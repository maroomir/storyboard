import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { buildGenerateOptions, withAttribution } from '#engine/pipeline/sceneGenerationStages';
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import { quotedDialoguePatternFor } from '#engine/pipeline/sectionValidation';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { GenerateTextOptions } from '@storyboard/story-ai';
import {
  computeDraftBodyHash,
  unknownDialogueSpeaker,
  type CharacterRef,
  type SceneDialogueRecord,
} from '@storyboard/story-model';

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
    run.dialogueRecord = await this.buildDialogueRecord(
      run,
      withAttribution(buildGenerateOptions(run.providers, 'sceneDialogueAttribution'), {
        primary: run.sceneRef,
      }),
    );
  }

  private async buildDialogueRecord(
    run: SceneGenerationRun,
    options: GenerateTextOptions,
  ): Promise<SceneDialogueRecord | undefined> {
    const sceneStem: string | undefined = run.input.sceneStem;

    if (!sceneStem) {
      return undefined;
    }

    const lines: string[] = extractDialogueLines(run.draftBody, run.tuning);
    const candidates: CharacterRef[] = run.context.characters.map(
      (character): CharacterRef => ({
        id: character.id,
        name: character.name,
      }),
    );

    if (lines.length === 0) {
      return undefined;
    }

    run.onProgress?.('attributeDialogue', 1, 1);

    let speakers: readonly { readonly index: number; readonly speaker: string }[] = [];
    if (candidates.length > 0) {
      try {
        speakers = await run.aiService.attributeSceneDialogue(
          { skeleton: run.draftBody, lines, candidates },
          options,
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
      bodyHash: computeDraftBodyHash(run.draftBody),
      turns: lines.map((text, offset) => ({
        index: offset + 1,
        speaker: speakerByIndex.get(offset + 1) ?? unknownDialogueSpeaker,
        text,
      })),
    };
  }
}
