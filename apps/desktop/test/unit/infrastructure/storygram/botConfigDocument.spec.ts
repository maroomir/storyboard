import { describe, expect, it } from 'vitest';

import {
  applyBotConfigPatch,
  maskBotToken,
  readBotConfigView,
} from '../../../../src/infrastructure/storygram/botConfigDocument';

const FULL_CONFIG = {
  telegram: {
    botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    allowedChatIds: [1, 2],
    allowedUserIds: [],
  },
  workspace: { path: '/novels/a', remote: 'origin', pushDebounceSec: 45 },
  providers: {
    default: 'claude-code',
    tasks: { sceneDraft: 'codex' },
    models: { codex: { model: 'gpt-5.2-codex' } },
  },
  draft: { reviseAfterGenerate: false, reviseMaxIterations: 3 },
  jobs: { heavyConcurrency: 2, lightConcurrency: 1 },
  dashboard: { enabled: true, port: 9000 },
};

describe('maskBotToken', () => {
  it('keeps the public bot id and hides the secret half', () => {
    expect(maskBotToken('123456789:AAHdqTcvCH1vGWJx')).toBe('123456789:••••••');
  });

  it('never returns the raw secret for odd inputs', () => {
    expect(maskBotToken('nocolon')).toBe('nocolon:••••••');
    expect(maskBotToken('')).toBeNull();
    expect(maskBotToken(undefined)).toBeNull();
  });
});

describe('readBotConfigView', () => {
  it('projects the fields the panel edits', () => {
    const view = readBotConfigView(FULL_CONFIG);

    expect(view).toEqual({
      tokenHint: '123456789:••••••',
      allowedChatIds: [1, 2],
      allowedUserIds: [],
      workspacePath: '/novels/a',
      remote: 'origin',
      defaultProvider: 'claude-code',
      dashboardPort: 9000,
    });
  });

  it('degrades to empty values instead of throwing on a broken document', () => {
    const view = readBotConfigView({ telegram: 'nope', workspace: null, providers: [] });

    expect(view.tokenHint).toBeNull();
    expect(view.allowedChatIds).toEqual([]);
    expect(view.workspacePath).toBeNull();
    expect(view.defaultProvider).toBeNull();
  });

  it('rejects a provider id the bot would not accept', () => {
    expect(readBotConfigView({ providers: { default: 'openai' } }).defaultProvider).toBeNull();
  });
});

describe('applyBotConfigPatch', () => {
  it('preserves every section the panel does not edit', () => {
    const next = applyBotConfigPatch(FULL_CONFIG, { defaultProvider: 'codex' });

    expect(next.draft).toEqual(FULL_CONFIG.draft);
    expect(next.jobs).toEqual(FULL_CONFIG.jobs);
    expect(next.dashboard).toEqual(FULL_CONFIG.dashboard);
    expect(next.providers).toEqual({
      default: 'codex',
      tasks: { sceneDraft: 'codex' },
      models: { codex: { model: 'gpt-5.2-codex' } },
    });
  });

  // SECURITY: an edit of any other field must never disturb the token.
  it('leaves the token untouched', () => {
    const next = applyBotConfigPatch(FULL_CONFIG, {
      allowedChatIds: [7],
      workspacePath: '/novels/b',
    });

    expect((next.telegram as { botToken: string }).botToken).toBe(FULL_CONFIG.telegram.botToken);
    expect((next.telegram as { allowedChatIds: number[] }).allowedChatIds).toEqual([7]);
    expect((next.workspace as { path: string }).path).toBe('/novels/b');
    expect((next.workspace as { pushDebounceSec: number }).pushDebounceSec).toBe(45);
  });

  it('removes the remote when it is cleared instead of writing null', () => {
    const next = applyBotConfigPatch(FULL_CONFIG, { remote: null });

    expect(next.workspace).not.toHaveProperty('remote');
    expect((next.workspace as { path: string }).path).toBe('/novels/a');
  });

  it('returns an unchanged document for an empty patch', () => {
    expect(applyBotConfigPatch(FULL_CONFIG, {})).toEqual(FULL_CONFIG);
  });
});
