import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectCurrentChapterHashes, getStoryboardProjectPaths } from '@storyboard/story-engine';

import { createCliContainer } from '../src/container';
import { runConfigSet, runConfigShow, runDoctor, runSetup } from '../src/commands/setup';
import { commands } from '../src/commands';
import type { ParsedArguments } from '../src/cliArguments';

let home: string;
let workspace: string;

function args(
  flags: Record<string, string | boolean> = {},
  positionals: string[] = [],
): ParsedArguments {
  return { path: [], flags, positionals };
}

function container(): ReturnType<typeof createCliContainer> {
  return createCliContainer({
    workspacePath: workspace,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      show: () => undefined,
    },
    canPrompt: false,
    version: '0.0.0',
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('storyboard setup', () => {
  it('writes the provider given on the command line into the shared config', async () => {
    const outcome = await runSetup({ container: container(), args: args({ provider: 'codex' }) });

    expect(outcome.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
      defaultProvider: 'codex',
    });
    expect(outcome.message).toContain(join(home, 'config.json'));
  });

  it('refuses to guess when there is no terminal and no --provider', async () => {
    const outcome = await runSetup({ container: container(), args: args() });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('--provider');
  });
});

describe('storyboard doctor', () => {
  it('fails with the setup hint when no provider is configured', async () => {
    const outcome = await runDoctor({ container: container(), args: args() });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('storyboard setup');
    expect(outcome.message).toContain('storyboard init --title');
  });

  it('passes for a configured mock provider and reports the workspace state', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'mock' }));

    const outcome = await runDoctor({ container: container(), args: args() });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('mock');
    expect(outcome.message).toContain('워크스페이스가 아닙니다');
    expect((outcome.data as { checks: unknown[] }).checks.length).toBeGreaterThan(3);
  });

  // 실행 파일이 있어도 로그아웃 상태면 생성이 통째로 실패한다.
  it('fails when a subscription CLI provider is not logged in', async () => {
    // 로그인 검사는 실행 파일이 있어야 돌므로 PATH의 claude 대신 임시 홈 안의 더미를 가리킨다.
    const fakeClaude = join(home, 'claude');
    writeFileSync(fakeClaude, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeClaude, 0o755);
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        defaultProvider: 'claude-code',
        providers: { 'claude-code': { model: 'sonnet', command: fakeClaude } },
      }),
    );
    const real = container();
    const stubbed = {
      ...real,
      aiProviderRegistry: {
        checkConnection: async () => {
          throw new Error('Claude Code에 로그인되어 있지 않습니다.');
        },
      },
    } as unknown as ReturnType<typeof createCliContainer>;

    const outcome = await runDoctor({ container: stubbed, args: args() });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('로그인되어 있지 않습니다');
  });
});

describe('storyboard doctor on a pre-0.8 workspace', () => {
  function checksOf(
    outcome: Awaited<ReturnType<typeof runDoctor>>,
  ): { label: string; detail: string }[] {
    return (outcome.data as { checks: { label: string; detail: string }[] }).checks;
  }

  it('reports missing directories and legacy scene files instead of throwing', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'mock' }));
    mkdirSync(join(workspace, '.storyboard'));
    writeFileSync(join(workspace, '.storyboard', 'project.json'), '{}');
    mkdirSync(join(workspace, 'scene'));
    writeFileSync(join(workspace, 'scene', '01-old.txt'), '[목적] 오래된 시드\n');

    const outcome = await runDoctor({ container: container(), args: args() });

    expect(outcome.ok).toBe(true);
    const checks = checksOf(outcome);
    expect(checks.find((check) => check.label === '디렉터리')?.detail).toContain('draft/');
    expect(checks.find((check) => check.label === '구형 씬')?.detail).toContain('1개');
    expect(checks.find((check) => check.label === '씬')?.detail).toContain('0개');
  });

  // 원장 무효화. 봉인 없는 0.8 이전 원장은 판정 근거가 없으므로 낡음이 아니라 보수 대상이다.
  function writeWorkspaceWithLedger(ledger: string): void {
    mkdirSync(join(workspace, '.storyboard', 'memory'), { recursive: true });
    writeFileSync(
      join(workspace, '.storyboard', 'project.json'),
      JSON.stringify({
        version: '1.0.0',
        id: 'p1',
        name: '테스트',
        format: 'novel',
        language: 'ko',
        createdAt: new Date().toISOString(),
        editor: { scenePrefixDigits: 2 },
      }),
    );
    mkdirSync(join(workspace, 'scene'), { recursive: true });
    writeFileSync(
      join(workspace, 'scene', '01-first.card'),
      'type: scene\nid: 01-first\nsummary: 첫 방송을 마친다.\n',
    );
    writeFileSync(join(workspace, '.storyboard', 'memory', 'storyState.md'), ledger);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'mock' }));
  }

  const unsealedLedger =
    '# 이야기 상태\n<!-- through-scene: 1 -->\n## 확정 사실\n- [1] 1화 사실\n';

  it('asks for a repair when the ledger carries no input record', async () => {
    writeWorkspaceWithLedger(unsealedLedger);

    const outcome = await runDoctor({ container: container(), args: args() });

    const check = checksOf(outcome).find((entry) => entry.label === '이야기 상태');
    expect(check?.status).toBe('info');
    expect(check?.fix).toBe('storyboard init --repair');
  });

  it('reports a ledger that no longer matches its scene after the repair sealed it', async () => {
    writeWorkspaceWithLedger(unsealedLedger);

    const repaired = await (commands['init'] as (context: never) => Promise<{ ok: boolean }>)({
      container: container(),
      args: args({ repair: true }),
    });
    expect(repaired.ok).toBe(true);
    expect(readFileSync(join(workspace, '.storyboard', 'memory', 'storyState.md'), 'utf8')).toContain(
      '<!-- scene-input: 1 sha256:',
    );

    const sealed = await runDoctor({ container: container(), args: args() });
    expect(checksOf(sealed).find((entry) => entry.label === '이야기 상태')?.status).toBe('ok');

    writeFileSync(
      join(workspace, 'scene', '01-first.card'),
      'type: scene\nid: 01-first\nsummary: 고쳐 쓴 요약.\n',
    );

    const stale = await runDoctor({ container: container(), args: args() });
    const check = checksOf(stale).find((entry) => entry.label === '이야기 상태');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('씬 1');
    expect(check?.fix).toContain('storyboard draft generate');
  });
});

describe('storyboard doctor chapter summaries', () => {
  function checksOf(outcome: { data?: unknown }): { label: string; detail: string; fix?: string }[] {
    return (outcome.data as { checks: { label: string; detail: string; fix?: string }[] }).checks;
  }

  // 장별 요약은 그 장의 초안에서 나온 것이므로, 초안을 고치고 다시 요약하지 않으면 낡는다.
  function writeWorkspaceWithSummary(draftBody: string, recordedHash: string): void {
    mkdirSync(join(workspace, '.storyboard', 'memory'), { recursive: true });
    mkdirSync(join(workspace, '.storyboard', 'outline'), { recursive: true });
    mkdirSync(join(workspace, 'draft'), { recursive: true });
    writeFileSync(
      join(workspace, '.storyboard', 'project.json'),
      JSON.stringify({
        version: '1.0.0',
        id: 'p1',
        name: '테스트',
        format: 'novel',
        language: 'ko',
        createdAt: new Date().toISOString(),
        editor: { scenePrefixDigits: 2 },
      }),
    );
    writeFileSync(
      join(workspace, '.storyboard', 'outline', 'chapters.yaml'),
      'version: 1.0.0\nacts:\n  - id: act-1\n    title: 1막\n    chapters:\n      - id: chapter-1\n        title: 1장\n        scenes:\n          - id: s1\n            title: 첫 씬\n',
    );
    writeFileSync(
      join(workspace, 'draft', '01-first.md'),
      `---\nsceneStem: 01-first\nformat: novel\ngeneratedAt: '2026-09-07T00:00:00.000Z'\n---\n${draftBody}\n`,
    );
    writeFileSync(
      join(workspace, '.storyboard', 'memory', 'summaries.md'),
      `# 장별 요약\n\n> 대상: 테스트\n\n## 1장\n\n<!-- chapter-input: ${recordedHash} -->\n\n1장 요약\n`,
    );
    writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'mock' }));
  }

  it('reports a summary that no longer matches its chapter drafts', async () => {
    writeWorkspaceWithSummary('첫 장 본문', 'sha256:stale');

    const check = checksOf(await runDoctor({ container: container(), args: args() })).find(
      (entry) => entry.label === '장별 요약',
    );

    expect(check?.detail).toContain('1장');
    expect(check?.fix).toBe('storyboard manuscript summaries');
  });

  it('says nothing is wrong once the recorded hash matches the assembled chapter', async () => {
    writeWorkspaceWithSummary('첫 장 본문', 'sha256:stale');
    const cli = container();
    const current = await collectCurrentChapterHashes(
      { fileSystem: cli.fileSystem, paths: getStoryboardProjectPaths(cli.workspaceRoot) },
      '테스트',
    );
    writeWorkspaceWithSummary('첫 장 본문', current.get('1장') as string);

    const check = checksOf(await runDoctor({ container: container(), args: args() })).find(
      (entry) => entry.label === '장별 요약',
    );

    expect(check?.detail).toContain('맞습니다');
  });
});

describe('storyboard config', () => {
  it('sets a catalog key with type validation and shows it with its origin', async () => {
    const bad = await runConfigSet({
      container: container(),
      args: args({}, ['draft.reviseMaxIterations', 'nine']),
    });
    expect(bad.ok).toBe(false);

    const unknown = await runConfigSet({
      container: container(),
      args: args({}, ['draft.nope', '1']),
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toContain('쓸 수 있는 키');

    const good = await runConfigSet({
      container: container(),
      args: args({}, ['draft.reviseMaxIterations', '3']),
    });
    expect(good.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
      draft: { reviseMaxIterations: 3 },
    });

    const shown = await runConfigShow({ container: container(), args: args() });
    expect(shown.message).toMatch(/draft\.reviseMaxIterations\s+3\s+공통/);
    expect(shown.message).toMatch(/defaultProvider\s+\(없음\)\s+기본값/);
  });

  it('validates provider fields against the catalog', async () => {
    const badModel = await runConfigSet({
      container: container(),
      args: args({}, ['providers.openai.model', 'gpt-99']),
    });
    expect(badModel.ok).toBe(false);

    const cliModel = await runConfigSet({
      container: container(),
      args: args({}, ['providers.codex.model', 'gpt-9-preview']),
    });
    expect(cliModel.ok).toBe(true);

    const provider = await runConfigSet({
      container: container(),
      args: args({}, ['defaultProvider', 'claude-code']),
    });
    expect(provider.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
      providers: { codex: { model: 'gpt-9-preview' } },
      defaultProvider: 'claude-code',
    });
  });
});
