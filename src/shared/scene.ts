import { z } from "zod"

export const sceneFileNamePattern = /^(\d+)-([a-z0-9][a-z0-9-]*)\.txt$/
export const sceneStemPattern = /^(\d+)-([a-z0-9][a-z0-9-]*)$/

export const sceneFrontmatterSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    characters: z.array(z.string().trim().min(1)).optional(),
    location: z.string().trim().min(1).optional(),
    mood: z.string().trim().min(1).optional()
  })
  .passthrough()

export interface SceneFileNameParts {
  readonly stem: string
  readonly order: number
  readonly orderText: string
  readonly slug: string
}

export type SceneFrontmatter = z.infer<typeof sceneFrontmatterSchema>

export interface SceneFile {
  readonly stem: string
  readonly order: number
  readonly orderText: string
  readonly slug: string
  readonly frontmatter: SceneFrontmatter
  readonly body: string
}

export function parseSceneFileName(fileName: string): SceneFileNameParts | undefined {
  const match = sceneFileNamePattern.exec(fileName)

  if (!match) {
    return undefined
  }

  const orderText = match[1]
  const slug = match[2]

  if (!orderText || !slug) {
    return undefined
  }

  return {
    stem: `${orderText}-${slug}`,
    order: Number.parseInt(orderText, 10),
    orderText,
    slug
  }
}

export function parseSceneStem(stem: string): SceneFileNameParts | undefined {
  const match = sceneStemPattern.exec(stem)

  if (!match) {
    return undefined
  }

  const orderText = match[1]
  const slug = match[2]

  if (!orderText || !slug) {
    return undefined
  }

  return {
    stem,
    order: Number.parseInt(orderText, 10),
    orderText,
    slug
  }
}