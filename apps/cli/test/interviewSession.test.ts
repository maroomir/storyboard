import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InterviewQuestion, InterviewWorkingModel, UsageRecord } from '@storyboard/story-model';
import {
  readInterviewAxes,
  readInterviewPending,
  readInterviewWorkingModel,
} from './fixtures/interviewSessions';
import type { InterviewStartResult } from '@storyboard/story-engine';
import { MockAiProvider } from '@storyboard/story-ai';

import type { ParsedArguments } from '@/cliArguments';
import { findCommand } from '@/commands/index';
import { createCliContainer, type CliContainer } from '@/container';
import { isLegacyCardPath, readCardFromBundles, writeCardBundleFromYaml } from './fixtures/cardBundles';
import { writeSceneBundleFromYaml } from './fixtures/sceneBundles';

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
  await write('scene/001-night.card', [
    'type: scene',
    'id: 001-night',
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
  await write('scene/002-dawn.card', [
    'type: scene',
    'id: 002-dawn',
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

function answerFromCard(valueIdByAxis: Readonly<Record<string, string>>): CapturedPrompt[] {
  const captured: CapturedPrompt[] = captureUserPrompts();
  const capture: MockAiProvider['generate'] = MockAiProvider.prototype.generate;
  vi.spyOn(MockAiProvider.prototype, 'generate').mockImplementation(async function (
    this: MockAiProvider,
    request: Parameters<MockAiProvider['generate']>[0],
  ) {
    const response = await capture.call(this, request);
    const answers = Object.entries(valueIdByAxis).map(([axisId, valueId]) => ({ axisId, valueId }));
    return request.taskName === 'interviewCardAnswers' ? { ...response, text: JSON.stringify({ answers }) } : response;
  });

  return captured;
}

function writeHanaWithSpeechToJun(): void {
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
    expect(started.opening.coverage.upcomingSceneStems).toEqual(['001-night', '002-dawn']);
    expect((await readInterviewAxes(workspace)).character).toBeDefined();
    expect(await readInterviewWorkingModel(workspace, 'hana')).toBeDefined();
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
    expect(first?.source).toEqual({ kind: 'beat', sceneStem: '001-night', beatIndex: 0 });
    expect(first?.options.map((option) => option.valueId)).toEqual(['counter', 'withhold', 'deflect']);
    expect(first?.options.every((option) => !option.isExploration)).toBe(true);

    expect(await app.interviews.next(request)).toEqual(first);

    await app.interviews.answer({ ...request, questionId: first?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    const second: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(second?.source).toEqual({ kind: 'beat', sceneStem: '001-night', beatIndex: 1 });
    expect(second?.axisId).toBe('pressure-defense');
    expect(second?.options.filter((option) => option.isExploration).map((option) => option.valueId)).toEqual([
      'counter',
    ]);

    await app.interviews.answer({ ...request, questionId: second?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    const third: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(third?.source).toEqual({ kind: 'beat', sceneStem: '002-dawn', beatIndex: 0 });
    expect(third?.axisId).toBe('affection');

    await app.interviews.answer({ ...request, questionId: third?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    const model: InterviewWorkingModel = (await readInterviewWorkingModel(workspace, 'hana'))!;
    expect(model.tallies).toEqual({ 'pressure-defense': { withhold: 2 }, affection: { indirect: 1 } });
    expect(model.summary).toContain('[Mock AI]');

    const fourth: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(fourth?.source).toEqual({ kind: 'beat', sceneStem: '001-night', beatIndex: 0 });
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

  it('asks no speech question to a partner the card already gives a speech, and hands that speech to the question prompt', async () => {
    writeHanaWithSpeechToJun();
    const captured: CapturedPrompt[] = captureUserPrompts();
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    const first: InterviewQuestion | undefined = await app.interviews.next(request);

    expect(first?.source.kind).toBe('beat');
    expect(promptsOf(captured, 'interviewRelationSpeech')).toHaveLength(0);
    expect(promptsOf(captured, 'interviewQuestion')[0]).toContain('[상대별 호칭·말투]\n- 하나 → 준: 반말');
  });

  it('asks the speech again to a partner the card already gives one when the writer asks for known speech', async () => {
    writeHanaWithSpeechToJun();
    const { container: app, sessionId } = await startSession('hana');

    const first: InterviewQuestion | undefined = await app.interviews.next({
      workspaceRoot: app.workspaceRoot,
      cardId: 'hana',
      sessionId,
      shouldAskKnown: true,
    });

    expect(first?.source).toEqual({ kind: 'relation', target: 'jun' });
  });

  it('hands the card speech to the question prompt when the speech question was skipped', async () => {
    const captured: CapturedPrompt[] = captureUserPrompts();
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: speech?.id ?? '', answer: { kind: 'skipped' } });
    writeHanaWithSpeechToJun();
    await app.interviews.next(request);

    expect(promptsOf(captured, 'interviewQuestion')).toHaveLength(1);
    expect(promptsOf(captured, 'interviewQuestion')[0]).toContain('[상대별 호칭·말투]\n- 하나 → 준: 반말');
  });

  it('closes the axes the card already answers, so questions and the workspace status go to the axes it leaves open', async () => {
    const captured: CapturedPrompt[] = answerFromCard({ affection: 'indirect' });
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    expect(promptsOf(captured, 'interviewCardAnswers')).toHaveLength(1);
    expect(promptsOf(captured, 'interviewCardAnswers')[0]).toContain('- 똑 부러진다');
    expect(promptsOf(captured, 'interviewCardAnswers')[0]).toContain('affection: 호감 표출\n- direct: 직접');

    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: speech?.id ?? '', answer: { kind: 'skipped' } });
    const asked: string[] = [];
    for (let question = await app.interviews.next(request); question !== undefined; question = await app.interviews.next(request)) {
      asked.push(question.axisId);
      await app.interviews.answer({ ...request, questionId: question.id, answer: { kind: 'chosen', index: 1 } });
    }
    expect(asked).toEqual(['pressure-defense', 'pressure-defense']);

    const status = await app.describeWorkspace();
    expect(status.interviews.map((coverage) => coverage.cardId)).not.toContain('hana');
    const summary = await app.interviews.finish(request);
    expect(summary.undecidedAxisLabels).toEqual([]);
    expect(promptsOf(captured, 'interviewDistill')[0]).not.toContain('호감 표출');

    await startSession('hana');
    expect(promptsOf(captured, 'interviewCardAnswers')).toHaveLength(1);
    write('character/hana.card', ['type: character', 'id: hana', 'name: 하나', 'role: main', 'traits:', '  - 똑 부러진다', '  - 몰리면 웃는다']);
    await startSession('hana');
    expect(promptsOf(captured, 'interviewCardAnswers')).toHaveLength(2);
  });

  it('hands the card lines the distill may not repeat, field by field', async () => {
    const captured: CapturedPrompt[] = captureUserPrompts();
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: speech?.id ?? '', answer: { kind: 'skipped' } });
    for (let i = 0; i < 2; i += 1) {
      const question: InterviewQuestion | undefined = await app.interviews.next(request);
      await app.interviews.answer({ ...request, questionId: question?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    }
    await app.interviews.finish(request);

    expect(promptsOf(captured, 'interviewDistill')[0]).toContain('[카드에 이미 있는 줄]\n- traits: 똑 부러진다');
  });

  it('tells the question prompt who is present at the beat, or the beat before it when no cast is written', async () => {
    await write('scene/002-dawn.card', [
      'type: scene',
      'id: 002-dawn',
      'characters:',
      '  - hana',
      'beats:',
      '  - 하나가 혼자 등대로 돌아온다',
      '  - 하나가 준의 방에서 편지를 찾는다',
    ]);
    const captured: CapturedPrompt[] = captureUserPrompts();
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    for (let round: number = 0; round < 6; round += 1) {
      const question: InterviewQuestion | undefined = await app.interviews.next(request);
      if (question === undefined) {
        break;
      }
      await app.interviews.answer({ ...request, questionId: question.id, answer: { kind: 'skipped' } });
    }

    const prompts: string[] = promptsOf(captured, 'interviewQuestion');
    const promptFor = (beat: string): string | undefined => prompts.find((prompt) => prompt.includes(`[상황]\n${beat}`));
    expect(promptFor('001-night: 준이 하나를 심문한다')).toContain('[이 자리에 있는 사람]\n- 하나\n- 준\n');
    expect(promptFor('001-night: 하나가 자리를 뜨려 한다')).toContain('[이 자리에 있는 사람]\n- 하나\n');
    expect(promptFor('002-dawn: 하나가 혼자 등대로 돌아온다')).toContain('(비트에 출연이 적혀 있지 않다)');
    expect(promptFor('002-dawn: 하나가 준의 방에서 편지를 찾는다')).toContain(
      '(비트에 출연이 적혀 있지 않다)\n\n[앞 비트]\n하나가 혼자 등대로 돌아온다',
    );
  });

  it('names the scene focus and marks a beat that does not name the character, keeping its action with its actor', async () => {
    await write('narrator/jun-eyes.card', [
      'type: narrator',
      'id: jun-eyes',
      'name: 준의 눈',
      'person: third',
      'knowledge: witnessed',
      'focal: jun',
    ]);
    await write('scene/002-dawn.card', [
      'type: scene',
      'id: 002-dawn',
      'narrator: jun-eyes',
      'characters:',
      '  - hana',
      '  - jun',
      'beats:',
      '  - 하나가 혼자 등대로 돌아온다',
      '  - 동생과 아침을 먹으며 초코 우유 대신 흰 우유를 마신다',
    ]);
    const captured: CapturedPrompt[] = captureUserPrompts();

    for (const cardId of ['hana', 'jun']) {
      const { container: app, sessionId } = await startSession(cardId);
      const request = { workspaceRoot: app.workspaceRoot, cardId, sessionId };
      for (let round: number = 0; round < 8; round += 1) {
        const question: InterviewQuestion | undefined = await app.interviews.next(request);
        if (question === undefined) {
          break;
        }
        await app.interviews.answer({ ...request, questionId: question.id, answer: { kind: 'skipped' } });
      }
    }

    const prompts: string[] = promptsOf(captured, 'interviewQuestion');
    const promptFor = (name: string, beat: string): string | undefined =>
      prompts.find((prompt) => prompt.startsWith(`[인물]\n${name}\n`) && prompt.includes(`[상황]\n${beat}`));
    const unnamedBeat: string = '002-dawn: 동생과 아침을 먹으며 초코 우유 대신 흰 우유를 마신다';
    expect(promptFor('하나', unnamedBeat)).toContain(`[상황]\n${unnamedBeat}\n(이 비트에는 하나의 이름이 없다)`);
    expect(promptFor('하나', unnamedBeat)).toContain('[초점 인물]\n준');
    expect(promptFor('하나', '002-dawn: 하나가 혼자 등대로 돌아온다')).toContain('[초점 인물]\n준');
    expect(promptFor('하나', '002-dawn: 하나가 혼자 등대로 돌아온다')).not.toContain('이름이 없다');
    expect(promptFor('준', unnamedBeat)).toContain('[초점 인물]\n준');
    expect(promptFor('준', unnamedBeat)).not.toContain('이름이 없다');
    expect(promptFor('하나', '001-night: 준이 하나를 심문한다')).not.toContain('[초점 인물]');
  });

  it('asks without a focal character when the scene names a narrator card that does not exist', async () => {
    await write('scene/002-dawn.card', [
      'type: scene',
      'id: 002-dawn',
      'narrator: ghost',
      'characters:',
      '  - hana',
      'beats:',
      '  - 하나가 혼자 등대로 돌아온다',
    ]);
    const captured: CapturedPrompt[] = captureUserPrompts();
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };

    for (let round: number = 0; round < 8; round += 1) {
      const question: InterviewQuestion | undefined = await app.interviews.next(request);
      if (question === undefined) {
        break;
      }
      await app.interviews.answer({ ...request, questionId: question.id, answer: { kind: 'skipped' } });
    }

    const brokenBeatPrompt: string | undefined = promptsOf(captured, 'interviewQuestion').find((prompt) =>
      prompt.includes('[상황]\n002-dawn: 하나가 혼자 등대로 돌아온다'),
    );
    expect(brokenBeatPrompt).toBeDefined();
    expect(brokenBeatPrompt).not.toContain('[초점 인물]');
  });

  it('asks again when an option addresses a partner who is not at the beat', async () => {
    const captured: CapturedPrompt[] = captureUserPrompts();
    const generate: MockAiProvider['generate'] = MockAiProvider.prototype.generate;
    let isFirstAbsentBeatQuestion: boolean = true;
    vi.spyOn(MockAiProvider.prototype, 'generate').mockImplementation(async function (
      this: MockAiProvider,
      request: Parameters<MockAiProvider['generate']>[0],
    ) {
      const response = await generate.call(this, request);
      const prompt: string = request.messages.map((message) => message.content).join('\n');
      const isAbsentBeat: boolean =
        request.taskName === 'interviewQuestion' && prompt.includes('[상황]\n001-night: 하나가 자리를 뜨려 한다');
      if (!isAbsentBeat || !isFirstAbsentBeatQuestion) {
        return response;
      }
      isFirstAbsentBeatQuestion = false;
      const draft = JSON.parse(response.text) as { options: { valueId: string; text: string }[] };
      draft.options = draft.options.map((option, index) =>
        index === 0 ? { ...option, text: '“등대지기, 어디 가?” 하고 돌아본다' } : option,
      );
      return { ...response, text: JSON.stringify(draft) };
    });
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };
    const speech: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({
      ...request,
      questionId: speech?.id ?? '',
      answer: { kind: 'written', text: "'등대지기'라 부르며 반말" },
    });

    let absentBeatQuestion: InterviewQuestion | undefined;
    for (let round: number = 0; round < 4 && absentBeatQuestion === undefined; round += 1) {
      const question: InterviewQuestion | undefined = await app.interviews.next(request);
      if (question === undefined) {
        break;
      }
      absentBeatQuestion = question.situation.includes('자리를 뜨려') ? question : undefined;
      await app.interviews.answer({ ...request, questionId: question.id, answer: { kind: 'skipped' } });
    }

    const absentBeatPrompts: string[] = promptsOf(captured, 'interviewQuestion').filter((prompt) =>
      prompt.includes('[상황]\n001-night: 하나가 자리를 뜨려 한다'),
    );
    expect(absentBeatPrompts).toHaveLength(2);
    expect(absentBeatQuestion?.options.map((option) => option.text).join(' ')).not.toContain('등대지기');
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
    const afterConfirm: InterviewWorkingModel = (await readInterviewWorkingModel(workspace, 'hana'))!;
    expect(afterConfirm.tallies).toEqual({ 'pressure-defense': { counter: 0, 'laugh-off': 2 } });
    expect(afterConfirm.records[1]?.answer).toEqual({
      kind: 'written',
      text: '웃어 버린다',
      valueId: 'laugh-off',
      isNewValue: true,
    });
    const axes = await readInterviewAxes(workspace);
    expect(axes.character?.axes[0]?.values.map((value) => value.id)).toContain('laugh-off');

    const second: InterviewQuestion | undefined = await app.interviews.next(request);
    const secondWritten = await app.interviews.answer({
      ...request,
      questionId: second?.id ?? '',
      answer: { kind: 'written', text: '고개를 돌린다' },
    });
    expect(secondWritten.isRebuilt).toBe(true);
    expect((await readInterviewWorkingModel(workspace, 'hana'))!.writtenStreak).toBe(0);
  });

  it('distills decided axes and the chosen speech into pending lines that card apply writes', async () => {
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

    const pending = await readInterviewPending(workspace, 'hana');
    expect(pending.map((line) => line.facet).sort()).toEqual(['speech', 'traits']);
    expect(pending.find((line) => line.facet === 'speech')).toMatchObject({
      value: "'등대 아이'라 부르고 반말",
      source: { origin: 'interview', session: sessionId },
    });

    const again = await startSession('hana');
    await again.container.interviews.finish({ workspaceRoot: again.container.workspaceRoot, cardId: 'hana', sessionId: again.sessionId });
    expect(await readInterviewPending(workspace, 'hana')).toEqual(pending);

    expect(await app.cards.applyPending(app.workspaceRoot, 'hana')).toMatchObject({ ok: true });
    const card = await readCardFromBundles(workspace, 'hana');
    expect(card?.type === 'character' ? card.traits?.join('\n') : undefined).toContain('[Mock AI] 몰릴 때 먼저 참고');
    expect(card?.type === 'character' ? card.relations?.[0]?.speech : undefined).toBe("'등대 아이'라 부르고 반말");
    expect(await readInterviewPending(workspace, 'hana')).toEqual([]);
  });

  it('calls no distill and keeps the candidates when a session ends without an answer', async () => {
    const { container: app, sessionId } = await startSession('hana');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'hana', sessionId };
    for (let i = 0; i < 4; i += 1) {
      const question: InterviewQuestion | undefined = await app.interviews.next(request);
      await app.interviews.answer({ ...request, questionId: question?.id ?? '', answer: { kind: 'chosen', index: 1 } });
    }
    await app.interviews.finish(request);
    const before = await readInterviewPending(workspace, 'hana');
    expect(before.length).toBeGreaterThan(0);

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
    expect(await readInterviewPending(workspace, 'hana')).toEqual(before);
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
    const model: InterviewWorkingModel = (await readInterviewWorkingModel(workspace, 'tavern'))!;
    expect(model.records.map((record) => record.id)).toEqual([asked?.id]);
  });

  it.each(['candidates', 'axes'])('interviews a card whose id is %s without touching the shared files', async (cardId) => {
    write(`character/${cardId}.card`, ['type: character', `id: ${cardId}`, 'name: 이름이 겹치는 이', 'role: supporting']);
    await write('scene/003-noon.card', ['type: scene', 'id: 003-noon', 'characters:', `  - ${cardId}`, 'beats:', '  - text: 이름이 겹치는 이가 문을 두드린다', '    cast: [이름이 겹치는 이]']);
    const { container: app, sessionId } = await startSession(cardId);
    const request = { workspaceRoot: app.workspaceRoot, cardId, sessionId };

    const question: InterviewQuestion | undefined = await app.interviews.next(request);
    await app.interviews.answer({ ...request, questionId: question?.id ?? '', answer: { kind: 'chosen', index: 0 } });
    const summary = await app.interviews.finish(request);

    expect(summary).toMatchObject({ cardId, answered: 1 });
    expect((await readInterviewWorkingModel(workspace, cardId))?.cardId).toBe(cardId);
    expect((await readInterviewAxes(workspace)).character).toBeDefined();
  });

  it('interviews a background through the same verbs and proposes layout and rules', async () => {
    const { container: app, sessionId } = await startSession('tavern');
    const request = { workspaceRoot: app.workspaceRoot, cardId: 'tavern', sessionId };

    const first: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(first?.axisId).toBe('exits');
    expect(first?.source).toEqual({ kind: 'beat', sceneStem: '001-night', beatIndex: 0 });
    await app.interviews.answer({ ...request, questionId: first?.id ?? '', answer: { kind: 'chosen', index: 0 } });

    const second: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(second?.axisId).toBe('exits');
    expect(second?.source).toEqual({ kind: 'beat', sceneStem: '001-night', beatIndex: 1 });
    await app.interviews.answer({ ...request, questionId: second?.id ?? '', answer: { kind: 'chosen', index: 0 } });

    const third: InterviewQuestion | undefined = await app.interviews.next(request);
    expect(third?.axisId).toBe('watchers');
    expect(third?.source).toEqual({ kind: 'beat', sceneStem: '001-night', beatIndex: 0 });
    await app.interviews.answer({ ...request, questionId: third?.id ?? '', answer: { kind: 'chosen', index: 0 } });

    const summary = await app.interviews.finish(request);
    expect(summary.candidateCount).toBe(2);
    expect((await readInterviewPending(workspace, 'tavern')).map((line) => line.facet)).toEqual([
      'layout',
      'rules',
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
