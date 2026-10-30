import { describe, expect, it, vi } from 'vitest';

import { StudioManager, type StudioManagerDependencies } from '@storyboard/story-app';

describe('StudioManager.chat', () => {
  it.each([true, false])(
    'passes the studio validation setting (%s) to the chat',
    async (isEnabled) => {
      const execute = vi.fn(async () => []);
      const manager = new StudioManager({
        studioChatUseCase: { execute },
        configBridge: { isStudioValidationEnabled: () => isEnabled },
      } as unknown as StudioManagerDependencies);

      await manager.chat({ message: '안녕' } as never);

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ message: '안녕', isValidationEnabled: isEnabled }),
      );
    },
  );
});
