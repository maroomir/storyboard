import { spawn, type ChildProcess } from 'node:child_process';

export function openBrowser(url: string): Promise<boolean> {
  const [command, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];

  return new Promise((resolve) => {
    const child: ChildProcess = spawn(command, args, { detached: true, stdio: 'ignore' });

    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}
