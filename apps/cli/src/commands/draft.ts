import { flagBoolean, flagString, type ParsedArguments } from '@/cliArguments';
import type { CommandHandler, CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import { WorkspaceInput, cancelledBeforeRun } from '@/commands/workspaceInput';
import { sceneStemFrom, sceneUriFor } from '@/commands/sceneArguments';
import type { CliContainer } from '@/container';
import type { DraftAugmentScope } from '@storyboard/story-ai';
import type { DraftReading } from '@storyboard/story-app';
import {
  describeReviseOutcome,
  draftCheckKinds,
  sceneStageCatalog,
  type ApplyDraftFormatResult,
  type AugmentDraftResult,
  type CheckDraftResult,
  type CondenseDraftResult,
  type DraftCheckKind,
  type ExpandDraftResult,
  type GenerateAllDraftsProgress,
  type GenerateAllDraftsResult,
  type GenerateDraftResult,
  type ReviseDraftWorkflowResult,
  type ReviseOutcome,
  type SaveDraftEditResult,
} from '@storyboard/story-engine';
import {
  draftPath,
  scenePath,
  type StoryboardProject,
  type StoryUri,
} from '@storyboard/story-model';

const sceneStageLabels: Record<string, string> = Object.fromEntries(
  sceneStageCatalog.map((definition) => [definition.id, definition.label]),
);

function describeBatchStep(progress: GenerateAllDraftsProgress): string {
  switch (progress.kind) {
    case 'prepared':
      return '준비';
    case 'pipeline':
      return progress.stage === undefined
        ? '생성'
        : `${sceneStageLabels[progress.stage] ?? progress.stage} ${progress.stageCurrent ?? 0}/${progress.stageTotal ?? 0}`;
    case 'saving':
      return '저장';
    case 'revising':
      return '검수·수정';
  }
}

export const generateScene: CommandHandler = async ({ container, args }) => {
  if (flagBoolean(args.flags, 'all')) {
    const isConfirmed: boolean = await new WorkspaceInput(container).confirmPaidRun((status) => {
      const pending: number = status.drafts.missing + status.drafts.stale;
      return {
        title: `초안 ${pending}개 생성`,
        details: [
          `대상  초안이 없거나 카드보다 오래된 씬 ${pending}개 (전체 ${status.scenes.total}개)`,
        ],
      };
    });

    if (!isConfirmed) {
      return cancelledBeforeRun;
    }

    const batchGeneration: GenerateAllDraftsResult = await container.drafts.generateAll({
      shouldPause: container.pauseRequests.watch(),
      onProgress: (progress) => {
        const step: string = describeBatchStep(progress);
        container.progress.update({
          line: `${progress.current}/${progress.total} ${progress.label} · ${step}`,
          unit: { current: progress.current, total: progress.total, label: progress.label },
          step,
        });
      },
    });

    if (!batchGeneration.ok) {
      return failure(describeBatchFailure(batchGeneration.kind), batchGeneration);
    }

    const { cacheHits, failureLabels, failures, generated, pausedWithRemaining } =
      batchGeneration.summary;

    if (pausedWithRemaining !== undefined) {
      return {
        ok: false,
        message:
          `멈췄습니다: 생성 ${generated}건, 남은 씬 ${pausedWithRemaining}개. ` +
          '다시 실행하면 남은 씬부터 이어 갑니다.',
        data: batchGeneration.summary,
        stop: 'paused',
      };
    }

    return {
      ok: failures === 0,
      message:
        failures === 0
          ? `초안 ${generated}건 생성, ${cacheHits}건은 입력이 같아 그대로 둡니다.`
          : `${failures}건 실패 (생성 ${generated}건, 캐시 ${cacheHits}건): ${failureLabels.join(', ')}`,
      data: batchGeneration.summary,
    };
  }

  const stem: string | undefined = sceneStemFrom(args);
  if (stem === undefined) {
    return failure('씬 stem을 지정해 주세요. 예: storyboard draft generate 01-scene-1-1');
  }

  const draftGeneration: GenerateDraftResult = await container.drafts.generate({
    sceneUri: sceneUriFor(container.workspaceRoot, stem),
    force: flagBoolean(args.flags, 'force'),
    onPipelineProgress: (stage, current, total) => {
      const step: string = `${sceneStageLabels[stage] ?? stage} ${current}/${total}`;
      container.progress.update({ line: step, step });
    },
  });

  if (!draftGeneration.ok) {
    return failure(draftGeneration.kind === 'failed' ? draftGeneration.message : '취소했습니다.');
  }

  const warnings: readonly string[] =
    draftGeneration.kind === 'generated' ? draftGeneration.warnings : [];
  for (const warning of warnings) {
    container.logger.warn(warning);
  }

  const reviseRequested: boolean =
    !flagBoolean(args.flags, 'no-revise') && container.configBridge.isReviseAfterGenerateEnabled();

  let revise: ReviseOutcome | undefined;
  if (draftGeneration.kind === 'generated' && reviseRequested) {
    const revised: ReviseDraftWorkflowResult | undefined = await container.drafts.reviseScene(
      container.workspaceRoot,
      stem,
      {
        onProgress: (message) => container.progress.update({ line: message, step: message }),
      },
    );
    revise = revised && describeReviseOutcome(revised);

    if (revise?.warning) {
      container.logger.warn(revise.warning);
    }
  }

  return success(
    draftGeneration.kind === 'cache_hit'
      ? '입력이 같아 기존 초안을 씁니다.'
      : '초안을 생성했습니다.',
    {
      draft: (draftGeneration.draftUri as StoryUri).fsPath,
      warnings: revise?.warning ? [...warnings, revise.warning] : warnings,
      ...(revise === undefined ? {} : { revise }),
    },
  );
};

export const reviseScene: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  if (stem === undefined) {
    return failure('씬 stem을 지정해 주세요.');
  }

  const revision: ReviseDraftWorkflowResult | undefined = await container.drafts.reviseScene(
    container.workspaceRoot,
    stem,
  );
  if (revision === undefined) {
    return failure('초안이 없어 검수를 건너뛰었습니다.');
  }

  return revision.failure
    ? failure(describeReviseOutcome(revision).warning ?? revision.failure.message, revision)
    : success('검수와 재작성을 마쳤습니다.', revision);
};

function describeBatchFailure(kind: 'no_projects' | 'no_scenes'): string {
  return kind === 'no_projects'
    ? 'Storyboard 프로젝트를 찾을 수 없습니다.'
    : '생성할 씬이 없습니다. scene/*.card 를 먼저 만들어 주세요.';
}

interface LineRange {
  readonly from: number;
  readonly to: number;
}

function parseLineRange(raw: string | undefined): LineRange | undefined | 'invalid' {
  if (raw === undefined) {
    return undefined;
  }

  const match: RegExpExecArray | null = /^(\d+)-(\d+)$/.exec(raw.trim());

  if (!match) {
    return 'invalid';
  }

  const from: number = Number(match[1]);
  const to: number = Number(match[2]);
  return from >= 1 && to >= from ? { from, to } : 'invalid';
}

function sliceLines(body: string, range: LineRange | undefined): string {
  if (range === undefined) {
    return body;
  }

  return body
    .split('\n')
    .slice(range.from - 1, range.to)
    .join('\n');
}

function replaceLines(body: string, range: LineRange | undefined, replacement: string): string {
  if (range === undefined) {
    return replacement;
  }

  const lines: string[] = body.split('\n');
  return [
    ...lines.slice(0, range.from - 1),
    ...replacement.split('\n'),
    ...lines.slice(range.to),
  ].join('\n');
}

interface TransformedDraft {
  ok: boolean;
  text?: string;
  message: string;
}

type LoadedDraftTarget =
  | { ok: true; body: string; target: string }
  | { ok: false; message: string };

async function loadDraftTarget(
  container: CliContainer,
  stem: string,
  range: LineRange | undefined,
): Promise<LoadedDraftTarget> {
  const body: string | undefined = await readDraftBody(container, stem);

  if (body === undefined) {
    return failure(`초안이 없습니다: ${stem}`);
  }

  const target: string = sliceLines(body, range);

  if (target.trim().length === 0) {
    return failure('대상 구간이 비어 있습니다.');
  }

  return { ok: true, body, target };
}

async function rewriteDraft(
  container: CliContainer,
  stem: string,
  range: LineRange | undefined,
  transform: (target: string) => Promise<TransformedDraft>,
): Promise<CommandOutcome> {
  const loaded: LoadedDraftTarget = await loadDraftTarget(container, stem, range);

  if (!loaded.ok) {
    return loaded;
  }

  const { body, target } = loaded;
  const transformed: TransformedDraft = await transform(target);

  if (!transformed.ok || transformed.text === undefined) {
    return failure(transformed.message);
  }

  const saved: SaveDraftEditResult = await container.drafts.saveEdit({
    workspaceRoot: container.workspaceRoot,
    sceneStem: stem,
    body: replaceLines(body, range, transformed.text),
    archivePrevious: container.configBridge.isKeepDraftHistoryEnabled(),
  });

  if (!saved.ok) {
    return failure(`초안이 없습니다: ${stem}`);
  }

  const draftUri: StoryUri = draftPath(container.workspaceRoot, stem);

  return success(transformed.message, { draft: draftUri.fsPath });
}

function rangeFrom(args: ParsedArguments): LineRange | undefined | 'invalid' {
  return parseLineRange(flagString(args.flags, 'lines'));
}

export const condenseDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  const range: LineRange | 'invalid' | undefined = rangeFrom(args);

  if (stem === undefined) {
    return failure('씬 stem 을 지정해 주세요.');
  }

  if (range === 'invalid') {
    return failure('--lines 는 40-60 형식이어야 합니다.');
  }

  const project: StoryboardProject = await container.novel.readProject(container.workspaceRoot);

  return rewriteDraft(container, stem, range, async (target) => {
    const condensed: CondenseDraftResult = await container.drafts.condense({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
      format: project.format,
      body: target,
      maxCompressionPercent: container.configBridge.getMaxCompressionPercent(),
    });

    return condensed.ok
      ? { ok: true, text: condensed.text, message: '초안을 압축했습니다.' }
      : failure(`압축하지 못했습니다 (${condensed.kind}).`);
  });
};

export const expandDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  const range: LineRange | 'invalid' | undefined = rangeFrom(args);

  if (stem === undefined) {
    return failure('씬 stem 을 지정해 주세요.');
  }

  if (range === 'invalid') {
    return failure('--lines 는 40-60 형식이어야 합니다.');
  }

  return rewriteDraft(container, stem, range, async (target) => {
    const expanded: ExpandDraftResult = await container.drafts.expand({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
      selectedText: target,
    });

    return expanded.ok
      ? { ok: true, text: expanded.text, message: '구간을 늘렸습니다.' }
      : failure(`늘리지 못했습니다 (${expanded.kind}).`);
  });
};

export const applyDraftFormat: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);

  if (stem === undefined) {
    return failure('씬 stem 을 지정해 주세요.');
  }

  const formatting: ApplyDraftFormatResult = await container.drafts.applyFormat({
    workspaceRoot: container.workspaceRoot,
    sceneStem: stem,
  });

  return {
    ok: formatting.ok,
    message: formatting.ok
      ? '초안 형식을 다시 적용했습니다.'
      : `형식을 적용하지 못했습니다 (${formatting.kind}).`,
    data: formatting,
  };
};

export const augmentDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  const range: LineRange | 'invalid' | undefined = rangeFrom(args);

  if (stem === undefined) {
    return failure('씬 stem 을 지정해 주세요.');
  }

  if (range === 'invalid') {
    return failure('--lines 는 40-60 형식이어야 합니다.');
  }

  return augmentDraftRange(container, stem, range, {
    scope: range === undefined ? 'draft' : 'selection',
    instruction: flagString(args.flags, 'instruction'),
    isDryRun: flagBoolean(args.flags, 'dry-run'),
    appliedMessage: '카드 기반 보충을 반영했습니다.',
    proposedMessage: '보충안을 만들었습니다 (적용하지 않음).',
    failedLabel: '보충하지 못했습니다',
  });
};

export const editDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  const range: LineRange | 'invalid' | undefined = rangeFrom(args);
  const instruction: string | undefined = flagString(args.flags, 'instruction');

  if (stem === undefined) {
    return failure('씬 stem 을 지정해 주세요.');
  }

  if (range === 'invalid') {
    return failure('--lines 는 40-60 형식이어야 합니다.');
  }

  if (instruction === undefined || instruction.trim().length === 0) {
    return failure('--instruction 으로 어떻게 고칠지 알려 주세요.');
  }

  return augmentDraftRange(container, stem, range, {
    scope: 'selection',
    instruction,
    isDryRun: flagBoolean(args.flags, 'dry-run'),
    appliedMessage: '지시대로 고쳤습니다.',
    proposedMessage: '수정안을 만들었습니다 (적용하지 않음).',
    failedLabel: '고치지 못했습니다',
  });
};

interface AugmentDraftRangeOptions {
  readonly scope: DraftAugmentScope;
  readonly instruction: string | undefined;
  readonly isDryRun: boolean;
  readonly appliedMessage: string;
  readonly proposedMessage: string;
  readonly failedLabel: string;
}

async function augmentDraftRange(
  container: CliContainer,
  stem: string,
  range: LineRange | undefined,
  options: AugmentDraftRangeOptions,
): Promise<CommandOutcome> {
  const prepare = (target: string): Promise<AugmentDraftResult> =>
    container.drafts.prepareAugmentation({
      draftSceneStem: stem,
      sceneUri: scenePath(container.workspaceRoot, stem),
      scope: options.scope,
      target,
      workspaceRoot: container.workspaceRoot,
      ...(options.instruction === undefined ? {} : { instruction: options.instruction }),
    });

  if (options.isDryRun) {
    const loaded: LoadedDraftTarget = await loadDraftTarget(container, stem, range);

    if (!loaded.ok) {
      return loaded;
    }

    const prepared: AugmentDraftResult = await prepare(loaded.target);

    return prepared.ok
      ? success(options.proposedMessage, prepared)
      : failure(`${options.failedLabel} (${prepared.kind}).`, prepared);
  }

  return rewriteDraft(container, stem, range, async (target) => {
    const prepared: AugmentDraftResult = await prepare(target);

    return prepared.ok
      ? { ok: true, text: prepared.text, message: options.appliedMessage }
      : failure(`${options.failedLabel} (${prepared.kind}).`);
  });
}

async function readDraftBody(container: CliContainer, stem: string): Promise<string | undefined> {
  try {
    return (await container.drafts.readDraft(container.workspaceRoot, stem))?.draft.body;
  } catch {
    return undefined;
  }
}

export const checkDraft: CommandHandler = async ({ container, args }) => {
  const kind: DraftCheckKind | undefined = draftCheckKinds.find(
    (candidate) => candidate === args.positionals[0],
  );
  const stem: string | undefined = sceneStemFrom(args, 1);

  if (kind === undefined) {
    return failure(
      `검사 종류를 지정해 주세요: storyboard draft check <${draftCheckKinds.join('|')}> <stem>`,
    );
  }

  if (stem === undefined) {
    return failure('씬 stem 을 지정해 주세요.');
  }

  const body: string | undefined = await readDraftBody(container, stem);

  if (body === undefined) {
    return failure(`초안이 없습니다: ${stem}`);
  }

  const draftCheck: CheckDraftResult = await container.drafts.check({
    workspaceRoot: container.workspaceRoot,
    sceneStem: stem,
    kind,
    text: body,
  });

  switch (draftCheck.kind) {
    case 'failed':
      return failure(draftCheck.message);
    case 'slop':
      return {
        ok: draftCheck.findings.length === 0,
        message:
          draftCheck.findings.length === 0
            ? '상투 표현을 찾지 못했습니다.'
            : `${draftCheck.findings.length}건`,
        data: draftCheck.findings,
      };
    case 'grammar':
      return {
        ok: draftCheck.issues.length === 0,
        message:
          draftCheck.issues.length === 0
            ? '문법 문제를 찾지 못했습니다.'
            : `${draftCheck.issues.length}건`,
        data: draftCheck.issues,
      };
    case 'continuity':
      if (!draftCheck.hasFacts) {
        return success('대조할 정전 사실이 없습니다.', []);
      }

      return {
        ok: draftCheck.issues.length === 0,
        message:
          draftCheck.issues.length === 0
            ? '연속성 문제를 찾지 못했습니다.'
            : `${draftCheck.issues.length}건`,
        data: draftCheck.issues,
      };
  }
};

export const showDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = args.positionals[0]?.replace(/\.card$/, '');

  if (stem === undefined) {
    return failure('씬 stem 을 지정해 주세요: storyboard draft show <stem>');
  }

  const reading: DraftReading | undefined = await container.drafts.readDraft(
    container.workspaceRoot,
    stem,
  );

  if (reading === undefined) {
    return failure(`초안이 없습니다: ${stem}`);
  }

  const { draft } = reading;

  return success(draft.body.trimEnd(), {
    stem,
    path: (reading.uri as StoryUri).fsPath,
    characterCount: draft.body.length,
    generatedAt: draft.generatedAt,
    providerId: draft.providerId ?? null,
    model: draft.model ?? null,
    warnings: draft.warnings ?? [],
    body: draft.body,
  });
};
