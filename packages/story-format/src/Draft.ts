import type { ProjectFormat } from './project';

export interface Draft {
  readonly sceneStem: string;
  readonly format: ProjectFormat;
  readonly generatedAt: string;
  readonly generator?: string;
  readonly providerId?: string;
  readonly model?: string;
  // NOTE: 기계 검증이 잡았지만 재시도로도 못 고친 위반. 로그를 보지 않아도 원고를 열면 보이도록
  // 헤더에 남긴다. 어느 구간에서 무엇이 걸렸는지 적어 그 구간만 다시 돌릴지 판단할 수 있게 한다.
  readonly warnings?: readonly string[];
  readonly body: string;
}
