import { describe, expect, it } from 'vitest';

// @ts-expect-error -- the BVT scripts are plain JavaScript and ship no types.
import { evaluateDiffContracts, formatDiffContractReport } from '../../../scripts/bvt/diffContracts.mjs';
// @ts-expect-error -- the BVT scripts are plain JavaScript and ship no types.
import { matchesGlob } from '../../../scripts/bvt/glob.mjs';

interface FakeRepo {
  readonly changed: readonly string[];
  readonly head?: Record<string, string>;
  readonly base?: Record<string, string>;
}

function statusOf(repo: FakeRepo, ruleId: string): string {
  const results = evaluateDiffContracts({
    changed: repo.changed,
    readHead: (file: string) => repo.head?.[file],
    readBase: (file: string) => repo.base?.[file],
  }) as readonly { id: string; status: string }[];

  return results.find((result) => result.id === ruleId)?.status ?? 'missing';
}

describe('glob matcher', () => {
  it('matches the forms the BVT tables use', () => {
    expect(matchesGlob('apps/*/src/**', 'apps/cli/src/commands/catalog.ts')).toBe(true);
    expect(matchesGlob('apps/*/src/**', 'apps/cli/test/help.test.ts')).toBe(false);
    expect(matchesGlob('**/*.params.json', 'packages/story-sim/src/simDefaults.params.json')).toBe(true);
    expect(matchesGlob('**/*.params.json', 'simDefaults.params.json')).toBe(true);
    expect(matchesGlob('packages/story-ai/src/ai/prompts/resources/*.md', 'packages/story-ai/src/ai/prompts/resources/a.md')).toBe(true);
    expect(matchesGlob('packages/story-ai/src/ai/prompts/resources/*.md', 'packages/story-ai/src/ai/prompts/resources/x/a.md')).toBe(false);
    expect(matchesGlob('CHANGELOG{,.en}.md', 'CHANGELOG.en.md')).toBe(true);
    expect(matchesGlob('CHANGELOG{,.en}.md', 'CHANGELOG.md')).toBe(true);
    expect(matchesGlob('a.b', 'aXb')).toBe(false);
  });
});

describe('diff contracts', () => {
  it('skips every rule on a range that touches nothing it watches', () => {
    const results = evaluateDiffContracts({
      changed: ['README.md'],
      readHead: () => '{"version":"1.0.0"}',
      readBase: () => '{"version":"1.0.0"}',
    }) as readonly { status: string }[];

    expect(results.every((result) => result.status === 'skipped')).toBe(true);
  });

  it('requires both changelogs once any source file changed', () => {
    const source = 'packages/story-engine/src/application/novel/novelStages.ts';
    expect(statusOf({ changed: [source, 'CHANGELOG.md'] }, 'changelog-both')).toBe('failed');
    expect(statusOf({ changed: [source, 'CHANGELOG.md', 'CHANGELOG.en.md'] }, 'changelog-both')).toBe('passed');
    expect(statusOf({ changed: ['apps/vscode/webview-ui/src/App.tsx', 'CHANGELOG.md'] }, 'changelog-both')).toBe('failed');
    expect(statusOf({ changed: ['apps/cli/test/help.test.ts'] }, 'changelog-both')).toBe('skipped');
  });

  it('requires the generated prompt module next to a prompt resource edit', () => {
    const resource = 'packages/story-ai/src/ai/prompts/resources/sceneDraft.md';
    expect(statusOf({ changed: [resource] }, 'prompt-generated')).toBe('failed');
    expect(
      statusOf({ changed: [resource, 'packages/story-ai/src/ai/prompts/resources.generated.ts'] }, 'prompt-generated'),
    ).toBe('passed');
  });

  it('requires a sibling schema and a coding-standards row for a params file', () => {
    const params = 'packages/story-sim/src/simDefaults.params.json';
    const schema = 'packages/story-sim/src/simDefaults.ts';
    const table = `| \`${params}\` | story-sim | knobs |`;

    expect(statusOf({ changed: [params], head: { [schema]: 'export {}', '.claude/rules/coding-standards.md': table } }, 'params-owner')).toBe('passed');
    expect(statusOf({ changed: [params], head: { '.claude/rules/coding-standards.md': table } }, 'params-owner')).toBe('failed');
    expect(statusOf({ changed: [params], head: { [schema]: 'export {}', '.claude/rules/coding-standards.md': '' } }, 'params-owner')).toBe('failed');
  });

  it('requires a settings test beside a config schema or setting catalog change', () => {
    const schema = 'packages/story-config/src/configSchema.ts';
    expect(statusOf({ changed: [schema] }, 'config-schema-test')).toBe('failed');
    expect(statusOf({ changed: [schema, 'apps/cli/test/configuration.test.ts'] }, 'config-schema-test')).toBe('passed');
    expect(
      statusOf(
        { changed: ['packages/story-model/src/contracts/settingCatalog.ts', 'apps/vscode/test/unit/infrastructure/settings/settings.spec.ts'] },
        'config-schema-test',
      ),
    ).toBe('passed');
  });

  it('requires the English strings beside the Korean ones', () => {
    expect(statusOf({ changed: ['apps/desktop/src/shared/i18n/ko.ts'] }, 'desktop-i18n')).toBe('failed');
    expect(statusOf({ changed: ['apps/desktop/src/shared/i18n/ko.ts', 'apps/desktop/src/shared/i18n/en.ts'] }, 'desktop-i18n')).toBe('passed');
    expect(statusOf({ changed: ['apps/desktop/src/shared/i18n/en.ts'] }, 'desktop-i18n')).toBe('skipped');
  });

  it('requires the Cursor mirror beside a Claude rule change', () => {
    expect(statusOf({ changed: ['.claude/rules/cli.md'] }, 'rules-mirror')).toBe('failed');
    expect(statusOf({ changed: ['.claude/rules/cli.md', '.cursor/rules/cli.mdc'] }, 'rules-mirror')).toBe('passed');
  });

  it('requires a changelog section for a new root version', () => {
    const base = { 'package.json': '{"version":"0.12.2"}' };
    const head = (changelog: string) => ({
      'package.json': '{"version":"0.12.3"}',
      'CHANGELOG.md': changelog,
      'CHANGELOG.en.md': changelog,
    });

    expect(statusOf({ changed: ['package.json'], base, head: head('## [0.12.2] - 2026-10-07') }, 'version-changelog')).toBe('failed');
    expect(statusOf({ changed: ['package.json'], base, head: head('## [0.12.3] - 2026-10-08') }, 'version-changelog')).toBe('passed');
    expect(statusOf({ changed: [], base, head: { 'package.json': '{"version":"0.12.2"}' } }, 'version-changelog')).toBe('skipped');
  });

  it('prints one line per rule and a tally', () => {
    const report = formatDiffContractReport('v1..HEAD', 2, [
      { id: 'a', title: 'A', status: 'passed' },
      { id: 'b', title: 'B', status: 'failed', detail: 'why' },
      { id: 'c', title: 'C', status: 'skipped' },
    ]) as string;

    expect(report).toContain('Diff contracts v1..HEAD (2 files)');
    expect(report).toContain('✗ b');
    expect(report).toContain(': why');
    expect(report).toContain('1 passed, 1 failed, 1 skipped');
  });
});
