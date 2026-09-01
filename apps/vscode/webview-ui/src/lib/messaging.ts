import type {
  CardEditorInitialData,
  SceneListItem,
  SidebarCardCategory,
  SidebarCardsInitialData,
  SidebarScenesInitialData,
  StudioCardStage,
  StudioCardStageRelation,
  StudioChatStage,
  StudioChatTurn,
  StudioEntity,
  StudioInitialData,
  StudioPendingFollowUp,
  StudioReviewState,
  StudioSceneStage,
  StudioSessionSnapshot,
  StudioSessionSummary,
  StudioStage,
  StudioStageCard,
  StudioTarget,
  UsageSummaryByEntity,
} from './types';

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

const emptyUsageSummary: UsageSummaryByEntity = {
  scenes: {},
  characters: {},
  backgrounds: {},
  totalUsd: 0,
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

  const candidate = value as Partial<StudioTarget>;

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

  const candidate = value as Partial<StudioEntity>;
  const kind = candidate.kind;

  if (kind !== 'character' && kind !== 'background' && kind !== 'scene' && kind !== 'project') {
    return undefined;
  }

  return typeof candidate.key === 'string' && candidate.key.length > 0
    ? { kind, key: candidate.key }
    : undefined;
}

export function parseStudioInitialData(value: unknown): StudioInitialData {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<StudioInitialData>;
  const title = typeof candidate.title === 'string' ? candidate.title : 'Studio';

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

  const candidate = value as Partial<StudioSessionSnapshot>;
  const entity = parseStudioEntity(candidate.entity);

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

  const sessions = (payload as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions.filter(isStudioSessionSummary);
}

export function parseStagePayload(payload: unknown): StudioStage | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const stage = (payload as { stage?: unknown }).stage;
  if (!stage || typeof stage !== 'object') {
    return undefined;
  }

  const kind = (stage as { kind?: unknown }).kind;

  if (kind === 'card') {
    return parseCardStage(stage as Partial<StudioCardStage>);
  }

  const candidate = stage as Partial<StudioSceneStage>;
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
  const cardKind = candidate.cardKind;

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

  const candidate = value as Partial<StudioCardStageRelation>;
  return typeof candidate.target === 'string' && typeof candidate.type === 'string';
}

function isStudioReviewState(value: unknown): value is StudioReviewState {
  return value === 'unreviewed' || value === 'clean' || value === 'issues';
}

function isStudioStageCard(value: unknown): value is StudioStageCard {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StudioStageCard>;
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

  const candidate = value as Partial<StudioSessionSummary>;
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

  const turns = (payload as { turns?: unknown }).turns;

  return Array.isArray(turns) ? (turns as readonly StudioChatTurn[]) : [];
}

export function parseProposalApplyPayload(payload: unknown): {
  readonly status: 'applied' | 'failed';
  readonly message: string;
} {
  const candidate = (payload && typeof payload === 'object' ? payload : {}) as {
    status?: unknown;
    message?: unknown;
  };

  const message = typeof candidate.message === 'string' ? candidate.message : '적용하지 못했습니다';

  return candidate.status === 'applied'
    ? { status: 'applied', message }
    : { status: 'failed', message };
}

export function parsePendingFollowUpsPayload(payload: unknown): readonly StudioPendingFollowUp[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const followUps = (payload as { followUps?: unknown }).followUps;

  return Array.isArray(followUps)
    ? (followUps as readonly StudioPendingFollowUp[]).filter(isPendingFollowUp)
    : [];
}

function isPendingFollowUp(value: unknown): value is StudioPendingFollowUp {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<StudioPendingFollowUp>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.reason === 'string' &&
    typeof candidate.instruction === 'string' &&
    parseStudioEntity(candidate.origin) !== undefined
  );
}

export function parsePreviewFailure(payload: unknown): string | undefined {
  const candidate = (payload && typeof payload === 'object' ? payload : {}) as {
    shown?: unknown;
    message?: unknown;
  };

  if (candidate.shown !== false) {
    return undefined;
  }

  return typeof candidate.message === 'string' && candidate.message.length > 0
    ? candidate.message
    : '변경을 보여 드릴 수 없습니다.';
}

export function parseProgressPayload(payload: unknown): StudioChatStage {
  const stage = (payload && typeof payload === 'object' ? payload : {}) as { stage?: unknown };

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

  const candidate = value as Partial<CardEditorInitialData>;
  return typeof candidate.documentUri === 'string' && typeof candidate.rawText === 'string';
}

export function parseUsageChangedPayload(payload: unknown): UsageSummaryByEntity {
  return normalizeUsageSummary(payload);
}

export function sumUsageMap(map: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const value of Object.values(map)) {
    if (Number.isFinite(value)) {
      total += value;
    }
  }
  return total;
}

function normalizeUsageSummary(value: unknown): UsageSummaryByEntity {
  if (!value || typeof value !== 'object') {
    return emptyUsageSummary;
  }

  const u = value as Partial<UsageSummaryByEntity & { readonly total?: number }>;
  const totalUsdRaw = u.totalUsd ?? u.total;
  return {
    scenes: typeof u.scenes === 'object' && u.scenes !== null ? u.scenes : {},
    characters: typeof u.characters === 'object' && u.characters !== null ? u.characters : {},
    backgrounds: typeof u.backgrounds === 'object' && u.backgrounds !== null ? u.backgrounds : {},
    totalUsd: typeof totalUsdRaw === 'number' && Number.isFinite(totalUsdRaw) ? totalUsdRaw : 0,
  };
}

function isSidebarCardsInitialData(value: unknown): value is SidebarCardsInitialData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SidebarCardsInitialData>;
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

  const candidate = value as Partial<SidebarScenesInitialData>;
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

  const s = value as Partial<SceneListItem>;
  return (
    typeof s.stem === 'string' &&
    typeof s.order === 'number' &&
    typeof s.slug === 'string' &&
    typeof s.sceneUri === 'string' &&
    (s.status === 'ready' || s.status === 'stale' || s.status === 'missing') &&
    typeof s.sceneMtime === 'number'
  );
}

function isSidebarCardCategory(value: unknown): value is SidebarCardCategory {
  return value === 'character' || value === 'background';
}
