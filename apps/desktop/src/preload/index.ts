import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { desktopEventNames, ipcEventChannelName, ipcInvokeChannelName } from '@/shared/ipcChannelNames';
import type { DesktopBridge, DesktopEventName } from '@/shared/ipcContract';

// SECURITY: the page gets exactly two functions and no Electron or Node object. Main validates
// every invoke against the channel's schema, so the bridge forwards without trusting the page.
const bridge: DesktopBridge = {
  invoke: (channel, request) => ipcRenderer.invoke(ipcInvokeChannelName, { channel, request }),
  on: (event, listener) => {
    if (!desktopEventNames.includes(event as DesktopEventName)) {
      return () => undefined;
    }

    const channel = ipcEventChannelName(event);
    const forward = (_event: IpcRendererEvent, payload: unknown): void => listener(payload as never);
    ipcRenderer.on(channel, forward);
    return () => ipcRenderer.removeListener(channel, forward);
  },
};

contextBridge.exposeInMainWorld('storyboard', bridge);
