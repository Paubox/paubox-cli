import type { Command } from 'commander';
import { buildWebhookCommands } from './webhooks';

/**
 * Deprecated alias for `paubox webhooks`.
 *
 * This group was nested under `forms` when pb_webhooks mapped only the `forms`
 * IAM scope for API keys, so an API key genuinely could not manage Email API
 * subscriptions. The 2026-10-14 cutover changed that: `email_api` now maps to
 * `view_email_api_section`, so one command covers every event a key is scoped
 * for and the nesting implies a limit that no longer exists.
 *
 * Kept so scripts written against 1.4.0 keep working. It delegates to the same
 * implementation and warns on every invocation.
 */
export function registerFormsWebhookCommands(forms: Command, program: Command): void {
  buildWebhookCommands(forms, program, { deprecated: true });
}
