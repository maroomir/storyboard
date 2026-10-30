import type { AiServices, HostAdapters } from '#engine/application/engineServices';
import {
  formatBibleFactLines,
  getStoryboardProjectPaths,
  readSceneFile,
  sceneContextPaths,
  scenePath,
  type NarrativeContext,
  type ProjectFormat,
  type SceneContext,
  type SceneContextWorkspacePaths,
  type SceneFile,
  type StoryUri,
} from '@storyboard/story-model';
import { formatAugmentCards } from '@storyboard/story-ai';
import { SceneContextReader } from '#engine/persistence/sceneContextReader';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import {
  resolveMinimumDraftLength,
  validateDraftCandidate,
  type DraftCandidateLengthPolicy,
  type DraftCandidateRejectionReason,
  type DraftCandidateValidation,
} from '#engine/pipeline/draftCandidateValidation';

export interface CondenseDraftRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly format: ProjectFormat;
  readonly body: string;
}

export type CondenseDraftResult =
  | { readonly kind: 'condensed'; readonly ok: true; readonly text: string }
  | {
      readonly kind: 'review-required';
      readonly ok: true;
      readonly text: string;
      readonly candidateLength: number;
      readonly minimumLength: number;
    }
  | {
      readonly kind: 'rejected';
      readonly ok: false;
      readonly reason: DraftCandidateRejectionReason;
      readonly candidateLength: number;
      readonly minimumLength: number;
    }
  | { readonly kind: 'failed'; readonly ok: false; readonly message: string };

interface CondenseSceneContext {
  readonly intent?: string;
  readonly facts?: readonly string[];
  readonly characterCards?: readonly string[];
}

const condenseWithoutContextWhenTheSceneCannotBeRead: CondenseSceneContext = {};

export class CondenseDraftUseCase implements IUseCase<CondenseDraftRequest, CondenseDraftResult> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
  ) {}

  public async execute(request: CondenseDraftRequest): Promise<CondenseDraftResult> {
    const lengthPolicy: DraftCandidateLengthPolicy = {
      maxCompressionPercent: this.host.configBridge.getMaxCompressionPercent(),
    };
    const minimumLength: number = resolveMinimumDraftLength(request.body.length, lengthPolicy);

    return await runUseCase<CondenseDraftResult>(
      this.host.logger,
      'Condense draft failed',
      async () => {
        const context: CondenseSceneContext = await this.loadSceneContext(
          request.workspaceRoot,
          request.sceneStem,
        );
        const text: string = await this.ai.gateway
          .createService(request.workspaceRoot)
          .condenseDraft(
            {
              body: request.body,
              format: request.format,
              targetLength: minimumLength,
              intent: context.intent,
              facts: context.facts,
              characterCards: context.characterCards,
            },
            {
              providerId: this.ai.gateway.getTaskProvider('draftRevision'),
              attribution: { primary: { kind: 'scene', id: request.sceneStem } },
            },
          );
        const validation: DraftCandidateValidation = validateDraftCandidate(
          request.body,
          text,
          lengthPolicy,
          {
            requireShorter: true,
          },
        );

        if (!validation.accepted) {
          if (validation.reason === 'too-short') {
            return {
              kind: 'review-required',
              ok: true,
              text,
              candidateLength: validation.candidateLength,
              minimumLength: validation.minimumLength,
            };
          }

          return {
            kind: 'rejected',
            ok: false,
            reason: validation.reason ?? 'empty',
            candidateLength: validation.candidateLength,
            minimumLength: validation.minimumLength,
          };
        }

        return { kind: 'condensed', ok: true, text };
      },
    );
  }

  private async loadSceneContext(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<CondenseSceneContext> {
    const { fileSystem } = this.host;

    try {
      const scene: SceneFile = await readSceneFile(
        scenePath(workspaceRoot, sceneStem),
        fileSystem,
        `${sceneStem}.card`,
      );
      const contextPaths: SceneContextWorkspacePaths = sceneContextPaths(
        getStoryboardProjectPaths(workspaceRoot),
      );
      const context: SceneContext = await new SceneContextReader(fileSystem).build(
        contextPaths,
        scene,
      );
      const narrative: NarrativeContext = await new SceneContextReader(fileSystem).buildNarrative(
        contextPaths,
        context,
      );

      return {
        intent: scene.body,
        facts: formatBibleFactLines(context, narrative.bibleFacts),
        characterCards: formatAugmentCards(context.characters, undefined),
      };
    } catch {
      return condenseWithoutContextWhenTheSceneCannotBeRead;
    }
  }
}
