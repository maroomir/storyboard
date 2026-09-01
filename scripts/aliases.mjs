import fs from 'node:fs';
import path from 'node:path';

// One source of truth for module aliases: a project's own tsconfig. esbuild, Vite and Vitest all
// take the same table from here, so `paths` can never drift from what the bundlers actually do.
//
// NOTE: package-internal aliases are NOT here. Those are Node subpath imports (`#engine/*`) declared
// in each package's own package.json, which resolve per package and so cannot collide with an app's
// `@/`. Adding them to a bundler's global alias table is what would reintroduce that collision.

function readJsonc(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const withoutComments = text
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, comment) =>
      comment ? '' : match,
    )
    .replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(withoutComments);
}

function resolvePaths(tsconfigPath, seen = new Set()) {
  const absolute = path.resolve(tsconfigPath);

  if (seen.has(absolute)) {
    throw new Error(`Circular tsconfig extends chain at ${absolute}`);
  }
  seen.add(absolute);

  const config = readJsonc(absolute);
  const directory = path.dirname(absolute);
  const options = config.compilerOptions ?? {};

  // A child's `paths` replaces the parent's wholesale, exactly as TypeScript resolves it.
  if (options.paths) {
    return { directory, baseUrl: options.baseUrl ?? '.', paths: options.paths };
  }

  if (config.extends) {
    return resolvePaths(path.resolve(directory, config.extends), seen);
  }

  return { directory, baseUrl: options.baseUrl ?? '.', paths: {} };
}

/**
 * Build a bundler alias table from a project's tsconfig `paths`.
 *
 * Only non-wildcard entries and `prefix/*` entries are supported, which is everything this
 * repository uses. A `prefix/*` entry becomes a bare `prefix` alias pointing at the mapped
 * directory, which is the shape esbuild and Vite both expect.
 */
export function aliasesFromTsconfig(tsconfigPath) {
  const { directory, baseUrl, paths } = resolvePaths(tsconfigPath);
  const root = path.resolve(directory, baseUrl);
  const aliases = {};

  for (const [pattern, targets] of Object.entries(paths)) {
    const target = targets[0];

    if (!target) {
      continue;
    }

    if (pattern.endsWith('/*')) {
      aliases[pattern.slice(0, -2)] = path.resolve(root, target.slice(0, -2));
      continue;
    }

    aliases[pattern] = path.resolve(root, target);
  }

  return aliases;
}
