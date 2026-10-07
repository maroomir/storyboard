import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compareGoldenFiles,
  formatGoldenReport,
  hasUnexpectedDifference,
  normalizeGoldenText,
  // @ts-expect-error -- the BVT scripts are plain JavaScript and ship no types.
} from '../../../scripts/bvt/goldenCompare.mjs';

interface GoldenScenario {
  readonly id: string;
  readonly kind: 'fresh' | 'reopen';
  readonly init?: readonly string[];
  readonly from?: string;
  readonly mayRewrite?: readonly string[];
}

interface GoldenEntry {
  readonly path: string;
  readonly verdict: 'identical' | 'changed' | 'added' | 'removed';
}

const repoRoot = join(__dirname, '..', '..', '..');
const goldenRoot = join(repoRoot, 'bvt/golden');
const { scenarios } = JSON.parse(readFileSync(join(goldenRoot, 'scenarios.json'), 'utf8')) as { scenarios: GoldenScenario[] };

function tree(entries: Record<string, string | Buffer>): Map<string, Buffer> {
  return new Map(Object.entries(entries).map(([file, content]) => [file, Buffer.isBuffer(content) ? content : Buffer.from(content)]));
}

describe('golden normalization', () => {
  it('masks what the engine mints per run and nothing else', () => {
    const text = [
      "generatedAt: '2026-10-07T21:21:56.428Z'",
      '33:54.653Z tail of a cut timestamp',
      '"id": "3849c1b9-d48e-4215-8993-d6c95f648608"',
      'bodyHash: sha256:0a492634a2be8de02ffd02c04d7873801a6c8153e16f6be0ba5198a4e2f0c75a',
      'generator: storyboard@0.12.2',
      'kept: 2026-10-07 and 12:34 and hana',
    ].join('\n');

    expect(normalizeGoldenText(text)).toBe(
      [
        "generatedAt: '<timestamp>'",
        '<timestamp> tail of a cut timestamp',
        '"id": "<uuid>"',
        'bodyHash: sha256:<hash>',
        'generator: storyboard@<version>',
        'kept: 2026-10-07 and 12:34 and hana',
      ].join('\n'),
    );
  });

  it('replaces the scratch paths before the patterns', () => {
    expect(normalizeGoldenText('root: /tmp/x/work/scene', [['/tmp/x/work', '<workspace>']])).toBe('root: <workspace>/scene');
  });
});

describe('golden comparison', () => {
  it('gives every path a verdict and ignores volatile fields in text', () => {
    const actual = tree({
      'a.md': "generatedAt: '2026-10-08T00:00:00.000Z'\nbody",
      'b.json': '{"x":1}',
      'c.png': Buffer.from([1, 2, 3]),
      'new.md': 'x',
    });
    const expected = tree({
      'a.md': "generatedAt: '2026-10-07T00:00:00.000Z'\nbody",
      'b.json': '{"x":2}',
      'c.png': Buffer.from([1, 2, 4]),
      'old.md': 'x',
    });

    const entries = compareGoldenFiles(actual, expected) as GoldenEntry[];
    expect(entries.map((entry) => `${entry.path}:${entry.verdict}`)).toEqual([
      'a.md:identical',
      'b.json:changed',
      'c.png:changed',
      'new.md:added',
      'old.md:removed',
    ]);
    expect(hasUnexpectedDifference(entries)).toBe(true);
    expect(hasUnexpectedDifference(entries, ['b.json', 'c.png', 'new.md', 'old.md'])).toBe(false);
    expect(formatGoldenReport('s', entries, ['b.json'])).toContain('~ changed   b.json');
    expect(formatGoldenReport('s', entries, ['b.json'])).toContain('✗ added     new.md');
  });
});

describe('golden scenarios', () => {
  it('each has its snapshot, and a reopen points at a frozen workspace without a cache', () => {
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length);

    for (const scenario of scenarios) {
      expect(existsSync(join(goldenRoot, scenario.id, 'status.json')), scenario.id).toBe(true);
      if (scenario.kind === 'fresh') {
        expect(existsSync(join(goldenRoot, scenario.id, 'workspace/.storyboard/project.json')), scenario.id).toBe(true);
        expect(existsSync(join(goldenRoot, scenario.id, 'manuscript.md')), scenario.id).toBe(true);
      } else {
        expect(scenario.from, scenario.id).toMatch(/^frozen\//);
        expect(existsSync(join(goldenRoot, scenario.from!, 'workspace/.storyboard/project.json')), scenario.id).toBe(true);
        expect(existsSync(join(goldenRoot, scenario.from!, 'workspace/.storyboard/cache')), scenario.id).toBe(false);
      }
    }
  });
});
