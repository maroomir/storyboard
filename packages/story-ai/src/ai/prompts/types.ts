import type { CacheTtl, ReasoningEffort } from '@storyboard/story-model';

export type PromptVariantId = 'generic' | 'xs' | 'rich';

// NOTE: 한 씬 안에서 되풀이되는 재료(뼈대·본문)는 `userPrefix`로, 호출마다 바뀌는 것(이번 인물·이번
// 구간·재시도 사유)은 `user`로 간다. 접두 캐시는 바이트 단위 일치라 바뀌는 조각이 앞에 있으면 그 뒤가
// 모두 무효다(#107). 접두가 없는 프롬프트는 종전처럼 user 하나다.
export interface PromptArtifact {
  readonly system: string;
  readonly userPrefix?: string;
  readonly prefixCacheTtl?: CacheTtl;
  readonly user: string;
}

export interface PromptConfig {
  readonly temperature: number;
  readonly maxTokens: number;
  readonly reasoningEffort?: ReasoningEffort;
  // 접두(`## prefix`)의 캐시 수명. 뼈대처럼 열 번 넘게 읽히는 접두에만 1h 를 적는다.
  readonly prefixCacheTtl?: CacheTtl;
}
