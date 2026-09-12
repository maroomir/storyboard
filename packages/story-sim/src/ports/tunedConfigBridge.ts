import { ConfigBridge } from '@storyboard/story-ai';
import type { ConfigBridgeDependencies, SceneGenerationTuningLike } from '@storyboard/story-ai';

// 설정 → 모델 프로필 → 파이프라인 기본값 층 위에 스윕 지점을 한 겹 더 얹는다. 엔진은 하니스가
// 있다는 사실을 알 필요가 없고, 손잡이는 원래 살던 설정 계층에 그대로 머문다.
export class TunedConfigBridge extends ConfigBridge {
  public constructor(
    dependencies: ConfigBridgeDependencies,
    private readonly overrides: SceneGenerationTuningLike,
    private readonly sectionOutputLimitOverride?: number,
  ) {
    super(dependencies);
  }

  public override getSceneGenerationTuning(): SceneGenerationTuningLike {
    return { ...super.getSceneGenerationTuning(), ...this.overrides };
  }

  public override getSectionOutputLimit(): number {
    return this.sectionOutputLimitOverride ?? super.getSectionOutputLimit();
  }
}
