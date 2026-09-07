import fs from 'node:fs';
import path from 'node:path';

// The app manifests list @storyboard/* workspace packages that only exist inside this monorepo. A
// release tarball ships the bundle, which has those inlined, so the manifest it carries must name
// only what the bundle still `require()`s at runtime: the esbuild `external` list. Shipping the
// source manifest instead makes `npm install` in the unpacked directory fail on a registry 404.

export function createRuntimeManifest(sourceManifest, externals) {
  const dependencies = {};

  for (const name of externals) {
    const range = sourceManifest.dependencies?.[name];
    if (!range) {
      throw new Error(`bundle external "${name}" is not declared in dependencies of ${sourceManifest.name}`);
    }
    dependencies[name] = range;
  }

  const { name, version, description, license, engines, main, bin } = sourceManifest;

  return { name, version, description, license, engines, main, bin, dependencies };
}

export function writeRuntimeManifest(packageRoot, externals) {
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const runtimeManifest = createRuntimeManifest(sourceManifest, externals);
  const outFile = path.join(packageRoot, 'dist', 'package.json');

  fs.writeFileSync(outFile, `${JSON.stringify(runtimeManifest, null, 2)}\n`);
  return outFile;
}
