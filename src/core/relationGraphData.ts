import * as vscode from "vscode"

import { isIgnoredSampleCardFileName } from "./pathConventions"
import { parseCard } from "../files/card"
import { isCharacterRole, type CharacterRole } from "../shared/card"
import type { RelationListCharacter } from "../shared/messaging"

export interface CharacterRosterEntry {
  readonly id: string
  readonly name: string
  readonly role?: CharacterRole
}

export async function loadCharacterRoster(workspaceRoot: vscode.Uri): Promise<CharacterRosterEntry[]> {
  const characters = await loadRelationListCharacters(workspaceRoot)

  return characters.map((character) => ({
    id: character.id,
    name: character.name,
    ...(character.role !== undefined && isCharacterRole(character.role) ? { role: character.role } : {})
  }))
}

export async function loadRelationListCharacters(workspaceRoot: vscode.Uri): Promise<RelationListCharacter[]> {
  const pattern = new vscode.RelativePattern(workspaceRoot, "character/*.card")
  const uris = await vscode.workspace.findFiles(pattern, undefined)
  const results: RelationListCharacter[] = []

  for (const uri of uris) {
    if (isIgnoredSampleCardFileName(uri.path.split("/").at(-1) ?? "")) {
      continue
    }

    try {
      const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
      const card = parseCard(raw)

      if (card.type !== "character") {
        continue
      }

      results.push({
        id: card.id,
        name: card.name,
        ...(card.role === undefined ? {} : { role: card.role }),
        uri: uri.toString(),
        relations: (card.relations ?? []).map((relation) => ({
          target: relation.target,
          type: relation.type
        }))
      })
    } catch {
      // NOTE: Unreadable or invalid cards are skipped so the relation list stays usable.
    }
  }

  return results.sort((left, right) => left.name.localeCompare(right.name, "ko"))
}
