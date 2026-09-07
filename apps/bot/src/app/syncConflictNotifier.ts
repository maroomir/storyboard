import type { SyncLogger } from '@storyboard/story-git';

export interface SyncConflictNotifierDependencies {
  readonly allowedChatIds: readonly number[];
  readonly sendMessage: (chatId: number, text: string) => PromiseLike<unknown>;
  readonly logger: SyncLogger;
}

// A sync conflict stops the push, so drafts stop reaching the phone while the bot still looks
// healthy. Nothing else surfaces it — the periodic sync runs unattended — so the state change is
// announced to every allowlisted chat. SyncService fires this only on the transition into
// conflict, never once per periodic tick.
export function createSyncConflictNotifier(
  dependencies: SyncConflictNotifierDependencies,
): (text: string) => void {
  const { allowedChatIds, sendMessage, logger } = dependencies;

  return (text) => {
    if (allowedChatIds.length === 0) {
      logger.warn(`동기화 충돌을 알릴 chat이 없습니다(allowedChatIds 비어 있음).\n${text}`);
      return;
    }

    for (const chatId of allowedChatIds) {
      Promise.resolve(sendMessage(chatId, text)).then(undefined, (error: unknown) => {
        logger.error(`동기화 충돌 알림 전송 실패(chat ${chatId})`, error);
      });
    }
  };
}
