export const storyboardProjectVersion = "1.0.0"

export const projectFormats = ["novel", "screenplay", "play", "essay", "poem"] as const

export type ProjectFormat = (typeof projectFormats)[number]

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