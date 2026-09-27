import type { DesktopEvents } from '@/shared/ipcContract';

// A disk change as the screens see it: numbered, so an effect can react to every one.
export type WorkspaceChange = DesktopEvents['workspace.changed'] & { readonly sequence: number };
