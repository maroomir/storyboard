import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

import { aliasesFromTsconfig } from '../../scripts/aliases.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// SECURITY: the packaged page may load only its own bundle and fonts and may reach nothing on the
// network; main does every call. The dev server injects inline scripts for hot reload, so the policy
// is added to the built page only.
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicyTag(): Plugin {
  return {
    name: 'storyboard-content-security-policy',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`),
  };
}

export default defineConfig({
  root: path.join(packageRoot, 'src/renderer'),
  // The packaged app loads the page from disk, so every asset path must be relative.
  base: './',
  plugins: [react(), contentSecurityPolicyTag()],
  resolve: {
    alias: aliasesFromTsconfig(path.join(packageRoot, 'src/renderer/tsconfig.json')),
  },
  build: {
    outDir: path.join(packageRoot, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: { port: 5178, strictPort: true },
});
