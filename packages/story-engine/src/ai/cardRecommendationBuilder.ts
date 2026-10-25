import type { RecommendedEntity, StoryboardAiService } from '@storyboard/story-ai';
import type { BibleSubjectKind, UsageAttribution } from '@storyboard/story-model';

interface EntityAccumulator {
  entity: RecommendedEntity;
  scenes: Set<string>;
}

interface SourceEntities {
  readonly sceneStem: string;
  readonly entities: RecommendedEntity[];
}

export interface RecommendationSource {
  readonly sceneStem: string;
  readonly text: string;
}

export type CardRecommendationAiService = Pick<StoryboardAiService, 'extractCardRecommendations'>;

export interface RecommendedCard {
  readonly name: string;
  readonly role?: RecommendedEntity['role'];
  readonly description?: string;
  readonly sourceScenes: readonly string[];
}

export interface BuildCardRecommendationsInput {
  readonly category: BibleSubjectKind;
  readonly sources: readonly RecommendationSource[];
  readonly existingNames: readonly string[];
  readonly aiService: CardRecommendationAiService;
}

export function normalizeRecommendationKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sceneAttribution(sceneStem: string): UsageAttribution {
  return { primary: { kind: 'scene', id: sceneStem } };
}

class RecommendationAccumulator {
  private readonly byKey: Map<string, EntityAccumulator> = new Map<string, EntityAccumulator>();

  public add(sceneStem: string, entity: RecommendedEntity): void {
    const key: string = normalizeRecommendationKey(entity.name);
    const existing: EntityAccumulator | undefined = this.byKey.get(key);

    if (existing) {
      existing.scenes.add(sceneStem);
      return;
    }

    this.byKey.set(key, { entity, scenes: new Set([sceneStem]) });
  }

  public finalize(): RecommendedCard[] {
    const cards: RecommendedCard[] = [];

    for (const { entity, scenes } of this.byKey.values()) {
      cards.push({
        name: entity.name,
        ...(entity.role !== undefined ? { role: entity.role } : {}),
        ...(entity.description !== undefined ? { description: entity.description } : {}),
        sourceScenes: [...scenes],
      });
    }

    return cards.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  }
}

export async function buildCardRecommendations(
  input: BuildCardRecommendationsInput,
): Promise<RecommendedCard[]> {
  const { category, sources, existingNames, aiService } = input;

  if (sources.length === 0) {
    return [];
  }

  const existingKeys: Set<string> = new Set(existingNames.map(normalizeRecommendationKey));
  const accumulator: RecommendationAccumulator = new RecommendationAccumulator();

  const extractedBySource: SourceEntities[] = await Promise.all(
    sources.map(
      async (source): Promise<SourceEntities> => ({
        sceneStem: source.sceneStem,
        entities: await aiService.extractCardRecommendations(source.text, category, existingNames, {
          attribution: sceneAttribution(source.sceneStem),
        }),
      }),
    ),
  );

  for (const { sceneStem, entities } of extractedBySource) {
    for (const entity of entities) {
      if (existingKeys.has(normalizeRecommendationKey(entity.name))) {
        continue;
      }

      accumulator.add(sceneStem, entity);
    }
  }

  return accumulator.finalize();
}
