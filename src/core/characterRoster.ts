import * as vscode from "vscode"

import { isIgnoredSampleCardFileName } from "./pathConventions"
import { parseCard } from "../files/card"
import { isCharacterRole, type CharacterRole } from "../shared/card"

export interface CharacterRosterEntry {
  readonly id: string
  readonly name: string
  readonly role?: CharacterRole
}

export async function loadCharacterRoster(workspaceRoot: vscode.Uri): Promise<CharacterRosterEntry[]> {
  const pattern = new vscode.RelativePattern(workspaceRoot, "character/*.card")
  const uris = await vscode.workspace.findFiles(pattern, undefined)
  const results: CharacterRosterEntry[] = []

  for (const uri of uris) {
    if (isIgnoredSampleCardFileName(uri.path.split("/").at(-1) ?? "")) {
      continue
    }

    try {
      const card = parseCard(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)))

      if (card.type !== "character") {
        continue
      }

      results.push({
        id: card.id,
        name: card.name,
        ...(card.role !== undefined && isCharacterRole(card.role) ? { role: card.role } : {})
      })
    } catch {
      // NOTE: Unreadable or invalid cards are skipped so the roster stays usable.
    }
  }

  return results.sort((left, right) => left.name.localeCompare(right.name, "ko"))
}
