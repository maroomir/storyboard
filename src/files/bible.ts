import yaml from "js-yaml"
import { ZodError } from "zod"

import { storyBibleSchema, type StoryBible } from "../shared/bible"

export type BibleParseErrorCode = "invalid-yaml" | "invalid-bible-schema"

export interface BibleFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>
}

export class BibleParseError extends Error {
  public constructor(
    public readonly code: BibleParseErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = "BibleParseError"
  }
}

export function parseBible(rawBible: string): StoryBible {
  let parsedYaml: unknown

  try {
    parsedYaml = yaml.load(rawBible)
  } catch (error) {
    throw new BibleParseError("invalid-yaml", "Bible YAML을 파싱할 수 없습니다.", error)
  }

  try {
    return storyBibleSchema.parse(parsedYaml)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BibleParseError("invalid-bible-schema", "Bible 스키마가 올바르지 않습니다.", error)
    }

    throw error
  }
}

export function serializeBible(bible: StoryBible): string {
  const parsedBible = storyBibleSchema.parse(bible)

  return yaml.dump(parsedBible, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  })
}

export async function readBibleFile(uri: unknown, fileSystem: BibleFileSystem): Promise<StoryBible> {
  const bytes = await fileSystem.readFile(uri)
  return parseBible(new TextDecoder().decode(bytes))
}

export async function writeBibleFile(
  uri: unknown,
  fileSystem: BibleFileSystem,
  bible: StoryBible
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeBible(bible)))
}
