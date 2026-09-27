import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { RecentWorkspace, UiLanguage } from '@/shared/dto';

const maxRecentWorkspaces = 10;

const desktopStateSchema = z.object({
  version: z.literal(1),
  language: z.enum(['ko', 'en']).optional(),
  recentWorkspaces: z
    .array(z.object({ path: z.string().min(1), title: z.string(), openedAt: z.string() }))
    .default([]),
});

export type DesktopState = z.infer<typeof desktopStateSchema>;

// App-operational state only the desktop needs (the recent list, the chosen language), kept under
// the shared Storyboard home as `desktop.json`. Settings and keys stay in config.json/secrets.json.
export class DesktopStateStore {
  private state: DesktopState;

  public constructor(
    private readonly stateFile: string,
    onDiscardedCorruptFile: (backupFile: string) => void,
  ) {
    this.state = this.load(onDiscardedCorruptFile);
  }

  public get language(): UiLanguage | undefined {
    return this.state.language;
  }

  public get recentWorkspaces(): readonly RecentWorkspace[] {
    return this.state.recentWorkspaces;
  }

  public isRecentWorkspace(path: string): boolean {
    return this.state.recentWorkspaces.some((entry) => entry.path === path);
  }

  public setLanguage(language: UiLanguage): void {
    this.update({ ...this.state, language });
  }

  public rememberWorkspace(path: string, title: string, now: Date = new Date()): void {
    const others = this.state.recentWorkspaces.filter((entry) => entry.path !== path);
    const recentWorkspaces = [{ path, title, openedAt: now.toISOString() }, ...others].slice(
      0,
      maxRecentWorkspaces,
    );

    this.update({ ...this.state, recentWorkspaces });
  }

  public forgetWorkspace(path: string): void {
    this.update({
      ...this.state,
      recentWorkspaces: this.state.recentWorkspaces.filter((entry) => entry.path !== path),
    });
  }

  private update(next: DesktopState): void {
    this.state = next;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, `${JSON.stringify(next, null, 2)}\n`);
  }

  // NOTE: 이 파일은 최근 목록과 언어뿐이라, 깨졌다고 앱을 못 열게 하면 잃는 것보다 막히는 것이 크다.
  // 대신 조용히 버리지 않는다 — 깨진 파일을 옆에 옮겨 두고 호출자에게 알린다.
  private load(onDiscardedCorruptFile: (backupFile: string) => void): DesktopState {
    if (!existsSync(this.stateFile)) {
      return { version: 1, recentWorkspaces: [] };
    }

    try {
      return desktopStateSchema.parse(JSON.parse(readFileSync(this.stateFile, 'utf8')));
    } catch {
      const backupFile = `${this.stateFile}.corrupt-${Date.now().toString(36)}`;
      renameSync(this.stateFile, backupFile);
      onDiscardedCorruptFile(backupFile);
      return { version: 1, recentWorkspaces: [] };
    }
  }
}
