import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getImportPath,
  parseSourceFile,
  refuseEngineConstruction,
  // @ts-expect-error -- the architecture scripts are plain JavaScript and ship no types.
} from '../../../scripts/architecture/runner.mjs';

type ImportRule = (
  filePath: string,
  importPath: string,
  statement: unknown,
  report: (message: string) => void,
) => void;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'storyboard-arch-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function reportsFor(source: string, rule: ImportRule): string[] {
  const filePath: string = join(directory, 'module.ts');
  writeFileSync(filePath, source);
  const reports: string[] = [];

  for (const statement of parseSourceFile(filePath).statements) {
    const importPath: string | undefined = getImportPath(statement);

    if (importPath !== undefined) {
      rule(filePath, importPath, statement, (message: string) => reports.push(message));
    }
  }

  return reports;
}

describe('refuseEngineConstruction', () => {
  it('refuses an app that constructs an engine class', () => {
    const reports: string[] = reportsFor(
      "import { ProjectRepository } from '@storyboard/story-engine';\nnew ProjectRepository(fs);\n",
      refuseEngineConstruction('CLI'),
    );

    expect(reports).toEqual([
      "CLI constructs the engine's ProjectRepository; call a manager verb instead",
    ]);
  });

  it('lets an engine import through when it is only a type or a function', () => {
    const reports: string[] = reportsFor(
      [
        "import { describeReviseOutcome, type ProjectRepository } from '@storyboard/story-engine';",
        "import type { WorkspaceInitializer } from '@storyboard/story-engine';",
        'describeReviseOutcome(result);',
        '',
      ].join('\n'),
      refuseEngineConstruction('CLI'),
    );

    expect(reports).toEqual([]);
  });

  it('allows the host-side classes an app lists', () => {
    const reports: string[] = reportsFor(
      "import { UsageLedgerRecorder } from '@storyboard/story-engine';\nnew UsageLedgerRecorder(fs);\n",
      refuseEngineConstruction('Desktop', ['UsageLedgerRecorder']),
    );

    expect(reports).toEqual([]);
  });
});
