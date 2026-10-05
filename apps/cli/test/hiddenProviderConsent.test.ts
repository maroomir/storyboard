import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChoiceRequest, IPrompter } from '@/adapters/prompter';
import type { ParsedArguments } from '@/cliArguments';
import { runConfigSet, runSetup } from '@/commands/setup';
import { createCliContainer } from '@/container';

const enabledKey = 'providers.claude-code.enabled';

let home: string;
let workspace: string;
let warnings: string[];
let questions: ChoiceRequest<unknown>[];

function args(positionals: string[]): ParsedArguments {
  return { path: [], flags: {}, positionals };
}

function prompterAnswering(isAccepted: boolean | undefined): IPrompter {
  return {
    choose: async <T>(request: ChoiceRequest<T>) => {
      questions.push(request);
      return request.options.find((option) => option.value === isAccepted)?.value;
    },
    askText: async () => undefined,
    announce: () => undefined,
    shouldConfirmPaidRuns: false,
  };
}

function container(prompter?: IPrompter): ReturnType<typeof createCliContainer> {
  return createCliContainer({
    workspacePath: workspace,
    logger: {
      info: () => undefined,
      warn: (message: string) => warnings.push(message),
      error: () => undefined,
      show: () => undefined,
    },
    canPrompt: prompter !== undefined,
    version: '0.0.0',
    ...(prompter === undefined ? {} : { prompter }),
  });
}

function homeConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-consent-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-consent-ws-'));
  warnings = [];
  questions = [];
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('switching the hidden subscription provider on', () => {
  it('shows every risk and offers no as the first answer', async () => {
    await runConfigSet({
      container: container(prompterAnswering(false)),
      args: args([enabledKey, 'true']),
    });

    const [question] = questions;
    const text = question?.details.join('\n') ?? '';

    expect(question?.title).toBe('구독 로그인으로 생성하기 전에 확인해 주세요.');
    for (const risk of [
      '구독 한도를 함께 씁니다.',
      '계정이 제한될 수 있습니다.',
      '예고 없이 멈출 수 있습니다.',
      '예산이 멈춰 주지 않습니다.',
      '실험 기능입니다.',
    ]) {
      expect(text).toContain(risk);
    }
    expect(question?.options[0]?.value).toBe(false);
  });

  it('changes nothing when the answer is no', async () => {
    const outcome = await runConfigSet({
      container: container(prompterAnswering(false)),
      args: args([enabledKey, 'true']),
    });

    expect(outcome.ok).toBe(false);
    expect(homeConfig()).toEqual({});
  });

  it('changes nothing when the person backs out of the question', async () => {
    const outcome = await runConfigSet({
      container: container(prompterAnswering(undefined)),
      args: args([enabledKey, 'true']),
    });

    expect(outcome.ok).toBe(false);
    expect(homeConfig()).toEqual({});
  });

  it('refuses without a person to ask, whatever flags are given', async () => {
    const outcome = await runConfigSet({
      container: container(),
      args: { path: [], flags: { yes: true, global: true }, positionals: [enabledKey, 'true'] },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('직접 동의');
    expect(homeConfig()).toEqual({});
  });

  it('records the acceptance in the home file and warns', async () => {
    const outcome = await runConfigSet({
      container: container(prompterAnswering(true)),
      args: args([enabledKey, 'true']),
    });

    expect(outcome.ok).toBe(true);
    expect(homeConfig()).toEqual({
      providers: { 'claude-code': { enabled: true, riskAcknowledged: true } },
    });
    expect(warnings).toHaveLength(1);
  });

  it('asks only once: after a yes, switching it back on is a warning', async () => {
    await runConfigSet({
      container: container(prompterAnswering(true)),
      args: args([enabledKey, 'true']),
    });
    await runConfigSet({ container: container(), args: args([enabledKey, 'false']) });
    questions = [];
    warnings = [];

    const outcome = await runConfigSet({
      container: container(),
      args: args([enabledKey, 'true']),
    });

    expect(outcome.ok).toBe(true);
    expect(questions).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(homeConfig()).toEqual({
      providers: { 'claude-code': { enabled: true, riskAcknowledged: true } },
    });
  });

  // QA D3: switching it off left `ai.provider.default: claude-code` behind, which made the whole home
  // file invalid, so it could never be switched back on.
  it('can be switched off and back on after it became the default', async () => {
    await runConfigSet({
      container: container(prompterAnswering(true)),
      args: args([enabledKey, 'true']),
    });
    const chosen = await runSetup({
      container: container(),
      args: { path: [], flags: { provider: 'claude-code', global: true }, positionals: [] },
    });
    expect(chosen.ok).toBe(true);

    const off = await runConfigSet({ container: container(), args: args([enabledKey, 'false']) });
    expect(off.ok).toBe(true);
    expect(off.message).toContain('storyboard setup');
    expect(homeConfig()).toEqual({
      providers: { 'claude-code': { enabled: false, riskAcknowledged: true } },
    });
    expect(container().configBridge.isDefaultProviderConfigured()).toBe(false);

    warnings = [];
    const on = await runConfigSet({ container: container(), args: args([enabledKey, 'true']) });
    expect(on.ok).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it('clears the task routes that named it, in both the home and the work file', async () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        ai: { provider: { default: 'claude' } },
        providers: { 'claude-code': { enabled: true, riskAcknowledged: true } },
        tasks: {
          sceneDraft: { provider: 'claude-code', model: 'claude-sonnet-5' },
          grammarCheck: { provider: 'claude', model: 'claude-sonnet-5' },
        },
      }),
    );
    mkdirSync(join(workspace, '.storyboard'), { recursive: true });
    writeFileSync(
      join(workspace, '.storyboard', 'config.json'),
      JSON.stringify({ 'ai.provider.default': 'claude-code', 'budget.run.limitUsd': 3 }),
    );

    const off = await runConfigSet({ container: container(), args: args([enabledKey, 'false']) });

    expect(off.ok).toBe(true);
    expect(homeConfig()).toEqual({
      ai: { provider: { default: 'claude' } },
      providers: { 'claude-code': { enabled: false, riskAcknowledged: true } },
      tasks: { grammarCheck: { provider: 'claude', model: 'claude-sonnet-5' } },
    });
    expect(JSON.parse(readFileSync(join(workspace, '.storyboard', 'config.json'), 'utf8'))).toEqual(
      { 'budget.run.limitUsd': 3 },
    );
    expect(container().configBridge.getDefaultProvider()).toBe('claude');
  });

  it('writes its keys to the home file even inside a workspace', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ [enabledKey]: true }));

    const command = await runConfigSet({
      container: container(),
      args: args(['providers.claude-code.command', '/opt/bin/claude']),
    });
    const timeout = await runConfigSet({
      container: container(),
      args: args(['providers.claude-code.timeoutMs', '900000']),
    });
    const badTimeout = await runConfigSet({
      container: container(),
      args: args(['providers.claude-code.timeoutMs', 'soon']),
    });

    expect(command.ok).toBe(true);
    expect(timeout.ok).toBe(true);
    expect(badTimeout.ok).toBe(false);
    expect(container().configBridge.getCliProviderConfig('claude-code')).toEqual({
      command: '/opt/bin/claude',
      timeoutMs: 900000,
    });
  });

  // QA D4: an empty command was saved, after which the schema rejected the home file and every
  // command — including the one that would fix it — failed.
  it('refuses an empty or blank command before writing anything', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ [enabledKey]: true }));
    const before = homeConfig();

    for (const blank of ['', '   ']) {
      const outcome = await runConfigSet({
        container: container(),
        args: args(['providers.claude-code.command', blank]),
      });

      expect(outcome.ok).toBe(false);
      expect(homeConfig()).toEqual(before);
    }

    const fixed = await runConfigSet({
      container: container(),
      args: args(['providers.claude-code.command', '/opt/bin/claude']),
    });
    expect(fixed.ok).toBe(true);
  });

  it('treats its other keys as an unknown provider while it is off', async () => {
    const outcome = await runConfigSet({
      container: container(),
      args: args(['providers.claude-code.command', '/opt/bin/claude']),
    });

    expect(outcome).toEqual({ ok: false, message: '알 수 없는 프로바이더: claude-code' });
  });
});
