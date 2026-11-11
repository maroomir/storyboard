import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InterviewWorkingModel } from '@storyboard/story-model';

import { CommandDispatcher, type DispatchDependencies, type DispatchResult } from '@/commands/commandDispatcher';

import { isLegacyCardPath, readCardYaml, writeCardBundleFromYaml } from './fixtures/cardBundles';
import { writeSceneBundleFromYaml } from './fixtures/sceneBundles';

let home: string;
let workspace: string;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

interface StepOption {
  readonly index: number;
  readonly label: string;
}

interface StepReport {
  readonly ok: boolean;
  readonly message: string;
  readonly data?: {
    readonly state: 'question' | 'confirm' | 'finished' | 'abandoned';
    readonly session: string;
    readonly question?: {
      readonly id: string;
      readonly title: string;
      readonly source: { readonly kind: string; readonly sceneStem?: string; readonly beatIndex?: number };
      readonly options: readonly StepOption[];
      readonly allowsText: boolean;
    };
    readonly questionId?: string;
    readonly read?: { readonly valueId: string; readonly valueLabel: string };
    readonly options?: readonly StepOption[];
    readonly answered?: number;
    readonly limit?: number;
    readonly summary?: { readonly answered: number; readonly candidateCount: number };
  };
}

function deps(): DispatchDependencies {
  return { version: '0.0.0', cwd: workspace, isInteractive: false, createLogger: () => silentLogger };
}

async function dispatch(argv: readonly string[]): Promise<DispatchResult> {
  return new CommandDispatcher(deps()).dispatch([...argv]);
}

async function step(...extra: string[]): Promise<{ readonly exitCode: number; readonly report: StepReport }> {
  const result: DispatchResult = await dispatch(['card', 'interview', 'hana', '--step', '--json', ...extra]);

  return { exitCode: result.exitCode, report: JSON.parse(result.stdout) as StepReport };
}

async function write(relativePath: string, lines: readonly string[]): Promise<void> {
  const text: string = `${lines.join('\n')}\n`;
  if (isLegacyCardPath(relativePath)) {
    writeCardBundleFromYaml(workspace, text);
    return;
  }

  if (/^scene\/[^/]+\.card$/.test(relativePath)) {
    await writeSceneBundleFromYaml(workspace, text);
    return;
  }

  writeFileSync(join(workspace, relativePath), text);
}

function readModel(): InterviewWorkingModel {
  return JSON.parse(
    readFileSync(join(workspace, '.storyboard/cache/interviews/cards/hana.json'), 'utf8'),
  ) as InterviewWorkingModel;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-interview-step-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-interview-step-ws-'));
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
  await dispatch(['init', '--title', '달의 문']);
  write('character/hana.card', ['type: character', 'id: hana', 'name: 하나', 'role: main']);
  await write('scene/001-night.card', [
    'type: scene',
    'id: 001-night',
    'characters:',
    '  - hana',
    'beats:',
    '  - text: 준이 하나를 심문한다',
    '    cast: [하나]',
    '  - text: 하나가 자리를 뜨려 한다',
    '    cast: [하나]',
    '  - text: 하나가 등대로 돌아간다',
    '    cast: [하나]',
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('card interview --step', () => {
  it('needs --json, and points an agent without a terminal to --step', async () => {
    const withoutJson: DispatchResult = await dispatch(['card', 'interview', 'hana', '--step']);
    expect(withoutJson.exitCode).toBe(1);
    expect(withoutJson.stdout).toContain('--step 은 --json 과 함께 씁니다');

    const withoutStep: DispatchResult = await dispatch(['card', 'interview', 'hana', '--json']);
    expect(withoutStep.exitCode).toBe(1);
    expect(JSON.parse(withoutStep.stdout).message).toContain('--step --json');
  });

  it('opens a session, keeps the question until it is answered, and walks to the end', async () => {
    const opened = await step();
    expect(opened.exitCode).toBe(0);
    expect(opened.report.data).toMatchObject({ state: 'question', answered: 0, limit: 20 });
    expect(opened.report.data?.question).toMatchObject({
      title: '1번째 · 압박 아래 방어 (001-night · 사건 1)',
      allowsText: true,
    });
    expect(opened.report.data?.question?.options.map((option) => option.index)).toEqual([1, 2, 3]);
    const sessionId: string = opened.report.data?.session ?? '';
    expect(sessionId).toMatch(/^\d{17}$/);

    const shownAgain = await step();
    expect(shownAgain.report.data?.question?.id).toBe(opened.report.data?.question?.id);
    expect(readModel().records).toHaveLength(1);

    const second = await step('--session', sessionId, '--answer', '2');
    expect(second.report.data).toMatchObject({ state: 'question', session: sessionId, answered: 1 });
    expect(second.report.data?.question?.title).toBe('2번째 · 압박 아래 방어 (001-night · 사건 2)');
    expect(readModel().records[0]?.answer).toEqual({ kind: 'chosen', index: 1 });

    const finished = await step('--finish');
    expect(finished.report.data).toMatchObject({ state: 'finished', session: sessionId });
    expect(finished.report.data?.summary).toMatchObject({ answered: 1 });
    expect(readModel().records.every((record) => record.answer !== undefined)).toBe(true);

    const afterFinish = await step('--answer', '1');
    expect(afterFinish.exitCode).toBe(1);
    expect(afterFinish.report.message).toContain('열린 인터뷰 세션이 없습니다');
  });

  it('asks to confirm how a written answer was read before the next question', async () => {
    await step();
    const confirm = await step('--write', '웃어 버린다');
    expect(confirm.report.data).toMatchObject({ state: 'confirm', read: { valueId: 'counter', valueLabel: '역공' } });
    expect(confirm.report.data?.options?.[0]).toEqual({ index: 1, label: '맞다 — 역공' });

    const shownAgain = await step();
    expect(shownAgain.report.data?.state).toBe('confirm');
    const answerWhileConfirming = await step('--answer', '1');
    expect(answerWhileConfirming.exitCode).toBe(1);
    expect(answerWhileConfirming.report.message).toContain('--confirm <n>');

    const next = await step('--confirm', '1');
    expect(next.report.data).toMatchObject({ state: 'question', answered: 1 });
    expect(readModel().records[0]).toMatchObject({
      answer: { kind: 'written', valueId: 'counter', isNewValue: false },
      isConfirmed: true,
    });
    expect(readModel().tallies['pressure-defense']).toEqual({ counter: 2 });
  });

  it('names a written answer as a new value with --rename', async () => {
    await step();
    await step('--write', '웃어 버린다');
    await step('--rename', '웃음으로 넘기기');

    const model: InterviewWorkingModel = readModel();
    expect(model.records[0]?.answer).toMatchObject({ kind: 'written', isNewValue: true });
    const newValueId: string = model.records[0]?.answer?.kind === 'written' ? model.records[0].answer.valueId : '';
    expect(newValueId).toMatch(/^custom-\d+$/);
    expect(model.tallies['pressure-defense']).toEqual({ counter: 0, [newValueId]: 2 });
  });

  it('closes a session without distilling on --abandon, and the next session asks that beat again', async () => {
    const opened = await step();
    const abandoned = await step('--abandon');
    expect(abandoned.report.data).toMatchObject({ state: 'abandoned', session: opened.report.data?.session });
    expect(readModel().records).toHaveLength(0);

    const reopened = await step();
    expect(reopened.report.data?.session).not.toBe(opened.report.data?.session);
    expect(reopened.report.data?.question?.source).toEqual(opened.report.data?.question?.source);
  });

  it('finishes on --limit, and refuses a wrong session, a bad number or two answers at once', async () => {
    const opened = await step('--limit', '1');

    expect((await step('--session', '20000101000000000')).report.message).toContain(
      `이 카드의 열린 세션은 ${opened.report.data?.session ?? ''}`,
    );
    expect((await step('--answer', '9')).report.message).toContain('선택지는 1~3 번입니다');
    expect((await step('--answer', '0')).report.message).toContain('선택지 번호(1부터)');
    expect((await step('--answer', '1', '--skip')).report.message).toContain('함께 쓸 수 없습니다');
    expect((await step('--limit', 'abc')).report.message).toContain('--limit 에는 1 이상의 정수');

    const finished = await step('--limit', '1', '--skip');
    expect(finished.report.data?.state).toBe('question');
    const done = await step('--limit', '1', '--answer', '1');
    expect(done.report.data).toMatchObject({ state: 'finished', summary: { answered: 1 } });
  });
});
