import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProgram } from '../../src/index';
import { FormsApiClient } from '../../src/lib/forms-api';
import * as credentials from '../../src/lib/credentials';
import { ApiError, AuthError, ConfigError } from '../../src/lib/errors';

jest.mock('../../src/lib/forms-api');
jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/api', () => ({
  PauboxApiClient: jest.fn(),
  resolveAttachments: jest.fn(),
}));

const MockFormsApiClient = FormsApiClient as jest.MockedClass<typeof FormsApiClient>;
const mockLoadCredentials = credentials.loadCredentials as jest.Mock;

const CREDS = { apiUsername: 'user', apiKey: 'key', formsApiKey: 'forms-key-123' };

const LIST_RESPONSE = {
  results: [
    {
      id: 'form-1',
      title: 'Intake Form',
      active: true,
      archived: false,
      submission_count: 12,
    },
    {
      id: 'form-2',
      title: 'Feedback Form',
      active: false,
      // archived and submission_count intentionally absent to exercise ?? fallbacks
    },
  ],
  page_info: { count: 2, pages: 3, page: 1, items: 50 },
};

const STATS_RESPONSE = {
  active_form_count: 3,
  total_submission_count: 120,
  submissions_last_7_days: 7,
};

const SUBMISSIONS_RESPONSE = {
  data: [
    { id: 'sub-1', created_at: '2026-08-01T00:00:00Z', submitter_email: 'jane@example.com' },
    { id: 'sub-2', created_at: '2026-08-02T00:00:00Z', submitter_email: null },
  ],
  total: 2,
  page: 1,
  items: 50,
};

const COPIED_FORM = { id: 'new-form-id', title: 'Copied Form', active: false };

function captureStdout(): jest.SpyInstance {
  return jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

function joined(spy: jest.SpyInstance): string {
  return spy.mock.calls.map((c) => c[0]).join('');
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paubox-forms-admin-'));
  jest.clearAllMocks();
  mockLoadCredentials.mockResolvedValue(CREDS);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('paubox forms list', () => {
  beforeEach(() => {
    MockFormsApiClient.prototype.listForms = jest.fn().mockResolvedValue(LIST_RESPONSE);
  });

  it('passes all parsed options to listForms', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'list',
      '--customer-id', '42',
      '--page', '2',
      '--items', '10',
      '--search', 'intake',
      '--form-id', 'form-1',
      '--active', 'true',
      '--archived', 'false',
      '--order-by', 'title',
      '--order', 'asc',
    ]);

    expect(MockFormsApiClient.prototype.listForms).toHaveBeenCalledWith({
      customerId: 42,
      page: 2,
      items: 10,
      search: 'intake',
      formId: 'form-1',
      active: true,
      archived: false,
      orderBy: 'title',
      order: 'asc',
    });
  });

  it('sends only customerId when no optional flags given', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'list', '--customer-id', '42',
    ]);

    expect(MockFormsApiClient.prototype.listForms).toHaveBeenCalledWith({ customerId: 42 });
  });

  it('constructs FormsApiClient with the stored forms API key', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'list', '--customer-id', '42',
    ]);

    expect(MockFormsApiClient).toHaveBeenCalledWith(undefined, 'forms-key-123');
  });

  it('prints one line per form with fallbacks plus a page footer', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'list', '--customer-id', '42',
    ]);

    const output = joined(writeSpy);
    expect(output).toContain('form-1  Intake Form  active=true archived=false submissions=12');
    expect(output).toContain('form-2  Feedback Form  active=false archived=false submissions=0');
    expect(output).toContain('Page 1 of 3 (2 forms total)');
  });

  it('outputs the raw response with --json', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'list', '--customer-id', '42',
    ]);

    expect(JSON.parse(joined(writeSpy))).toEqual(LIST_RESPONSE);
  });

  it('throws ConfigError for non-integer --customer-id', async () => {
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'forms', 'list', '--customer-id', 'abc']),
    ).rejects.toThrow(ConfigError);
    expect(MockFormsApiClient.prototype.listForms).not.toHaveBeenCalled();
  });

  it('throws ConfigError for non-integer --page', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'list', '--customer-id', '42', '--page', '1.5',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError for invalid --active value', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'list', '--customer-id', '42', '--active', 'yes',
      ]),
    ).rejects.toThrow('--active must be "true" or "false"');
  });

  it('throws ConfigError for invalid --order-by column', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'list', '--customer-id', '42', '--order-by', 'bogus',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError for invalid --order direction', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'list', '--customer-id', '42', '--order', 'sideways',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('surfaces AuthError when no forms API key is configured', async () => {
    mockLoadCredentials.mockResolvedValue(null);
    MockFormsApiClient.prototype.listForms = jest
      .fn()
      .mockRejectedValue(new AuthError('No Forms API key configured.'));

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'forms', 'list', '--customer-id', '42']),
    ).rejects.toThrow(AuthError);
    expect(MockFormsApiClient).toHaveBeenCalledWith(undefined, undefined);
  });
});

describe('paubox forms stats', () => {
  beforeEach(() => {
    MockFormsApiClient.prototype.getFormStats = jest.fn().mockResolvedValue(STATS_RESPONSE);
  });

  it('calls getFormStats with undefined when --customer-id omitted', async () => {
    captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'forms', 'stats']);

    expect(MockFormsApiClient.prototype.getFormStats).toHaveBeenCalledWith(undefined);
  });

  it('calls getFormStats with the parsed --customer-id', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'stats', '--customer-id', '42',
    ]);

    expect(MockFormsApiClient.prototype.getFormStats).toHaveBeenCalledWith(42);
  });

  it('prints the three counters in human mode', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'forms', 'stats']);

    const output = joined(writeSpy);
    expect(output).toContain('Active forms');
    expect(output).toContain('3');
    expect(output).toContain('Total submissions');
    expect(output).toContain('120');
    expect(output).toContain('Submissions (last 7d)');
    expect(output).toContain('7');
  });

  it('outputs the raw response with --json', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'forms', 'stats']);

    expect(JSON.parse(joined(writeSpy))).toEqual(STATS_RESPONSE);
  });

  it('throws ConfigError for non-integer --customer-id', async () => {
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'forms', 'stats', '--customer-id', 'x']),
    ).rejects.toThrow(ConfigError);
  });
});

describe('paubox forms submissions', () => {
  beforeEach(() => {
    MockFormsApiClient.prototype.listSubmissions = jest
      .fn()
      .mockResolvedValue(SUBMISSIONS_RESPONSE);
  });

  it('passes all parsed options to listSubmissions', async () => {
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'submissions', 'form-1',
      '--page', '2',
      '--items', '25',
      '--order-by', 'submitter_email',
      '--order', 'desc',
      '--submission-id', 'sub-1',
    ]);

    expect(MockFormsApiClient.prototype.listSubmissions).toHaveBeenCalledWith('form-1', {
      page: 2,
      items: 25,
      orderBy: 'submitter_email',
      order: 'desc',
      submissionId: 'sub-1',
    });
  });

  it('sends empty params when no options given', async () => {
    captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'forms', 'submissions', 'form-1']);

    expect(MockFormsApiClient.prototype.listSubmissions).toHaveBeenCalledWith('form-1', {});
  });

  it('prints a line per submission with "-" for missing email plus totals', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'forms', 'submissions', 'form-1']);

    const output = joined(writeSpy);
    expect(output).toContain('sub-1  2026-08-01T00:00:00Z  jane@example.com');
    expect(output).toContain('sub-2  2026-08-02T00:00:00Z  -');
    expect(output).toContain('Page 1 (2 submissions total)');
  });

  it('outputs the raw response with --json', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'submissions', 'form-1',
    ]);

    expect(JSON.parse(joined(writeSpy))).toEqual(SUBMISSIONS_RESPONSE);
  });

  it('throws ConfigError for invalid --order-by column', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submissions', 'form-1', '--order-by', 'title',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError for non-integer --items', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'submissions', 'form-1', '--items', 'many',
      ]),
    ).rejects.toThrow(ConfigError);
  });
});

describe('paubox forms export-csv', () => {
  const CSV_BUFFER = Buffer.from('id,email\nsub-1,jane@example.com\n');

  beforeEach(() => {
    MockFormsApiClient.prototype.exportSubmissionsCsv = jest.fn().mockResolvedValue(CSV_BUFFER);
  });

  it('writes the CSV buffer to --output and prints success', async () => {
    const outPath = path.join(tmpDir, 'out.csv');
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'export-csv', 'form-1', '--output', outPath,
    ]);

    expect(MockFormsApiClient.prototype.exportSubmissionsCsv).toHaveBeenCalledWith(
      'form-1',
      undefined,
    );
    expect(fs.readFileSync(outPath)).toEqual(CSV_BUFFER);
    expect(joined(writeSpy)).toContain(`CSV written to ${outPath}`);
  });

  it('defaults to form-<formId>-submissions.csv without a submissionId', async () => {
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    captureStdout();
    try {
      await createProgram().parseAsync(['node', 'paubox', 'forms', 'export-csv', 'form-1']);
    } finally {
      process.chdir(prevCwd);
    }

    expect(fs.readFileSync(path.join(tmpDir, 'form-form-1-submissions.csv'))).toEqual(CSV_BUFFER);
  });

  it('defaults to submission-<submissionId>.csv and forwards the submissionId', async () => {
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    captureStdout();
    try {
      await createProgram().parseAsync([
        'node', 'paubox', 'forms', 'export-csv', 'form-1', 'sub-9',
      ]);
    } finally {
      process.chdir(prevCwd);
    }

    expect(MockFormsApiClient.prototype.exportSubmissionsCsv).toHaveBeenCalledWith(
      'form-1',
      'sub-9',
    );
    expect(fs.readFileSync(path.join(tmpDir, 'submission-sub-9.csv'))).toEqual(CSV_BUFFER);
  });

  it('outputs {status, formId, output} with --json', async () => {
    const outPath = path.join(tmpDir, 'out.csv');
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'export-csv', 'form-1', '--output', outPath,
    ]);

    expect(JSON.parse(joined(writeSpy))).toEqual({
      status: 'ok',
      formId: 'form-1',
      output: outPath,
    });
  });

  it('propagates ApiError without writing a file', async () => {
    MockFormsApiClient.prototype.exportSubmissionsCsv = jest
      .fn()
      .mockRejectedValue(new ApiError('Form or submission not found.', 404));
    const outPath = path.join(tmpDir, 'never.csv');

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'export-csv', 'form-x', '--output', outPath,
      ]),
    ).rejects.toThrow('Form or submission not found.');
    expect(fs.existsSync(outPath)).toBe(false);
  });
});

describe('paubox forms export-pdf', () => {
  const PDF_BUFFER = Buffer.from('%PDF-1.7 fake');

  beforeEach(() => {
    MockFormsApiClient.prototype.exportSubmissionPdf = jest.fn().mockResolvedValue(PDF_BUFFER);
  });

  it('writes the PDF buffer to --output and prints success', async () => {
    const outPath = path.join(tmpDir, 'out.pdf');
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'export-pdf', 'form-1', 'sub-1', '--output', outPath,
    ]);

    expect(MockFormsApiClient.prototype.exportSubmissionPdf).toHaveBeenCalledWith(
      'form-1',
      'sub-1',
    );
    expect(fs.readFileSync(outPath)).toEqual(PDF_BUFFER);
    expect(joined(writeSpy)).toContain(`PDF written to ${outPath}`);
  });

  it('defaults to submission-<submissionId>.pdf', async () => {
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    captureStdout();
    try {
      await createProgram().parseAsync([
        'node', 'paubox', 'forms', 'export-pdf', 'form-1', 'sub-7',
      ]);
    } finally {
      process.chdir(prevCwd);
    }

    expect(fs.readFileSync(path.join(tmpDir, 'submission-sub-7.pdf'))).toEqual(PDF_BUFFER);
  });

  it('outputs {status, formId, submissionId, output} with --json', async () => {
    const outPath = path.join(tmpDir, 'out.pdf');
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'export-pdf', 'form-1', 'sub-1',
      '--output', outPath,
    ]);

    expect(JSON.parse(joined(writeSpy))).toEqual({
      status: 'ok',
      formId: 'form-1',
      submissionId: 'sub-1',
      output: outPath,
    });
  });
});

describe('paubox forms archive / unarchive', () => {
  beforeEach(() => {
    MockFormsApiClient.prototype.archiveForm = jest.fn().mockResolvedValue(undefined);
    MockFormsApiClient.prototype.unarchiveForm = jest.fn().mockResolvedValue(undefined);
  });

  it('archive calls archiveForm and prints success', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'forms', 'archive', 'form-1']);

    expect(MockFormsApiClient.prototype.archiveForm).toHaveBeenCalledWith('form-1');
    expect(joined(writeSpy)).toContain('Form form-1 archived.');
  });

  it('archive outputs {status, formId} with --json', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', '--json', 'forms', 'archive', 'form-1']);

    expect(JSON.parse(joined(writeSpy))).toEqual({ status: 'ok', formId: 'form-1' });
  });

  it('unarchive calls unarchiveForm and prints success', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync(['node', 'paubox', 'forms', 'unarchive', 'form-1']);

    expect(MockFormsApiClient.prototype.unarchiveForm).toHaveBeenCalledWith('form-1');
    expect(joined(writeSpy)).toContain('Form form-1 unarchived.');
  });

  it('unarchive outputs {status, formId} with --json', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'unarchive', 'form-1',
    ]);

    expect(JSON.parse(joined(writeSpy))).toEqual({ status: 'ok', formId: 'form-1' });
  });

  it('archive propagates ApiError from the client', async () => {
    MockFormsApiClient.prototype.archiveForm = jest
      .fn()
      .mockRejectedValue(new ApiError('Form or submission not found.', 404));

    await expect(
      createProgram().parseAsync(['node', 'paubox', 'forms', 'archive', 'missing']),
    ).rejects.toThrow('Form or submission not found.');
  });
});

describe('paubox forms copy', () => {
  beforeEach(() => {
    MockFormsApiClient.prototype.copyForm = jest.fn().mockResolvedValue(COPIED_FORM);
  });

  it('calls copyForm with formId and title and prints the new form', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'copy', 'form-1', '--title', 'Copied Form',
    ]);

    expect(MockFormsApiClient.prototype.copyForm).toHaveBeenCalledWith('form-1', 'Copied Form');
    const output = joined(writeSpy);
    expect(output).toContain('Form copied.');
    expect(output).toContain('ID:    new-form-id');
    expect(output).toContain('Title: Copied Form');
  });

  it('outputs the raw new form record with --json', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'copy', 'form-1', '--title', 'Copied Form',
    ]);

    expect(JSON.parse(joined(writeSpy))).toEqual(COPIED_FORM);
  });
});

describe('paubox forms create', () => {
  const FORM_JSON = { fields: [{ name: 'email', type: 'text' }] };
  let formJsonPath: string;

  beforeEach(() => {
    MockFormsApiClient.prototype.createForm = jest.fn().mockResolvedValue({ id: 'created-id' });
    formJsonPath = path.join(tmpDir, 'form.json');
    fs.writeFileSync(formJsonPath, JSON.stringify(FORM_JSON));
  });

  it('sends the minimal body with defaults (version 1, active false)', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'create',
      '--title', 'New Form',
      '--customer-id', '42',
      '--form-json-file', formJsonPath,
    ]);

    expect(MockFormsApiClient.prototype.createForm).toHaveBeenCalledWith({
      title: 'New Form',
      customer_id: 42,
      form_json: FORM_JSON,
      version: 1,
      active: false,
    });
    expect(joined(writeSpy)).toContain('Form created: created-id');
  });

  it('sends the full body when all options are given', async () => {
    const htmlPath = path.join(tmpDir, 'form.html');
    const cssPath = path.join(tmpDir, 'form.css');
    fs.writeFileSync(htmlPath, '<form></form>');
    fs.writeFileSync(cssPath, 'form { color: red; }');
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'create',
      '--title', 'Full Form',
      '--customer-id', '42',
      '--form-json-file', formJsonPath,
      '--description', 'A form',
      '--recipient', 'ops@example.com',
      '--active',
      '--signable',
      '--signature-confirmation-label', 'Sign here',
      '--subscription-list-id', 'list-9',
      '--type', 'intake',
      '--form-html-file', htmlPath,
      '--form-css-file', cssPath,
    ]);

    expect(MockFormsApiClient.prototype.createForm).toHaveBeenCalledWith({
      title: 'Full Form',
      customer_id: 42,
      form_json: FORM_JSON,
      version: 1,
      active: true,
      description: 'A form',
      recipient: 'ops@example.com',
      signable: true,
      signature_confirmation_label: 'Sign here',
      subscription_list_id: 'list-9',
      type: 'intake',
      form_html: '<form></form>',
      form_css: 'form { color: red; }',
    });
  });

  it('accepts a non-object JSON root in --form-json-file', async () => {
    const arrPath = path.join(tmpDir, 'arr.json');
    fs.writeFileSync(arrPath, '[{"q":1}]');
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'create',
      '--title', 'Arr', '--customer-id', '1', '--form-json-file', arrPath,
    ]);

    const body = (MockFormsApiClient.prototype.createForm as jest.Mock).mock.calls[0][0];
    expect(body.form_json).toEqual([{ q: 1 }]);
  });

  it('throws ConfigError when --form-json-file is not valid JSON', async () => {
    const badPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badPath, 'not json');

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'create',
        '--title', 'T', '--customer-id', '1', '--form-json-file', badPath,
      ]),
    ).rejects.toThrow(ConfigError);
    expect(MockFormsApiClient.prototype.createForm).not.toHaveBeenCalled();
  });

  it('throws ConfigError when --form-json-file does not exist', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'create',
        '--title', 'T', '--customer-id', '1',
        '--form-json-file', '/nonexistent/form.json',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  // NOTE: `--version <n>` on `forms create` cannot be exercised through parseAsync:
  // the root program's `-v, --version` flag consumes `--version` anywhere in argv
  // and exits with the CLI version (implementation bug — see forms-admin.ts).
  // The default path (version: 1) is covered by the minimal-body test above.

  it('throws ConfigError for non-integer --customer-id', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'create',
        '--title', 'T', '--customer-id', 'acme', '--form-json-file', formJsonPath,
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when --form-html-file cannot be read', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'create',
        '--title', 'T', '--customer-id', '1', '--form-json-file', formJsonPath,
        '--form-html-file', '/nonexistent/form.html',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('outputs the raw {id} response with --json', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'create',
      '--title', 'T', '--customer-id', '1', '--form-json-file', formJsonPath,
    ]);

    expect(JSON.parse(joined(writeSpy))).toEqual({ id: 'created-id' });
  });

  it('surfaces AuthError when no forms API key is configured', async () => {
    mockLoadCredentials.mockResolvedValue({ apiUsername: 'user', apiKey: 'key' });
    MockFormsApiClient.prototype.createForm = jest
      .fn()
      .mockRejectedValue(new AuthError('No Forms API key configured.'));

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'create',
        '--title', 'T', '--customer-id', '1', '--form-json-file', formJsonPath,
      ]),
    ).rejects.toThrow(AuthError);
    expect(MockFormsApiClient).toHaveBeenCalledWith(undefined, undefined);
  });
});

describe('paubox forms update', () => {
  beforeEach(() => {
    MockFormsApiClient.prototype.updateForm = jest.fn().mockResolvedValue(undefined);
  });

  it('sends only the provided fields', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'update', 'form-1',
      '--title', 'Renamed',
      '--active', 'false',
    ]);

    expect(MockFormsApiClient.prototype.updateForm).toHaveBeenCalledWith('form-1', {
      title: 'Renamed',
      active: false,
    });
    expect(joined(writeSpy)).toContain('Form form-1 updated.');
  });

  it('sends all updatable fields when given', async () => {
    const jsonPath = path.join(tmpDir, 'update.json');
    fs.writeFileSync(jsonPath, '{"fields":[]}');
    captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', 'forms', 'update', 'form-1',
      '--title', 'T',
      '--description', 'D',
      '--recipient', 'r@example.com',
      '--active', 'true',
      '--vanity-url', 'my-form',
      '--subscription-list-id', 'list-1',
      '--form-json-file', jsonPath,
    ]);

    expect(MockFormsApiClient.prototype.updateForm).toHaveBeenCalledWith('form-1', {
      title: 'T',
      description: 'D',
      recipient: 'r@example.com',
      active: true,
      vanity_url: 'my-form',
      subscription_list_id: 'list-1',
      form_json: { fields: [] },
    });
  });

  it('throws ConfigError when no update options are provided', async () => {
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'forms', 'update', 'form-1']),
    ).rejects.toThrow('No update options provided.');
    expect(MockFormsApiClient.prototype.updateForm).not.toHaveBeenCalled();
  });

  it('throws ConfigError for invalid --active value', async () => {
    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'update', 'form-1', '--active', 'maybe',
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when --form-json-file is invalid JSON', async () => {
    const badPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badPath, '{oops');

    await expect(
      createProgram().parseAsync([
        'node', 'paubox', 'forms', 'update', 'form-1', '--form-json-file', badPath,
      ]),
    ).rejects.toThrow(ConfigError);
  });

  it('outputs {status, formId} with --json', async () => {
    const writeSpy = captureStdout();

    await createProgram().parseAsync([
      'node', 'paubox', '--json', 'forms', 'update', 'form-1', '--title', 'T',
    ]);

    expect(JSON.parse(joined(writeSpy))).toEqual({ status: 'ok', formId: 'form-1' });
  });
});
