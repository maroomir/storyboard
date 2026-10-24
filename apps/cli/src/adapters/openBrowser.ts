import { spawn } from 'node:child_process';

// Hands a URL to the system browser without waiting for it. False when the launcher is missing
// (a container, a headless server); the caller shows the URL either way.
export function openBrowser(url: string): Promise<boolean> {
  const [command, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];

  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });

    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}
