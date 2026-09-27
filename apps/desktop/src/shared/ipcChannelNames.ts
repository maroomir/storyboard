import type { DesktopEventName } from './ipcContract';

// The preload bundle reads only this file, so it must stay free of values from anything heavier.
export const ipcInvokeChannelName = 'storyboard:invoke';

export const desktopEventNames: readonly DesktopEventName[] = [
  'run.changed',
  'workspace.changed',
  'app.updateReady',
];

export function ipcEventChannelName(event: DesktopEventName): string {
  return `storyboard:event:${event}`;
}
