import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { characterCardPath, getStoryboardProjectPaths } from "../core/pathConventions"
import {
  applyCardCandidateItems,
  cardCandidateItemKey,
  collectCardCandidateItems,
  pruneRecordByPromotedKeys,
  selectNewCardCandidateItems,
  type CardCandidateItem
} from "../core/cardCandidatePromotion"
import { getTargetWorkspaceFolder, hasStoryboardProject } from "../core/workspace"
import { readCardFile, writeCardFile } from "../files/card"
import { readCardCandidateFile, writeCardCandidateFile } from "../files/cardCandidates"
import type { CharacterCard } from "../shared/card"
import type { CardCandidateRecord } from "../shared/cardCandidates"

const promoteCommand = "storyboard.cards.promoteCandidates"

const vscodeFs = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

interface CandidateQuickPickItem extends vscode.QuickPickItem {
  readonly item: CardCandidateItem
}

async function readAllCandidateRecords(cardCacheDirectory: vscode.Uri): Promise<CardCandidateRecord[]> {
  let entries: [string, vscode.FileType][]

  try {
    entries = await vscode.workspace.fs.readDirectory(cardCacheDirectory)
  } catch {
    return []
  }

  const records: CardCandidateRecord[] = []

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith(".json")) {
      continue
    }

    try {
      records.push(await readCardCandidateFile(vscode.Uri.joinPath(cardCacheDirectory, name), vscodeFs))
    } catch {
      // skip unreadable candidate files
    }
  }

  return records
}

async function loadCardsById(
  workspaceRoot: vscode.Uri,
  cardIds: ReadonlySet<string>
): Promise<Map<string, CharacterCard>> {
  const cardsById = new Map<string, CharacterCard>()

  for (const cardId of cardIds) {
    try {
      const card = await readCardFile(characterCardPath(workspaceRoot, cardId), vscodeFs)
      if (card.type === "character") {
        cardsById.set(cardId, card)
      }
    } catch {
      // card missing or unreadable — leave it out so its candidates stay selectable
    }
  }

  return cardsById
}

function describeItem(item: CardCandidateItem): string {
  switch (item.kind) {
    case "attribute":
      return `${item.cardId} — 속성 ${item.key}: ${item.value}`
    case "relation":
      return `${item.cardId} — 관계 ${item.target}: ${item.type}`
    case "arc":
      return `${item.cardId} — 아크 ${item.sceneRef}: ${item.summary}`
  }
}

async function applyPickedItems(
  workspaceRoot: vscode.Uri,
  picked: readonly CardCandidateItem[],
  logger: StoryboardLogger
): Promise<number> {
  const itemsByCardId = new Map<string, CardCandidateItem[]>()
  for (const item of picked) {
    const group = itemsByCardId.get(item.cardId) ?? []
    group.push(item)
    itemsByCardId.set(item.cardId, group)
  }

  let updatedCardCount = 0

  for (const [cardId, items] of itemsByCardId) {
    const cardUri = characterCardPath(workspaceRoot, cardId)

    try {
      const current = await readCardFile(cardUri, vscodeFs)
      if (current.type !== "character") {
        continue
      }

      await writeCardFile(cardUri, vscodeFs, applyCardCandidateItems(current, items))
      updatedCardCount += 1
    } catch (error) {
      logger.error(`Failed to promote candidates for card ${cardId}`, error)
    }
  }

  return updatedCardCount
}

function countRecordCandidates(record: CardCandidateRecord): number {
  return record.characters.reduce(
    (total, character) => total + character.attributes.length + character.relations.length + character.arc.length,
    0
  )
}

async function pruneCandidateFiles(
  cardCacheDirectory: vscode.Uri,
  promotedKeys: ReadonlySet<string>,
  logger: StoryboardLogger
): Promise<void> {
  let entries: [string, vscode.FileType][]

  try {
    entries = await vscode.workspace.fs.readDirectory(cardCacheDirectory)
  } catch {
    return
  }

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith(".json")) {
      continue
    }

    const fileUri = vscode.Uri.joinPath(cardCacheDirectory, name)

    try {
      const record = await readCardCandidateFile(fileUri, vscodeFs)
      const pruned = pruneRecordByPromotedKeys(record, promotedKeys)

      if (countRecordCandidates(pruned) === countRecordCandidates(record)) {
        continue
      }

      if (pruned.characters.length === 0) {
        await vscode.workspace.fs.delete(fileUri)
      } else {
        await writeCardCandidateFile(fileUri, vscodeFs, pruned)
      }
    } catch (error) {
      logger.error(`Failed to prune promoted candidates in ${name}`, error)
    }
  }
}

async function runPromote(logger: StoryboardLogger): Promise<void> {
  const folder = await getTargetWorkspaceFolder()

  if (!folder) {
    await vscode.window.showErrorMessage("Storyboard 워크스페이스 폴더를 찾을 수 없습니다.")
    return
  }

  if (!(await hasStoryboardProject(folder))) {
    await vscode.window.showErrorMessage("Storyboard 프로젝트가 없습니다. 먼저 초기화해 주세요.")
    return
  }

  const paths = getStoryboardProjectPaths(folder.uri)
  const items = collectCardCandidateItems(await readAllCandidateRecords(paths.cardCacheDirectory))

  if (items.length === 0) {
    await vscode.window.showInformationMessage("승격할 카드 후보가 없습니다. 먼저 초안을 생성해 주세요.")
    return
  }

  const cardIds = new Set(items.map((item) => item.cardId))
  const cardsById = await loadCardsById(folder.uri, cardIds)
  const promotable = selectNewCardCandidateItems(items, cardsById)

  if (promotable.length === 0) {
    await vscode.window.showInformationMessage("새로 승격할 후보가 없습니다. 이미 모두 카드에 반영되어 있습니다.")
    return
  }

  const quickPickItems: CandidateQuickPickItem[] = promotable.map((item) => ({
    label: describeItem(item),
    description: `후보 · ${item.sceneStem}`,
    item
  }))

  const picked = await vscode.window.showQuickPick(quickPickItems, {
    canPickMany: true,
    title: "카드에 반영할 후보 선택",
    placeHolder: "캐릭터 카드에 추가할 관계·아크·속성을 선택하세요."
  })

  if (!picked || picked.length === 0) {
    return
  }

  const updatedCardCount = await applyPickedItems(
    folder.uri,
    picked.map((entry) => entry.item),
    logger
  )

  if (updatedCardCount === 0) {
    logger.show()
    await vscode.window.showErrorMessage("카드 저장에 실패했습니다. Output 패널을 확인해 주세요.")
    return
  }

  const promotedKeys = new Set(picked.map((entry) => cardCandidateItemKey(entry.item)))
  await pruneCandidateFiles(paths.cardCacheDirectory, promotedKeys, logger)

  await vscode.window.showInformationMessage(`후보 ${picked.length}개를 카드 ${updatedCardCount}개에 반영했습니다.`)
}

export function registerPromoteCardCandidatesCommand(dependencies: {
  readonly logger: StoryboardLogger
}): vscode.Disposable {
  return vscode.commands.registerCommand(promoteCommand, () => runPromote(dependencies.logger))
}
