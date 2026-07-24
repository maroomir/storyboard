import type { ProjectFormat } from './project';

export interface Draft {
  readonly sceneStem: string;
  readonly format: ProjectFormat;
  readonly generatedAt: string;
  readonly body: string;
}
