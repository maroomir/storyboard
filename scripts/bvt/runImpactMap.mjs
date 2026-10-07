import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { describeRange, listChangedFiles, repoRoot, resolveBaseRef } from './gitDiff.mjs';
import { formatImpactPlan, planImpact } from './impactMap.mjs';

// Usage: node scripts/bvt/runImpactMap.mjs [<base-ref>] [--plan]
// Runs the checks the changed files pull in from bvt/impactMap.json; `--plan` only prints them.

const args = process.argv.slice(2);
const isPlanOnly = args.includes('--plan');
const baseRef = resolveBaseRef(args.find((arg) => !arg.startsWith('--')));
const impactMap = JSON.parse(fs.readFileSync(path.join(repoRoot, 'bvt/impactMap.json'), 'utf8'));
const changed = listChangedFiles(baseRef);
const plan = planImpact(changed, impactMap);

console.log(formatImpactPlan(describeRange(baseRef), changed.length, plan));

if (plan.unmapped.length > 0) {
  console.error(`\n${plan.unmapped.length} changed file(s) belong to no area in bvt/impactMap.json; add a row.`);
  process.exit(1);
}

if (isPlanOnly) {
  for (const check of plan.checks) {
    console.log(`  $ ${check.run}   [${check.areas.join(', ')}]`);
  }
  process.exit(0);
}

// The gate must answer for the repository, not for this machine: a check never sees the home
// config (an enabled hidden provider there changes what the CLI lists).
const env = { ...process.env, STORYBOARD_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-bvt-home-')) };

const failures = [];
for (const [index, check] of plan.checks.entries()) {
  console.log(`\n[${index + 1}/${plan.checks.length}] ${check.run}   [${check.areas.join(', ')}]`);
  try {
    execSync(check.run, { cwd: repoRoot, env, stdio: 'inherit', shell: '/bin/bash' });
  } catch {
    failures.push(check);
  }
}

console.log(`\n${plan.checks.length - failures.length} passed, ${failures.length} failed`);
for (const check of failures) {
  console.log(`  ✗ ${check.run}`);
}

if (failures.length > 0) {
  process.exit(1);
}
