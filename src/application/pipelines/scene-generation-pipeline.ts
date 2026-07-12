import type { SceneContext } from '../../core/sceneContext';
import type { IBackgroundMemoryStore, IPersonaMemoryStore } from '../ports/memoryStore';
import type { Background } from '../../domain/Background';
import { createEmptyBackground } from '../../domain/Background';
import type { BackgroundCard, CharacterCard } from '../../shared/card';
import type { ProjectFormat } from '../../shared/project';
import type { StyleDirective } from '../../shared/styleDirective';
import type {
  GenerateTextOptions,
  SituationWithCharacters,
  StoryboardAIService,
} from '../../services/ai/AIService';
import type { AiProviderId, EntityRef } from '../../services/ai/types';

export type SceneGenerationPipelineAiService = Pick<
  StoryboardAIService,
  | 'extractSituations'
  | 'createCharacterPersona'
  | 'describeBackground'
  | 'generatePersonaDialogue'
  | 'applyGenreFormat'
>;

export type SceneGenerationPipelineStage =
  | 'extractSituations'
  | 'buildPersonas'
  | 'generateDialogue'
  | 'applyFormat';

export interface SceneGenerationPipelineTaskProviders {
  readonly situationExtraction?: AiProviderId;
  readonly personaGeneration?: AiProviderId;
  readonly personaDialogue?: AiProviderId;
  readonly sceneDraft?: AiProviderId;
}

export type PersonaMemoryStore = IPersonaMemoryStore;
export type BackgroundMemoryStore = IBackgroundMemoryStore;

export class SceneGenerationPipelineCancelledError extends Error {
  public constructor() {
    super('씬 초안 생성이 취소되었습니다.');
    this.name = 'SceneGenerationPipelineCancelledError';
  }
}

export interface RunSceneGenerationPipelineInput {
  readonly context: SceneContext;
  readonly aiService: SceneGenerationPipelineAiService;
  readonly format: ProjectFormat;
  readonly styleDirective?: StyleDirective;
  readonly previousContext?: string;
  readonly providers?: Readonly<SceneGenerationPipelineTaskProviders>;
  readonly onProgress?: (
    stage: SceneGenerationPipelineStage,
    current: number,
    total: number,
  ) => void;
  readonly shouldCancel?: () => boolean;
  readonly sceneStem?: string;
  readonly backgroundId?: string;
  readonly useContextCondense?: boolean;
  readonly personaStore?: PersonaMemoryStore;
  readonly backgroundStore?: BackgroundMemoryStore;
  readonly sceneBreakJoiner?: string;
}

export interface RunSceneGenerationPipelineResult {
  readonly draftBody: string;
  readonly detectedCharacters: readonly string[];
  readonly situations: readonly SituationWithCharacters[];
  readonly personasUsed: ReadonlyMap<string, string>;
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
}

export function dedupeSituations(
  items: readonly SituationWithCharacters[],
): SituationWithCharacters[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = (item.situation || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) {
      return false;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildGenerateOptions(
  providers: Readonly<SceneGenerationPipelineTaskProviders> | undefined,
  task: keyof SceneGenerationPipelineTaskProviders,
): GenerateTextOptions | undefined {
  const providerId = providers?.[task];
  return providerId ? { providerId } : undefined;
}

function withAttribution(
  options: GenerateTextOptions | undefined,
  attribution: GenerateTextOptions['attribution'],
): GenerateTextOptions {
  return { ...options, attribution };
}

function situationCharacterRefs(
  situation: SituationWithCharacters,
  characters: readonly CharacterCard[],
): EntityRef[] {
  const byName = new Map(characters.map((character) => [character.name, character] as const));
  const refs: EntityRef[] = [];

  for (const name of situation.characters) {
    const card = byName.get(name);

    if (card) {
      refs.push({ kind: 'character', id: card.id });
    }
  }

  return refs;
}

function dedupeEntityRefs(refs: readonly EntityRef[]): EntityRef[] {
  const seen = new Set<string>();
  const out: EntityRef[] = [];

  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(ref);
  }

  return out;
}

function dialogueParticipantsForSituation(
  situation: SituationWithCharacters,
  characters: readonly CharacterCard[],
  backgroundParticipantId: string | undefined,
): EntityRef[] {
  const fromSituation = situationCharacterRefs(situation, characters);
  const characterParticipants =
    fromSituation.length === 0
      ? characters.map((card) => ({ kind: 'character' as const, id: card.id }))
      : fromSituation;

  const refs: EntityRef[] = [...characterParticipants];

  if (backgroundParticipantId) {
    refs.push({ kind: 'background', id: backgroundParticipantId });
  }

  return dedupeEntityRefs(refs);
}

function selectSituationPersonas(
  situation: SituationWithCharacters,
  characters: readonly CharacterCard[],
  personasUsed: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  if (situation.characters.length === 0) {
    return personasUsed;
  }

  // NOTE: 상황 추출이 원문 표기(별칭일 수 있음)로 인물을 돌려주므로 카드 name뿐 아니라 alias로도
  // 대조해야 스코핑이 실제로 걸린다. 이름만 비교하면 별칭 상황은 전부 전체 폴백으로 새 버린다.
  const tokens = new Set(situation.characters);
  const subset = new Map<string, string>();
  for (const card of characters) {
    const matches =
      tokens.has(card.name) || (card.aliases ?? []).some((alias) => tokens.has(alias));
    if (!matches) {
      continue;
    }
    const persona = personasUsed.get(card.name);
    if (persona !== undefined) {
      subset.set(card.name, persona);
    }
  }

  return subset.size > 0 ? subset : personasUsed;
}

// NOTE: 모든 대사 조각을 한 번에 포맷하면 모델 출력 한계로 뒷부분 비트가 잘려 나간다. 글자 예산 단위로
// 조각을 묶어 여러 번 포맷한 뒤 이어 붙여, 27개 비트가 전부 살아남고 분량이 안정적으로 나오게 한다.
const FORMAT_CHUNK_CHAR_BUDGET = 12000;

const MAX_CONDENSED_CONTEXT_CHARS = 1200;

export function chunkDialoguePiecesByBudget(
  pieces: readonly string[],
  maxChars: number,
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const piece of pieces) {
    if (current.length > 0 && currentChars + piece.length > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(piece);
    currentChars += piece.length;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

const MAX_SCENE_BREAK_NEWLINE_COUNT = 10;

export function resolveSceneBreakJoiner(rawSeparator: string | undefined): string | undefined {
  const separator = rawSeparator?.trim();

  if (!separator) {
    return undefined;
  }

  if (/^\d+$/.test(separator)) {
    const newlineCount = Math.min(Number.parseInt(separator, 10), MAX_SCENE_BREAK_NEWLINE_COUNT);
    return newlineCount > 0 ? '\n'.repeat(newlineCount) : undefined;
  }

  return `\n\n${separator}\n\n`;
}

// NOTE: 청크 포맷 호출이 소설 본문 대신 "분량 한계라 연재형/압축형 중 고르라"는 메타 안내를 돌려보내는
// 경우가 있어, 그게 원고에 박히지 않도록 감지한다. 길이 핑계와 선택지 제시가 함께 있을 때만 메타로 본다.
export function looksLikeFormatMetaLeak(text: string): boolean {
  const hasLengthExcuse =
    /분량[^\n]{0,8}(한계|제한|많|길)|한 ?번에 (다|모두|전부)|토큰 ?(한계|제한|수)/.test(text);
  const offersOptions =
    /연재형|압축형|다음 중|어느 (쪽|것|걸)|선택해|골라|옵션|원하시(는|면)|알려 ?주(세요|시면)/.test(
      text,
    );
  return hasLengthExcuse && offersOptions;
}

async function describeBackgroundForScene(
  card: BackgroundCard,
  aiService: Pick<StoryboardAIService, 'describeBackground'>,
  store: BackgroundMemoryStore | undefined,
): Promise<Background> {
  const cached = await store?.load(card);
  let atmosphere = cached;
  if (atmosphere === undefined) {
    atmosphere = await aiService.describeBackground(card, {
      attribution: { primary: { kind: 'background', id: card.id } },
    });
    await store?.save(card, atmosphere);
  }

  if (atmosphere.length === 0) {
    return card;
  }

  const description = [...(card.description ?? []), atmosphere];
  return { ...card, description };
}

function assertNotCancelled(shouldCancel: (() => boolean) | undefined): void {
  if (shouldCancel?.()) {
    throw new SceneGenerationPipelineCancelledError();
  }
}

function isContextBearingLine(line: string): boolean {
  return line.includes(':') || /행동|표정|감정|생각|묘사/.test(line);
}

function condensePreviousContext(
  previousContext: string | undefined,
  enabled: boolean,
): string | undefined {
  if (!previousContext) {
    return undefined;
  }

  if (!enabled) {
    return previousContext;
  }

  if (previousContext.length <= MAX_CONDENSED_CONTEXT_CHARS) {
    return previousContext;
  }

  const lines = previousContext
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter(isContextBearingLine);

  if (lines.length === 0) {
    return previousContext.slice(-MAX_CONDENSED_CONTEXT_CHARS);
  }

  const condensed = lines.join('\n');
  return condensed.length <= MAX_CONDENSED_CONTEXT_CHARS
    ? condensed
    : condensed.slice(-MAX_CONDENSED_CONTEXT_CHARS);
}

async function buildScenePersonas(
  characters: readonly CharacterCard[],
  personaOptions: GenerateTextOptions,
  aiService: Pick<SceneGenerationPipelineAiService, 'createCharacterPersona'>,
  personaStore: PersonaMemoryStore | undefined,
  sceneRef: EntityRef,
  onProgress: RunSceneGenerationPipelineInput['onProgress'],
  shouldCancel: (() => boolean) | undefined,
): Promise<Map<string, string>> {
  const personasUsed = new Map<string, string>();
  const characterCount = characters.length;

  for (let i = 0; i < characters.length; i++) {
    const character = characters[i];
    if (!character) {
      continue;
    }
    const cached = await personaStore?.load(character);
    let persona = cached;
    if (persona === undefined) {
      persona = await aiService.createCharacterPersona(
        character,
        withAttribution(personaOptions, {
          primary: { kind: 'character', id: character.id },
          participants: [sceneRef],
        }),
      );
      await personaStore?.save(character, persona);
    }
    personasUsed.set(character.name, persona);
    onProgress?.('buildPersonas', i + 1, characterCount);
    assertNotCancelled(shouldCancel);
  }

  return personasUsed;
}

async function generateSceneDialogue(
  situations: readonly SituationWithCharacters[],
  characters: readonly CharacterCard[],
  personasUsed: ReadonlyMap<string, string>,
  background: Background,
  backgroundParticipantId: string | undefined,
  dialogueOptions: GenerateTextOptions,
  condensedPreviousContext: string | undefined,
  aiService: Pick<SceneGenerationPipelineAiService, 'generatePersonaDialogue'>,
  sceneRef: EntityRef,
  onProgress: RunSceneGenerationPipelineInput['onProgress'],
  shouldCancel: (() => boolean) | undefined,
): Promise<string[]> {
  const dialoguePieces: string[] = [];

  for (let i = 0; i < situations.length; i++) {
    const situation = situations[i];
    if (!situation) {
      continue;
    }
    onProgress?.('generateDialogue', i + 1, situations.length);

    // NOTE: 앞 구간에서 실제로 생성된 대사의 압축 tail을 이어 넘겨 장면 간 연결성을 유지한다.
    // 직전 상황의 원문이 아니라 이미 쓰여진 대사를 봐야 인물 감정·맥락이 누적된다.
    const prior: string | undefined =
      dialoguePieces.length > 0
        ? condensePreviousContext(dialoguePieces.join('\n\n'), true)
        : condensedPreviousContext;

    const dialogueParticipants = dialogueParticipantsForSituation(
      situation,
      characters,
      backgroundParticipantId,
    );

    // NOTE: 이 상황에 실제 참여하는 인물의 페르소나만 넘긴다. 전체 페르소나를 매 상황에 주면
    // 모델이 그 비트에 없어야 할 인물(예: 다른 장소 전용 인물)까지 끌어와 등장 드리프트가 난다.
    const situationPersonas = selectSituationPersonas(situation, characters, personasUsed);

    const dialogue = await aiService.generatePersonaDialogue(
      situation.situation,
      situationPersonas,
      background,
      prior,
      withAttribution(dialogueOptions, {
        primary: sceneRef,
        participants: dialogueParticipants,
      }),
    );
    dialoguePieces.push(dialogue);
    assertNotCancelled(shouldCancel);
  }

  return dialoguePieces;
}

async function formatSceneDraft(
  dialoguePieces: readonly string[],
  format: ProjectFormat,
  providers: Readonly<SceneGenerationPipelineTaskProviders>,
  sceneBreakJoiner: string | undefined,
  styleDirective: StyleDirective | undefined,
  aiService: Pick<SceneGenerationPipelineAiService, 'applyGenreFormat'>,
  sceneRef: EntityRef,
  onProgress: RunSceneGenerationPipelineInput['onProgress'],
  shouldCancel: (() => boolean) | undefined,
): Promise<string> {
  // NOTE: AI 포맷이 chunk 내부의 장면 경계를 소실시키므로, 구분자 모드에서는 장면(비트) 단위로 포맷한다.
  const formatChunks = sceneBreakJoiner
    ? dialoguePieces.map((piece) => [piece])
    : chunkDialoguePiecesByBudget(dialoguePieces, FORMAT_CHUNK_CHAR_BUDGET);
  const formattedParts: string[] = [];

  for (let i = 0; i < formatChunks.length; i++) {
    const chunk = formatChunks[i];
    if (!chunk) {
      continue;
    }
    onProgress?.('applyFormat', i + 1, formatChunks.length);
    const chunkInput = chunk.join('\n\n');
    const formatted = await aiService.applyGenreFormat(
      chunkInput,
      format,
      withAttribution(
        { ...buildGenerateOptions(providers, 'sceneDraft'), styleDirective },
        { primary: sceneRef },
      ),
    );
    // 메타 누수가 감지되면 원고를 오염시키는 대신 해당 청크의 원본 대사를 그대로 남긴다.
    formattedParts.push(looksLikeFormatMetaLeak(formatted) ? chunkInput : formatted);
    assertNotCancelled(shouldCancel);
  }

  return sceneBreakJoiner
    ? formattedParts.map((part) => part.trim()).join(sceneBreakJoiner)
    : formattedParts.join('\n\n');
}

async function executeSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput,
): Promise<RunSceneGenerationPipelineResult> {
  const {
    context,
    aiService,
    format,
    styleDirective,
    previousContext,
    providers = {},
    onProgress,
    shouldCancel,
  } = input;
  const condensedPreviousContext = condensePreviousContext(
    previousContext,
    input.useContextCondense === true,
  );
  const sceneStem = input.sceneStem ?? input.context.scene.stem;
  const sceneRef: EntityRef = { kind: 'scene', id: sceneStem };
  const body = context.scene.body.trim();

  if (body.length === 0) {
    throw new Error(
      '씬 본문이 비어 있습니다. scene 파일에 장면 설명을 작성한 뒤 다시 시도해주세요.',
    );
  }

  const detectedCharacters = context.characters.map((character) => character.name);
  if (detectedCharacters.length === 0) {
    throw new Error(
      '등장인물을 찾을 수 없습니다. 스크립트에 인물 이름을 포함하거나 frontmatter에 characters를 지정해주세요.',
    );
  }

  const situationsRaw = await aiService.extractSituations(
    body,
    withAttribution(buildGenerateOptions(providers, 'situationExtraction'), { primary: sceneRef }),
  );
  onProgress?.('extractSituations', 1, 1);
  assertNotCancelled(shouldCancel);

  const situations = dedupeSituations(situationsRaw);
  if (situations.length === 0) {
    throw new Error('상황을 추출할 수 없습니다.');
  }

  const personaOptions: GenerateTextOptions = {
    ...buildGenerateOptions(providers, 'personaGeneration'),
    styleDirective,
  };
  const personasUsed = await buildScenePersonas(
    context.characters,
    personaOptions,
    aiService,
    input.personaStore,
    sceneRef,
    onProgress,
    shouldCancel,
  );

  const backgroundCard = context.background ?? createEmptyBackground('scene-default', '미정');
  const background = context.background
    ? await describeBackgroundForScene(context.background, aiService, input.backgroundStore)
    : backgroundCard;
  const dialogueOptions: GenerateTextOptions = {
    ...buildGenerateOptions(providers, 'personaDialogue'),
    styleDirective,
  };
  const backgroundParticipantId = context.background?.id ?? input.backgroundId;
  assertNotCancelled(shouldCancel);

  const dialoguePieces = await generateSceneDialogue(
    situations,
    context.characters,
    personasUsed,
    background,
    backgroundParticipantId,
    dialogueOptions,
    condensedPreviousContext,
    aiService,
    sceneRef,
    onProgress,
    shouldCancel,
  );

  const draftBody = await formatSceneDraft(
    dialoguePieces,
    format,
    providers,
    input.sceneBreakJoiner,
    styleDirective,
    aiService,
    sceneRef,
    onProgress,
    shouldCancel,
  );

  return {
    draftBody,
    detectedCharacters,
    situations,
    personasUsed,
    providers,
  };
}

export class SceneGenerationPipeline {
  public constructor(private readonly input: RunSceneGenerationPipelineInput) {}

  public async run(): Promise<RunSceneGenerationPipelineResult> {
    return await executeSceneGenerationPipeline(this.input);
  }
}

export async function runSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput,
): Promise<RunSceneGenerationPipelineResult> {
  return await new SceneGenerationPipeline(input).run();
}
