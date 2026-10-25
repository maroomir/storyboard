import type { DesktopEventName } from './ipcContract';

export const ipcInvokeChannelName: string = 'storyboard:invoke';

export const desktopEventNames: readonly DesktopEventName[] = [
  'run.changed',
  'workspace.changed',
  'app.updateReady',
];

export function ipcEventChannelName(event: DesktopEventName): string {
  return `storyboard:event:${event}`;
}
