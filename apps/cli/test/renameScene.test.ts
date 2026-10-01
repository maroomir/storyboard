import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { RenameSceneUseCase, type IStoryboardLogger } from '@storyboard/story-engine';
import {
  createDraft,
  NodeUri,
  parseBible,
  parseCard,
  parseDraft,
  parseStoryState,
  serializeDraft,
} from '@storyboard/story-format';
import { NodeFileSystem } from '@storyboard/story-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const fromStem = '03-night-market';
const silentLogger: IStoryboardLogger = {
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  show: (): void => {},
};

let workspace: string;

function write(relativePath: string, content: string): void {
  const target = join(workspace, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function read(relativePath: string): string {
  return readFileSync(join(workspace, relativePath), 'utf8');
}

function has(relativePath: string): boolean {
  return existsSync(join(workspace, relativePath));
}

function rename(toStem: string): ReturnType<RenameSceneUseCase['execute']> {
  return new RenameSceneUseCase({
    fileSystem: new NodeFileSystem(),
    logger: silentLogger,
  }).execute({ workspaceRoot: NodeUri.file(workspace), fromStem, toStem });
}

function draftFor(stem: string, body: string): string {
  return serializeDraft(
    createDraft({
      sceneStem: stem,
      format: 'novel',
      body,
      generatedAt: '2026-10-01T00:00:00.000Z',
    }),
  );
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-rename-'));

  write(
    `scene/${fromStem}.card`,
    `type: scene\nid: ${fromStem}\ntitle: 야시장\nsummary: ${fromStem}.summary.md\nbeats:\n  - 등불이 켜진다.\n`,
  );
  write(`scene/${fromStem}.summary.md`, '야시장에서 둘이 마주친다.\n');
  write('scene/05-dawn.card', 'type: scene\nid: 05-dawn\n');
  write(`draft/${fromStem}.md`, draftFor(fromStem, '등불 아래.\n'));
  write(`.draft/${fromStem}/2026-10-01-00-00-rev-01.md`, draftFor(fromStem, '옛 초안.\n'));
  write(
    `.storyboard/cache/scenes/${fromStem}.json`,
    `${JSON.stringify({ sceneStem: fromStem, inputHash: 'sha256:x' }, null, 2)}\n`,
  );
  write(
    `.storyboard/memory/threads/side/dialogue/${fromStem}.json`,
    `${JSON.stringify({ sceneStem: fromStem, lines: [] }, null, 2)}\n`,
  );
  write(
    `.storyboard/cache/studio-sessions/scene/${fromStem}/s1.json`,
    `${JSON.stringify({ entity: { kind: 'scene', key: fromStem } }, null, 2)}\n`,
  );
  write(
    '.storyboard/memory/storyState.md',
    [
      '# 이야기 상태',
      '<!-- through-scene: 5 -->',
      `<!-- scene-input: 3 sha256:${'a'.repeat(64)} -->`,
      `<!-- scene-input: 5 sha256:${'b'.repeat(64)} -->`,
      '## 확정 사실',
      '- [3|hana] 야시장은 자정에 닫는다.',
      '- [5] 새벽이 온다.',
      '',
    ].join('\n'),
  );
  write(
    '.storyboard/bible/canon.yaml',
    [
      "version: '1.0.0'",
      'facts:',
      '  - id: character:hana:job@3',
      '    subject: { kind: character, id: hana }',
      '    key: job',
      '    value: 상인',
      `    sourceScene: ${fromStem}`,
      `    validFrom: ${fromStem}`,
      '    validUntil: 3',
      '    revealFrom: { scene: 3, knownBy: [hana] }',
      '  - id: character:hana:age',
      '    subject: { kind: character, id: hana }',
      '    key: age',
      "    value: '17'",
      '    validFrom: 5',
      '',
    ].join('\n'),
  );
  write(
    '.storyboard/cache/usage.json',
    JSON.stringify({ entries: [{ attribution: { primary: { kind: 'scene', id: fromStem } } }] }),
  );
  write(
    '.storyboard/memory/personas/hana.json',
    `${JSON.stringify({ cardId: 'hana', updatedThroughScene: fromStem }, null, 2)}\n`,
  );
  write(
    'character/hana.card',
    `type: character\nid: hana\nname: 하나\nrole: main\narc:\n  - stage: 시작\n    summary: 장사를 시작한다\n    sceneRef: ${fromStem}\n`,
  );
  write('character/jun.card', 'type: character\nid: jun\nname: 준\nrole: main\n');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('RenameSceneUseCase', () => {
  it('moves every file named after the scene and rewrites the stem inside them', async () => {
    const result = await rename('04-night-market');

    expect(result).toMatchObject({ ok: true, kind: 'renamed', hasOrderChanged: true });
    expect(has(`scene/${fromStem}.card`)).toBe(false);
    expect(read('scene/04-night-market.card')).toBe(
      'type: scene\nid: 04-night-market\ntitle: 야시장\nsummary: 04-night-market.summary.md\nbeats:\n  - 등불이 켜진다.\n',
    );
    expect(read('scene/04-night-market.summary.md')).toBe('야시장에서 둘이 마주친다.\n');
    expect(parseDraft(read('draft/04-night-market.md'))).toMatchObject({
      sceneStem: '04-night-market',
      body: '등불 아래.\n',
    });
    expect(parseDraft(read('.draft/04-night-market/2026-10-01-00-00-rev-01.md')).sceneStem).toBe(
      '04-night-market',
    );
    expect(has(`.draft/${fromStem}`)).toBe(false);
    expect(JSON.parse(read('.storyboard/cache/scenes/04-night-market.json')).sceneStem).toBe(
      '04-night-market',
    );
    expect(
      JSON.parse(read('.storyboard/memory/threads/side/dialogue/04-night-market.json')).sceneStem,
    ).toBe('04-night-market');
    expect(
      JSON.parse(read('.storyboard/cache/studio-sessions/scene/04-night-market/s1.json')).entity,
    ).toEqual({ kind: 'scene', key: '04-night-market' });
    expect(has(`.storyboard/cache/studio-sessions/scene/${fromStem}`)).toBe(false);
  });

  it('renumbers the ledger and canon and follows the stem in memory, usage and cards', async () => {
    await rename('04-night-market');

    const state = parseStoryState(read('.storyboard/memory/storyState.md'));
    expect(state.throughSceneOrder).toBe(5);
    expect([...state.sceneInputHashes.keys()].sort()).toEqual([4, 5]);
    expect(state.entries.map((entry) => entry.throughScene)).toEqual([4, 5]);
    expect(state.entries[0]?.witnesses).toEqual(['hana']);

    const [moved, untouched] = parseBible(read('.storyboard/bible/canon.yaml')).facts;
    expect(moved).toMatchObject({
      id: 'character:hana:job@3',
      sourceScene: '04-night-market',
      validFrom: '04-night-market',
      validUntil: 4,
      revealFrom: { scene: 4, knownBy: ['hana'] },
    });
    expect(untouched?.validFrom).toBe(5);

    expect(JSON.parse(read('.storyboard/cache/usage.json'))).toEqual({
      entries: [{ attribution: { primary: { kind: 'scene', id: '04-night-market' } } }],
    });
    expect(read('.storyboard/cache/usage.json')).not.toContain('\n');
    expect(JSON.parse(read('.storyboard/memory/personas/hana.json')).updatedThroughScene).toBe(
      '04-night-market',
    );

    const hana = parseCard(read('character/hana.card'));
    expect(hana.type === 'character' ? hana.arc?.[0]?.sceneRef : undefined).toBe('04-night-market');
    expect(read('character/jun.card')).toBe('type: character\nid: jun\nname: 준\nrole: main\n');
  });

  it('changes only the stem references when the number stays', async () => {
    const before = read('.storyboard/memory/storyState.md');
    const result = await rename('03-moon-market');

    expect(result).toMatchObject({ ok: true, hasOrderChanged: false });
    expect(read('.storyboard/memory/storyState.md')).toBe(before);
    expect(parseBible(read('.storyboard/bible/canon.yaml')).facts[0]).toMatchObject({
      sourceScene: '03-moon-market',
      validUntil: 3,
    });
  });

  it('refuses a number another scene holds and leaves the workspace untouched', async () => {
    const result = await rename('05-night-market');

    expect(result).toMatchObject({ ok: false, kind: 'order-taken' });
    expect(has(`scene/${fromStem}.card`)).toBe(true);
    expect(has('scene/05-night-market.card')).toBe(false);
  });

  it('refuses a malformed stem and a missing scene', async () => {
    expect(await rename('night-market')).toMatchObject({ ok: false, kind: 'invalid-stem' });
    expect(await rename(fromStem)).toMatchObject({ ok: false, kind: 'invalid-stem' });

    rmSync(join(workspace, 'scene', `${fromStem}.card`));
    expect(await rename('04-night-market')).toMatchObject({ ok: false, kind: 'missing' });
  });
});
