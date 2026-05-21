import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/index';
import { FormsApiClient } from '../../src/lib/forms-api';
import { ApiError, ConfigError } from '../../src/lib/errors';

jest.mock('../../src/lib/forms-api');
jest.mock('../../src/lib/api', () => ({
  PauboxApiClient: jest.fn(),
  resolveAttachments: jest.fn(),
}));

import { resolveAttachments } from '../../src/lib/api';

const MockFormsApiClient = FormsApiClient as jest.MockedClass<typeof FormsApiClient>;
const mockResolveAttachments = resolveAttachments as jest.Mock;

const FORM_RESPONSE = {
  id: 'abc123',
  title: 'Contact Form',
  description: 'Get in touch',
  active: true,
  submission_count: 10,
  signable: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-forms-'));
  jest.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('paubox forms get', () => {
  it('calls getForm with the correct formId', async () => {
    MockFormsApiClient.prototype.getForm = jest.fn().mockResolvedValue(FORM_RESPONSE);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'forms', 'get', 'abc123']);

    expect(MockFormsApiClient.prototype.getForm).toHaveBeenCalledWith('abc123');
  });

  it('prints human-readable metadata', async () => {
    MockFormsApiClient.prototype.getForm = jest.fn().mockResolvedValue(FORM_RESPONSE);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'forms', 'get', 'abc123']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Contact Form');
    expect(output).toContain('abc123');
    expect(output).toContain('10');
    writeSpy.mockRestore();
  });

  it('outputs JSON with --json flag', async () => {
    MockFormsApiClient.prototype.getForm = jest.fn().mockResolvedValue(FORM_RESPONSE);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'forms', 'get', 'abc123']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(FORM_RESPONSE);
    writeSpy.mockRestore();
  });

  it('propagates ApiError from getForm', async () => {
    MockFormsApiClient.prototype.getForm = jest
      .fn()
      .mockRejectedValue(new ApiError('Form not found.', 404));

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'forms', 'get', 'missing-id']),
    ).rejects.toThrow('Form not found.');
  });
});

describe('paubox forms submit', () => {
  beforeEach(() => {
    MockFormsApiClient.prototype.submitForm = jest.fn().mockResolvedValue(undefined);
  });

  it('parses single --data key=value into form_data', async () => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'submit', 'abc123',
      '--data', 'name=Jane',
    ]);

    expect(MockFormsApiClient.prototype.submitForm).toHaveBeenCalledWith(
      'abc123',
      expect.objectContaining({ form_data: { name: 'Jane' } }),
    );
  });

  it('parses multiple --data flags into merged object', async () => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'submit', 'abc123',
      '--data', 'first=Jane',
      '--data', 'last=Doe',
      '--data', 'token=abc=def',
    ]);

    expect(MockFormsApiClient.prototype.submitForm).toHaveBeenCalledWith(
      'abc123',
      expect.objectContaining({
        form_data: { first: 'Jane', last: 'Doe', token: 'abc=def' },
      }),
    );
  });

  it('reads --data-file and passes contents to submitForm', async () => {
    const filePath = path.join(tmpDir, 'fields.json');
    fs.writeFileSync(filePath, JSON.stringify({ email: 'jane@example.com', role: 'admin' }));
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'submit', 'abc123',
      '--data-file', filePath,
    ]);

    expect(MockFormsApiClient.prototype.submitForm).toHaveBeenCalledWith(
      'abc123',
      expect.objectContaining({
        form_data: { email: 'jane@example.com', role: 'admin' },
      }),
    );
  });

  it('--data overrides matching keys from --data-file', async () => {
    const filePath = path.join(tmpDir, 'base.json');
    fs.writeFileSync(filePath, JSON.stringify({ name: 'FromFile', extra: 'value' }));
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'submit', 'abc123',
      '--data-file', filePath,
      '--data', 'name=Override',
    ]);

    const callArg = (MockFormsApiClient.prototype.submitForm as jest.Mock).mock.calls[0][1];
    expect(callArg.form_data).toEqual({ name: 'Override', extra: 'value' });
  });

  it('throws ConfigError when no form data provided', async () => {
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'forms', 'submit', 'abc123']),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError for malformed --data value (missing =)', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submit', 'abc123',
        '--data', 'badvalue',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when --data-file path does not exist', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submit', 'abc123',
        '--data-file', '/nonexistent/path/fields.json',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when --data-file contains invalid JSON', async () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not json at all');
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submit', 'abc123',
        '--data-file', filePath,
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when --data-file JSON root is an array', async () => {
    const filePath = path.join(tmpDir, 'arr.json');
    fs.writeFileSync(filePath, '["a","b"]');
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submit', 'abc123',
        '--data-file', filePath,
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when --data-file has non-string values', async () => {
    const filePath = path.join(tmpDir, 'nonstr.json');
    fs.writeFileSync(filePath, '{"count":42}');
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submit', 'abc123',
        '--data-file', filePath,
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('passes attachments to submitForm when --attach given', async () => {
    const filePath = path.join(tmpDir, 'doc.pdf');
    fs.writeFileSync(filePath, 'content');
    const fakeAttachment = { fileName: 'doc.pdf', contentType: 'application/pdf', content: 'Y29udGVudA==' };
    mockResolveAttachments.mockReturnValue([fakeAttachment]);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'submit', 'abc123',
      '--data', 'name=Jane',
      '--attach', filePath,
    ]);

    expect(mockResolveAttachments).toHaveBeenCalledWith([filePath]);
    const callArg = (MockFormsApiClient.prototype.submitForm as jest.Mock).mock.calls[0][1];
    expect(callArg.attachments).toEqual([fakeAttachment]);
  });

  it('prints success message on completion', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'submit', 'abc123',
      '--data', 'name=Jane',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('Form submitted successfully.');
    writeSpy.mockRestore();
  });

  it('outputs JSON with --json flag', async () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'submit', 'abc123',
      '--data', 'name=Jane',
    ]);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ status: 'ok', formId: 'abc123' });
    writeSpy.mockRestore();
  });

  it('propagates ApiError from submitForm (404)', async () => {
    MockFormsApiClient.prototype.submitForm = jest
      .fn()
      .mockRejectedValue(new ApiError('Form not found.', 404));

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submit', 'missing',
        '--data', 'x=y',
      ]),
    ).rejects.toThrow('Form not found.');
  });

  it('propagates ApiError from submitForm (422)', async () => {
    MockFormsApiClient.prototype.submitForm = jest
      .fn()
      .mockRejectedValue(new ApiError('Submission validation failed: {"error":"bad"}', 422));

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submit', 'abc123',
        '--data', 'x=y',
      ]),
    ).rejects.toThrow('Submission validation failed');
  });

  it('propagates ApiError from submitForm (413)', async () => {
    MockFormsApiClient.prototype.submitForm = jest
      .fn()
      .mockRejectedValue(new ApiError('Payload too large (413).', 413));

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submit', 'abc123',
        '--data', 'x=y',
      ]),
    ).rejects.toThrow('Payload too large');
  });
});
