import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

describe('scene create', () => {
  // 씬은 번호가 정체성을 지니므로 슬러그를 못 만들어도 진행한다.
  it('falls back to a numbered slug for a name with no ascii', async () => {
    const outcome = await run('scene create', args(['scene', 'create'], { name: '첫 방송' }));

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(workspace, 'scene', '01-scene-1.card'))).toBe(true);
  });
});
