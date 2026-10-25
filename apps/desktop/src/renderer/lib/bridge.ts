import type { DesktopBridge } from '@/shared/ipcContract';

declare global {
  interface Window {
    readonly storyboard: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge {
  return window.storyboard;
}
