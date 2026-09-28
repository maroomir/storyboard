import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStudioCardInvokeResolver } from '@/presentation/messaging/studioCardToolResolver';
import type {
  StudioCardToolResolverDependencies,
  StudioCardToolResolverInput,
} from '@/presentation/messaging/studioCardToolResolver';

const seorinCard = [
  'type: character',
  'id: seorin',
  'name: 서린',
  'relations:',
  '  - target: jiho',
  '    type: 친구',
  '  - target: ghost',
  '    type: 스승',
].join('\n');

const jihoWithBackRelation = [
  'type: character',
  'id: jiho',
  'name: 지호',
  'relations:',
  '  - target: seorin',
  '    type: 친구',
].join('\n');

const jihoWithoutBackRelation = ['type: character', 'id: jiho', 'name: 지호'].join('\n');

const sceneCard = [
  'type: scene',
  'id: 01-intro',
  'title: 첫 등교',
  'characters:',
  '  - seorin',
  '  - ghost',
  'location: nowhere',
  'summary: 서린이 등교한다.',
].join('\n');

let files: Map<string, string>;

beforeEach((): void => {
  files = new Map([['/workspace/character/seorin.card', seorinCard]]);

  vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri) => {
    if (!files.has(String((uri as { fsPath: string }).fsPath))) {
      throw new Error('missing');
    }
    return { type: 1, mtime: 0 } as never;
  });

  vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri) => {
    const content = files.get(String((uri as { fsPath: string }).fsPath));
    if (content === undefined) {
      throw new Error('missing');
    }
    return new TextEncoder().encode(content);
  });
});

afterEach((): void => {
  vi.restoreAllMocks();
});

interface FakeDeps {
  readonly deps: StudioCardToolResolverDependencies;
  readonly audit: ReturnType<typeof vi.fn>;
  readonly collect: ReturnType<typeof vi.fn>;
}

function fakeDeps(): FakeDeps {
  const audit = vi.fn(async () => ({ state: 'pass', warnings: [] }));
  const collect = vi.fn(async () => []);

  const deps = {
    aiGateway: {
      createService: () => ({ auditStudioEntity: audit }),
      getTaskProvider: () => 'mock',
    },
    cards: { collectProposals: collect },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  } as unknown as StudioCardToolResolverDependencies;

  return { deps, audit, collect };
}

function characterInput(baseline = seorinCard): StudioCardToolResolverInput {
  return {
    workspaceRoot: vscode.Uri.file('/workspace'),
    entity: { kind: 'character', key: 'seorin' },
    entityLabel: 'seorin',
    context: 'id: seorin',
    baseline,
  };
}

describe('createStudioCardInvokeResolver relationCheck', () => {
  it('reports a relation whose target card is missing', async () => {
    files.set('/workspace/character/jiho.card', jihoWithBackRelation);
    const resolve = createStudioCardInvokeResolver(fakeDeps().deps, characterInput());

    const report = await resolve({ tool: 'relationCheck' });

    expect(report).toContain('ghost');
    expect(report).toContain('character/ghost.card 가 없다');
    expect(report).not.toContain('jiho(친구)');
  });

  it('reports a one-way relation', async () => {
    files.set('/workspace/character/jiho.card', jihoWithoutBackRelation);
    const resolve = createStudioCardInvokeResolver(fakeDeps().deps, characterInput());

    const report = await resolve({ tool: 'relationCheck' });

    expect(report).toContain('일방향');
  });

  it('checks scene cast and location references', async () => {
    const resolve = createStudioCardInvokeResolver(fakeDeps().deps, {
      ...characterInput(sceneCard),
      entity: { kind: 'scene', key: '01-intro' },
    });

    const report = await resolve({ tool: 'relationCheck' });

    expect(report).toContain('character/ghost.card 가 없다');
    expect(report).toContain('background/nowhere.card 가 없다');
    expect(report).not.toContain('seorin —');
  });
});

describe('createStudioCardInvokeResolver collectFromDrafts', () => {
  it('lists collect candidates for the agent to rework', async () => {
    const { deps, collect } = fakeDeps();
    collect.mockResolvedValue([
      { kind: 'trait', id: 't1', value: '비 오는 날 손이 떨린다', sourceScenes: ['01-intro'] },
      { kind: 'relation', id: 'r1', target: 'jiho', type: '친구', sourceScenes: [] },
    ]);
    const resolve = createStudioCardInvokeResolver(deps, characterInput());

    const report = await resolve({ tool: 'collectFromDrafts' });

    expect(report).toContain('후보 2건');
    expect(report).toContain('비 오는 날 손이 떨린다');
    expect(report).toContain('출처: 01-intro');
  });

  it('refuses collect on a scene conversation', async () => {
    const { deps, collect } = fakeDeps();
    const resolve = createStudioCardInvokeResolver(deps, {
      ...characterInput(sceneCard),
      entity: { kind: 'scene', key: '01-intro' },
    });

    await expect(resolve({ tool: 'collectFromDrafts' })).resolves.toContain('[도구 실패');
    expect(collect).not.toHaveBeenCalled();
  });
});

describe('createStudioCardInvokeResolver cardAudit', () => {
  it('reports the mismatches the audit found', async () => {
    const { deps, audit } = fakeDeps();
    audit.mockResolvedValue({
      state: 'warn',
      warnings: [{ message: '유리병 색이 씬1과 다르다', source: 'scene/01-intro' }],
    });
    const resolve = createStudioCardInvokeResolver(deps, characterInput());

    const report = await resolve({ tool: 'cardAudit' });

    expect(report).toContain('어긋남 1건');
    expect(report).toContain('유리병 색이 씬1과 다르다');
    expect(report).toContain('근거: scene/01-intro');
  });

  it('says the card is clean on a pass', async () => {
    const resolve = createStudioCardInvokeResolver(fakeDeps().deps, characterInput());

    await expect(resolve({ tool: 'cardAudit' })).resolves.toContain('어긋나는 점이 없다');
  });
});

describe('createStudioCardInvokeResolver failures', () => {
  it('refuses a draft tool in a card conversation', async () => {
    const resolve = createStudioCardInvokeResolver(fakeDeps().deps, characterInput());

    await expect(resolve({ tool: 'expand' })).resolves.toContain('쓸 수 없는 도구다');
  });

  it('degrades to a failure remark when a tool throws', async () => {
    const { deps, audit } = fakeDeps();
    audit.mockRejectedValue(new Error('provider down'));
    const resolve = createStudioCardInvokeResolver(deps, characterInput());

    await expect(resolve({ tool: 'cardAudit' })).resolves.toContain('[도구 실패: cardAudit]');
  });
});
