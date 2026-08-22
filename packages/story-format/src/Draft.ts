import type { ProjectFormat } from './project';

export interface Draft {
  readonly sceneStem: string;
  readonly format: ProjectFormat;
  readonly generatedAt: string;
  readonly generator?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly body: string;
}
