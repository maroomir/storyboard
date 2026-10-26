import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { buildGenerateOptions, withAttribution } from '#engine/pipeline/sceneGenerationStages';
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import type {
  RunSceneGenerationPipelineInput,
  SceneGenerationPipelineAiService,
} from '#engine/pipeline/sceneGenerationTypes';
import { quotedDialoguePatternFor } from '#engine/pipeline/sceneSectionPlan';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { GenerateTextOptions } from '@storyboard/story-ai';
import {
  computeDraftBodyHash,
  unknownDialogueSpeaker,
  type CharacterCard,
  type CharacterRef,
  type SceneDialogueRecord,
} from '@storyboard/story-model';

export async function buildDialogueRecord(input: {
  readonly aiService: SceneGenerationPipelineAiService;
  readonly draftBody: string;
  readonly characters: readonly CharacterCard[];
  readonly sceneStem: string | undefined;
  readonly options: GenerateTextOptions;
  readonly onProgress: RunSceneGenerationPipelineInput['onProgress'];
  readonly tuning: ResolvedSceneGenerationTuning;
}): Promise<SceneDialogueRecord | undefined> {
  const { sceneStem } = input;

  if (!sceneStem) {
    return undefined;
  }

  const lines: string[] = extractDialogueLines(input.draftBody, input.tuning);
  const candidates: CharacterRef[] = input.characters.map(
    (character): CharacterRef => ({
      id: character.id,
      name: character.name,
    }),
  );

  if (lines.length === 0) {
    return undefined;
  }

  input.onProgress?.('attributeDialogue', 1, 1);

  let speakers: readonly { readonly index: number; readonly speaker: string }[] = [];
  if (candidates.length > 0) {
    try {
      speakers = await input.aiService.attributeSceneDialogue(
        { skeleton: input.draftBody, lines, candidates },
        input.options,
      );
    } catch {
      speakers = [];
    }
  }

  const speakerByIndex: Map<number, string> = new Map(
    speakers.map((entry) => [entry.index, entry.speaker]),
  );
  return {
    sceneStem,
    bodyHash: computeDraftBodyHash(input.draftBody),
    turns: lines.map((text, offset) => ({
      index: offset + 1,
      speaker: speakerByIndex.get(offset + 1) ?? unknownDialogueSpeaker,
      text,
    })),
  };
}

export function extractDialogueLines(
  text: string,
  tuning: ResolvedSceneGenerationTuning,
): string[] {
  return [...text.matchAll(quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength))].map(
    (match) => (match[1] ?? '').trim(),
  );
}

export class AttributeDialogueStage implements ISceneStage {
  public readonly id: SceneStageId = 'attributeDialogue';

  public async run(run: SceneGenerationRun): Promise<void> {
    run.dialogueRecord = await buildDialogueRecord({
      aiService: run.aiService,
      draftBody: run.draftBody,
      characters: run.context.characters,
      sceneStem: run.input.sceneStem,
      options: withAttribution(buildGenerateOptions(run.providers, 'sceneDialogueAttribution'), {
        primary: run.sceneRef,
      }),
      onProgress: run.onProgress,
      tuning: run.tuning,
    });
  }
}
