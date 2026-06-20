import * as vscode from "vscode"

import { getStoryboardProjectPaths, isDraftMarkdownFile } from "../core/pathConventions"
import { hasStoryboardProject } from "../core/workspace"
import { readCardFile } from "../files/card"
import type { CharacterCard } from "../shared/card"
import { detectCharactersInText } from "../utils/characterDetector"

const wordPattern = /[0-9A-Za-z가-힣_-]+/

const vscodeFsAdapter = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

interface CharacterHoverContext {
  readonly character: CharacterCard
  readonly relatedCharacterNames: readonly string[]
}

export function buildCharacterHoverMarkdown(context: CharacterHoverContext): vscode.MarkdownString {
  const { character, relatedCharacterNames } = context
  const lines: string[] = [`### ${character.name}`]

  if (character.profile && character.profile.trim().length > 0) {
    lines.push("", character.profile.trim())
  }

  if (character.description && character.description.trim().length > 0) {
    lines.push("", `- 설명: ${character.description.trim()}`)
  }

  if (character.traits && character.traits.length > 0) {
    lines.push("", "- 특성", ...character.traits.slice(0, 5).map((trait) => `  - ${trait}`))
  }

  if (character.recentDialogues && character.recentDialogues.length > 0) {
    lines.push("", "- 최근 대사", ...character.recentDialogues.slice(-3).map((line) => `  - ${line}`))
  }

  if (relatedCharacterNames.length > 0) {
    lines.push("", `- 관계: ${relatedCharacterNames.join(", ")}`)
  }

  const MarkdownCtor = (vscode as unknown as { MarkdownString?: typeof vscode.MarkdownString }).MarkdownString
  const markdown = MarkdownCtor
    ? new MarkdownCtor(lines.join("\n"))
    : ({
        value: lines.join("\n")
      } as vscode.MarkdownString)
  markdown.isTrusted = false
  markdown.supportHtml = false
  return markdown
}

export async function listCharacterCardsInWorkspace(workspaceFolder: vscode.WorkspaceFolder): Promise<CharacterCard[]> {
  const paths = getStoryboardProjectPaths(workspaceFolder.uri)
  const entries = await vscode.workspace.fs.readDirectory(paths.characterDirectory)
  const cardNames = entries
    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".card") && name !== ".sample.card")
    .map(([name]) => name)

  const cards = await Promise.all(
    cardNames.map(async (name) => {
      const uri = vscode.Uri.joinPath(paths.characterDirectory, name)
      try {
        const parsed = await readCardFile(uri, vscodeFsAdapter)
        return parsed.type === "character" ? parsed : undefined
      } catch {
        return undefined
      }
    })
  )

  return cards.filter((card): card is CharacterCard => card !== undefined)
}

export class CharacterHoverProvider implements vscode.HoverProvider {
  public async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    if (document.uri.scheme !== "file") {
      return undefined
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
      return undefined
    }

    if (!isDraftMarkdownFile(document.uri, workspaceFolder)) {
      return undefined
    }

    const wordRange = document.getWordRangeAtPosition(position, wordPattern)
    if (!wordRange) {
      return undefined
    }

    const hoveredWord = document.getText(wordRange).trim()
    if (hoveredWord.length === 0) {
      return undefined
    }

    const characters = await listCharacterCardsInWorkspace(workspaceFolder)
    if (characters.length === 0) {
      return undefined
    }

    const matchedNames = detectCharactersInText(hoveredWord, characters.map((character) => character.name))
    const matched = matchedNames.length > 0
      ? characters.find((character) => character.name === matchedNames[0])
      : undefined
    if (!matched) {
      return undefined
    }

    const byId = new Map(characters.map((character) => [character.id, character.name] as const))
    const relatedNames = (matched.relations ?? [])
      .map((relation) => byId.get(relation.target))
      .filter((name): name is string => typeof name === "string")

    return new vscode.Hover(buildCharacterHoverMarkdown({ character: matched, relatedCharacterNames: relatedNames }), wordRange)
  }
}

export function registerCharacterHoverProvider(): vscode.Disposable {
  const selector: vscode.DocumentSelector = { scheme: "file", pattern: "**/draft/*.md" }
  return vscode.languages.registerHoverProvider(selector, new CharacterHoverProvider())
}
