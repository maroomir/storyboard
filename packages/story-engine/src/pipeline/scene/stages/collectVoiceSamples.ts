import {
  selectRepresentativeDialogue,
  type VoiceSampleBounds,
} from '#engine/pipeline/dialogueCorpus';
import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import type { RunSceneGenerationPipelineInput } from '#engine/pipeline/sceneGenerationTypes';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { CharacterCard, SceneDialogueRecord } from '@storyboard/story-model';

export async function buildVoiceSamples(
  characters: readonly CharacterCard[],
  dialogueCorpus: RunSceneGenerationPipelineInput['dialogueCorpus'],
  sceneStem: string | undefined,
  tuning: ResolvedSceneGenerationTuning,
): Promise<Map<string, readonly string[]>> {
  const voiceSamples: Map<string, readonly string[]> = new Map<string, readonly string[]>();

  if (!dialogueCorpus) {
    return voiceSamples;
  }

  const corpus: readonly SceneDialogueRecord[] = await dialogueCorpus.loadCorpus();
  const seeds: Readonly<Record<string, readonly string[]>> =
    (await dialogueCorpus.loadVoiceSeeds?.())?.characters ?? {};
  const bounds: VoiceSampleBounds = {
    minimumLength: tuning.voiceSampleMinimumLength,
    maximumLength: tuning.voiceSampleMaximumLength,
  };

  for (const character of characters) {
    const fromDrafts: string[] = selectRepresentativeDialogue(
      corpus,
      character.id,
      sceneStem ?? '',
      tuning.voiceSampleLimit,
      bounds,
    );
    const fromNotes: string[] = (seeds[character.id] ?? []).filter(
      (line) =>
        line.length >= bounds.minimumLength &&
        line.length <= bounds.maximumLength &&
        !fromDrafts.includes(line),
    );
    const samples: string[] = [...fromDrafts, ...fromNotes].slice(0, tuning.voiceSampleLimit);
    if (samples.length > 0) {
      voiceSamples.set(character.name, samples);
    }
  }

  return voiceSamples;
}

export class CollectVoiceSamplesStage implements ISceneStage {
  public readonly id: SceneStageId = 'collectVoiceSamples';

  public async run(run: SceneGenerationRun): Promise<void> {
    run.voiceSamples = await buildVoiceSamples(
      run.context.characters,
      run.input.dialogueCorpus,
      run.input.sceneStem,
      run.tuning,
    );
  }
}
