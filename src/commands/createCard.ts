import * as vscode from "vscode"

import {
  backgroundCardPath,
  backgroundConceptPath,
  characterCardPath,
  characterProfilePath
} from "../core/pathConventions"
import { getTargetWorkspaceFolder, uriExists } from "../core/workspace"
import { createEmptyBackground } from "../domain/Background"
import { createEmptyCharacter } from "../domain/Character"
import { serializeCard } from "../files/card"
import { cardIdPattern, type StoryboardCard } from "../shared/card"

const createCharacterCommand = "storyboard.character.create"
const createBackgroundCommand = "storyboard.background.create"
const cardEditorViewType = "storyboard.card"
const transparentPngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
  0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
  0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
])

export function registerCreateCardCommands(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(createCharacterCommand, () => createCard("character")),
    vscode.commands.registerCommand(createBackgroundCommand, () => createCard("background"))
  )
}

async function createCard(cardType: StoryboardCard["type"]): Promise<void> {
  const workspaceFolder = await getTargetWorkspaceFolder()

  if (!workspaceFolder) {
    return
  }

  const name = await vscode.window.showInputBox({
    title: cardType === "character" ? "새 캐릭터 이름" : "새 배경 이름",
    prompt: "카드에 표시할 이름을 입력하세요.",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length === 0 ? "이름을 입력해 주세요." : undefined)
  })

  if (!name) {
    return
  }

  const id = await vscode.window.showInputBox({
    title: cardType === "character" ? "새 캐릭터 ID" : "새 배경 ID",
    prompt: "파일명과 참조에 사용할 ID를 입력하세요. 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.",
    value: suggestCardId(name),
    ignoreFocusOut: true,
    validateInput: validateCardId
  })

  if (!id) {
    return
  }

  const card = createEmptyCard(cardType, id, name)
  const cardUri = getCardUri(workspaceFolder.uri, card)

  if (await uriExists(cardUri)) {
    await vscode.window.showWarningMessage(`이미 존재하는 카드입니다: ${id}`)
    return
  }

  await vscode.workspace.fs.writeFile(cardUri, new TextEncoder().encode(serializeCard(card)))
  await writePlaceholderImageIfMissing(workspaceFolder.uri, card)
  await vscode.commands.executeCommand("vscode.openWith", cardUri, cardEditorViewType)
}

function createEmptyCard(cardType: StoryboardCard["type"], id: string, name: string): StoryboardCard {
  if (cardType === "character") {
    return createEmptyCharacter(id, name)
  }

  return createEmptyBackground(id, name)
}

function getCardUri(workspaceRoot: vscode.Uri, card: StoryboardCard): vscode.Uri {
  if (card.type === "character") {
    return characterCardPath(workspaceRoot, card.id)
  }

  return backgroundCardPath(workspaceRoot, card.id)
}

async function writePlaceholderImageIfMissing(
  workspaceRoot: vscode.Uri,
  card: StoryboardCard
): Promise<void> {
  const imageUri =
    card.type === "character"
      ? characterProfilePath(workspaceRoot, card.id)
      : backgroundConceptPath(workspaceRoot, card.id)

  if (await uriExists(imageUri)) {
    return
  }

  await vscode.workspace.fs.writeFile(imageUri, transparentPngBytes)
}

function validateCardId(value: string): string | undefined {
  const id = value.trim()

  if (id.length === 0) {
    return "ID를 입력해 주세요."
  }

  if (!cardIdPattern.test(id)) {
    return "ID는 영문 소문자, 숫자, 하이픈만 사용할 수 있고 숫자/문자로 시작해야 합니다."
  }

  return undefined
}

function suggestCardId(name: string): string {
  const normalizedName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalizedName.length > 0 ? normalizedName : "new-card"
}
