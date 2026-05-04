import * as vscode from "vscode"

import { parseCard } from "../files/card"
import type { RelationListCharacter } from "../shared/messaging"

export async function loadRelationListCharacters(workspaceRoot: vscode.Uri): Promise<RelationListCharacter[]> {
  const pattern = new vscode.RelativePattern(workspaceRoot, "character/*.card")
  const uris = await vscode.workspace.findFiles(pattern, undefined)
  const results: RelationListCharacter[] = []

  for (const uri of uris) {
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
      // Skip unreadable or invalid cards so the graph stays usable.
    }
  }

  return results.sort((left, right) => left.name.localeCompare(right.name, "ko"))
}
