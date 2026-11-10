import { ValidationError } from './errors';
import type { AttachmentOption } from '../types';

/**
 * Deliberately permissive: this catches typos and shell-mangled arguments, not
 * RFC 5322 violations. Rejecting an address the API would have accepted is a
 * worse failure than passing one through, so anything with a plausible
 * local@domain.tld shape is allowed and the API has the final say.
 */
const EMAIL_RE = /^[^\s@,<>]+@[^\s@,<>]+\.[A-Za-z]{2,}$/;

/** `Display Name <user@example.com>` is accepted wherever a bare address is. */
const DISPLAY_NAME_RE = /^[^<>]*<([^\s<>]+)>$/;

/** The Email API caps a request at 250 MB; base64 inflates by ~4/3. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 250 * 1024 * 1024;

export function extractAddress(value: string): string {
  const match = DISPLAY_NAME_RE.exec(value.trim());
  return (match?.[1] ?? value).trim();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(extractAddress(value));
}

export interface MessageInput {
  to: string[];
  from: string;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: AttachmentOption[];
}

/**
 * Check a message locally before spending a round trip on it.
 *
 * Collects every problem rather than stopping at the first, so a user fixing a
 * malformed command gets the whole list in one pass instead of one per retry.
 */
export function validateMessage(input: MessageInput): void {
  const problems: string[] = [];

  if (input.to.length === 0) {
    problems.push('--to: at least one recipient is required');
  }
  for (const recipient of input.to) {
    if (!isValidEmail(recipient)) {
      problems.push(`--to: "${recipient}" is not a valid email address`);
    }
  }

  if (!input.from || input.from.trim() === '') {
    problems.push('--from: a sender address is required');
  } else if (!isValidEmail(input.from)) {
    problems.push(`--from: "${input.from}" is not a valid email address`);
  }

  if (input.subject !== undefined && input.subject.trim() === '') {
    problems.push('--subject: must not be empty');
  }

  const hasText = input.text !== undefined && input.text !== '';
  const hasHtml = input.html !== undefined && input.html !== '';
  if (!hasText && !hasHtml) {
    problems.push('--text/--html: provide at least one message body');
  }

  const totalBytes = (input.attachments ?? []).reduce(
    // `content` is already base64 at this point; the wire size is what the API caps.
    (sum, attachment) => sum + attachment.content.length,
    0,
  );
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    const mb = Math.round(totalBytes / (1024 * 1024));
    problems.push(`--attachment: total encoded size is ${mb} MB, over the 250 MB request limit`);
  }

  if (problems.length > 0) {
    throw new ValidationError(
      problems.length === 1
        ? `Invalid message: ${problems[0]}`
        : `Invalid message — ${problems.length} problems found.`,
      'Fix the arguments listed above. Nothing was sent.',
      problems,
    );
  }
}

/** ISO 8601 with an offset, which is what the schedule endpoint requires. */
export function validateScheduledAt(value: string): void {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ValidationError(
      `--at: "${value}" is not a valid timestamp.`,
      'Use an ISO 8601 timestamp with an offset, e.g. 2026-11-12T09:00:00-08:00.',
    );
  }
  if (parsed <= Date.now()) {
    throw new ValidationError(
      `--at: "${value}" is in the past.`,
      'Schedule a time in the future, e.g. 2026-11-12T09:00:00-08:00.',
    );
  }
}
