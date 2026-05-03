import yaml from "js-yaml"
import { ZodError, z } from "zod"

import type { Draft } from "../domain/Draft"
import { projectFormats, type ProjectFormat } from "../shared/project"

export type DraftParseErrorCode = "missing-frontmatter" | "invalid-frontmatter-yaml" | "invalid-frontmatter-schema"

export interface DraftFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>
}

export class DraftParseError extends Error {
  public constructor(
    public readonly code: DraftParseErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = "DraftParseError"
  }
}

interface DraftFrontmatter {
  readonly sceneStem: string
  readonly format: ProjectFormat
  readonly generatedAt: string
}

const draftFrontmatterSchema = z.object({
  sceneStem: z.string().trim().min(1),
  format: z.enum(projectFormats),
  generatedAt: z.string().datetime()
})

export function createDraft(input: {
  readonly sceneStem: string
  readonly format: ProjectFormat
  readonly body: string
  readonly generatedAt?: string
}): Draft {
  return {
    sceneStem: input.sceneStem,
    format: input.format,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    body: input.body
  }
}

export function serializeDraft(draft: Draft): string {
  const frontmatter: DraftFrontmatter = {
    sceneStem: draft.sceneStem,
    format: draft.format,
    generatedAt: draft.generatedAt
  }
  const serializedFrontmatter = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  })
  const body = draft.body.endsWith("\n") ? draft.body : `${draft.body}\n`

  return `---\n${serializedFrontmatter}---\n${body}`
}

export function parseDraft(rawDraft: string): Draft {
  const normalizedDraft = rawDraft.replace(/\r\n/g, "\n")

  if (!normalizedDraft.startsWith("---\n")) {
    throw new DraftParseError("missing-frontmatter", "Draft frontmatter가 없습니다.")
  }

  const closingFenceIndex = normalizedDraft.indexOf("\n---", "---\n".length)

  if (closingFenceIndex === -1) {
    throw new DraftParseError("missing-frontmatter", "Draft frontmatter 닫는 구분자를 찾을 수 없습니다.")
  }

  const rawFrontmatter = normalizedDraft.slice("---\n".length, closingFenceIndex)
  const bodyStartIndex = closingFenceIndex + "\n---".length
  const body = normalizedDraft.slice(bodyStartIndex).replace(/^\n/, "")

  return {
    ...parseDraftFrontmatter(rawFrontmatter),
    body
  }
}

export async function writeDraftFile(
  uri: unknown,
  fileSystem: DraftFileSystem,
  draft: Draft
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeDraft(draft)))
}

export async function readDraftFile(uri: unknown, fileSystem: DraftFileSystem): Promise<string> {
  const bytes = await fileSystem.readFile(uri)
  return new TextDecoder().decode(bytes)
}

function parseDraftFrontmatter(rawFrontmatter: string): DraftFrontmatter {
  let parsedYaml: unknown

  try {
    parsedYaml = yaml.load(rawFrontmatter) ?? {}
  } catch (error) {
    throw new DraftParseError("invalid-frontmatter-yaml", "Draft frontmatter YAML을 파싱할 수 없습니다.", error)
  }

  try {
    return draftFrontmatterSchema.parse(parsedYaml)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new DraftParseError("invalid-frontmatter-schema", "Draft frontmatter 스키마가 올바르지 않습니다.", error)
    }

    throw error
  }
}