import { readPayloadFields, type PayloadFields } from '@webview/lib/payloadFields';
import type {
  CardEditorInitialData,
  SceneListItem,
  SidebarCardsInitialData,
  SidebarScenesInitialData,
  StudioCardStage,
  StudioCardStageRelation,
  StudioChatStage,
  StudioChatTurn,
  StudioEntity,
  EntityKind,
  StudioInitialData,
  StudioPendingFollowUp,
  StudioReviewState,
  StudioSceneStage,
  StudioSessionSnapshot,
  StudioSessionSummary,
  StudioStage,
  StudioStageCard,
  StudioTarget,
  UsageAmount,
  UsageCacheAmount,
  UsageSummaryByEntity,
} from './types';
import type { BibleSubjectKind } from '@storyboard/story-model/contracts';

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function parseCardEditorInitialData(value: unknown): CardEditorInitialData {
  if (isCardEditorInitialData(value)) {
    return value;
  }

  return {
    documentUri: '',
    rawText: '',
    error: '초기 카드 데이터를 읽을 수 없습니다.',
  };
}

export const emptyUsageAmount: UsageAmount = { costUsd: 0, tokens: 0, hasUnpricedUsage: false };

const emptyUsageSummary: UsageSummaryByEntity = {
  scenes: {},
  characters: {},
  backgrounds: {},
  total: emptyUsageAmount,
};

export function parseSidebarCardsInitialData(value: unknown): SidebarCardsInitialData {
  if (isSidebarCardsInitialData(value)) {
    return { ...value, usage: normalizeUsageSummary(value.usage) };
  }

  return {
    type: 'character',
    title: 'Cards',
    cards: [],
    isStoryboardProject: false,
    usage: emptyUsageSummary,
  };
}

export function parseSidebarScenesInitialData(value: unknown): SidebarScenesInitialData {
  if (isSidebarScenesInitialData(value)) {
    return { ...value, usage: normalizeUsageSummary(value.usage) };
  }

  return {
    title: 'Scenes',
    scenes: [],
    isStoryboardProject: false,
    usage: emptyUsageSummary,
  };
}

const noneStudioTarget: StudioTarget = { kind: 'none', hasSelection: false };

export function parseStudioTarget(value: unknown): StudioTarget {
  if (!value || typeof value !== 'object') {
    return noneStudioTarget;
  }

  const candidate: Partial<StudioTarget> = value as Partial<StudioTarget>;

  if (!isStudioTargetKind(candidate.kind)) {
    return noneStudioTarget;
  }

  return {
    kind: candidate.kind,
    label: typeof candidate.label === 'string' ? candidate.label : undefined,
    entity: parseStudioEntity(candidate.entity),
    sceneUri: typeof candidate.sceneUri === 'string' ? candidate.sceneUri : undefined,
    draftUri: typeof candidate.draftUri === 'string' ? candidate.draftUri : undefined,
    cardUri: typeof candidate.cardUri === 'string' ? candidate.cardUri : undefined,
    hasSelection: candidate.hasSelection === true,
    draftExists: typeof candidate.draftExists === 'boolean' ? candidate.draftExists : undefined,
  };
}

function isStudioTargetKind(value: unknown): value is StudioTarget['kind'] {
  return (
    value === 'draft' ||
    value === 'scene' ||
    value === 'character' ||
    value === 'background' ||
    value === 'project' ||
    value === 'none'
  );
}

function parseStudioEntity(value: unknown): StudioEntity | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate: Partial<StudioEntity> = value as Partial<StudioEntity>;
  const kind: EntityKind | undefined = candidate.kind;

  if (kind !== 'character' && kind !== 'background' && kind !== 'scene' && kind !== 'project') {
    return undefined;
  }

  return typeof candidate.key === 'string' && candidate.key.length > 0
    ? { kind, key: candidate.key }
    : undefined;
}

export function parseStudioInitialData(value: unknown): StudioInitialData {
  const candidate: Partial<StudioInitialData> = (
    value && typeof value === 'object' ? value : {}
  ) as Partial<StudioInitialData>;
  const title: string = typeof candidate.title === 'string' ? candidate.title : 'Studio';

  return {
    title,
    target: parseStudioTarget(candidate.target),
    session: parseStudioSessionSnapshot(candidate.session),
  };
}

function parseStudioSessionSnapshot(value: unknown): StudioSessionSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate: Partial<StudioSessionSnapshot> = value as Partial<StudioSessionSnapshot>;
  const entity: StudioEntity | undefined = parseStudioEntity(candidate.entity);

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.createdAt !== 'string' ||
    !entity ||
    !Array.isArray(candidate.turns)
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    entity,
    createdAt: candidate.createdAt,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : candidate.createdAt,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    hasAppliedChanges: candidate.hasAppliedChanges === true,
    turns: [...(candidate.turns as readonly StudioChatTurn[])],
  };
}

export function parseSessionListPayload(payload: unknown): readonly StudioSessionSummary[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const sessions: unknown = (payload as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions.filter(isStudioSessionSummary);
}

export function parseStagePayload(payload: unknown): StudioStage | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const stage: unknown = (payload as { stage?: unknown }).stage;
  if (!stage || typeof stage !== 'object') {
    return undefined;
  }

  const kind: unknown = (stage as { kind?: unknown }).kind;

  if (kind === 'card') {
    return parseCardStage(stage as Partial<StudioCardStage>);
  }

  const candidate: Partial<StudioSceneStage> = stage as Partial<StudioSceneStage>;
  if (typeof candidate.sceneStem !== 'string' || candidate.sceneStem.length === 0) {
    return undefined;
  }

  return {
    kind: 'scene',
    sceneStem: candidate.sceneStem,
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
    draftLength: typeof candidate.draftLength === 'number' ? candidate.draftLength : undefined,
    draftUpdatedAt:
      typeof candidate.draftUpdatedAt === 'string' ? candidate.draftUpdatedAt : undefined,
    draftRevision:
      typeof candidate.draftRevision === 'number' ? candidate.draftRevision : undefined,
    review: isStudioReviewState(candidate.review) ? candidate.review : 'unreviewed',
    cards: Array.isArray(candidate.cards) ? candidate.cards.filter(isStudioStageCard) : [],
  };
}

function parseCardStage(candidate: Partial<StudioCardStage>): StudioCardStage | undefined {
  const cardKind: BibleSubjectKind | undefined = candidate.cardKind;

  if (cardKind !== 'character' && cardKind !== 'background') {
    return undefined;
  }

  if (typeof candidate.cardId !== 'string' || typeof candidate.name !== 'string') {
    return undefined;
  }

  return {
    kind: 'card',
    cardKind,
    cardId: candidate.cardId,
    name: candidate.name,
    role: typeof candidate.role === 'string' ? candidate.role : undefined,
    relations: Array.isArray(candidate.relations)
      ? candidate.relations.filter(isStudioCardStageRelation)
      : [],
    appearsInScenes: Array.isArray(candidate.appearsInScenes)
      ? candidate.appearsInScenes.filter((stem): stem is string => typeof stem === 'string')
      : [],
  };
}

function isStudioCardStageRelation(value: unknown): value is StudioCardStageRelation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate: Partial<StudioCardStageRelation> = value as Partial<StudioCardStageRelation>;
  return typeof candidate.target === 'string' && typeof candidate.type === 'string';
}

function isStudioReviewState(value: unknown): value is StudioReviewState {
  return value === 'unreviewed' || value === 'clean' || value === 'issues';
}

function isStudioStageCard(value: unknown): value is StudioStageCard {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate: Partial<StudioStageCard> = value as Partial<StudioStageCard>;
  return (
    (candidate.kind === 'character' || candidate.kind === 'background') &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0
  );
}

export function parseSessionLoadPayload(payload: unknown): StudioSessionSnapshot | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  return parseStudioSessionSnapshot((payload as { session?: unknown }).session);
}

function isStudioSessionSummary(value: unknown): value is StudioSessionSummary {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate: Partial<StudioSessionSummary> = value as Partial<StudioSessionSummary>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    typeof candidate.turnCount === 'number' &&
    typeof candidate.hasAppliedChanges === 'boolean'
  );
}

export function parseChatSendPayload(payload: unknown): readonly StudioChatTurn[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const turns: unknown = (payload as { turns?: unknown }).turns;

  return Array.isArray(turns) ? (turns as readonly StudioChatTurn[]) : [];
}

export function parseProposalApplyPayload(payload: unknown): {
  readonly status: 'applied' | 'failed';
  readonly message: string;
} {
  const candidate: PayloadFields = readPayloadFields(payload);

  const message: string =
    typeof candidate.message === 'string' ? candidate.message : '적용하지 못했습니다';

  return candidate.status === 'applied'
    ? { status: 'applied', message }
    : { status: 'failed', message };
}

export function parsePendingFollowUpsPayload(payload: unknown): readonly StudioPendingFollowUp[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const followUps: unknown = (payload as { followUps?: unknown }).followUps;

  return Array.isArray(followUps)
    ? (followUps as readonly StudioPendingFollowUp[]).filter(isPendingFollowUp)
    : [];
}

function isPendingFollowUp(value: unknown): value is StudioPendingFollowUp {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate: Partial<StudioPendingFollowUp> = value as Partial<StudioPendingFollowUp>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.reason === 'string' &&
    typeof candidate.instruction === 'string' &&
    parseStudioEntity(candidate.origin) !== undefined
  );
}

export function parsePreviewFailure(payload: unknown): string | undefined {
  const candidate: PayloadFields = readPayloadFields(payload);

  if (candidate.shown !== false) {
    return undefined;
  }

  return typeof candidate.message === 'string' && candidate.message.length > 0
    ? candidate.message
    : '변경을 보여 드릴 수 없습니다.';
}

export function parseProgressPayload(payload: unknown): StudioChatStage {
  const stage: PayloadFields = readPayloadFields(payload);

  return stage.stage === 'thinking' ||
    stage.stage === 'looking-up' ||
    stage.stage === 'invoking' ||
    stage.stage === 'validating'
    ? stage.stage
    : 'idle';
}

function isCardEditorInitialData(value: unknown): value is CardEditorInitialData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate: Partial<CardEditorInitialData> = value as Partial<CardEditorInitialData>;
  return typeof candidate.documentUri === 'string' && typeof candidate.rawText === 'string';
}

export function parseUsageChangedPayload(payload: unknown): UsageSummaryByEntity {
  return normalizeUsageSummary(payload);
}

export function addUsageAmount(base: UsageAmount, delta: UsageAmount): UsageAmount {
  const cache: UsageCacheAmount | undefined =
    base.cache === undefined || delta.cache === undefined
      ? (base.cache ?? delta.cache)
      : {
          promptTokens: base.cache.promptTokens + delta.cache.promptTokens,
          cachedTokens: base.cache.cachedTokens + delta.cache.cachedTokens,
          savedUsd: base.cache.savedUsd + delta.cache.savedUsd,
        };

  return {
    costUsd: base.costUsd + delta.costUsd,
    tokens: base.tokens + delta.tokens,
    hasUnpricedUsage: base.hasUnpricedUsage || delta.hasUnpricedUsage,
    ...(cache === undefined ? {} : { cache }),
  };
}

export function sumUsageMap(usageByKey: Readonly<Record<string, UsageAmount>>): UsageAmount {
  return Object.values(usageByKey).reduce(addUsageAmount, emptyUsageAmount);
}

export function usageAmountOf(
  usageByKey: Readonly<Record<string, UsageAmount>>,
  key: string,
): UsageAmount {
  return usageByKey[key] ?? emptyUsageAmount;
}

function normalizeUsageAmount(value: unknown): UsageAmount | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const amount: Partial<UsageAmount> = value as Partial<UsageAmount>;

  if (!Number.isFinite(amount.costUsd) || !Number.isFinite(amount.tokens)) {
    return undefined;
  }

  const cache: UsageCacheAmount | undefined = amount.cache;
  const hasCache: boolean =
    cache !== undefined &&
    Number.isFinite(cache.promptTokens) &&
    Number.isFinite(cache.cachedTokens) &&
    Number.isFinite(cache.savedUsd);

  return {
    costUsd: amount.costUsd as number,
    tokens: amount.tokens as number,
    hasUnpricedUsage: amount.hasUnpricedUsage === true,
    ...(hasCache && cache !== undefined
      ? {
          cache: {
            promptTokens: cache.promptTokens,
            cachedTokens: cache.cachedTokens,
            savedUsd: cache.savedUsd,
          },
        }
      : {}),
  };
}

function normalizeUsageMap(value: unknown): Readonly<Record<string, UsageAmount>> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const normalized: Record<string, UsageAmount> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const amount: UsageAmount | undefined = normalizeUsageAmount(raw);

    if (amount) {
      normalized[key] = amount;
    }
  }

  return normalized;
}

function normalizeUsageSummary(value: unknown): UsageSummaryByEntity {
  if (!value || typeof value !== 'object') {
    return emptyUsageSummary;
  }

  const summary: Partial<UsageSummaryByEntity> = value as Partial<UsageSummaryByEntity>;

  return {
    scenes: normalizeUsageMap(summary.scenes),
    characters: normalizeUsageMap(summary.characters),
    backgrounds: normalizeUsageMap(summary.backgrounds),
    total: normalizeUsageAmount(summary.total) ?? emptyUsageAmount,
  };
}

function isSidebarCardsInitialData(value: unknown): value is SidebarCardsInitialData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate: Partial<SidebarCardsInitialData> = value as Partial<SidebarCardsInitialData>;
  return (
    isSidebarCardCategory(candidate.type) &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.cards) &&
    typeof candidate.isStoryboardProject === 'boolean'
  );
}

function isSidebarScenesInitialData(value: unknown): value is SidebarScenesInitialData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate: Partial<SidebarScenesInitialData> = value as Partial<SidebarScenesInitialData>;
  return (
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.scenes) &&
    typeof candidate.isStoryboardProject === 'boolean' &&
    candidate.scenes.every(isSceneListItem)
  );
}

function isSceneListItem(value: unknown): value is SceneListItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const sceneFields: Partial<SceneListItem> = value as Partial<SceneListItem>;
  return (
    typeof sceneFields.stem === 'string' &&
    typeof sceneFields.order === 'number' &&
    typeof sceneFields.slug === 'string' &&
    typeof sceneFields.sceneUri === 'string' &&
    (sceneFields.status === 'ready' ||
      sceneFields.status === 'stale' ||
      sceneFields.status === 'missing') &&
    typeof sceneFields.sceneMtime === 'number'
  );
}

function isSidebarCardCategory(value: unknown): value is BibleSubjectKind {
  return value === 'character' || value === 'background';
}
