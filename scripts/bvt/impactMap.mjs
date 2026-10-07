import { matchesAnyGlob } from './glob.mjs';

// Turns a list of changed files into the checks to run: a file belongs to the first area whose
// paths match it, every area touched contributes its checks, and a file no row claims is reported
// so the table cannot silently rot as folders are added.

export function planImpact(changedFiles, impactMap) {
  const ignored = [];
  const unmapped = [];
  const filesByArea = new Map();

  for (const file of changedFiles) {
    if (matchesAnyGlob(impactMap.ignore, file)) {
      ignored.push(file);
      continue;
    }

    const area = impactMap.areas.find((candidate) => matchesAnyGlob(candidate.paths, file));
    if (area === undefined) {
      unmapped.push(file);
      continue;
    }

    const files = filesByArea.get(area.id) ?? [];
    files.push(file);
    filesByArea.set(area.id, files);
  }

  const areas = impactMap.areas
    .filter((area) => filesByArea.has(area.id))
    .map((area) => ({ id: area.id, files: filesByArea.get(area.id), checks: area.checks }));

  const checks = [];
  for (const area of areas) {
    for (const run of area.checks) {
      const existing = checks.find((check) => check.run === run);
      if (existing === undefined) {
        checks.push({ run, areas: [area.id] });
      } else {
        existing.areas.push(area.id);
      }
    }
  }

  return { areas, checks: mergeTestRuns(checks), ignored, unmapped };
}

const testRunPattern = /^npm run test --workspace (\S+)(?: -- (.+))?$/;

// Several areas naming test files of the same workspace become one vitest start with the union of
// their filters; an area that runs the whole workspace subsumes the rest.
function mergeTestRuns(checks) {
  const merged = [];
  const byWorkspace = new Map();

  for (const check of checks) {
    const match = testRunPattern.exec(check.run);
    if (match === null) {
      merged.push(check);
      continue;
    }

    const [, workspace, filters] = match;
    const entry = byWorkspace.get(workspace) ?? { workspace, filters: new Set(), isWhole: false, areas: [] };
    if (filters === undefined) {
      entry.isWhole = true;
    } else {
      for (const filter of filters.split(' ')) {
        entry.filters.add(filter);
      }
    }
    entry.areas.push(...check.areas.filter((id) => !entry.areas.includes(id)));
    byWorkspace.set(workspace, entry);
  }

  for (const entry of byWorkspace.values()) {
    const run = entry.isWhole
      ? `npm run test --workspace ${entry.workspace}`
      : `npm run test --workspace ${entry.workspace} -- ${[...entry.filters].join(' ')}`;
    merged.push({ run, areas: entry.areas });
  }

  return merged;
}

export function formatImpactPlan(range, changedCount, plan) {
  const lines = [`Impact ${range} (${changedCount} files → ${plan.areas.length} areas, ${plan.checks.length} checks)`];

  for (const area of plan.areas) {
    lines.push(`  ${area.id.padEnd(22)} ${area.files.length} file${area.files.length === 1 ? '' : 's'}`);
  }
  if (plan.ignored.length > 0) {
    lines.push(`  ${'(ignored)'.padEnd(22)} ${plan.ignored.length} files`);
  }
  for (const file of plan.unmapped) {
    lines.push(`  !! unmapped: ${file}`);
  }

  return lines.join('\n');
}
