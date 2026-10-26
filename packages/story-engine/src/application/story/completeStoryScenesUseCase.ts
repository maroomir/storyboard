import type { AiServices, WorkspaceRepositories } from '#engine/application/engineServices';
import type { StoryUri, SceneCard, SceneFile, StoryboardCard, AiGenerateResponse } from '@storyboard/story-model';
import type { IUseCase } from '#engine/application/useCase';
import { z } from 'zod';

import { sceneFileNamePattern, serializeSceneCard, parseJsonObject } from '@storyboard/story-model';
import type { StoryFeatureSource, StoryFileSnapshot } from './storyFeatureTypes';
import { StoryFeatureSourceError } from './storyFeatureTypes';
import type { StoryboardAiService } from '@storyboard/story-ai';

const MAX_COMPLETE_SCENES: number = 20;
const FULL_SCENE_CONTEXT_LIMIT: number = 120_000;
const SUMMARY_CHUNK_SIZE: number = 40_000;

interface CompletionResponse {
  scenes: { slug: string; title: string; characterIds: string[]; body: string; resolvedThreads: string[]; openThreads: string[]; locationId?: string | undefined; mood?: string | undefined; relationStage?: string | undefined; }[];
  centralQuestion?: string;
  climaxChoice?: string;
}

const completionResponseSchema: z.ZodType<CompletionResponse> = z.object({
  scenes: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        title: z.string().trim().min(1),
        characterIds: z.array(z.string().trim().min(1)),
        locationId: z.string().trim().min(1).optional(),
        mood: z.string().trim().min(1).optional(),
        relationStage: z.string().trim().min(1).optional(),
        body: z.string().trim().min(1),
        resolvedThreads: z.array(z.string().trim().min(1)).default([]),
        openThreads: z.array(z.string().trim().min(1)).default([]),
      }),
    )
    .min(1)
    .max(MAX_COMPLETE_SCENES),
  centralQuestion: z.string().trim().min(1).optional(),
  climaxChoice: z.string().trim().min(1).optional(),
});

export interface CompletedStoryScene {
  readonly fileName: string;
  readonly content: string;
  readonly title: string;
  readonly resolvedThreads: readonly string[];
  readonly openThreads: readonly string[];
}

export interface CompleteStoryScenesProposal {
  readonly scenes: readonly CompletedStoryScene[];
  readonly centralQuestion?: string;
  readonly climaxChoice?: string;
  readonly snapshots: readonly StoryFileSnapshot[];
}

export interface CompleteStoryScenesRequest {
  readonly workspaceRoot: StoryUri;
}

export class CompleteStoryScenesUseCase implements IUseCase<CompleteStoryScenesRequest, CompleteStoryScenesProposal> {
  public constructor(
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: CompleteStoryScenesRequest): Promise<CompleteStoryScenesProposal> {
    const { workspaceRoot } = request;
    const source: StoryFeatureSource = await this.repositories.storyFeatures.load(workspaceRoot);

    if (source.scenes.length === 0) {
      throw new StoryFeatureSourceError('no-valid-scenes', '완결할 유효한 씬이 없습니다.');
    }

    const sceneContext: unknown = await this.buildSceneContext(workspaceRoot, source.scenes);
    const response: AiGenerateResponse = await this.ai.gateway.createService(workspaceRoot).generateText(
      'storyCompletion',
      [
        {
          role: 'system',
          content:
            'You are a story architect. Return JSON only. Never return file paths or file names. Preserve established facts and propose only append-only ending scenes.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'Complete the unfinished story with 1 to 20 causally earned scenes.',
            project: source.project,
            canon: source.canonText,
            cards: source.cards.map(cardSummary),
            scenes: sceneContext,
            responseShape: {
              scenes: [
                {
                  slug: 'lowercase-kebab-case',
                  title: 'string',
                  characterIds: ['existing-character-id'],
                  locationId: 'existing-background-id optional',
                  mood: 'optional',
                  relationStage: 'optional',
                  body: 'scene source body',
                  resolvedThreads: ['string'],
                  openThreads: ['string'],
                },
              ],
              centralQuestion: 'optional',
              climaxChoice: 'optional',
            },
          }),
        },
      ],
      {},
    );
    const parsed: CompletionResponse = completionResponseSchema.parse(parseJsonObject(response.text));
    const existingCharacterIds: Set<string> = new Set(
      source.cards.filter((card) => card.type === 'character').map((card) => card.id),
    );
    const existingBackgroundIds: Set<string> = new Set(
      source.cards.filter((card) => card.type !== 'character').map((card) => card.id),
    );
    const existingSlugs: Set<string> = new Set(source.scenes.map((scene) => scene.slug));
    const proposedSlugs: Set<string> = new Set<string>();
    const maximumOrder: number = Math.max(...source.scenes.map((scene) => scene.order));

    const scenes: CompletedStoryScene[] = parsed.scenes.map((candidate, index): CompletedStoryScene => {
      if (existingSlugs.has(candidate.slug) || proposedSlugs.has(candidate.slug)) {
        throw new StoryFeatureSourceError('duplicate-scene-slug', `중복된 씬 slug: ${candidate.slug}`);
      }
      proposedSlugs.add(candidate.slug);
      for (const id of candidate.characterIds) {
        if (!existingCharacterIds.has(id)) {
          throw new StoryFeatureSourceError('unknown-card-reference', `존재하지 않는 캐릭터 ID: ${id}`);
        }
      }
      if (candidate.locationId && !existingBackgroundIds.has(candidate.locationId)) {
        throw new StoryFeatureSourceError('unknown-card-reference', `존재하지 않는 배경 ID: ${candidate.locationId}`);
      }

      const prefix: string = String(maximumOrder + index + 1).padStart(
        source.project.editor.scenePrefixDigits,
        '0',
      );
      const fileName: string = `${prefix}-${candidate.slug}.card`;
      if (!sceneFileNamePattern.test(fileName)) {
        throw new StoryFeatureSourceError('invalid-scene-filename', `생성할 수 없는 씬 파일명: ${fileName}`);
      }
      const sceneCard: SceneCard = {
        type: 'scene',
        id: `${prefix}-${candidate.slug}`,
        title: candidate.title,
        ...(candidate.characterIds.length > 0 ? { characters: candidate.characterIds } : {}),
        ...(candidate.locationId ? { location: candidate.locationId } : {}),
        ...(candidate.mood ? { mood: candidate.mood } : {}),
        ...(candidate.relationStage ? { relationStage: candidate.relationStage } : {}),
        summary: candidate.body.trim(),
      };

      return {
        fileName,
        content: serializeSceneCard(sceneCard),
        title: candidate.title,
        resolvedThreads: candidate.resolvedThreads,
        openThreads: candidate.openThreads,
      };
    });

    return {
      scenes,
      ...(parsed.centralQuestion ? { centralQuestion: parsed.centralQuestion } : {}),
      ...(parsed.climaxChoice ? { climaxChoice: parsed.climaxChoice } : {}),
      snapshots: source.snapshots,
    };
  }

  public async hasCurrentSources(snapshots: readonly StoryFileSnapshot[]): Promise<boolean> {
    return await this.repositories.storyFeatures.hasCurrentSnapshots(snapshots);
  }

  private async buildSceneContext(
    workspaceRoot: StoryUri,
    scenes: readonly SceneFile[],
  ): Promise<unknown> {
    const fullScenes: Record<string, unknown>[] = scenes.map(sceneSummary);
    const serialized: string = JSON.stringify(fullScenes);

    if (serialized.length <= FULL_SCENE_CONTEXT_LIMIT) {
      return fullScenes;
    }

    const tail: Record<string, unknown>[] = fullScenes.slice(-5);
    const previousText: string = JSON.stringify(fullScenes.slice(0, -5));
    const chunks: string[] = splitText(previousText, SUMMARY_CHUNK_SIZE);
    const aiService: StoryboardAiService = this.ai.gateway.createService(workspaceRoot);
    const summaries: string[] = await Promise.all(
      chunks.map(async (chunk) => {
        const response: AiGenerateResponse = await aiService.generateText(
          'storyCompletion',
          [
            {
              role: 'system',
              content:
                'Summarize story events, character changes, and unresolved threads. Return plain concise text only.',
            },
            { role: 'user', content: chunk },
          ],
          {},
        );
        return response.text.trim();
      }),
    );

    return { previousSceneSummaries: summaries, finalScenes: tail };
  }
}

function sceneSummary(scene: SceneFile): Record<string, unknown> {
  return {
    stem: scene.stem,
    title: scene.frontmatter.title,
    frontmatter: scene.frontmatter,
    body: scene.body,
  };
}

function cardSummary(card: StoryboardCard): Record<string, unknown> {
  return {
    type: card.type,
    id: card.id,
    name: card.name,
    aliases: card.aliases ?? [],
    role: card.type === 'character' ? card.role : undefined,
  };
}

function splitText(value: string, maximumSize: number): string[] {
  const chunks: string[] = [];
  for (let start: number = 0; start < value.length; start += maximumSize) {
    chunks.push(value.slice(start, start + maximumSize));
  }
  return chunks;
}
