export interface IAllowlist {
  isAllowed(chatId: number, userId: number | undefined): boolean;
}

export interface AllowlistConfig {
  readonly allowedChatIds: readonly number[];
  readonly allowedUserIds: readonly number[];
}

// QA-04: an update is authorized when its chat is allowlisted, or its sender is an allowlisted
// user (useful in groups). With both lists empty, nothing is allowed — a safe default.
export function createAllowlist(config: AllowlistConfig): IAllowlist {
  const chats = new Set(config.allowedChatIds);
  const users = new Set(config.allowedUserIds);

  return {
    isAllowed(chatId, userId) {
      return chats.has(chatId) || (userId !== undefined && users.has(userId));
    },
  };
}
