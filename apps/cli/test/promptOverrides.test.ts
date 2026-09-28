import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadPromptOverrides } from '@storyboard/story-app';
import { GrammarCheckPrompt, promptResources } from '@storyboard/story-ai';
import { NodeUri } from '@storyboard/story-format';
import { NodeFileSystem } from '@storyboard/story-node';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'storyboard-prompts-'));
});

afterEach(() => {
  promptResources.clearOverrides();
  rmSync(root, { recursive: true, force: true });
});

function writePrompt(directory: string, name: string, text: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), text);
}

describe('loadPromptOverrides', () => {
  it('lays the workspace file over the home file over the bundled text', async () => {
    const home = join(root, 'home', 'prompts');
    const workspace = join(root, 'ws', '.storyboard', 'prompts');
    writePrompt(home, 'grammarCheck.md', '## system\n홈 문구\n\n## user\n{{body}}\n');
    writePrompt(
      workspace,
      'grammarCheck.md',
      '## system\n작품 문구\n\n## user\n[본문]\n{{body}}\n',
    );

    const report = await loadPromptOverrides(new NodeFileSystem(), [
      NodeUri.file(home),
      NodeUri.file(workspace),
    ]);

    expect(report.problems).toEqual([]);
    expect(report.applied.map((entry) => entry.key)).toEqual(['grammarCheck', 'grammarCheck']);
    expect(GrammarCheckPrompt.build('가')).toEqual({ system: '작품 문구', user: '[본문]\n가' });
  });

  it('keeps the bundled text and reports a file it cannot use', async () => {
    const home = join(root, 'home', 'prompts');
    writePrompt(home, 'nope.md', '## system\nx\n');
    writePrompt(home, 'chapterSummary.md', '## chapter\nnot a section\n');

    const bundled = GrammarCheckPrompt.build('가');
    const report = await loadPromptOverrides(new NodeFileSystem(), [NodeUri.file(home)]);

    expect(report.applied).toEqual([]);
    expect(report.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('chapterSummary.md'),
      expect.stringContaining('nope.md'),
    ]);
    expect(GrammarCheckPrompt.build('가')).toEqual(bundled);
  });

  it('lists nothing when the directories do not exist', async () => {
    const report = await loadPromptOverrides(new NodeFileSystem(), [
      NodeUri.file(join(root, 'missing')),
    ]);

    expect(report).toEqual({ applied: [], problems: [] });
  });
});
