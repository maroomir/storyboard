import type {
  EntityRef,
  GenerateTextOptions,
  SituationWithCharacters,
  StoryboardAIService,
  StyleDirective,
} from '@storyboard/story-ai';
import type { Background } from '@storyboard/story-format';
import { characterMatchTokens } from '@storyboard/story-format';
import type { BackgroundCard, CharacterCard, ProjectFormat } from '@storyboard/story-format';
import {
  chunkDialoguePiecesByBudget,
  condensePreviousContext,
  looksLikeFormatMetaLeak,
} from './sceneGenerationPolicies';
import {
  SceneGenerationPipelineCancelledError,
  type BackgroundMemoryStore,
  type PersonaMemoryStore,
  type RunSceneGenerationPipelineInput,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';

export function buildGenerateOptions(
  providers: Readonly<SceneGenerationPipelineTaskProviders> | undefined,
  task: keyof SceneGenerationPipelineTaskProviders,
): GenerateTextOptions | undefined {
  const providerId = providers?.[task];
  return providerId ? { providerId } : undefined;
}

export function withAttribution(
  options: GenerateTextOptions | undefined,
  attribution: GenerateTextOptions['attribution'],
): GenerateTextOptions {
  return { ...options, attribution };
}

function situationCharacterRefs(
  situation: SituationWithCharacters,
  characters: readonly CharacterCard[],
): EntityRef[] {
  const byToken = new Map(
    characters.flatMap((character) =>
      characterMatchTokens(character).map((token) => [token, character] as const),
    ),
  );
  const refs: EntityRef[] = [];

  for (const name of situation.characters) {
    const card = byToken.get(name);

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

  // NOTE: 상황 추출이 원문 표기(별칭·게임 아이디일 수 있음)로 인물을 돌려주므로 카드 name뿐 아니라
  // alias·gamename으로도 대조해야 스코핑이 실제로 걸린다. 이름만 비교하면 전부 전체 폴백으로 새 버린다.
  const tokens = new Set(situation.characters);
  const subset = new Map<string, string>();
  for (const card of characters) {
    const matches = characterMatchTokens(card).some((token) => tokens.has(token));
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

export async function describeBackgroundForScene(
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

export function assertNotCancelled(shouldCancel: (() => boolean) | undefined): void {
  if (shouldCancel?.()) {
    throw new SceneGenerationPipelineCancelledError();
  }
}

export async function buildScenePersonas(
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

export async function generateSceneDialogue(
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
    // 씬 진입 컨텍스트(설정 메모·이전 씬 말미)는 tail로 대체하지 않고 모든 비트에 유지한다 —
    // 첫 비트에만 주면 뒤 비트일수록 캐넌·직전 씬 사실에서 이탈한다.
    const intraSceneTail: string | undefined =
      dialoguePieces.length > 0
        ? condensePreviousContext(dialoguePieces.join('\n\n'), true)
        : undefined;
    const prior: string | undefined =
      intraSceneTail !== undefined
        ? [condensedPreviousContext, intraSceneTail]
            .filter((part): part is string => Boolean(part))
            .join('\n\n')
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

// NOTE: 목표 분량의 이 비율에 못 미치면 한 번만 보충한다. 생성 프롬프트의 분량 지시만으로는
// 비트 수에 비례한 길이밖에 나오지 않아, 목표를 크게 밑도는 원고가 그대로 출고된다.
const LENGTH_SHORTFALL_RATIO = 0.7;

export async function expandDraftToTargetLength(
  draftBody: string,
  format: ProjectFormat,
  styleDirective: StyleDirective | undefined,
  facts: readonly string[],
  intent: string,
  aiService: Pick<SceneGenerationPipelineAiService, 'augmentDraft'>,
  sceneRef: EntityRef,
  onProgress: RunSceneGenerationPipelineInput['onProgress'],
): Promise<string> {
  const target = styleDirective?.targetWordCount;
  if (target === undefined || draftBody.length >= target * LENGTH_SHORTFALL_RATIO) {
    return draftBody;
  }

  onProgress?.('expandToTarget', 1, 1);

  const expanded = await aiService.augmentDraft(
    {
      target: draftBody,
      scope: 'draft',
      format,
      cards: [],
      facts,
      intent,
      instruction: `현재 분량이 목표에 못 미친다. 사건 순서와 대사를 그대로 두고 감각 묘사·내면·호흡만 늘려 약 ${target.toLocaleString()}자에 가깝게 확장하라. 새로운 사건·설정·인물을 추가하지 마라.`,
    },
    withAttribution({ styleDirective }, { primary: sceneRef }),
  );

  // 보충이 오히려 짧아지면 원본을 지킨다.
  return expanded.trim().length > draftBody.length ? expanded : draftBody;
}

export async function formatSceneDraft(
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
