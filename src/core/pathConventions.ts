import * as vscode from "vscode"

export interface StoryboardProjectPaths {
  readonly workspaceRoot: vscode.Uri
  readonly metadataDirectory: vscode.Uri
  readonly projectJson: vscode.Uri
  readonly cacheDirectory: vscode.Uri
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
    personaCacheDirectory: vscode.Uri.joinPath(cacheDirectory, "personas"),
    sceneCacheDirectory: vscode.Uri.joinPath(cacheDirectory, "scenes"),
    characterDirectory,
    characterProfileDirectory: vscode.Uri.joinPath(characterDirectory, "profile"),
    sampleCharacterCard: vscode.Uri.joinPath(characterDirectory, "sample.card"),
    backgroundDirectory,
    backgroundConceptDirectory: vscode.Uri.joinPath(backgroundDirectory, "concept"),
    sampleBackgroundCard: vscode.Uri.joinPath(backgroundDirectory, "sample.card"),
    sceneDirectory,
    sampleScene: vscode.Uri.joinPath(sceneDirectory, "01-prologue.txt"),
    draftDirectory: vscode.Uri.joinPath(workspaceRoot, "draft"),
    gitignore: vscode.Uri.joinPath(workspaceRoot, ".gitignore"),
    readme: vscode.Uri.joinPath(workspaceRoot, "README.md")
  }
}