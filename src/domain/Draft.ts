import type { ProjectFormat } from "../shared/project"

export interface Draft {
  readonly sceneStem: string
  readonly format: ProjectFormat
  readonly generatedAt: string
  readonly body: string
}