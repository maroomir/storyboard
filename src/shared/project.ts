export const storyboardProjectVersion = "1.0.0"

export const projectFormats = ["novel", "screenplay", "play", "essay", "poem"] as const

export type ProjectFormat = (typeof projectFormats)[number]

export const pointOfViews = ["first", "third-limited", "third-omniscient"] as const

export type PointOfView = (typeof pointOfViews)[number]

export const contractFieldKeys = ["genre", "audience", "pov", "targetWordCount"] as const

export type ContractFieldKey = (typeof contractFieldKeys)[number]

export interface ProjectEditor {
  readonly scenePrefixDigits: number
  readonly trackDraft?: boolean
}

export interface ProjectSetting {
  readonly genre?: string
  readonly country?: string
  readonly concept?: string
  readonly tags: string[]
  readonly description?: string
  readonly audience?: string
  readonly targetWordCount?: number
  readonly pov?: PointOfView
  readonly prohibitions: string[]
  readonly styleConstraints: string[]
  readonly qualityCriteria: string[]
}

export interface StoryboardProject {
  readonly version: typeof storyboardProjectVersion
  readonly id: string
  readonly name: string
  readonly format: ProjectFormat
  readonly language: string
  readonly createdAt: string
  readonly editor: ProjectEditor
  readonly setting?: ProjectSetting
}