import type { StoryUri } from '#model/format/storyUri';
import type { BackgroundCard, CharacterCard } from '#model/format/card';
import type { SceneFile, SceneGrounding } from '#model/format/scene';
import type { BibleFact } from '#model/format/bible';
import type { ProjectFormat } from '#model/format/project';
import type { AiProviderId } from '#model/contracts/providerCatalog';
import type { AiTaskName } from '#model/contracts/ai';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { formatCardAttributes, joinCardText } from '#model/format/card';
import { aiProviderIds } from '#model/contracts/providerCatalog';
import { aiTaskCatalog } from '#model/contracts/ai';

interface SceneCacheBackgroundSnapshot {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface SceneCacheRecord {
  readonly sceneStem: string;
  readonly generatedAt: string;
  readonly inputHash: string;
  readonly input: string;
  readonly detectedCharacters: readonly string[];
  // 1단계 뼈대. 사건·등장·종료 지점이 여기서 확정되므로 재생성 결과를 견주는 기준이 된다.
  readonly skeleton?: string;
  // 대목마다 시각·장소·있는 사람(«1. 시각: … / 장소: …»). 재작성 전 검수가 장면 안 연속성의 기준으로 쓴다.
  readonly sceneCoordinates?: readonly string[];
  // 이 기록과 함께 쓴 초안 본문의 해시. 디스크의 초안이 우리가 쓴 그것인지 판정하는 데 쓴다.
  readonly bodyHash?: string;
  readonly personasUsed: Readonly<Record<string, string>>;
  readonly backgroundSnapshot?: SceneCacheBackgroundSnapshot;
  readonly previousContext?: string;
  readonly providers: Partial<Record<AiTaskName, AiProviderId>>;
}

export interface SceneCacheFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
}

export interface SceneInputHashInput {
  readonly sceneBody: string;
  readonly characters: readonly CharacterCard[];
  readonly background?: BackgroundCard;
  readonly format: ProjectFormat;
  readonly bibleFacts?: readonly BibleFact[];
  readonly sceneBreakJoiner?: string;
  readonly grounding?: SceneGrounding;
  // 시점을 정하는 씬 카드 필드. 프롬프트를 바꾸므로 digest 에 들어가야 캐시가 무효화된다.
  readonly narration?: SceneNarrationHashInput;
}

export interface SceneNarrationHashInput {
  readonly narrator?: string;
  readonly thread?: string;
  readonly povCharacter?: string;
}

// 생성과 원장 감사가 같은 값을 digest 해야 한다. 두 곳이 각자 필드를 고르면 한쪽만 고쳐질 때
// 해시가 갈려, 고치지 않은 씬이 통째로 낡음으로 잡힌다.
export function sceneNarrationHashInput(scene: SceneFile): SceneNarrationHashInput | undefined {
  const narration: SceneNarrationHashInput = {
    ...(scene.card.narrator === undefined ? {} : { narrator: scene.card.narrator }),
    ...(scene.card.thread === undefined ? {} : { thread: scene.card.thread }),
    ...(scene.frontmatter.povCharacter === undefined
      ? {}
      : { povCharacter: scene.frontmatter.povCharacter }),
  };

  return Object.keys(narration).length > 0 ? narration : undefined;
}

const sceneCacheBackgroundSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

const aiProviderIdSchema = z.enum(aiProviderIds);
const sceneCacheProvidersSchema = z.object(
  Object.fromEntries(
    aiTaskCatalog.map((task) => [task.name, aiProviderIdSchema.optional()]),
  ) as Record<AiTaskName, z.ZodOptional<typeof aiProviderIdSchema>>,
);

const sceneCacheRecordSchema = z.object({
  sceneStem: z.string().trim().min(1),
  generatedAt: z.string().datetime(),
  inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  input: z.string(),
  detectedCharacters: z.array(z.string()),
  skeleton: z.string().optional(),
  sceneCoordinates: z.array(z.string()).optional(),
  bodyHash: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  personasUsed: z.record(z.string(), z.string()),
  backgroundSnapshot: sceneCacheBackgroundSnapshotSchema.optional(),
  previousContext: z.string().optional(),
  providers: sceneCacheProvidersSchema,
});

export function serializeSceneCache(record: SceneCacheRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseSceneCache(rawCache: string): SceneCacheRecord {
  return sceneCacheRecordSchema.parse(JSON.parse(rawCache));
}

export async function readSceneCacheFile(
  uri: StoryUri,
  fileSystem: SceneCacheFileSystem,
): Promise<SceneCacheRecord> {
  const bytes = await fileSystem.readFile(uri);
  return parseSceneCache(new TextDecoder().decode(bytes));
}

export async function writeSceneCacheFile(
  uri: StoryUri,
  fileSystem: SceneCacheFileSystem,
  record: SceneCacheRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeSceneCache(record)));
}

function digestBibleFacts(
  facts: readonly BibleFact[],
): { kind: string; id: string; key: string; value: string }[] {
  return facts
    .map((fact) => ({
      kind: fact.subject.kind,
      id: fact.subject.id,
      key: fact.key,
      value: fact.value,
    }))
    .sort((a, b) => `${a.kind}:${a.id}:${a.key}`.localeCompare(`${b.kind}:${b.id}:${b.key}`));
}

// 값이 하나도 없으면 키 자체를 넣지 않는다. 넣으면 이 필드를 쓰지 않는 기존 워크스페이스의 해시가
// 전부 바뀌어, 고치지 않은 씬까지 한 번씩 다시 생성된다.
function hasNarrationInput(narration: SceneNarrationHashInput | undefined): boolean {
  return (
    narration !== undefined &&
    (narration.narrator !== undefined ||
      narration.thread !== undefined ||
      narration.povCharacter !== undefined)
  );
}

function hasRelationSpeech(relations: CharacterCard['relations']): boolean {
  return (relations ?? []).some((relation) => relation.speech !== undefined);
}

export function computeSceneInputHash(input: SceneInputHashInput): string {
  // NOTE: A draft cache hit skips the whole generation pipeline (incl. persona/background
  // regen), so every card field that reaches a generation prompt must be digested here or
  // edits to it would serve a stale draft.
  const digestSource = {
    sceneBody: input.sceneBody,
    characters: input.characters.map((character) => ({
      id: character.id,
      name: character.name,
      role: character.role,
      tags: character.tags ?? [],
      traits: character.traits ?? [],
      voice: joinCardText(character.voice),
      description: joinCardText(character.description),
      desire: joinCardText(character.desire),
      attributes: formatCardAttributes(character.attributes),
      recentDialogues: character.recentDialogues ?? [],
      // NOTE: 입버릇이 없는 카드는 키를 넣지 않아 입버릇 도입 전에 만든 초안의 해시가 그대로 맞는다.
      ...(character.catchphrases && character.catchphrases.length > 0
        ? { catchphrases: character.catchphrases }
        : {}),
      // NOTE: 상대별 말투는 다듬기·감수 프롬프트에 실린다. 적은 것이 없으면 키를 넣지 않아 그 전에
      // 만든 초안의 해시가 그대로 맞는다.
      ...(hasRelationSpeech(character.relations)
        ? {
            relationSpeech: (character.relations ?? []).flatMap((relation) =>
              relation.speech ? [{ target: relation.target, speech: relation.speech }] : [],
            ),
          }
        : {}),
    })),
    background: input.background
      ? {
          type: input.background.type,
          id: input.background.id,
          name: input.background.name,
          tags: input.background.tags ?? [],
          description: joinCardText(input.background.description),
          time: input.background.time ?? '',
          weather: input.background.weather ?? '',
          senses: joinCardText(input.background.senses),
          characterIds: input.background.characterIds ?? [],
        }
      : undefined,
    format: input.format,
    ...(input.bibleFacts && input.bibleFacts.length > 0
      ? { bibleFacts: digestBibleFacts(input.bibleFacts) }
      : {}),
    ...(input.sceneBreakJoiner ? { sceneBreakJoiner: input.sceneBreakJoiner } : {}),
    ...(input.grounding && Object.keys(input.grounding).length > 0
      ? { grounding: input.grounding }
      : {}),
    ...(hasNarrationInput(input.narration) ? { narration: input.narration } : {}),
  };
  const hash = createHash('sha256').update(JSON.stringify(digestSource)).digest('hex');

  return `sha256:${hash}`;
}
