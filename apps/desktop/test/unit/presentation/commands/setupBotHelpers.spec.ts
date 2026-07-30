import { describe, expect, it } from 'vitest';

import {
  BROWSE_FOLDER_LABEL,
  buildWorkspacePickOptions,
} from '@/presentation/commands/setupBotHelpers';

describe('buildWorkspacePickOptions', () => {
  it('offers only the browse entry when no folder is open', () => {
    const options = buildWorkspacePickOptions([]);

    expect(options).toHaveLength(1);
    expect(options[0]?.label).toBe(BROWSE_FOLDER_LABEL);
    expect(options[0]?.path).toBeUndefined();
  });

  it('keeps uninitialized folders as init candidates instead of hiding them', () => {
    const options = buildWorkspacePickOptions([{ path: '/ws/blank', hasProject: false }]);

    expect(options.map((option) => option.label)).toEqual(['/ws/blank', BROWSE_FOLDER_LABEL]);
    expect(options[0]).toMatchObject({ path: '/ws/blank', needsInit: true });
  });

  it('lists ready workspaces before ones that need initialization', () => {
    const options = buildWorkspacePickOptions([
      { path: '/ws/blank', hasProject: false },
      { path: '/ws/novel', hasProject: true },
    ]);

    expect(options.map((option) => option.label)).toEqual([
      '/ws/novel',
      '/ws/blank',
      BROWSE_FOLDER_LABEL,
    ]);
    expect(options[0]?.needsInit).toBe(false);
    expect(options[1]?.needsInit).toBe(true);
  });

  it('never marks the browse entry as needing initialization', () => {
    const options = buildWorkspacePickOptions([{ path: '/ws/novel', hasProject: true }]);

    expect(options.at(-1)).toMatchObject({ label: BROWSE_FOLDER_LABEL, needsInit: false });
  });
});
