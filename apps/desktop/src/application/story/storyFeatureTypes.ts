import type * as vscode from 'vscode';

import type { StoryboardCard } from '@/shared/card';
import type { SceneFile } from '@/shared/scene';
import type { StoryboardProject } from '@/shared/project';

export interface StoryFileSnapshot {
  readonly uri: vscode.Uri;
  readonly sha256: string;
  readonly kind?: 'file' | 'directory';
}

export interface StoryFeatureSource {
  readonly workspaceRoot: vscode.Uri;
  readonly project: StoryboardProject;
  readonly scenes: readonly SceneFile[];
  readonly cards: readonly StoryboardCard[];
  readonly canonText: string;
  readonly snapshots: readonly StoryFileSnapshot[];
}

export interface IStoryFeatureRepository {
  load(workspaceRoot: vscode.Uri): Promise<StoryFeatureSource>;
  hasCurrentSnapshots(snapshots: readonly StoryFileSnapshot[]): Promise<boolean>;
}

export class StoryFeatureSourceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StoryFeatureSourceError';
  }
}
