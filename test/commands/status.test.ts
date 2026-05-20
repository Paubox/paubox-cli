import { createProgram } from '../../src/index';
import * as credentials from '../../src/lib/credentials';
import { PauboxApiClient } from '../../src/lib/api';

jest.mock('../../src/lib/credentials');
jest.mock('../../src/lib/api');

const mockCredentials = credentials as jest.Mocked<typeof credentials>;
const MockPauboxApiClient = PauboxApiClient as jest.MockedClass<typeof PauboxApiClient>;

const mockStatusResponse = {
  sourceTrackingId: 'track-1',
  data: {
    message: {
      id: 'msg-1',
      message_deliveries: [
        {
          recipient: 'to@example.com',
          status: {
            deliveryStatus: 'delivered',
            deliveryTime: '2026-01-01T00:00:00Z',
            openedStatus: 'opened',
            openedTime: '2026-01-01T01:00:00Z',
          },
        },
      ],
    },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('paubox status', () => {
  it('throws AuthError when not authenticated', async () => {
    mockCredentials.loadCredentials.mockResolvedValue(null);
    await expect(
      createProgram().parseAsync(['node', 'paubox', 'status', 'track-1']),
    ).rejects.toThrow();
  });

  it('prints a table of delivery statuses', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: 'u', apiKey: 'k' });
    MockPauboxApiClient.prototype.getMessageStatus = jest.fn().mockResolvedValue(mockStatusResponse);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'status', 'track-1']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('to@example.com');
    expect(output).toContain('delivered');
    writeSpy.mockRestore();
  });

  it('outputs JSON with --json flag', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: 'u', apiKey: 'k' });
    MockPauboxApiClient.prototype.getMessageStatus = jest.fn().mockResolvedValue(mockStatusResponse);
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', '--json', 'status', 'track-1']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.sourceTrackingId).toBe('track-1');
    writeSpy.mockRestore();
  });

  it('reports no deliveries when list is empty', async () => {
    mockCredentials.loadCredentials.mockResolvedValue({ apiUsername: 'u', apiKey: 'k' });
    MockPauboxApiClient.prototype.getMessageStatus = jest.fn().mockResolvedValue({
      ...mockStatusResponse,
      data: { message: { id: 'x', message_deliveries: [] } },
    });
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await createProgram().parseAsync(['node', 'paubox', 'status', 'track-1']);

    const output = writeSpy.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('No delivery records');
    writeSpy.mockRestore();
  });
});
