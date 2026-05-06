import * as vscode from "vscode"

export interface StoryboardProjectPaths {
  readonly workspaceRoot: vscode.Uri
  readonly metadataDirectory: vscode.Uri
  readonly projectJson: vscode.Uri
  readonly cacheDirectory: vscode.Uri
  readonly usageLedger: vscode.Uri
  readonly personaCacheDirectory: vscode.Uri
  readonly sceneCacheDirectory: vscode.Uri
  readonly characterDirectory: vscode.Uri
  readonly characterProfileDirectory: vscode.Uri
  readonly sampleCharacterCard: vscode.Uri
  readonly backgroundDirectory: vscode.Uri
  readonly backgroundConceptDirectory: vscode.Uri
  readonly sampleBackgroundCard: vscode.Uri
  readonly sceneDirectory: vscode.Uri
  readonly sampleScene: vscode.Uri
  readonly draftDirectory: vscode.Uri
  readonly gitignore: vscode.Uri
  readonly readme: vscode.Uri
}

export function getStoryboardProjectPaths(workspaceRoot: vscode.Uri): StoryboardProjectPaths {
  const metadataDirectory = vscode.Uri.joinPath(workspaceRoot, ".storyboard")
  const cacheDirectory = vscode.Uri.joinPath(metadataDirectory, "cache")
  const characterDirectory = vscode.Uri.joinPath(workspaceRoot, "character")
  const backgroundDirectory = vscode.Uri.joinPath(workspaceRoot, "background")
  const sceneDirectory = vscode.Uri.joinPath(workspaceRoot, "scene")

  return {
    workspaceRoot,
    metadataDirectory,
    projectJson: vscode.Uri.joinPath(metadataDirectory, "project.json"),
    cacheDirectory,
    usageLedger: vscode.Uri.joinPath(cacheDirectory, "usage.json"),
    personaCacheDirectory: vscode.Uri.joinPath(cacheDirectory, "personas"),
    sceneCacheDirectory: vscode.Uri.joinPath(cacheDirectory, "scenes"),
    characterDirectory,
    characterProfileDirectory: vscode.Uri.joinPath(characterDirectory, "profile"),
    sampleCharacterCard: vscode.Uri.joinPath(characterDirectory, ".sample.card"),
    backgroundDirectory,
    backgroundConceptDirectory: vscode.Uri.joinPath(backgroundDirectory, "concept"),
    sampleBackgroundCard: vscode.Uri.joinPath(backgroundDirectory, ".sample.card"),
    sceneDirectory,
    sampleScene: vscode.Uri.joinPath(sceneDirectory, ".sample.txt"),
    draftDirectory: vscode.Uri.joinPath(workspaceRoot, "draft"),
    gitignore: vscode.Uri.joinPath(workspaceRoot, ".gitignore"),
    readme: vscode.Uri.joinPath(workspaceRoot, "README.md")
  }
}

export function isIgnoredSampleCardFileName(fileName: string): boolean {
  return fileName === ".sample.card"
}

export function isHiddenSceneFileName(fileName: string): boolean {
  return fileName.startsWith(".") && fileName.endsWith(".txt")
}

export function characterCardPath(workspaceRoot: vscode.Uri, id: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot, "character", `${id}.card`)
}

export function characterProfilePath(workspaceRoot: vscode.Uri, id: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot, "character", "profile", `${id}.png`)
}

export function backgroundCardPath(workspaceRoot: vscode.Uri, id: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot, "background", `${id}.card`)
}

export function backgroundConceptPath(workspaceRoot: vscode.Uri, id: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot, "background", "concept", `${id}.png`)
}

export function sceneFilePath(workspaceRoot: vscode.Uri, prefix: string, slug: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot, "scene", `${prefix}-${slug}.txt`)
}

export function draftPath(workspaceRoot: vscode.Uri, sceneStem: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot, "draft", `${sceneStem}.md`)
}

export function parseCardIdFromPath(uri: vscode.Uri): string | undefined {
  const fileName = uri.path.split("/").at(-1)

  if (!fileName?.endsWith(".card")) {
    return undefined
  }

  return fileName.slice(0, -".card".length)
}