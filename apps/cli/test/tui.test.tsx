import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { foldLines, StoryboardTui } from '../src/tui/app';
import { findHistoryMatch } from '../src/tui/lineEditor';
import { acquireWorkspaceRunLock } from '@storyboard/story-engine';
import { NodeUri, serializeDraft } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { dispatch } from '../src/commands/dispatch';
import { canShowWordmark, storyboardWordmark } from '../src/terminal/banner';
import { measureWidth } from '../src/terminal/width';
import { Banner } from '../src/tui/banner';
import { describeHeader } from '../src/tui/index';
import { Dashboard, describeDraftProgress } from '../src/tui/dashboard';
import {
  classifyReaderLine,
  countManuscriptCharacters,
  DraftReader,
  layoutReaderLines,
} from '../src/tui/draftReader';
import { readWorkspaceView } from '../src/tui/workspaceView';
import { StatusBar } from '../src/tui/statusBar';
import { runShellCommand } from '../src/adapters/shellCommand';
import { describeSpending, splitCommandLine, suggestForInput } from '../src/tui/session';
import { loadTuiThemeName, saveTuiThemeName } from '../src/tui/tuiTheme';
import { selectVisibleWindow } from '../src/tui/suggestionList';

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-tui-home-'));
  cwd = mkdtempSync(join(tmpdir(), 'storyboard-tui-cwd-'));
  vi.stubEnv('STORYBOARD_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A person types one key at a time; a whole string in one write reaches Ink as a single chunk.
async function typeKeys(stdin: { write: (data: string) => void }, text: string): Promise<void> {
  for (const key of text) {
    stdin.write(key);
    await wait(5);
  }
}

describe('splitCommandLine', () => {
  it('keeps quoted arguments together', () => {
    expect(splitCommandLine('init --title "밤의 항해" --language ko')).toEqual([
      'init',
      '--title',
      '밤의 항해',
      '--language',
      'ko',
    ]);
  });
});

describe('suggestForInput', () => {
  it('proposes verbs by prefix and slash commands by leading slash', () => {
    expect(suggestForInput('draft gen', cwd).map((s) => s.text)).toEqual(['draft generate']);
    expect(suggestForInput('/he', cwd).map((s) => s.text)).toEqual(['/help']);
    expect(suggestForInput('', cwd)).toEqual([]);
  });

  it('completes the word after the verb and keeps what was typed before it', () => {
    expect(suggestForInput('draft check ', cwd).map((s) => s.line)).toEqual([
      'draft check grammar ',
      'draft check continuity ',
      'draft check slop ',
    ]);
    expect(suggestForInput('draft generate --f', cwd)).toEqual([
      expect.objectContaining({ text: '--force', line: 'draft generate --force ' }),
    ]);
  });

  it('names scenes and cards after an @ and fills in the bare stem', () => {
    mkdirSync(join(cwd, 'scene'), { recursive: true });
    mkdirSync(join(cwd, 'character'), { recursive: true });
    writeFileSync(join(cwd, 'scene', '01-ambush.card'), '');
    writeFileSync(join(cwd, 'character', 'hana.card'), '');

    expect(suggestForInput('draft show @01', cwd)).toEqual([
      { text: '@01-ambush', summary: '씬', line: 'draft show 01-ambush ' },
    ]);
    expect(suggestForInput('card show @', cwd).map((s) => s.text)).toEqual(['@01-ambush', '@hana']);
  });

  it('falls back to the closest verbs for a misspelled one', () => {
    expect(suggestForInput('scen genrate', cwd).map((s) => s.text)).toContain('draft generate');
  });
});

describe('selectVisibleWindow', () => {
  it('keeps the selection inside an eight-row window', () => {
    expect(selectVisibleWindow(3, 2)).toEqual([0, 3]);
    expect(selectVisibleWindow(20, 0)).toEqual([0, 8]);
    expect(selectVisibleWindow(20, 10)).toEqual([6, 14]);
    expect(selectVisibleWindow(20, 19)).toEqual([12, 20]);
  });
});

describe('describeHeader', () => {
  it('tells the author the folder is not a workspace and no provider is set', () => {
    const header = describeHeader(cwd);

    expect(header.workspaceLabel).toContain('워크스페이스 아님');
    expect(header.providerLabel).toBe('AI 프로바이더 없음');
    expect(header.hint).toContain('setup');
  });
});

describe('readWorkspaceView', () => {
  const silentLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    show: () => undefined,
  };

  it('names the app that holds the run lock of the workspace', async () => {
    await dispatch(['init', '--title', '잠금'], {
      version: '0',
      cwd,
      isInteractive: false,
      createLogger: () => silentLogger,
    });
    expect((await readWorkspaceView(cwd, '0')).lockHolder).toBeUndefined();

    const acquired = await acquireWorkspaceRunLock({
      fileSystem: new NodeFileSystem(),
      workspaceRoot: NodeUri.file(cwd),
      holder: { owner: 'desktop', label: '소설 생성', pid: process.pid, hostname: 'here' },
    });
    expect(acquired.ok).toBe(true);

    expect((await readWorkspaceView(cwd, '0')).lockHolder).toContain('데스크톱 앱');
  });

  it('reads the work status a home screen shows', async () => {
    await dispatch(['init', '--title', '현황'], {
      version: '0',
      cwd,
      isInteractive: false,
      createLogger: () => silentLogger,
    });
    const view = await readWorkspaceView(cwd, '0');

    expect(view.status?.project.name).toBe('현황');
    expect(view.status?.nextStep).toBe('fill-contract');
    expect((await readWorkspaceView(home, '0')).status).toBeUndefined();
  });
});

describe('history and folding', () => {
  it('finds the newest matching line, then older ones', () => {
    const history = ['scene list', 'draft show 01-a', 'draft show 02-b', 'status'];

    expect(findHistoryMatch(history, 'draft')).toBe(2);
    expect(findHistoryMatch(history, 'draft', 2)).toBe(1);
    expect(findHistoryMatch(history, 'draft', 1)).toBeUndefined();
    expect(findHistoryMatch(history, '')).toBe(3);
  });

  it('folds a long result to its head and unfolds it on request', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `줄 ${index}`);

    expect(foldLines(lines, false)).toHaveLength(13);
    expect(foldLines(lines, false).at(-1)).toBe('… +28줄 · Ctrl+O 로 펼치기');
    expect(foldLines(lines, true)).toHaveLength(40);
    expect(foldLines(lines.slice(0, 14), false)).toHaveLength(14);
  });
});

describe('settings screens', () => {
  it('totals what the screen spent, command by command', () => {
    expect(describeSpending([])).toContain('아직 비용이 든 명령이 없습니다');
    expect(
      describeSpending([
        { line: 'draft generate 01-a', costUsd: 0.18 },
        { line: 'draft revise 01-a', costUsd: 0.05 },
      ]).split('\n'),
    ).toEqual(['$   0.18  draft generate 01-a', '$   0.05  draft revise 01-a', '$   0.23  합계']);
  });

  it('keeps the theme choice in its own file and falls back on a damaged one', () => {
    const file = join(home, 'tui.json');

    expect(loadTuiThemeName(file)).toBe('default');
    saveTuiThemeName('mono', file);
    expect(loadTuiThemeName(file)).toBe('mono');
    writeFileSync(file, '{ not json');
    expect(loadTuiThemeName(file)).toBe('default');
  });
});

describe('draft reader', () => {
  const body = ['그는 문을 열었다.', '', '"누구세요?"', '', '* * *', '', '다음 날 아침.'].join(
    '\n',
  );

  it('tells dialogue, scene breaks and prose apart', () => {
    expect(classifyReaderLine('"누구세요?"')).toBe('dialogue');
    expect(classifyReaderLine('「가자」')).toBe('dialogue');
    expect(classifyReaderLine('* * *')).toBe('separator');
    expect(classifyReaderLine('---')).toBe('separator');
    expect(classifyReaderLine('그는 문을 열었다.')).toBe('prose');
    expect(classifyReaderLine('   ')).toBe('blank');
  });

  it('counts characters without spaces and wraps paragraphs to the width', () => {
    expect(countManuscriptCharacters('가 나\n다')).toBe(3);
    const lines = layoutReaderLines('가나다라마바사아자차카타파하 가나다라마바사아자차', 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.kind === 'prose')).toBe(true);
  });

  it('pages through a long draft and closes on q', async () => {
    const long = Array.from({ length: 60 }, (_, index) => `문단 ${index}.`).join('\n');
    let isClosed = false;
    const { lastFrame, stdin } = render(
      <DraftReader
        title="draft/01-a.md"
        body={long}
        columns={80}
        rows={15}
        onClose={() => {
          isClosed = true;
        }}
      />,
    );
    await wait(50);

    expect(lastFrame()).toContain('draft/01-a.md · 290자 · 0%');
    expect(lastFrame()).toContain('문단 0.');
    stdin.write(' ');
    await wait(30);
    expect(lastFrame()).not.toContain('문단 0.');
    expect(lastFrame()).toContain('문단 10.');
    stdin.write('q');
    await wait(30);
    expect(isClosed).toBe(true);
  });

  it('opens a shown draft in the reader instead of the log', async () => {
    await dispatch(['init', '--title', '읽기'], {
      version: '0',
      cwd,
      isInteractive: false,
      createLogger: () => ({
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        show: () => undefined,
      }),
    });
    mkdirSync(join(cwd, 'draft'), { recursive: true });
    writeFileSync(
      join(cwd, 'draft', '01-a.md'),
      serializeDraft({
        sceneStem: '01-a',
        format: 'novel',
        generatedAt: '2026-10-05T00:00:00.000Z',
        body,
      }),
    );
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );
    await wait(50);

    await typeKeys(stdin, 'draft show 01-a');
    stdin.write('\r');
    await wait(400);

    expect(lastFrame()).toContain('draft/01-a.md ·');
    expect(lastFrame()).toContain('q 닫기');
    expect(lastFrame()).toContain('"누구세요?"');
  });
});

describe('Banner', () => {
  it('draws the two-line wordmark when it fits and one line when it does not', () => {
    expect(new Set(storyboardWordmark.map(measureWidth)).size).toBe(1);
    expect(canShowWordmark(80)).toBe(true);
    expect(canShowWordmark(40)).toBe(false);

    const narrow = render(<Banner version="1.2.3" columns={40} />).lastFrame() ?? '';
    expect(narrow).toContain('Storyboard 1.2.3');
    expect(narrow).not.toContain(storyboardWordmark[0]);
  });
});

describe('Dashboard', () => {
  const status = {
    project: { name: '레벨 제로', missingContract: [] },
    outline: { hasSynopsis: true, hasChapterPlan: true },
    cards: { characters: 5, backgrounds: 3, narrators: 0 },
    scenes: { total: 32 },
    drafts: { ready: 18, stale: 2, missing: 12, withWarnings: 0 },
    canon: { pendingFacts: 0 },
    manuscript: { isAssembled: false, isStale: false, isReviewed: false },
    nextStep: 'generate-drafts',
  } as const;

  it('counts fresh drafts against scenes', () => {
    const progress = describeDraftProgress(status);

    expect([progress.done, progress.total]).toEqual([18, 32]);
    expect(progress.bar).toHaveLength(24);
    expect(describeDraftProgress({ ...status, scenes: { total: 0 } }).bar).toBe('░'.repeat(24));
  });

  it('shows progress and the command that moves the work forward', () => {
    const { lastFrame } = render(<Dashboard status={status} />);

    expect(lastFrame()).toContain('레벨 제로');
    expect(lastFrame()).toContain('초안 18/32');
    expect(lastFrame()).toContain('56%');
    expect(lastFrame()).toContain('다음 draft generate --all');
  });
});

describe('StoryboardTui', () => {
  it('renders the header, runs a typed command, and shows its result in the log', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );

    expect(lastFrame()).toContain(storyboardWordmark[0]);
    expect(lastFrame()).toContain('1.2.3 · 장편 소설을 터미널에서');
    await wait(50);

    await typeKeys(stdin, '/doctor');
    await wait(20);
    stdin.write('\r');
    await wait(200);

    expect(lastFrame()).toContain('› /doctor');
    expect(lastFrame()).toContain('storyboard setup');
  });

  it('shows suggestions while typing and completes one with Tab', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );
    // Ink attaches its input listener in an effect, after the first frame.
    await wait(50);

    await typeKeys(stdin, 'config s');
    await wait(20);
    expect(lastFrame()).toContain('config show');
    expect(lastFrame()).toContain('config set');

    stdin.write('\t');
    await wait(20);
    expect(lastFrame()).toContain('❯ config show');
  });

  it('closes the list with Esc, then clears the line with a second Esc', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );
    await wait(50);

    await typeKeys(stdin, 'config s');
    await wait(20);
    expect(lastFrame()).toContain('Tab 확정');

    stdin.write('\u001b');
    await wait(50);
    expect(lastFrame()).not.toContain('Tab 확정');
    expect(lastFrame()).toContain('❯ config s');

    stdin.write('\u001b');
    await wait(50);
    expect(lastFrame()).not.toContain('config s');
  });

  it('keeps a status line under the prompt', async () => {
    const view = {
      header: { workspaceLabel: '밤의 항해', providerLabel: 'mock' },
      lockHolder: '데스크톱 앱이(가) «소설 생성» 작업 중입니다',
    };
    const { lastFrame } = render(
      <StoryboardTui
        version="1.2.3"
        cwd={cwd}
        header={describeHeader(cwd)}
        loadWorkspaceView={() => Promise.resolve(view)}
      />,
    );
    await wait(50);

    const lines = (lastFrame() ?? '').split('\n');
    expect(lines.findIndex((line) => line.includes('❯'))).toBeLessThan(
      lines.findIndex((line) => line.includes('«소설 생성» 작업 중')),
    );
    expect(lastFrame()).toContain('/help 도움말');
  });

  it('keeps the status on one line in a narrow window', () => {
    const view = {
      header: { workspaceLabel: '아주 긴 작품 이름이 붙은 장편', providerLabel: 'mock' },
    };
    const { lastFrame } = render(<StatusBar view={view} isBusy={false} columns={40} />);

    expect((lastFrame() ?? '').split('\n')).toHaveLength(1);
    expect(lastFrame()).not.toContain('Ctrl+R');
  });

  it('stops a shell command that would wait forever, with what it started', async () => {
    const run = runShellCommand('sleep 30', tmpdir());
    run.stop();

    expect((await run.result).exitCode).not.toBe(0);
  });

  it('names Esc only when the running command can stop', () => {
    const view = { header: { workspaceLabel: '작품', providerLabel: 'mock' } };

    expect(render(<StatusBar view={view} isBusy columns={100} />).lastFrame()).not.toContain('Esc');
    expect(
      render(
        <StatusBar view={view} isBusy columns={100} escapeHint="Esc 씬 경계에서 멈춤" />,
      ).lastFrame(),
    ).toContain('Esc 씬 경계에서 멈춤');
  });

  it('puts a line found with Ctrl+R back at the prompt without running it', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );
    await wait(50);

    await typeKeys(stdin, '/clear');
    stdin.write('\r');
    await wait(50);

    stdin.write('\u0012');
    await wait(20);
    await typeKeys(stdin, 'cl');
    await wait(20);
    expect(lastFrame()).toContain('기록 검색 cl');
    expect(lastFrame()).toContain('/clear · Enter 넣기');

    stdin.write('\r');
    await wait(50);
    expect(lastFrame()).toContain('❯ /clear');
  });

  it('changes a setting through /config with the same write config set makes', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );
    await wait(50);

    await typeKeys(stdin, '/config');
    stdin.write('\r');
    await wait(100);
    expect(lastFrame()).toContain('생성 직후 자동 검수·수정');

    stdin.write('\r');
    await wait(50);
    stdin.write('2');
    await wait(300);

    expect(lastFrame()).toContain('revise.loop.afterGenerate = false 저장했습니다');
    expect(readFileSync(join(home, 'config.json'), 'utf8')).toMatch(/"afterGenerate": false/);
  });

  it('runs a line that starts with ! in the shell and shows what it printed', async () => {
    const { lastFrame, stdin } = render(
      <StoryboardTui version="1.2.3" cwd={cwd} header={describeHeader(cwd)} />,
    );
    await wait(50);

    await typeKeys(stdin, '!echo 셸에서');
    stdin.write('\r');
    await wait(300);

    expect(lastFrame()).toContain('셸에서');
  });
});
