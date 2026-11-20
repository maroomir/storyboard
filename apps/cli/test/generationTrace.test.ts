import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AiCallObservation } from '@storyboard/story-ai';
import {
  GenerationTraceRecorder,
  type IStoryboardLogger,
  type TraceRunSession,
} from '@storyboard/story-engine';
import {
  NodeUri,
  STORYBOARD_RELATIVE_PATHS,
  traceCallRecordSchema,
  traceEventRecordSchema,
  tracePipelinePlanSchema,
  traceRunHeaderSchema,
  traceStageRecordSchema,
  type StoryUri,
  type TraceCallRecord,
  type TraceEventRecord,
  type TraceRunHeader,
  type TraceStageRecord,
} from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { TemporaryWorkspaces } from './fixtures/cacheWorkspace';

const workspaces: TemporaryWorkspaces = new TemporaryWorkspaces();
const silentLogger: IStoryboardLogger = {
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  show: (): void => {},
};

interface RecorderSettings {
  readonly isEnabled: boolean;
  readonly keepRunCount?: number;
}

function createRecorder(settings: RecorderSettings): GenerationTraceRecorder {
  return new GenerationTraceRecorder({
    fileSystem: new NodeFileSystem(),
    logger: silentLogger,
    isEnabled: () => settings.isEnabled,
    keepRunCount: () => settings.keepRunCount ?? 3,
  });
}

function observeCall(prompt: string, responseText: string): AiCallObservation {
  return {
    taskName: 'sceneSectionExpansion',
    messages: [
      { role: 'system', content: '공통 지시문' },
      { role: 'user', content: prompt },
    ],
    maxTokens: 8000,
    startedAt: new Date('2026-11-20T00:00:00.000Z'),
    durationMs: 1200,
    response: {
      text: responseText,
      providerId: 'mock',
      model: 'mock-model',
      usage: { inputTokens: 10, outputTokens: 20 },
      isTruncated: true,
      stopReason: 'max_tokens',
    },
    traceTag: { stage: 'expandSection', sectionIndex: 3, attempt: 2, retryReason: '분량 미달' },
  };
}

function traceRootOf(workspace: string): string {
  return join(workspace, ...STORYBOARD_RELATIVE_PATHS.traceDirectory.split('/'));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

afterEach(() => workspaces.cleanUp());

describe('GenerationTraceRecorder', () => {
  it('writes nothing while tracing is off', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: false });

    const session: TraceRunSession = await recorder.startRun(root, { kind: 'draft-generate' });
    await recorder.recordCall(root, observeCall('구간 1', '본문'));
    await session.finish('completed');

    expect(session.runId).toBeUndefined();
    expect(existsSync(traceRootOf(workspace))).toBe(false);
  });

  it('records each call with its prompt and response and closes the run', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });

    const session: TraceRunSession = await recorder.startRun(root, {
      kind: 'draft-generate',
      subject: { sceneStem: '001-opening' },
    });
    await recorder.recordCall(root, observeCall('구간 1', '첫 본문'));
    await recorder.recordCall(root, observeCall('구간 2', '둘째 본문'));
    await session.finish('failed', '출력 한도');

    const runDirectory: string = join(traceRootOf(workspace), session.runId ?? '');
    const header: TraceRunHeader = traceRunHeaderSchema.parse(readJson(join(runDirectory, 'run.json')));
    const second: TraceCallRecord = traceCallRecordSchema.parse(
      readJson(join(runDirectory, 'calls', '00002.json')),
    );
    const userPromptHash: string = second.messages[1]?.hash ?? '';

    expect(header).toMatchObject({
      kind: 'draft-generate',
      status: 'failed',
      failureMessage: '출력 한도',
      subject: { sceneStem: '001-opening' },
    });
    expect(readdirSync(join(runDirectory, 'calls'))).toEqual(['00001.json', '00002.json']);
    expect(second).toMatchObject({
      sequence: 2,
      taskName: 'sceneSectionExpansion',
      providerId: 'mock',
      parameters: { maxTokens: 8000 },
      response: { isTruncated: true, stopReason: 'max_tokens', charCount: '둘째 본문'.length },
      tag: { sectionIndex: 3, attempt: 2, retryReason: '분량 미달' },
    });
    expect(readFileSync(join(runDirectory, 'blobs', `${userPromptHash}.txt`), 'utf8')).toBe('구간 2');
    expect(readFileSync(join(runDirectory, 'blobs', `${second.response?.hash}.txt`), 'utf8')).toBe('둘째 본문');
    expect(readdirSync(join(runDirectory, 'blobs'))).toHaveLength(5);
  });

  it('records the plan and each stage with the calls made inside it', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });
    const { traceTag: _traceTag, ...untagged } = observeCall('뼈대', '뼈대 본문');

    const session: TraceRunSession = await recorder.startRun(root, { kind: 'draft-generate' });
    await recorder.recordPlan(root, {
      pipeline: 'scene',
      stageIds: ['draftSkeleton', 'expandSection'],
      catalog: [{ id: 'draftSkeleton', label: '뼈대', required: true }],
    });
    recorder.enterStage(root, 'draftSkeleton');
    await recorder.recordCall(root, untagged);
    await recorder.leaveStage(root);
    recorder.enterStage(root, 'expandSection');
    await recorder.recordCall(root, observeCall('구간 1', '첫 본문'));
    await recorder.recordCall(root, observeCall('구간 2', '둘째 본문'));
    await recorder.leaveStage(root, new Error('출력 한도'));

    const runDirectory: string = join(traceRootOf(workspace), session.runId ?? '');
    const readStage = (name: string): TraceStageRecord =>
      traceStageRecordSchema.parse(readJson(join(runDirectory, 'stages', name)));
    const readCall = (name: string): TraceCallRecord =>
      traceCallRecordSchema.parse(readJson(join(runDirectory, 'calls', name)));

    expect(tracePipelinePlanSchema.parse(readJson(join(runDirectory, 'plan.json'))).stageIds).toEqual([
      'draftSkeleton',
      'expandSection',
    ]);
    expect(readStage('00001.json')).toMatchObject({
      stageId: 'draftSkeleton',
      status: 'completed',
      firstCallSequence: 1,
      callCount: 1,
    });
    expect(readStage('00002.json')).toMatchObject({
      stageId: 'expandSection',
      status: 'failed',
      firstCallSequence: 2,
      callCount: 2,
      errorMessage: '출력 한도',
    });
    expect(readCall('00001.json').tag).toEqual({ stage: 'draftSkeleton' });
    expect(readCall('00003.json').tag).toMatchObject({ stage: 'expandSection', sectionIndex: 3 });
  });

  it('keeps every call when many share one prompt at the same moment', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });
    const simultaneousCallCount: number = 24;

    const session: TraceRunSession = await recorder.startRun(root, { kind: 'draft-generate' });
    await Promise.all(
      Array.from({ length: simultaneousCallCount }, (_unused, index) =>
        recorder.recordCall(root, observeCall(`구간 ${index}`, '같은 응답')),
      ),
    );

    const runDirectory: string = join(traceRootOf(workspace), session.runId ?? '');
    expect(readdirSync(join(runDirectory, 'calls'))).toHaveLength(simultaneousCallCount);
  });

  it('removes a run that made no model call', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });

    const session: TraceRunSession = await recorder.startRun(root, { kind: 'draft-generate' });
    await recorder.runStage(root, 'resolveSceneBeats', async () => undefined);
    await session.finish('completed');

    expect(readdirSync(traceRootOf(workspace))).toEqual([]);
  });

  it('continues the generation run of the same scene and marks a failed step', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });
    const subject: { readonly sceneStem: string } = { sceneStem: '001-opening' };

    const generation: TraceRunSession = await recorder.startRun(root, { kind: 'draft-generate', subject });
    await recorder.recordCall(root, observeCall('구간 1', '본문'));
    await generation.finish('completed');
    const revision: TraceRunSession = await recorder.startRun(root, {
      kind: 'draft-revise',
      subject,
      continuesRunOfKind: 'draft-generate',
    });
    const outcome: { readonly failure: string } = await recorder.runStage(
      root,
      'reviseLoop',
      async () => {
        await recorder.recordCall(root, observeCall('검수', '끊긴 본문'));
        return { failure: '출력 한도' };
      },
      (result) => result.failure,
    );
    await revision.finish('failed', outcome.failure);

    const runDirectory: string = join(traceRootOf(workspace), generation.runId ?? '');
    expect(revision.runId).toBe(generation.runId);
    expect(readdirSync(traceRootOf(workspace))).toHaveLength(1);
    expect(readdirSync(join(runDirectory, 'calls'))).toEqual(['00001.json', '00002.json']);
    expect(traceRunHeaderSchema.parse(readJson(join(runDirectory, 'run.json')))).toMatchObject({
      kind: 'draft-generate',
      status: 'failed',
      failureMessage: '출력 한도',
    });
    expect(
      traceStageRecordSchema.parse(readJson(join(runDirectory, 'stages', '00001.json'))),
    ).toMatchObject({ stageId: 'reviseLoop', status: 'failed', callCount: 1, firstCallSequence: 2 });
  });

  it('starts a revision run of its own when no generation run precedes it', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });

    const revision: TraceRunSession = await recorder.startRun(root, {
      kind: 'draft-revise',
      subject: { sceneStem: '001-opening' },
      continuesRunOfKind: 'draft-generate',
    });
    await recorder.recordCall(root, observeCall('검수', '본문'));
    await revision.finish('completed');

    const runDirectory: string = join(traceRootOf(workspace), revision.runId ?? '');
    expect(traceRunHeaderSchema.parse(readJson(join(runDirectory, 'run.json'))).kind).toBe('draft-revise');
  });

  it('records what happened to the text between calls, under the stage that did it', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });

    const session: TraceRunSession = await recorder.startRun(root, { kind: 'draft-generate' });
    recorder.enterStage(root, 'expandSection');
    await recorder.recordCall(root, observeCall('구간 2', '본문과 앞당겨 쓴 대사'));
    await recorder.recordEvent(root, {
      kind: 'text-trimmed',
      sectionIndex: 2,
      rule: 'runs-ahead',
      beforeText: '본문과 앞당겨 쓴 대사',
      afterText: '본문',
    });
    await recorder.recordEvent(root, {
      kind: 'section-measured',
      sectionIndex: 2,
      lengths: { target: 6667, skeleton: 2310, expanded: 7396, final: 5590 },
    });
    await recorder.leaveStage(root);

    const runDirectory: string = join(traceRootOf(workspace), session.runId ?? '');
    const readEvent = (name: string): TraceEventRecord =>
      traceEventRecordSchema.parse(readJson(join(runDirectory, 'events', name)));
    const trimmed: TraceEventRecord = readEvent('00001.json');

    expect(trimmed).toMatchObject({ kind: 'text-trimmed', stage: 'expandSection', sectionIndex: 2, rule: 'runs-ahead' });
    expect(readFileSync(join(runDirectory, 'blobs', `${trimmed.before?.hash}.txt`), 'utf8')).toBe('본문과 앞당겨 쓴 대사');
    expect(readFileSync(join(runDirectory, 'blobs', `${trimmed.after?.hash}.txt`), 'utf8')).toBe('본문');
    expect(readEvent('00002.json').lengths).toEqual({ target: 6667, skeleton: 2310, expanded: 7396, final: 5590 });
  });

  it('keeps a failed call with its error and no response', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });
    const { response: _response, ...unanswered } = observeCall('구간 1', '');

    const session: TraceRunSession = await recorder.startRun(root, { kind: 'draft-generate' });
    await recorder.recordCall(root, { ...unanswered, error: new Error('연결이 끊겼습니다') });

    const call: TraceCallRecord = traceCallRecordSchema.parse(
      readJson(join(traceRootOf(workspace), session.runId ?? '', 'calls', '00001.json')),
    );
    expect(call.errorMessage).toBe('연결이 끊겼습니다');
    expect(call.response).toBeUndefined();
  });

  it('collects calls made outside a run into an ambient run', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true });

    await Promise.all([
      recorder.recordCall(root, observeCall('질문 1', '답 1')),
      recorder.recordCall(root, observeCall('질문 2', '답 2')),
    ]);

    const runIds: string[] = readdirSync(traceRootOf(workspace));
    expect(runIds).toHaveLength(1);
    const runDirectory: string = join(traceRootOf(workspace), runIds[0] ?? '');
    expect(traceRunHeaderSchema.parse(readJson(join(runDirectory, 'run.json'))).kind).toBe('ambient');
    expect(readdirSync(join(runDirectory, 'calls'))).toHaveLength(2);
  });

  it('keeps only the newest runs of one scene', async () => {
    const workspace: string = workspaces.create('storyboard-trace-');
    const root: StoryUri = NodeUri.file(workspace);
    const recorder: GenerationTraceRecorder = createRecorder({ isEnabled: true, keepRunCount: 2 });
    const startedRunIds: string[] = [];

    for (const sceneStem of ['001-opening', '001-opening', '002-other', '001-opening']) {
      const session: TraceRunSession = await recorder.startRun(root, {
        kind: 'draft-generate',
        subject: { sceneStem },
      });
      await recorder.recordCall(root, observeCall('구간 1', '본문'));
      await session.finish('completed');
      startedRunIds.push(session.runId ?? '');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const [firstOpening, secondOpening, otherScene, thirdOpening] = startedRunIds;
    expect(readdirSync(traceRootOf(workspace)).sort()).toEqual(
      [secondOpening, otherScene, thirdOpening].sort(),
    );
    expect(existsSync(join(traceRootOf(workspace), firstOpening ?? ''))).toBe(false);
  });
});
