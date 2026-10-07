import { filterByGlobs } from './glob.mjs';

// A change that has a mandatory companion. Tests catch a companion that is wrong; nothing but a
// look at the diff itself catches one that is missing. Each rule names what triggers it and what
// the same range must then also carry. `readHead`/`readBase` read a file at either end of the range.

const sourceGlobs = ['apps/*/src/**', 'apps/*/webview-ui/src/**', 'packages/*/src/**'];
const changelogFiles = ['CHANGELOG.md', 'CHANGELOG.en.md'];

function versionOf(manifestText) {
  if (manifestText === undefined) {
    return undefined;
  }
  return JSON.parse(manifestText).version;
}

function listMissing(expected, changed) {
  return expected.filter((file) => !changed.includes(file));
}

export const diffContractRules = [
  {
    id: 'changelog-both',
    title: '소스가 바뀌면 두 변경 내역(한국어·영어)이 함께 바뀐다',
    trigger: ({ changed }) => filterByGlobs(sourceGlobs, changed).length > 0,
    check: ({ changed }) => {
      const missing = listMissing(changelogFiles, changed);
      return missing.length === 0 ? { ok: true } : { ok: false, detail: `${missing.join(', ')} 가 바뀌지 않았습니다` };
    },
  },
  {
    id: 'prompt-generated',
    title: '프롬프트 리소스(md)가 바뀌면 생성 모듈이 함께 바뀐다',
    trigger: ({ changed }) => filterByGlobs(['packages/story-ai/src/ai/prompts/resources/*.md'], changed).length > 0,
    check: ({ changed }) => {
      const generated = 'packages/story-ai/src/ai/prompts/resources.generated.ts';
      return changed.includes(generated)
        ? { ok: true }
        : { ok: false, detail: `${generated} 가 바뀌지 않았습니다 (npm run build:prompts --workspace @storyboard/story-ai)` };
    },
  },
  {
    id: 'params-owner',
    title: 'params 파일은 옆의 zod 스키마와 coding-standards 표의 행을 가진다',
    trigger: ({ changed }) => filterByGlobs(['**/*.params.json'], changed).length > 0,
    check: ({ changed, readHead }) => {
      const table = readHead('.claude/rules/coding-standards.md') ?? '';
      const problems = [];

      for (const file of filterByGlobs(['**/*.params.json'], changed)) {
        const schema = file.replace(/\.params\.json$/, '.ts');
        if (readHead(schema) === undefined) {
          problems.push(`${schema} 가 없습니다`);
        }
        if (!table.includes(file)) {
          problems.push(`${file} 가 .claude/rules/coding-standards.md 의 표에 없습니다`);
        }
      }

      return problems.length === 0 ? { ok: true } : { ok: false, detail: problems.join('; ') };
    },
  },
  {
    id: 'config-schema-test',
    title: '설정 스키마·설정 카탈로그가 바뀌면 설정 테스트가 함께 바뀐다',
    trigger: ({ changed }) =>
      changed.includes('packages/story-config/src/configSchema.ts') ||
      changed.includes('packages/story-model/src/contracts/settingCatalog.ts'),
    check: ({ changed }) => {
      const tests = [
        'apps/cli/test/configuration.test.ts',
        'apps/cli/test/setupCommands.test.ts',
        'apps/vscode/test/unit/infrastructure/settings/**',
      ];
      return filterByGlobs(tests, changed).length > 0
        ? { ok: true }
        : { ok: false, detail: `${tests.join(', ')} 중 어느 것도 바뀌지 않았습니다` };
    },
  },
  {
    id: 'desktop-i18n',
    title: '데스크톱 한국어 문자열이 바뀌면 영어 문자열이 함께 바뀐다',
    trigger: ({ changed }) => changed.includes('apps/desktop/src/shared/i18n/ko.ts'),
    check: ({ changed }) =>
      changed.includes('apps/desktop/src/shared/i18n/en.ts')
        ? { ok: true }
        : { ok: false, detail: 'apps/desktop/src/shared/i18n/en.ts 가 바뀌지 않았습니다' },
  },
  {
    id: 'rules-mirror',
    title: '.claude/rules 가 바뀌면 .cursor/rules 거울이 함께 바뀐다',
    trigger: ({ changed }) => filterByGlobs(['.claude/rules/**'], changed).length > 0,
    check: ({ changed }) =>
      filterByGlobs(['.cursor/rules/**'], changed).length > 0
        ? { ok: true }
        : { ok: false, detail: '.cursor/rules/ 아래 파일이 하나도 바뀌지 않았습니다' },
  },
  {
    id: 'version-changelog',
    title: '루트 버전이 오르면 두 변경 내역에 그 버전의 절이 있다',
    trigger: ({ readHead, readBase }) => versionOf(readHead('package.json')) !== versionOf(readBase('package.json')),
    check: ({ readHead }) => {
      const version = versionOf(readHead('package.json'));
      const missing = changelogFiles.filter((file) => !(readHead(file) ?? '').includes(`## [${version}]`));
      return missing.length === 0
        ? { ok: true }
        : { ok: false, detail: `${missing.join(', ')} 에 "## [${version}]" 절이 없습니다` };
    },
  },
];

export function evaluateDiffContracts(context, rules = diffContractRules) {
  return rules.map((rule) => {
    if (!rule.trigger(context)) {
      return { id: rule.id, title: rule.title, status: 'skipped' };
    }
    const result = rule.check(context);
    return result.ok
      ? { id: rule.id, title: rule.title, status: 'passed' }
      : { id: rule.id, title: rule.title, status: 'failed', detail: result.detail };
  });
}

export function formatDiffContractReport(range, changedCount, results) {
  const marks = { passed: '✓', failed: '✗', skipped: '-' };
  const lines = [`Diff contracts ${range} (${changedCount} files)`];

  for (const result of results) {
    const suffix = result.status === 'failed' ? `: ${result.detail}` : '';
    lines.push(`  ${marks[result.status]} ${result.id.padEnd(20)} ${result.title}${suffix}`);
  }

  const count = (status) => results.filter((result) => result.status === status).length;
  lines.push(`${count('passed')} passed, ${count('failed')} failed, ${count('skipped')} skipped`);
  return lines.join('\n');
}
