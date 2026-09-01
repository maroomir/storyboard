import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedArguments } from '../src/cliArguments';
import { commands } from '../src/commands/index';
import { createCliContainer } from '../src/container';

let home: string;
let workspace: string;
let previousHome: string | undefined;

function args(path: string[], flags: Record<string, string | boolean> = {}, positionals: string[] = []): ParsedArguments {
  return { path, flags, positionals };
}

async function run(verb: string, parsed: ParsedArguments) {
  const handler = commands[verb];
  if (!handler) {
    throw new Error(`unknown verb: ${verb}`);
  }
  return await handler({ container: createCliContainer({ workspacePath: workspace }), args: parsed });
}

beforeEach(async () => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));
  await run('init', args(['init'], { title: '시그널' }));
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.STORYBOARD_HOME;
  } else {
    process.env.STORYBOARD_HOME = previousHome;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('card create', () => {
  // 예전에는 한글 이름이 new-card, new-card-2 로 번호를 받아 이름과 무관한 id 가 조용히 생겼고,
  // 씬 카드가 그 id 로 인물을 참조했다.
  it('refuses a name it cannot turn into an id instead of inventing one', async () => {
    const outcome = await run('card create character', args(['card', 'create', 'character'], { name: '서진아' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('--id');
    expect(existsSync(join(workspace, 'character', 'new-card.card'))).toBe(false);
  });

  it('uses the explicit id when one is given', async () => {
    const outcome = await run(
      'card create character',
      args(['card', 'create', 'character'], { name: '서진아', id: 'seo-jina' }),
    );

    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(workspace, 'character', 'seo-jina.card'), 'utf8')).toContain('name: 서진아');
  });

  it('rejects an explicit id that is not file-name safe', async () => {
    const outcome = await run(
      'card create character',
      args(['card', 'create', 'character'], { name: '서진아', id: 'Seo Jina' }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('영소문자');
  });
});

describe('cards build', () => {
  // 익스텐션은 제안을 골라 파일까지 쓰는데 CLI 는 JSON 만 뱉고 끝이었다. 파리티 테스트는
  // verb 존재만 보므로 이 반쪽 상태를 잡지 못했다.
  function containerWith(targets: unknown[]) {
    const real = createCliContainer({ workspacePath: workspace });
    return {
      ...real,
      buildStoryCardsUseCase: { execute: async () => ({ targets, snapshots: [] }) },
    } as unknown as Parameters<(typeof commands)['cards build']>[0]['container'];
  }

  it('writes the proposed cards instead of only printing them', async () => {
    const container = containerWith([
      {
        card: { type: 'character', id: 'seo-jina', name: '서진아', tags: [], traits: [] },
        uriId: 'seo-jina',
        isNew: true,
        requiresIdConfirmation: false,
        changes: [],
        sourceScenes: ['01-first'],
      },
    ]);

    const outcome = await commands['cards build']({ container, args: args(['cards', 'build']) });

    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(workspace, 'character', 'seo-jina.card'), 'utf8')).toContain('name: 서진아');
  });

  it('leaves the tree alone under --dry-run', async () => {
    const container = containerWith([
      {
        card: { type: 'character', id: 'seo-jina', name: '서진아', tags: [], traits: [] },
        uriId: 'seo-jina',
        isNew: true,
        requiresIdConfirmation: false,
        changes: [],
        sourceScenes: ['01-first'],
      },
    ]);

    await commands['cards build']({ container, args: args(['cards', 'build'], { 'dry-run': true }) });

    expect(existsSync(join(workspace, 'character', 'seo-jina.card'))).toBe(false);
  });

  it('reports a new card whose name yields no id rather than inventing one', async () => {
    const container = containerWith([
      {
        card: { type: 'location', id: 'new-card-2', name: '방송실', tags: [] },
        uriId: 'new-card-2',
        isNew: true,
        requiresIdConfirmation: true,
        changes: [],
        sourceScenes: ['01-first'],
      },
    ]);

    const outcome = await commands['cards build']({ container, args: args(['cards', 'build']) });

    expect(outcome.message).toContain('방송실');
    expect(existsSync(join(workspace, 'background', 'new-card-2.card'))).toBe(false);
  });
});

describe('scene complete', () => {
  async function seedOneScene() {
    await run('scene create', args(['scene', 'create'], { name: 'first' }));
  }

  function containerProposing(fileName: string) {
    const real = createCliContainer({ workspacePath: workspace });
    return {
      ...real,
      completeStoryScenesUseCase: {
        execute: async () => ({
          scenes: [{ fileName, content: 'type: scene\nid: proposed\n', title: '제안', resolvedThreads: [], openThreads: [] }],
          snapshots: [],
        }),
      },
    } as unknown as Parameters<(typeof commands)['scene complete']>[0]['container'];
  }

  it('writes the proposed ending scenes instead of only printing them', async () => {
    await seedOneScene();

    const outcome = await run('scene complete', args(['scene', 'complete']));

    expect(outcome.ok).toBe(true);
    const written = (outcome.data as { written: string[] }).written;
    expect(written.length).toBeGreaterThan(0);
    expect(existsSync(join(workspace, 'scene', written[0] as string))).toBe(true);
  });

  // 완결 씬은 뒤에 덧붙이는 제안이므로, 같은 이름의 씬이 이미 있으면 쓰던 내용을 덮지 않는다.
  it('skips a file that already exists', async () => {
    await seedOneScene();
    const container = containerProposing('01-first.card');
    const before = readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8');

    const outcome = await commands['scene complete']({ container, args: args(['scene', 'complete']) });

    expect((outcome.data as { skipped: string[] }).skipped).toContain('01-first.card');
    expect(readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8')).toBe(before);
  });

  it('leaves the tree alone under --dry-run', async () => {
    await seedOneScene();
    const before = readdirSync(join(workspace, 'scene')).length;

    await run('scene complete', args(['scene', 'complete'], { 'dry-run': true }));

    expect(readdirSync(join(workspace, 'scene')).length).toBe(before);
  });
});

describe('scene create', () => {
  // 씬은 번호가 정체성을 지니므로 슬러그를 못 만들어도 진행한다.
  it('falls back to a numbered slug for a name with no ascii', async () => {
    const outcome = await run('scene create', args(['scene', 'create'], { name: '첫 방송' }));

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(workspace, 'scene', '01-scene-1.card'))).toBe(true);
  });
});
