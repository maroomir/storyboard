import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedArguments } from '../src/cliArguments';
import { commands } from '../src/commands/index';
import { createCliContainer } from '../src/container';

let home: string;
let workspace: string;
let previousHome: string | undefined;

function args(
  path: string[],
  flags: Record<string, string | boolean> = {},
  positionals: string[] = [],
): ParsedArguments {
  return { path, flags, positionals };
}

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function container() {
  return createCliContainer({
    workspacePath: workspace,
    logger: silentLogger,
    canPrompt: false,
    version: '0.0.0',
  });
}

async function run(verb: string, parsed: ParsedArguments) {
  const handler = commands[verb];
  if (!handler) {
    throw new Error(`unknown verb: ${verb}`);
  }
  return await handler({ container: container(), args: parsed });
}

beforeEach(async () => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-cli-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));
  // Generation verbs refuse an unconfigured provider, so the temp home names one the way
  // `storyboard setup` would.
  writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'mock' }));
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

describe('project contract', () => {
  function settingOf(): Record<string, unknown> {
    const project = JSON.parse(
      readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8'),
    ) as { setting?: Record<string, unknown> };
    return project.setting ?? {};
  }

  // 계약이 비면 outline generate 가 거절한다. 채우는 길이 없으면 CLI 만으로는 시작할 수 없었다.
  it('fills the contract from init flags', async () => {
    rmSync(workspace, { recursive: true, force: true });
    workspace = mkdtempSync(join(tmpdir(), 'storyboard-cli-ws-'));

    const outcome = await run(
      'init',
      args(['init'], {
        title: '시그널',
        genre: '하이틴 로맨스',
        audience: '10~20대',
        pov: 'third-limited',
        'target-words': '480000',
        chapters: '8',
        'scenes-per-chapter': '4',
      }),
    );

    expect(outcome.ok).toBe(true);
    expect(settingOf()).toMatchObject({
      genre: '하이틴 로맨스',
      pov: 'third-limited',
      targetWordCount: 480000,
      chapterCount: 8,
      scenesPerChapter: 4,
    });
  });

  it('reads a contract file and lets flags win over it', async () => {
    const file = join(home, 'contract.json');
    writeFileSync(
      file,
      JSON.stringify({ genre: '무협', audience: '성인', styleConstraints: ['단문'] }),
    );

    const outcome = await run(
      'project set',
      args(['project', 'set'], { from: file, genre: '하이틴 로맨스' }),
    );

    expect(outcome.ok).toBe(true);
    expect(settingOf()).toMatchObject({
      genre: '하이틴 로맨스',
      audience: '성인',
      styleConstraints: ['단문'],
    });
  });

  it('keeps the keys it was not given', async () => {
    await run(
      'project set',
      args(['project', 'set'], { genre: '하이틴 로맨스', audience: '10~20대' }),
    );
    await run('project set', args(['project', 'set'], { 'target-words': '480000' }));

    expect(settingOf()).toMatchObject({
      genre: '하이틴 로맨스',
      audience: '10~20대',
      targetWordCount: 480000,
    });
  });

  it('refuses a point of view the format does not define', async () => {
    const outcome = await run('project set', args(['project', 'set'], { pov: 'omniscient' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('third-limited');
  });

  it('refuses a non-integer word count instead of writing NaN', async () => {
    const outcome = await run('project set', args(['project', 'set'], { 'target-words': '사만' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('양의 정수');
  });
});

describe('card create', () => {
  // 예전에는 한글 이름이 new-card, new-card-2 로 번호를 받아 이름과 무관한 id 가 조용히 생겼고,
  // 씬 카드가 그 id 로 인물을 참조했다.
  it('refuses a name it cannot turn into an id instead of inventing one', async () => {
    const outcome = await run(
      'card create character',
      args(['card', 'create', 'character'], { name: '서진아' }),
    );

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
    expect(readFileSync(join(workspace, 'character', 'seo-jina.card'), 'utf8')).toContain(
      'name: 서진아',
    );
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
    const real = container();
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
    expect(readFileSync(join(workspace, 'character', 'seo-jina.card'), 'utf8')).toContain(
      'name: 서진아',
    );
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

    await commands['cards build']({
      container,
      args: args(['cards', 'build'], { 'dry-run': true }),
    });

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
    const real = container();
    return {
      ...real,
      completeStoryScenesUseCase: {
        execute: async () => ({
          scenes: [
            {
              fileName,
              content: 'type: scene\nid: proposed\n',
              title: '제안',
              resolvedThreads: [],
              openThreads: [],
            },
          ],
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

    const outcome = await commands['scene complete']({
      container,
      args: args(['scene', 'complete']),
    });

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

describe('pre-0.8 workspace migration', () => {
  const placeholderSummary =
    '> 1막 · 1장 — 자동 생성된 씬 시드입니다. 초안 생성 전에 자유롭게 수정하세요.';

  function writeLegacyScene(): void {
    writeFileSync(
      join(workspace, 'scene', '01-first.card'),
      [
        'type: scene',
        'id: 01-first',
        'title: 첫 방송',
        'purpose: 진아가 마이크를 처음 켰다.',
        `summary: '${placeholderSummary}'`,
        '',
      ].join('\n'),
    );
  }

  // summary가 비어 있지 않으면 초안이 그 한 줄만 서사 재료로 받는다.
  it('clears the legacy placeholder summary', async () => {
    writeLegacyScene();

    const outcome = await run('scene migrate', args(['scene', 'migrate']));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('플레이스홀더');
    const migrated = readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8');
    expect(migrated).not.toContain('자동 생성된 씬 시드');
    expect(migrated).toContain('진아가 마이크를 처음 켰다.');
  });

  it('keeps the summary an author wrote above the placeholder', async () => {
    writeFileSync(
      join(workspace, 'scene', '01-first.card'),
      [
        'type: scene',
        'id: 01-first',
        'title: 첫 방송',
        'summary: |-',
        '  진아가 마이크를 켠다.',
        '  유정이 큐 사인을 놓친다.',
        `  ${placeholderSummary}`,
        '',
      ].join('\n'),
    );

    const outcome = await run('scene migrate', args(['scene', 'migrate']));

    expect(outcome.ok).toBe(true);
    const migrated = readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8');
    expect(migrated).not.toContain('자동 생성된 씬 시드');
    // 걷어 낸 뒤 남은 저자 산문은 인라인 summary 이므로 같은 실행에서 파일로 옮겨진다.
    expect(migrated).toContain('summary: 01-first.summary.md');
    expect(readFileSync(join(workspace, 'scene', '01-first.summary.md'), 'utf8')).toBe(
      '진아가 마이크를 켠다.\n유정이 큐 사인을 놓친다.\n',
    );
  });

  it('skips a card it cannot parse and names it', async () => {
    writeLegacyScene();
    writeFileSync(join(workspace, 'scene', '02-broken.card'), 'type: scene\nid: [\n');

    const outcome = await run('scene migrate', args(['scene', 'migrate']));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('플레이스홀더 요약 1개');
    expect(outcome.message).toContain('02-broken.card');

    const doctor = await run('doctor', args(['doctor']));
    expect(doctor.message).toContain('읽지 못한 카드');
  });

  // 창작자가 쓴 사건과 기계가 펼친 beats 를 구별하려고 summary 산문은 카드 옆 파일로 둔다.
  it('moves an authored inline summary into <stem>.summary.md', async () => {
    writeFileSync(
      join(workspace, 'scene', '01-first.card'),
      ['type: scene', 'id: 01-first', 'summary: 진아가 사연을 읽었다.', ''].join('\n'),
    );

    const outcome = await run('scene migrate', args(['scene', 'migrate']));

    expect(outcome.message).toContain('인라인 summary 1개');
    expect(readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8')).toBe(
      'type: scene\nid: 01-first\nsummary: 01-first.summary.md\n',
    );
    expect(readFileSync(join(workspace, 'scene', '01-first.summary.md'), 'utf8')).toBe(
      '진아가 사연을 읽었다.\n',
    );

    const again = await run('scene migrate', args(['scene', 'migrate']));
    expect(again.message).toBe('바꿀 씬이 없습니다.');
  });

  // 0.8 이전 워크스페이스에는 마커만 있고 manuscript/ 가 없다.
  it('tops up a stale gitignore block on re-init', async () => {
    writeFileSync(
      join(workspace, '.gitignore'),
      '# Storyboard generated files\n.storyboard/cache/\n.draft/\n',
    );

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(workspace, '.gitignore'), 'utf8')).toContain('manuscript/');
    expect(
      JSON.parse(readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8')).name,
    ).toBe('시그널');
  });

  // 계약 플래그가 조용히 버려진 채 exit 0 이 되면 에이전트는 제목이 바뀌었다고 믿는다.
  it('refuses a plain init on an existing workspace', async () => {
    const outcome = await run('init', args(['init'], { title: '새 제목' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('--repair');
  });

  it('refuses --repair outside a workspace', async () => {
    rmSync(join(workspace, '.storyboard'), { recursive: true, force: true });

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(false);
  });

  it('reports both gaps in doctor', async () => {
    writeLegacyScene();
    writeFileSync(
      join(workspace, '.gitignore'),
      '# Storyboard generated files\n.storyboard/cache/\n.draft/\n',
    );

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).toContain('플레이스홀더 요약이 1개');
    expect(outcome.message).toContain('storyboard scene migrate');
    expect(outcome.message).toContain('manuscript/');
  });

  it('reports inline summaries and missing beats in doctor', async () => {
    writeFileSync(
      join(workspace, 'scene', '01-first.card'),
      ['type: scene', 'id: 01-first', 'summary: 진아가 사연을 읽었다.', ''].join('\n'),
    );
    writeFileSync(
      join(workspace, 'scene', '02-second.card'),
      ['type: scene', 'id: 02-second', 'beats:', '  - 진아가 스튜디오에 들어선다.', ''].join('\n'),
    );

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).toContain('인라인 summary 씬이 1개');
    expect(outcome.message).toContain('비트 없는 씬이 1개');
    expect(outcome.message).toContain('storyboard scene beats --all');
  });
});

describe('git repository', () => {
  function git(...gitArgs: string[]): string | undefined {
    try {
      return execFileSync('git', gitArgs, {
        cwd: workspace,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return undefined;
    }
  }

  // 발판(.gitignore)이 저장소보다 먼저 있어야 생성물이 첫 커밋에 쓸려 들어가지 않는다. 그 첫 커밋은
  // CLI 가 아니라 사용자의 몫이라 HEAD 는 아직 비어 있어야 한다.
  it('makes a new workspace a repository on main without committing', () => {
    expect(existsSync(join(workspace, '.git'))).toBe(true);
    expect(git('symbolic-ref', 'HEAD')).toBe('refs/heads/main');
    expect(git('rev-parse', '--verify', 'HEAD')).toBeUndefined();
    expect(readFileSync(join(workspace, '.gitignore'), 'utf8')).toContain('manuscript/');
  });

  it('creates the repository for an existing workspace on --repair', async () => {
    rmSync(join(workspace, '.git'), { recursive: true, force: true });

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('git 저장소도 만들었습니다');
    expect(git('rev-parse', '--is-inside-work-tree')).toBe('true');
  });

  it('leaves an existing repository untouched', async () => {
    git('symbolic-ref', 'HEAD', 'refs/heads/draft');

    const outcome = await run('init', args(['init'], { repair: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).not.toContain('git 저장소');
    expect(git('symbolic-ref', 'HEAD')).toBe('refs/heads/draft');
  });

  it('points a repository-less workspace at init --repair in doctor', async () => {
    rmSync(join(workspace, '.git'), { recursive: true, force: true });

    const outcome = await run('doctor', args(['doctor']));
    const { checks } = outcome.data as {
      checks: { label: string; status: string; fix?: string }[];
    };
    const check = checks.find((entry) => entry.label === 'git');

    expect(check?.status).toBe('warn');
    expect(check?.fix).toBe('storyboard init --repair');
  });
});

describe('scene beats', () => {
  function writeScene(stem: string, extra: string[] = []): void {
    writeFileSync(
      join(workspace, 'scene', `${stem}.card`),
      ['type: scene', `id: ${stem}`, 'purpose: 첫 방송', ...extra, ''].join('\n'),
    );
  }

  it('writes the proposed beats to the card', async () => {
    writeScene('01-first');

    const outcome = await run('scene beats', args(['scene', 'beats'], {}, ['01-first']));

    expect(outcome.ok).toBe(true);
    expect(outcome.data).toMatchObject({ stem: '01-first', written: true });
    const card = readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8');
    expect(card).toContain('beats:\n  - 모의 비트 하나\n  - 모의 비트 둘\n  - 모의 비트 셋\n');
    expect(card).toContain('purpose: 첫 방송');
  });

  it('keeps existing beats unless --force, and never writes on --dry-run', async () => {
    writeScene('01-first', ['beats:', '  - 창작자가 다듬은 비트']);

    const kept = await run('scene beats', args(['scene', 'beats'], {}, ['01-first']));
    expect(kept.ok).toBe(true);
    expect(kept.message).toContain('--force');
    expect(readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8')).toContain(
      '창작자가 다듬은 비트',
    );

    const dry = await run(
      'scene beats',
      args(['scene', 'beats'], { force: true, 'dry-run': true }, ['01-first']),
    );
    expect(dry.data).toMatchObject({ written: false, beats: ['모의 비트 하나', '모의 비트 둘', '모의 비트 셋'] });
    expect(readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8')).toContain(
      '창작자가 다듬은 비트',
    );

    const forced = await run('scene beats', args(['scene', 'beats'], { force: true }, ['01-first']));
    expect(forced.data).toMatchObject({ written: true });
    expect(readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8')).not.toContain(
      '창작자가 다듬은 비트',
    );
  });

  it('fills only the scenes without beats on --all', async () => {
    writeScene('01-first');
    writeScene('02-second', ['beats:', '  - 이미 있는 비트']);

    const outcome = await run('scene beats', args(['scene', 'beats'], { all: true }));

    expect(outcome.ok).toBe(true);
    expect(outcome.data).toMatchObject({ proposed: 1, failures: [] });
    expect(readFileSync(join(workspace, 'scene', '02-second.card'), 'utf8')).toContain(
      '이미 있는 비트',
    );
    expect(readFileSync(join(workspace, 'scene', '01-first.card'), 'utf8')).toContain(
      '모의 비트 하나',
    );
  });

  it('requires a stem without --all', async () => {
    const outcome = await run('scene beats', args(['scene', 'beats']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('scene beats 01-scene-1-1');
  });
});

describe('scene generate progress', () => {
  // 한 씬이 10~25분 걸리는데 --verbose 로도 아무 것도 찍히지 않았다.
  it('logs the pipeline stage and section index', async () => {
    const logged: string[] = [];
    const real = container();
    const stubbed = {
      ...real,
      logger: { ...silentLogger, info: (message: string) => logged.push(message) },
      generateDraftUseCase: {
        execute: async (
          _uri: unknown,
          request: {
            onPipelineProgress?: (stage: string, current: number, total: number) => void;
          },
        ) => {
          request.onPipelineProgress?.('expandSection', 2, 3);
          return { ok: true, kind: 'generated', draftUri: real.workspaceRoot, warnings: [] };
        },
      },
    } as unknown as Parameters<(typeof commands)['scene generate']>[0]['container'];

    await commands['scene generate']({
      container: stubbed,
      args: args(['scene', 'generate'], {}, ['01-first']),
    });

    expect(logged).toEqual(['살붙임 2/3']);
  });
});

describe('scene generate warnings', () => {
  // 초안 앞머리의 warnings 는 사람이 파일을 열어야 보인다. 무인 실행에서는 아무도 열지 않는다.
  it('reports the draft warnings on stderr and in the json data', async () => {
    const warned: string[] = [];
    const real = container();
    const stubbed = {
      ...real,
      logger: {
        ...silentLogger,
        warn: (message: string) => warned.push(message),
        info: (message: string) => warned.push(message),
      },
      generateDraftUseCase: {
        execute: async () => ({
          ok: true,
          kind: 'generated',
          draftUri: real.workspaceRoot,
          warnings: ['1구간: 목표 3,000자에 크게 못 미칩니다 (1,650자)'],
        }),
      },
      configBridge: { ...real.configBridge, isReviseAfterGenerateEnabled: () => true },
      reviseAfterGenerateGate: {
        runForScene: async (
          _root: unknown,
          _stem: string,
          options: { onProgress: (m: string) => void },
        ) => {
          options.onProgress('검사 중 (1/1)');
          return undefined;
        },
      },
    } as unknown as Parameters<(typeof commands)['scene generate']>[0]['container'];

    const outcome = await commands['scene generate']({
      container: stubbed,
      args: args(['scene', 'generate'], {}, ['01-first']),
    });

    expect(outcome.ok).toBe(true);
    // 검수 재작성이 이미 고쳤을 수 있는 문제를 그 뒤에 알리면 stale 경고가 된다.
    expect(warned).toEqual(['1구간: 목표 3,000자에 크게 못 미칩니다 (1,650자)', '검사 중 (1/1)']);
    expect((outcome.data as { warnings: string[] }).warnings).toHaveLength(1);
  });
});

describe('narrator verbs', () => {
  it('reports no narrator cards on a fresh workspace', async () => {
    const outcome = await run('narrator list', args(['narrator', 'list']));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('작품 계약의 시점');
  });

  it('creates a narrator card and lists it', async () => {
    const created = await run(
      'narrator add',
      args(['narrator', 'add'], { person: 'first', focal: 'hana', voice: '건조한 단문, 자기 비하' }, ['hana-first']),
    );

    expect(created.ok).toBe(true);
    expect(existsSync(join(workspace, 'narrator', 'hana-first.card'))).toBe(true);

    const listed = await run('narrator list', args(['narrator', 'list']));
    expect(listed.message).toContain('hana-first');
    expect(listed.message).toContain('1인칭');
  });

  it('refuses a person the format does not define', async () => {
    const outcome = await run('narrator add', args(['narrator', 'add'], { person: 'fourth' }, ['x']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('first, second, third');
  });

  it('refuses an id that is not a valid file name', async () => {
    const outcome = await run('narrator add', args(['narrator', 'add'], {}, ['하나']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('영소문자');
  });

  it('refuses to overwrite an existing narrator', async () => {
    await run('narrator add', args(['narrator', 'add'], {}, ['hana-first']));
    const again = await run('narrator add', args(['narrator', 'add'], {}, ['hana-first']));

    expect(again.ok).toBe(false);
    expect(again.message).toContain('이미 있습니다');
  });

  it('shows one narrator and removes it', async () => {
    await run('narrator add', args(['narrator', 'add'], { person: 'first', knowledge: 'retrospective' }, ['old-hana']));

    const shown = await run('narrator show', args(['narrator', 'show'], {}, ['old-hana']));
    expect(shown.message).toContain('회고');

    const removed = await run('narrator remove', args(['narrator', 'remove'], {}, ['old-hana']));
    expect(removed.ok).toBe(true);
    expect(existsSync(join(workspace, 'narrator', 'old-hana.card'))).toBe(false);
  });

  it('reports a narrator that does not exist', async () => {
    const outcome = await run('narrator show', args(['narrator', 'show'], {}, ['ghost']));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('ghost');
  });
});

describe('composition presets', () => {
  it('creates omnibus threads from the contract flags', async () => {
    const outcome = await run(
      'project set',
      args(['project', 'set'], { composition: 'omnibus', episodes: '4' }),
    );

    expect(outcome.ok).toBe(true);

    const project = JSON.parse(
      readFileSync(join(workspace, '.storyboard', 'project.json'), 'utf8'),
    ) as { setting?: { composition?: string; threads?: Record<string, unknown> } };

    expect(project.setting?.composition).toBe('omnibus');
    expect(Object.keys(project.setting?.threads ?? {})).toEqual(['ep1', 'ep2', 'ep3', 'ep4']);
  });

  it('writes narrator cards for an alternating point of view', async () => {
    const outcome = await run(
      'project set',
      args(['project', 'set'], { composition: 'alternating-pov', 'pov-characters': 'hana,jun', pov: 'first' }),
    );

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(workspace, 'narrator', 'hana-pov.card'))).toBe(true);
    expect(existsSync(join(workspace, 'narrator', 'jun-pov.card'))).toBe(true);
  });

  it('refuses a composition the format does not define', async () => {
    const outcome = await run('project set', args(['project', 'set'], { composition: 'anthology' }));

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('omnibus');
  });
});

describe('scene show', () => {
  it('reports the narration a scene will be generated with', async () => {
    await run('project set', args(['project', 'set'], { pov: 'first' }));
    await run('scene create', args(['scene', 'create'], { name: 'night market' }));

    const outcome = await run('scene show', args(['scene', 'show'], {}, ['01-night-market']));

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain('시점: 1인칭');
    expect(outcome.message).toContain('줄기: main');
  });

  it('reports the narrator card a scene names', async () => {
    await run('narrator add', args(['narrator', 'add'], { person: 'third', knowledge: 'omniscient' }, ['wide']));
    await run('scene create', args(['scene', 'create'], { name: 'bridge' }));
    writeFileSync(
      join(workspace, 'scene', '01-bridge.card'),
      'type: scene\nid: 01-bridge\nnarrator: wide\nthread: ep2\n',
    );

    const outcome = await run('scene show', args(['scene', 'show'], {}, ['01-bridge']));

    expect(outcome.message).toContain('전지');
    expect(outcome.message).toContain('줄기: ep2');
  });
});

describe('doctor: unreadable ledger lines', () => {
  function writeLedger(relativePath: string, ...lines: readonly string[]): void {
    const absolute = join(workspace, ...relativePath.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(
      absolute,
      ['# 이야기 상태', '<!-- through-scene: 2 -->', '## 확정 사실', ...lines, ''].join('\n'),
    );
  }

  it('stays quiet about a ledger it can read', async () => {
    writeLedger('.storyboard/memory/storyState.md', '- [1] 사실', '- [2|hana] 사실', '- 태그 없는 사실');

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).not.toContain('태그를 읽지 못한 원장 줄');
  });

  it('reports a hand-edited line whose tag no longer parses', async () => {
    writeLedger('.storyboard/memory/storyState.md', '- [1] 사실', '- [2!!] 망가진 줄');

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).toContain('태그를 읽지 못한 원장 줄이 1개');
    expect(outcome.message).toContain('[2!!] 망가진 줄');
  });

  it('looks at the ledger of every declared thread', async () => {
    await run('project set', args(['project', 'set'], { composition: 'omnibus', episodes: '2' }));
    writeLedger('.storyboard/memory/storyState.md', '- [1] 사실');
    writeLedger('.storyboard/memory/threads/ep2/storyState.md', '- [삼] 편 안의 망가진 줄');

    const outcome = await run('doctor', args(['doctor']));

    expect(outcome.message).toContain('태그를 읽지 못한 원장 줄이 1개');
    expect(outcome.message).toContain('[삼] 편 안의 망가진 줄');
  });
});

