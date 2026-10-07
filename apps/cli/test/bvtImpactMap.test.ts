import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error -- the BVT scripts are plain JavaScript and ship no types.
import { formatImpactPlan, planImpact } from '../../../scripts/bvt/impactMap.mjs';

interface ImpactArea {
  readonly id: string;
  readonly paths: readonly string[];
  readonly checks: readonly string[];
}

interface ImpactMap {
  readonly ignore: readonly string[];
  readonly areas: readonly ImpactArea[];
}

interface ImpactPlan {
  readonly areas: readonly { id: string; files: string[]; checks: readonly string[] }[];
  readonly checks: readonly { run: string; areas: string[] }[];
  readonly ignored: readonly string[];
  readonly unmapped: readonly string[];
}

const repoRoot = join(__dirname, '..', '..', '..');
const impactMap = JSON.parse(readFileSync(join(repoRoot, 'bvt/impactMap.json'), 'utf8')) as ImpactMap;

function plan(files: readonly string[]): ImpactPlan {
  return planImpact(files, impactMap) as ImpactPlan;
}

describe('impact map', () => {
  // The guard against rot: every file in the repository belongs to a row, so a change anywhere
  // pulls in some check. A new folder must be given a row before it can ship.
  it('claims every tracked file', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter((file) => file.length > 0);

    expect(plan(tracked).unmapped).toEqual([]);
  });

  // A target is a vitest filter: a file, a folder, or the prefix of several files (`test/sim`).
  function isTestTarget(target: string): boolean {
    return existsSync(target) || (existsSync(dirname(target)) && readdirSync(dirname(target)).some((name) => name.startsWith(basename(target))));
  }

  it('refers only to test files, folders and prefixes that exist', () => {
    const testPaths = impactMap.areas
      .flatMap((area) => area.checks)
      .filter((run) => run.includes('-- test/'))
      .flatMap((run) => {
        const workspace = /--workspace (\S+)/.exec(run)?.[1];
        const folder = workspace === 'storyboard-vscode' ? 'apps/vscode' : workspace === '@storyboard/cli' ? 'apps/cli' : 'apps/desktop';
        return run.split(' -- ')[1]!.split(' ').map((target) => join(repoRoot, folder, target));
      });

    const missing = testPaths.filter((target) => !isTestTarget(target));
    expect(missing).toEqual([]);
  });

  it('gives a file to the first matching area and merges shared checks', () => {
    const result = plan([
      'packages/story-engine/src/application/novel/novelStages.ts',
      'packages/story-engine/src/application/drafts/generateDraftUseCase.ts',
      'packages/story-engine/src/index.ts',
      'README.md',
    ]);

    expect(result.areas.map((area) => area.id)).toEqual(['engine-novel', 'engine-application', 'engine-package']);
    expect(result.ignored).toEqual(['README.md']);
    expect(result.unmapped).toEqual([]);

    const vscodeRuns = result.checks.filter((check) => check.run.startsWith('npm run test --workspace storyboard-vscode'));
    expect(vscodeRuns).toHaveLength(1);
    expect(vscodeRuns[0]!.run).toContain('test/unit/core');
    expect(vscodeRuns[0]!.run).toContain('test/unit/infrastructure');
    expect(vscodeRuns[0]!.areas).toEqual(['engine-novel', 'engine-application', 'engine-package']);
  });

  it('lets a whole-workspace test run subsume the filtered ones', () => {
    const result = plan(['apps/cli/src/index.ts', 'packages/story-config/src/home.ts']);
    const cliRuns = result.checks.filter((check) => check.run.startsWith('npm run test --workspace @storyboard/cli'));

    expect(cliRuns).toEqual([{ run: 'npm run test --workspace @storyboard/cli', areas: ['config', 'cli'] }]);
  });

  it('reports a file no row claims', () => {
    const result = plan(['tools/newThing/index.ts']);

    expect(result.unmapped).toEqual(['tools/newThing/index.ts']);
    expect(formatImpactPlan('v1..HEAD', 1, result)).toContain('!! unmapped: tools/newThing/index.ts');
  });
});
