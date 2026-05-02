export const storyboardProjectVersion = "1.0.0"

export const projectFormats = ["novel", "screenplay", "play", "essay", "poem"] as const

export type ProjectFormat = (typeof projectFormats)[number]

export interface StoryboardProjectSettings {
  readonly scenePrefixDigits: number
  readonly trackDraft: boolean
}

export interface StoryboardProject {
  readonly version: typeof storyboardProjectVersion
  readonly id: string
  readonly name: string
  readonly format: ProjectFormat
  readonly language: string
  readonly createdAt: string
  readonly settings: StoryboardProjectSettings
}