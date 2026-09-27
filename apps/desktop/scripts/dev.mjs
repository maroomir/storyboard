import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';
import { createServer } from 'vite';

// `npm run dev`: the page comes from the Vite server with hot reload; main and preload are built
// once (restart the command after changing them).
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: packageRoot, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

await run(process.execPath, ['esbuild.config.mjs']);

const server = await createServer({ configFile: path.join(packageRoot, 'vite.config.ts') });
await server.listen();
const devServerUrl = server.resolvedUrls?.local[0];

const electron = spawn(electronPath, [path.join(packageRoot, 'dist')], {
  stdio: 'inherit',
  env: { ...process.env, STORYBOARD_DESKTOP_DEV_URL: devServerUrl },
});

electron.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
