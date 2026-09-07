import { describe, expect, it, vi } from 'vitest';

import { createSyncConflictNotifier } from '@/app/syncConflictNotifier';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('sync conflict notifier', () => {
  it('sends the conflict text to every allowlisted chat', () => {
    const sendMessage = vi.fn(() => Promise.resolve());

    createSyncConflictNotifier({
      allowedChatIds: [10, 20],
      sendMessage,
      logger: silentLogger,
    })('⚠️ 충돌');

    expect(sendMessage.mock.calls).toEqual([
      [10, '⚠️ 충돌'],
      [20, '⚠️ 충돌'],
    ]);
  });

  it('logs instead of throwing when no chat is allowlisted', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const sendMessage = vi.fn(() => Promise.resolve());

    createSyncConflictNotifier({ allowedChatIds: [], sendMessage, logger })('⚠️ 충돌');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  // A failed delivery must not reject into the periodic sync's promise chain and take the tick down.
  it('swallows a delivery failure into the log', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    createSyncConflictNotifier({
      allowedChatIds: [10],
      sendMessage: () => Promise.reject(new Error('telegram down')),
      logger,
    })('⚠️ 충돌');

    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
