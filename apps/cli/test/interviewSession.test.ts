import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InterviewQuestion, InterviewWorkingModel, NoteCandidateFile, UsageRecord } from '@storyboard/story-model';
import type { InterviewStartResult, PrepareNoteCandidatePromotionResult } from '@storyboard/story-engine';
import { MockAiProvider } from '@storyboard/story-ai';

import type { ParsedArguments } from '@/cliArguments';
import { findCommand } from '@/commands/index';
import { createCliContainer, type CliContainer } from '@/container';

let home: string;
let workspace: string;
let previousHome: string | undefined;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function container(): CliContainer {
  return createCliContainer({
    workspacePath: workspace,
    logger: silentLogger,
    canPrompt: false,
    version: '0.0.0',
  });
}

function args(path: string[], flags: Record<string, string | boolean> = {}): ParsedArguments {
  return { path, flags, positionals: [] };
}

function write(relativePath: string, lines: readonly string[]): void {
  writeFileSync(join(workspace, relativePath), `${lines.join('\n')}\n`);
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(workspace, relativePath), 'utf8')) as T;
}

beforeEach(async () => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-interview-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-interview-ws-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
  const init = findCommand('init');
  await init?.execute({ container: container(), args: args(['init'], { title: '달의 문' }) });

  write('character/hana.card', [
    'type: character',
    'id: hana',
    'name: 하나',
    'role: main',
    'aliases:',
    '  - 등대 아이',
    'traits:',
    '  - 똑 부러진다',
    'relations:',
    '  - target: jun',
    '    type: 소꿉친구',
    '    speech: 반말',
  ]);
  write('character/jun.card', ['type: character', 'id: jun', 'name: 준', 'role: supporting']);
  write('background/tavern.card', [
    'type: location',
    'id: tavern',
    'name: 미감',
    'aliases:',
    '  - 술집',
    'description:',
    '  - 항구 뒷골목의 술집',
    'characterIds: []',
    'tags: []',
    'locationKind: place',
  ]);
  write('scene/01-night.card', [
    'type: scene',
    'id: 01-night',
    'characters:',
    '  - hana',
    '  - jun',
    'location: tavern',
    'beats:',
    '  - text: 준이 하나를 심문한다',
    '    cast: [하나, 준]',
    '    place: 미감',
    '    time: 밤',
    '  - text: 하나가 자리를 뜨려 한다',
    '    cast: [등대 아이]',
    '    place: 술집',
  ]);
  write('scene/02-dawn.card', [
    'type: scene',
    'id: 02-dawn',
    'characters:',
    '  - hana',
    'beats:',
    '  - 하나가 등대로 돌아간다',
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousHome === undefined) {
    delete process.env.STORYBOARD_HOME;
  } else {
    process.env.STORYBOARD_HOME = previousHome;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

async function waitForNextSessionId(): Promise<void> {
  const millisecondsUntilNextSecond: number = 1000 - (Date.now() % 1000) + 5;
  await new Promise((resolve) => setTimeout(resolve, millisecondsUntilNextSecond));
}

interface CapturedPrompt {
  readonly taskName: string;
  readonly prompt: string;
}

function captureUserPrompts(): CapturedPrompt[] {
  const captured: CapturedPrompt[] = [];
  const generate: MockAiProvider['generate'] = MockAiProvider.prototype.generate;
  vi.spyOn(MockAiProvider.prototype, 'generate').mockImplementation(function (
    this: MockAiProvider,
    request: Parameters<MockAiProvider['generate']>[0],
  ) {
    captured.push({
      taskName: request.taskName ?? '',
      prompt: request.messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content)
        .join('\n'),
    });
    return generate.call(this, request);
  });

  return captured;
}

function promptsOf(captured: readonly CapturedPrompt[], taskName: string): string[] {
  return captured.filter((entry) => entry.taskName === taskName).map((entry) => entry.prompt);
}

async function startSession(cardId: string): Promise<{ container: CliContainer; sessionId: string }> {
  const app: CliContainer = container();
  const started: InterviewStartResult = await app.interviews.start({
    workspaceRoot: app.workspaceRoot,
    cardId,
  });
  if (!started.ok) {
    throw new Error(started.message);
  }

  return { container: app, sessionId: started.opening.sessionId };
}

describe('interview session (mock provider)', () => {
  it('opens with the work-wide axes and the beats the character is in', async () => {
    const app: CliContainer = container();
    const started: InterviewStartResult = await app.interviews.start({
      workspaceRoot: app.workspaceRoot,
      cardId: 'hana',
    });

    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    expect(started.opening.coverage.openAxes.map((axis) => axis.axisId)).toEqual([
      'pressure-defense',
      'affection',
    ]);
    expect(started.opening.coverage.openAxes[0]?.beatSituations).toHaveLength(3);
    expect(started.opening.coverage.upcomingSceneStems).toEqual(['01-night', '02-dawn']);
    expect(existsSync(join(workspace, '.storyboard/cache/interviews/axes.json'))).toBe(true);
    expect(existsSync(join(workspace, '.storyboard/cache/interviews/cards/hana.json'))).toBe(true);
  });

  it('refuses a card that does not exist', async () => {
    const app: CliContainer = container();

    const started: InterviewStartResult = await app.interviews.start({
      workspaceRoot: app.workspaceRoot,
      cardId: 'nobody',
    });

    expect(started).toMatchObject({ ok: false, kind: 'card-not-found' });
  });

  it('asks the speech to a present relation first, then rotates beats one axis at a time, deciding an axis at the threshold', async () => {
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(speech?.source).toEqual({ kind: 'relation', target: 'jun' });
    expect(speech?.axisLabel).toBe('호칭과 말투 · 준에게');
    expect(speech?.options.map((option) => option.text)).toEqual([
      "[Mock AI] '준'라 부르고 반말",
      '[Mock AI] 이름 뒤에 씨를 붙여 존댓말',
      '[Mock AI] 별칭으로만 부르고 반말',
    ]);
    const spoken = await app.interviews.answer({ ...request, questionId: speech?.id ?? '', answer: { kind: 'chosen', index: 0 } });
    expect(spoken.classification).toBeUndefined();

    const first: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(first?.axisId).toBe('pressure-defense');
    expect(first?.source).toEqual({ kind: 'beat', sceneStem: '01-night', beatIndex: 0 });
    expect(first?.options.map((option) => option.valueId)).toEqual(['counter', 'withhold', 'deflect']);
    expect(first?.options.every((option) => !option.isExploration)).toBe(true);

    expect(await app.interviews.next(request)).toEqual(first);

    await app.interviews.answer({ ...request, questionId: first?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    const second: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(second?.source).toEqual({ kind: 'beat', sceneStem: '01-night', beatIndex: 1 });
    expect(second?.axisId).toBe('pressure-defense');
    expect(second?.options.filter((option) => option.isExploration).map((option) => option.valueId)).toEqual([
      'counter',
    ]);

    await app.interviews.answer({ ...request, questionId: second?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    const third: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(third?.source).toEqual({ kind: 'beat', sceneStem: '02-dawn', beatIndex: 0 });
    expect(third?.axisId).toBe('affection');

    await app.interviews.answer({ ...request, questionId: third?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    const model: InterviewWorkingModel = readJson('.storyboard/cache/interviews/cards/hana.json');
    expect(model.tallies).toEqual({ 'pressure-defense': { withhold: 2 }, affection: { indirect: 1 } });
    expect(model.summary).toContain('[Mock AI]');

    const fourth: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(fourth?.source).toEqual({ kind: 'beat', sceneStem: '01-night', beatIndex: 0 });
    expect(fourth?.axisId).toBe('affection');
  });

  it('hands the speech the writer chose toward each partner to the question and update prompts', async () => {
    const captured: CapturedPrompt[] = captureUserPrompts();
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({
      ...request,
      questionId: speech?.id ?? '',
      answer: { kind: 'written', text: "'등대지기'라 부르며 반말" },
    });
    const first: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: first?.id ?? '', answer: { kind: 'chosen', index: 0 } });
    const second: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: second?.id ?? '', answer: { kind: 'written', text: '웃어 버린다' } });

    const block: string = "[상대별 호칭·말투]\n- 하나 → 준: '등대지기'라 부르며 반말";
    expect(promptsOf(captured, 'interviewQuestion')).toHaveLength(2);
    expect(promptsOf(captured, 'interviewQuestion').every((prompt) => prompt.includes(block))).toBe(true);
    expect(promptsOf(captured, 'interviewUpdate')).toHaveLength(2);
    expect(promptsOf(captured, 'interviewUpdate').every((prompt) => prompt.includes(block))).toBe(true);
    expect(promptsOf(captured, 'interviewRelationSpeech')[0]).not.toContain('[상대별 호칭·말투]');
  });

  it('hands the card speech to the question prompt when the speech question was skipped', async () => {
    const captured: CapturedPrompt[] = captureUserPrompts();
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: speech?.id ?? '', answer: { kind: 'skipped' } });
    await app.interviews.next(request);

    expect(promptsOf(captured, 'interviewQuestion')).toHaveLength(1);
    expect(promptsOf(captured, 'interviewQuestion')[0]).toContain('[상대별 호칭·말투]\n- 하나 → 준: 반말');
  });

  it('classifies a written answer, lets the writer rename it to a new value, and rebuilds after a streak', async () => {
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };
    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: speech?.id ?? '', answer: { kind: 'skipped' } });

    const first: InterviewQuestion | undefined = await app.interviews.next(request);
    const written = await app.interviews.answer({
      ...request,
      questionId: first?.id ?? '',
      answer: { kind: 'written', text: '웃어 버린다' },
    });
    expect(written.classification).toEqual({ valueId: 'counter', valueLabel: '역공', isNewValue: false });
    expect(written.isRebuilt).toBe(false);

    await app.interviews.confirm({
      ...request,
      questionId: first?.id ?? '',
      confirmation: { kind: 'newValue', id: 'laugh-off', label: '웃음으로 넘기기' },
    });
    const afterConfirm: InterviewWorkingModel = readJson('.storyboard/cache/interviews/cards/hana.json');
    expect(afterConfirm.tallies).toEqual({ 'pressure-defense': { counter: 0, 'laugh-off': 2 } });
    expect(afterConfirm.records[1]?.answer).toEqual({
      kind: 'written',
      text: '웃어 버린다',
      valueId: 'laugh-off',
      isNewValue: true,
    });
    const axes = readJson<{ character: { axes: { id: string; values: { id: string }[] }[] } }>(
      '.storyboard/cache/interviews/axes.json',
    );
    expect(axes.character.axes[0]?.values.map((value) => value.id)).toContain('laugh-off');

    const second: InterviewQuestion | undefined = await app.interviews.next(request);
    const secondWritten = await app.interviews.answer({
      ...request,
      questionId: second?.id ?? '',
      answer: { kind: 'written', text: '고개를 돌린다' },
    });
    expect(secondWritten.isRebuilt).toBe(true);
    expect(readJson<InterviewWorkingModel>('.storyboard/cache/interviews/cards/hana.json').writtenStreak).toBe(0);
  });

  it('distills decided axes and the chosen speech into one interview source that card promote applies', async () => {
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: speech?.id ?? '', answer: { kind: 'written', text: "'등대 아이'라 부르고 반말" } });
    for (let i = 0; i < 3; i += 1) {
      const question: InterviewQuestion | undefined = await app.interviews.next(request);
      await app.interviews.answer({ ...request, questionId: question?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    }
    const skipped: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: skipped?.id ?? '', answer: { kind: 'skipped' } });

    const summary = await app.interviews.finish(request);
    expect(summary).toMatchObject({ cardId: 'hana', answered: 4, skipped: 1, candidateCount: 2 });
    expect(summary.undecidedAxisLabels).toEqual(['호감 표출']);

    const candidates: NoteCandidateFile = readJson('.storyboard/cache/interviews/candidates.json');
    expect(candidates.sources).toHaveLength(1);
    expect(candidates.sources[0]?.location).toBe('interview:hana');
    expect(candidates.sources[0]?.candidates[0]?.changes.map((change) => change.kind)).toEqual(['relationSpeech', 'trait']);
    expect(candidates.sources[0]?.candidates[0]?.changes[0]).toMatchObject({ target: 'jun', speech: "'등대 아이'라 부르고 반말" });

    const again = await startSession('hana');
    await again.container.interviews.finish({ workspaceRoot: again.container.workspaceRoot, cardId: 'hana', sessionId: again.sessionId });
    expect(readJson<NoteCandidateFile>('.storyboard/cache/interviews/candidates.json').sources).toHaveLength(1);

    const prepared: PrepareNoteCandidatePromotionResult = await app.notes.prepareCandidatePromotion(app.workspaceRoot);
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') {
      return;
    }
    expect(prepared.candidates[0]?.locations).toEqual(['interview:hana']);

    write('character/hana.card', [
      'type: character',
      'id: hana',
      'name: 하나',
      'relations:',
      '  - target: jun',
      '    type: 소꿉친구',
      '    speech: 반말',
      'role: main',
      'aliases:',
      '  - 등대 아이',
      'traits:',
      '  - 똑 부러진다',
    ]);
    await app.notes.promoteCandidates(app.workspaceRoot, prepared.candidates);
    const card: string = readFileSync(join(workspace, 'character/hana.card'), 'utf8');
    expect(card).toContain('[Mock AI] 몰릴 때 먼저 참고');
    expect(card).toContain("speech: '''등대 아이''라 부르고 반말");
    expect(card.split('\n').filter((line) => /^[a-z]/.test(line))).toEqual([
      'type: character',
      'id: hana',
      'name: 하나',
      'relations:',
      'role: main',
      'aliases:',
      'traits:',
    ]);
    expect(existsSync(join(workspace, '.storyboard/cache/interviews/candidates.json'))).toBe(false);
  });

  it('calls no distill and keeps the candidates when a session ends without an answer', async () => {
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };
    for (let i = 0; i < 4; i += 1) {
      const question: InterviewQuestion | undefined = await app.interviews.next(request);
      await app.interviews.answer({ ...request, questionId: question?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    }
    await app.interviews.finish(request);
    const before: NoteCandidateFile = readJson('.storyboard/cache/interviews/candidates.json');
    expect(before.sources).toHaveLength(1);

    const records: UsageRecord[] = [];
    const recording: CliContainer = createCliContainer({
      workspacePath: workspace,
      logger: silentLogger,
      canPrompt: false,
      version: '0.0.0',
      usageSink: { record: async (_root, usage) => void records.push(usage) },
    });
    for (let i = 0; i < 2; i += 1) {
      await waitForNextSessionId();
      const started: InterviewStartResult = await recording.interviews.start({ workspaceRoot: recording.workspaceRoot, cardId: 'hana' });
      if (!started.ok) {
        throw new Error(started.message);
      }
      const summary = await recording.interviews.finish({
        workspaceRoot: recording.workspaceRoot,
        cardId: 'hana',
        sessionId: started.opening.sessionId,
      });
      expect(summary).toMatchObject({ answered: 0, candidateCount: 0 });
    }

    expect(records.filter((record) => record.taskName === 'interviewDistill')).toHaveLength(0);
    expect(readJson<NoteCandidateFile>('.storyboard/cache/interviews/candidates.json')).toEqual(before);
  });

  it('asks the same beat again in the next session when the question was left unanswered', async () => {
    const first = await startSession('tavern');
    const cancelled: InterviewQuestion | undefined = await first.container.interviews.next({
      workspaceRoot: first.container.workspaceRoot,
      cardId: 'tavern',
      sessionId: first.sessionId,
    });
    expect(cancelled?.source.kind).toBe('beat');

    await waitForNextSessionId();
    const second = await startSession('tavern');
    const asked: InterviewQuestion | undefined = await second.container.interviews.next({
      workspaceRoot: second.container.workspaceRoot,
      cardId: 'tavern',
      sessionId: second.sessionId,
    });

    expect(asked?.sessionId).toBe(second.sessionId);
    expect(asked?.source).toEqual(cancelled?.source);
    const model: InterviewWorkingModel = readJson('.storyboard/cache/interviews/cards/tavern.json');
    expect(model.records.map((record) => record.id)).toEqual([asked?.id]);
  });

  it.each(['candidates', 'axes'])('interviews a card whose id is %s without touching the shared files', async (cardId) => {
    write(`character/${cardId}.card`, ['type: character', `id: ${cardId}`, 'name: 이름이 겹치는 이', 'role: supporting']);
    write('scene/03-noon.card', ['type: scene', 'id: 03-noon', 'characters:', `  - ${cardId}`, 'beats:', '  - text: 이름이 겹치는 이가 문을 두드린다', '    cast: [이름이 겹치는 이]']);
    const { container: app, sessionId } = await startSession(cardId);
    const request = { workspaceRoot: app.workspaceRoot, cardId, sessionId };

    const question: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: question?.id ?? '', answer: { kind: 'chosen', index: 0 } });
    const summary = await app.interviews.finish(request);

    expect(summary).toMatchObject({ cardId, answered: 1 });
    expect(existsSync(join(workspace, `.storyboard/cache/interviews/cards/${cardId}.json`))).toBe(true);
    expect(readJson<InterviewWorkingModel>(`.storyboard/cache/interviews/cards/${cardId}.json`).cardId).toBe(cardId);
    expect(readJson<{ version: number; character: unknown }>('.storyboard/cache/interviews/axes.json').character).toBeDefined();
    expect(existsSync(join(workspace, '.storyboard/cache/interviews/candidates.json'))).toBe(false);
  });

  it('interviews a background through the same verbs and proposes layout and rules', async () => {
    const { container: app, sessionId } = await startSession('tavern');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'tavern', sessionId };

    const first: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(first?.axisId).toBe('exits');
    expect(first?.source).toEqual({ kind: 'beat', sceneStem: '01-night', beatIndex: 0 });
    await app.interviews.answer({ ...request, questionId: first?.id ?? '', answer: { kind: 'chosen', index: 0 } });

    const second: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(second?.axisId).toBe('exits');
    expect(second?.source).toEqual({ kind: 'beat', sceneStem: '01-night', beatIndex: 1 });
    await app.interviews.answer({ ...request, questionId: second?.id ?? '', answer: { kind: 'chosen', index: 0 } });

    const third: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(third?.axisId).toBe('watchers');
    expect(third?.source).toEqual({ kind: 'beat', sceneStem: '01-night', beatIndex: 0 });
    await app.interviews.answer({ ...request, questionId: third?.id ?? '', answer: { kind: 'chosen', index: 0 } });

    const summary = await app.interviews.finish(request);
    expect(summary.candidateCount).toBe(2);
    const candidates: NoteCandidateFile = readJson('.storyboard/cache/interviews/candidates.json');
    expect(candidates.sources[0]?.candidates[0]?.changes.map((change) => change.kind)).toEqual([
      'layoutLine',
      'ruleLine',
    ]);
  });

  it('suggests interviews in the workspace status until the axes are decided', async () => {
    const app: CliContainer = container();

    const before = await app.describeWorkspace();
    expect(before.interviews.map((coverage) => coverage.cardId).sort()).toEqual(['hana', 'jun', 'tavern']);
    expect(before.interviews.every((coverage) => !coverage.hasWorkingModel)).toBe(true);

    const { container: started, sessionId } = await startSession('hana');
    const request = { workspaceRoot: started.workspaceRoot, cardId: 'hana', sessionId };
    const speech: InterviewQuestion | undefined = await started.interviews.next(request);
    await started.interviews.answer({ ...request, questionId: speech?.id ?? '', answer: { kind: 'skipped' } });
    const question: InterviewQuestion | undefined = await started.interviews.next(request);
    await started.interviews.answer({ ...request, questionId: question?.id ?? '', answer: { kind: 'chosen', index: 0 } });

    const after = await started.describeWorkspace();
    const hana = after.interviews.find((coverage) => coverage.cardId === 'hana');
    expect(hana?.hasWorkingModel).toBe(true);
    expect(hana?.openAxes.map((axis) => axis.axisId)).toEqual(['pressure-defense', 'affection']);
  });
});
