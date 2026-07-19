import yaml from 'js-yaml';
import { z } from 'zod';

import type { AiGateway } from '@/application/ai/aiGateway';
import type { StoryboardCard } from '@/shared/card';
import { sceneFileNamePattern, type SceneFile } from '@/shared/scene';
import { parseJsonObject } from '@/shared/aiResponseParser';
import type { IStoryFeatureRepository, StoryFileSnapshot } from './storyFeatureTypes';
import { StoryFeatureSourceError } from './storyFeatureTypes';

const MAX_COMPLETE_SCENES = 20;
const FULL_SCENE_CONTEXT_LIMIT = 120_000;
const SUMMARY_CHUNK_SIZE = 40_000;

const completionResponseSchema = z.object({
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

export class CompleteStoryScenesUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly repository: IStoryFeatureRepository,
  ) {}

  public async execute(workspaceRoot: import('vscode').Uri): Promise<CompleteStoryScenesProposal> {
    const source = await this.repository.load(workspaceRoot);

    if (source.scenes.length === 0) {
      throw new StoryFeatureSourceError('완결할 유효한 씬이 없습니다.');
    }

    const sceneContext = await this.buildSceneContext(workspaceRoot, source.scenes);
    const response = await this.aiGateway.createService(workspaceRoot).generateText(
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
    const parsed = completionResponseSchema.parse(parseJsonObject(response.text));
    const existingCharacterIds = new Set(
      source.cards.filter((card) => card.type === 'character').map((card) => card.id),
    );
    const existingBackgroundIds = new Set(
      source.cards.filter((card) => card.type !== 'character').map((card) => card.id),
    );
    const existingSlugs = new Set(source.scenes.map((scene) => scene.slug));
    const proposedSlugs = new Set<string>();
    const maximumOrder = Math.max(...source.scenes.map((scene) => scene.order));

    const scenes = parsed.scenes.map((candidate, index): CompletedStoryScene => {
      if (existingSlugs.has(candidate.slug) || proposedSlugs.has(candidate.slug)) {
        throw new StoryFeatureSourceError(`중복된 씬 slug: ${candidate.slug}`);
      }
      proposedSlugs.add(candidate.slug);
      for (const id of candidate.characterIds) {
        if (!existingCharacterIds.has(id)) {
          throw new StoryFeatureSourceError(`존재하지 않는 캐릭터 ID: ${id}`);
        }
      }
      if (candidate.locationId && !existingBackgroundIds.has(candidate.locationId)) {
        throw new StoryFeatureSourceError(`존재하지 않는 배경 ID: ${candidate.locationId}`);
      }

      const prefix = String(maximumOrder + index + 1).padStart(
        source.project.editor.scenePrefixDigits,
        '0',
      );
      const fileName = `${prefix}-${candidate.slug}.txt`;
      if (!sceneFileNamePattern.test(fileName)) {
        throw new StoryFeatureSourceError(`생성할 수 없는 씬 파일명: ${fileName}`);
      }
      const frontmatter = {
        title: candidate.title,
        ...(candidate.characterIds.length > 0 ? { characters: candidate.characterIds } : {}),
        ...(candidate.locationId ? { location: candidate.locationId } : {}),
        ...(candidate.mood ? { mood: candidate.mood } : {}),
        ...(candidate.relationStage ? { relationStage: candidate.relationStage } : {}),
      };

      return {
        fileName,
        content: `---\n${yaml.dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${candidate.body.trim()}\n`,
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
    return await this.repository.hasCurrentSnapshots(snapshots);
  }

  private async buildSceneContext(
    workspaceRoot: import('vscode').Uri,
    scenes: readonly SceneFile[],
  ): Promise<unknown> {
    const fullScenes = scenes.map(sceneSummary);
    const serialized = JSON.stringify(fullScenes);

    if (serialized.length <= FULL_SCENE_CONTEXT_LIMIT) {
      return fullScenes;
    }

    const tail = fullScenes.slice(-5);
    const previousText = JSON.stringify(fullScenes.slice(0, -5));
    const chunks = splitText(previousText, SUMMARY_CHUNK_SIZE);
    const aiService = this.aiGateway.createService(workspaceRoot);
    const summaries = await Promise.all(
      chunks.map(async (chunk) => {
        const response = await aiService.generateText(
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
  for (let start = 0; start < value.length; start += maximumSize) {
    chunks.push(value.slice(start, start + maximumSize));
  }
  return chunks;
}
