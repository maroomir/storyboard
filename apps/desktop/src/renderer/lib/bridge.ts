import type { DesktopBridge } from '@/shared/ipcContract';

declare global {
  interface Window {
    readonly storyboard: DesktopBridge;
  }
}

// The one way the page talks to main. Tests replace `window.storyboard` with a fake.
export function desktopBridge(): DesktopBridge {
  return window.storyboard;
}
