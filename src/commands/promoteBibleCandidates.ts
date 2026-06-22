import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { getStoryboardProjectPaths } from "../core/pathConventions"
import { aggregateCandidateFacts, mergeCanonFacts, seedPromotedFact, selectNewCandidates } from "../core/biblePromotion"
import { getTargetWorkspaceFolder, hasStoryboardProject } from "../core/workspace"
import { readBibleFile, writeBibleFile } from "../files/bible"
import { readBibleCandidateFile, type BibleCandidateRecord } from "../files/bibleCandidates"
import { createEmptyBible, type BibleFact, type StoryBible } from "../shared/bible"

const promoteCommand = "storyboard.bible.promoteCandidates"

const vscodeFs = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

interface CandidateQuickPickItem extends vscode.QuickPickItem {
  readonly fact: BibleFact
}

async function readAllCandidateRecords(bibleCacheDirectory: vscode.Uri): Promise<BibleCandidateRecord[]> {
  let entries: [string, vscode.FileType][]

  try {
    entries = await vscode.workspace.fs.readDirectory(bibleCacheDirectory)
  } catch {
    return []
  }

  const records: BibleCandidateRecord[] = []

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith(".json")) {
      continue
    }

    try {
      records.push(await readBibleCandidateFile(vscode.Uri.joinPath(bibleCacheDirectory, name), vscodeFs))
    } catch {
      // skip unreadable candidate files
    }
  }

  return records
}

async function readCanon(canonUri: vscode.Uri): Promise<StoryBible> {
  try {
    return await readBibleFile(canonUri, vscodeFs)
  } catch {
    return createEmptyBible()
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
  const candidates = aggregateCandidateFacts(await readAllCandidateRecords(paths.bibleCacheDirectory))

  if (candidates.length === 0) {
    await vscode.window.showInformationMessage("승격할 설정 후보가 없습니다. 먼저 초안을 생성해 주세요.")
    return
  }

  const canon = await readCanon(paths.bibleCanon)
  const promotable = selectNewCandidates(candidates, canon)

  if (promotable.length === 0) {
    await vscode.window.showInformationMessage("새로 승격할 후보가 없습니다. 이미 모두 canon입니다.")
    return
  }

  const items: CandidateQuickPickItem[] = promotable.map((fact) => ({
    label: `${fact.subject.id} — ${fact.key}: ${fact.value}`,
    description: fact.sourceScene ? `후보 · ${fact.sourceScene}` : "후보",
    fact
  }))

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "스토리 바이블 canon으로 승격할 설정 선택",
    placeHolder: "canon에 추가할 설정 사실을 선택하세요."
  })

  if (!picked || picked.length === 0) {
    return
  }

  const merged = mergeCanonFacts(
    canon,
    picked.map((item) => seedPromotedFact(item.fact))
  )

  try {
    await vscode.workspace.fs.createDirectory(paths.bibleDirectory)
    await writeBibleFile(paths.bibleCanon, vscodeFs, merged)
  } catch (error) {
    logger.error("Failed to write bible canon", error)
    logger.show()
    await vscode.window.showErrorMessage("canon.yaml 저장에 실패했습니다. Output 패널을 확인해 주세요.")
    return
  }

  await vscode.window.showInformationMessage(`설정 ${picked.length}개를 canon으로 승격했습니다.`)
}

export function registerPromoteBibleCandidatesCommand(dependencies: {
  readonly logger: StoryboardLogger
}): vscode.Disposable {
  return vscode.commands.registerCommand(promoteCommand, () => runPromote(dependencies.logger))
}
