import * as vscode from "vscode"

import { type StoryboardLogger } from "../core/logger"
import { refreshStoryboardWorkspaceContext } from "../core/storyboardWorkspaceContext"
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from "../core/pathConventions"
import { ensureUriDoesNotExist, getTargetWorkspaceFolder, uriExists } from "../core/workspace"
import { createDefaultProjectJson, writeProjectJson } from "../files/projectJson"

const initCommand = "storyboard.init"
const storyboardGitignoreBlock = `
# Storyboard generated files
.storyboard/cache/
draft/
character/.sample.card
background/.sample.card
scene/.sample.txt
`

export interface RegisterInitCommandDependencies {
  readonly logger: StoryboardLogger
}

export function registerInitCommand(dependencies: RegisterInitCommandDependencies): vscode.Disposable {
  return vscode.commands.registerCommand(initCommand, () => initializeStoryboardProject(dependencies))
}

async function initializeStoryboardProject(
  dependencies: RegisterInitCommandDependencies
): Promise<void> {
  const workspaceFolder = await getTargetWorkspaceFolder()

  if (!workspaceFolder) {
    return
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri)

  try {
    if (!(await validateCanInitialize(paths))) {
      return
    }

    const project = createDefaultProjectJson({ name: workspaceFolder.name })

    await createStoryboardDirectories(paths)
    await writeProjectJson(paths.projectJson, project)
    await writeFileIfMissing(paths.sampleCharacterCard, createSampleCharacterCard())
    await writeFileIfMissing(paths.sampleBackgroundCard, createSampleBackgroundCard())
    await writeFileIfMissing(paths.sampleScene, createSampleScene())
    await ensureWorkspaceGitignore(paths.gitignore)
    await writeFileIfMissing(paths.readme, createWorkspaceReadme(project.name))

    dependencies.logger.info(`Initialized Storyboard project at ${workspaceFolder.uri.fsPath}`)
    await refreshStoryboardWorkspaceContext()
    await vscode.window.showInformationMessage(`Storyboard 프로젝트를 초기화했습니다: ${project.name}`)
  } catch (error) {
    dependencies.logger.error("Failed to initialize Storyboard project", error)
    dependencies.logger.show()
    await vscode.window.showErrorMessage("Storyboard 프로젝트 초기화에 실패했습니다. Output 패널을 확인해 주세요.")
  }
}

async function validateCanInitialize(paths: StoryboardProjectPaths): Promise<boolean> {
  if (await uriExists(paths.projectJson)) {
    await vscode.window.showInformationMessage("이미 Storyboard 프로젝트로 초기화된 폴더입니다.")
    return false
  }

  return ensureUriDoesNotExist(
    paths.metadataDirectory,
    "`.storyboard` 폴더가 이미 있지만 `project.json`은 없습니다. 안전을 위해 초기화를 중단합니다."
  )
}

export async function createStoryboardDirectories(paths: StoryboardProjectPaths): Promise<void> {
  await Promise.all([
    vscode.workspace.fs.createDirectory(paths.sceneCacheDirectory),
    vscode.workspace.fs.createDirectory(paths.characterProfileDirectory),
    vscode.workspace.fs.createDirectory(paths.backgroundDirectory),
    vscode.workspace.fs.createDirectory(paths.sceneDirectory),
    vscode.workspace.fs.createDirectory(paths.draftDirectory)
  ])
}

async function writeFileIfMissing(uri: vscode.Uri, content: string): Promise<void> {
  if (await uriExists(uri)) {
    return
  }

  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content))
}

export async function ensureWorkspaceGitignore(gitignoreUri: vscode.Uri): Promise<void> {
  if (!(await uriExists(gitignoreUri))) {
    await vscode.workspace.fs.writeFile(gitignoreUri, new TextEncoder().encode(storyboardGitignoreBlock.trimStart()))
    return
  }

  const currentGitignore = new TextDecoder().decode(await vscode.workspace.fs.readFile(gitignoreUri))

  if (currentGitignore.includes("# Storyboard generated files")) {
    return
  }

  const separator = currentGitignore.endsWith("\n") ? "" : "\n"
  const nextGitignore = `${currentGitignore}${separator}${storyboardGitignoreBlock}`
  await vscode.workspace.fs.writeFile(gitignoreUri, new TextEncoder().encode(nextGitignore))
}

function createSampleCharacterCard(): string {
  return `type: character
id: sample
name: 샘플 캐릭터
profile: profile/sample.png
role: main
attributes: {}
tags:
  - 샘플
traits: []
description: |
  Storyboard 프로젝트를 시작하기 위한 샘플 캐릭터입니다.
relations: []
arc: []
recentDialogues: []
`
}

function createSampleBackgroundCard(): string {
  return `type: location
id: sample
name: 샘플 배경
locationKind: place
characterIds: []
tags:
  - 샘플
description: |
  Storyboard 프로젝트를 시작하기 위한 샘플 배경입니다.
`
}

function createSampleScene(): string {
  return `# 샘플 씬

Storyboard 프로젝트를 시작하기 위한 샘플 텍스트입니다.
실제 작업에 반영할 씬은 \`storyboard.scene.create\` 명령으로 생성해 주세요.
`
}

export function createWorkspaceReadme(projectName: string): string {
  return `# ${projectName}

Storyboard 프로젝트 노트입니다.

## 구조

- \`.storyboard/project.json\`: 프로젝트 메타데이터
- \`character/\`: 캐릭터 카드
- \`background/\`: 배경 카드
- \`scene/\`: 사용자가 작성하는 씬 시드
- \`draft/\`: AI가 생성하는 원고 산출물
`
}