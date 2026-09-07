import { describe, expect, it } from 'vitest';

import { createRuntimeManifest } from '../../../scripts/runtimeManifest.mjs';
import sourceManifest from '../package.json';
import { bundleExternals } from '../scripts/bundleExternals.mjs';

describe('release runtime manifest', () => {
  const manifest = createRuntimeManifest(sourceManifest, bundleExternals);

  it('declares exactly the bundle externals as dependencies', () => {
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...bundleExternals].sort());
  });

  it('carries no workspace package', () => {
    expect(Object.keys(manifest.dependencies).some((name) => name.startsWith('@storyboard/'))).toBe(false);
  });

  it('keeps the entry points and identity the installer links against', () => {
    expect(manifest.name).toBe(sourceManifest.name);
    expect(manifest.version).toBe(sourceManifest.version);
    expect(manifest.bin).toEqual({ 'storyboard-bot': 'dist/index.js' });
    expect(manifest.engines).toEqual(sourceManifest.engines);
    expect(manifest).not.toHaveProperty('devDependencies');
    expect(manifest).not.toHaveProperty('scripts');
  });

  it('refuses an external the source manifest does not declare', () => {
    expect(() => createRuntimeManifest(sourceManifest, ['left-pad'])).toThrow(/left-pad/);
  });
});
