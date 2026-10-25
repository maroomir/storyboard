import type { DesktopEvents } from '@/shared/ipcContract';

export type WorkspaceChange = DesktopEvents['workspace.changed'] & { readonly sequence: number };
