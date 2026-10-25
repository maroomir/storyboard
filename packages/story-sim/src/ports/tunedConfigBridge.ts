import { ConfigBridge } from '@storyboard/story-ai';
import type { ConfigBridgeDependencies } from '@storyboard/story-ai';
import type { GenerationKnobs } from '@storyboard/story-model';

export class TunedConfigBridge extends ConfigBridge {
  public constructor(
    dependencies: ConfigBridgeDependencies,
    private readonly overrides: GenerationKnobs,
    private readonly sectionOutputLimitOverride?: number,
  ) {
    super(dependencies);
  }

  public override getSceneGenerationTuning(): GenerationKnobs {
    return { ...super.getSceneGenerationTuning(), ...this.overrides };
  }

  public override getSectionOutputLimit(): number {
    return this.sectionOutputLimitOverride ?? super.getSectionOutputLimit();
  }
}
