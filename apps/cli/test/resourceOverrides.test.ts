import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadResourceOverrides } from '@storyboard/story-app';
import {
  buildCompositionPreset,
  resolveNovelPipelinePlan,
  resolveScenePipelinePlan,
  sceneStageIds,
} from '@storyboard/story-engine';
import {
  novelStageNames,
  NodeUri,
  resolveCraftContract,
  defaultCraftContract,
} from '@storyboard/story-model';
import {
  ChapterSummaryPrompt,
  GrammarCheckPrompt,
  promptResources,
  selectPromptVariant,
} from '@storyboard/story-ai';
import { NodeFileSystem } from '@storyboard/story-node';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'storyboard-prompts-'));
});

afterEach(async () => {
  await loadResourceOverrides(new NodeFileSystem(), []);
  rmSync(root, { recursive: true, force: true });
});

function writePrompt(directory: string, name: string, text: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), text);
}

describe('loadResourceOverrides', () => {
  it('lays the workspace file over the home file over the bundled text', async () => {
    const home = join(root, 'home');
    const workspace = join(root, 'ws', '.storyboard');
    writePrompt(
      join(home, 'prompts'),
      'grammarCheck.md',
      '## system\n홈 문구\n\n## user\n{{body}}\n',
    );
    writePrompt(
      join(workspace, 'prompts'),
      'grammarCheck.md',
      '## system\n작품 문구\n\n## user\n[본문]\n{{body}}\n',
    );

    const report = await loadResourceOverrides(new NodeFileSystem(), [
      NodeUri.file(home),
      NodeUri.file(workspace),
    ]);

    expect(report.problems).toEqual([]);
    expect(report.applied.map((entry) => entry.key)).toEqual(['grammarCheck', 'grammarCheck']);
    expect(report.applied.every((entry) => entry.kind === 'prompt')).toBe(true);
    expect(GrammarCheckPrompt.build('가')).toEqual({ system: '작품 문구', user: '[본문]\n가' });
  });

  it('keeps the bundled text and reports a file it cannot use', async () => {
    const home = join(root, 'home');
    writePrompt(join(home, 'prompts'), 'nope.md', '## system\nx\n');
    writePrompt(join(home, 'prompts'), 'chapterSummary.md', '## chapter\nnot a section\n');

    const bundled = GrammarCheckPrompt.build('가');
    const report = await loadResourceOverrides(new NodeFileSystem(), [NodeUri.file(home)]);

    expect(report.applied).toEqual([]);
    expect(report.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('chapterSummary.md'),
      expect.stringContaining('nope.md'),
    ]);
    expect(GrammarCheckPrompt.build('가')).toEqual(bundled);
  });

  it('takes the sampling config from the file and keeps the bundled one without a front-matter', async () => {
    const home = join(root, 'home');
    const workspace = join(root, 'ws', '.storyboard');
    const bundled = { ...GrammarCheckPrompt.config };
    writePrompt(
      join(home, 'prompts'),
      'grammarCheck.md',
      '---\ntemperature: 0.9\nmaxTokens: 50\n---\n## system\n홈\n\n## user\n{{body}}\n',
    );
    writePrompt(
      join(workspace, 'prompts'),
      'chapterSummary.md',
      '## system\n작품\n\n## user\n{{body}}\n',
    );

    const report = await loadResourceOverrides(new NodeFileSystem(), [
      NodeUri.file(home),
      NodeUri.file(workspace),
    ]);

    expect(report.problems).toEqual([]);
    expect({ ...GrammarCheckPrompt.config }).toEqual({ temperature: 0.9, maxTokens: 50 });
    expect({ ...ChapterSummaryPrompt.config }).toEqual({
      ...promptResources.config('chapterSummary'),
    });
    expect(ChapterSummaryPrompt.config.maxTokens).toBe(600);

    promptResources.clearOverrides();

    expect({ ...GrammarCheckPrompt.config }).toEqual(bundled);
  });

  it('reports a front-matter it cannot read and keeps the bundled config', async () => {
    const home = join(root, 'home');
    const bundled = { ...GrammarCheckPrompt.config };
    writePrompt(
      join(home, 'prompts'),
      'grammarCheck.md',
      '---\ntemperature: 5\nmaxTokens: 50\n---\n## system\nx\n',
    );

    const report = await loadResourceOverrides(new NodeFileSystem(), [NodeUri.file(home)]);

    expect(report.applied).toEqual([]);
    expect(report.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('temperature'),
    ]);
    expect({ ...GrammarCheckPrompt.config }).toEqual(bundled);
  });

  it('lays craftContract.json files over the bundled contract, workspace last', async () => {
    const home = join(root, 'home');
    const workspace = join(root, 'ws', '.storyboard');
    writePrompt(home, 'craftContract.json', '{ "motifRepeatLimit": 5, "banTelling": false }');
    writePrompt(workspace, 'craftContract.json', '{ "motifRepeatLimit": 2 }');

    const report = await loadResourceOverrides(new NodeFileSystem(), [
      NodeUri.file(home),
      NodeUri.file(workspace),
    ]);

    expect(report.problems).toEqual([]);
    expect(report.applied.map((entry) => entry.kind)).toEqual(['craftContract', 'craftContract']);
    expect(resolveCraftContract(undefined)).toEqual({
      ...defaultCraftContract,
      motifRepeatLimit: 2,
      banTelling: false,
    });
    expect(resolveCraftContract({ motifRepeatLimit: 9 }).motifRepeatLimit).toBe(9);

    await loadResourceOverrides(new NodeFileSystem(), []);

    expect(resolveCraftContract(undefined)).toEqual(defaultCraftContract);
  });

  it('reports a craft contract file it cannot use and keeps the defaults', async () => {
    const home = join(root, 'home');
    writePrompt(home, 'craftContract.json', '{ "motifRepeatLimit": "many" }');
    const broken = join(root, 'broken');
    writePrompt(broken, 'craftContract.json', 'not json');

    const report = await loadResourceOverrides(new NodeFileSystem(), [
      NodeUri.file(home),
      NodeUri.file(broken),
    ]);

    expect(report.applied).toEqual([]);
    expect(report.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('motifRepeatLimit'),
      expect.stringContaining('broken'),
    ]);
    expect(resolveCraftContract(undefined)).toEqual(defaultCraftContract);
  });

  it('lays promptVariants.json over the bundled variant rules', async () => {
    const home = join(root, 'home');
    const workspace = join(root, 'ws', '.storyboard');
    const claudeGrammar = {
      providerId: 'claude',
      taskName: 'grammarCheck',
      model: 'claude-x',
    } as const;
    writePrompt(home, 'promptVariants.json', '{ "xs": { "providers": ["claude"] } }');
    writePrompt(workspace, 'promptVariants.json', '{ "xs": { "tasks": ["grammarCheck"] } }');

    expect(selectPromptVariant(claudeGrammar)).toBe('generic');

    const report = await loadResourceOverrides(new NodeFileSystem(), [
      NodeUri.file(home),
      NodeUri.file(workspace),
    ]);

    expect(report.problems).toEqual([]);
    expect(report.applied.map((entry) => entry.kind)).toEqual(['promptVariants', 'promptVariants']);
    expect(selectPromptVariant(claudeGrammar)).toBe('xs');
    expect(selectPromptVariant({ ...claudeGrammar, model: 'claude-opus-5-5' })).toBe('xs');

    await loadResourceOverrides(new NodeFileSystem(), []);

    expect(selectPromptVariant(claudeGrammar)).toBe('generic');
  });

  it('reports a variant rule it cannot use', async () => {
    const home = join(root, 'home');
    writePrompt(home, 'promptVariants.json', '{ "xs": { "providers": ["nope"] } }');

    const report = await loadResourceOverrides(new NodeFileSystem(), [NodeUri.file(home)]);

    expect(report.applied).toEqual([]);
    expect(report.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('xs.providers'),
    ]);
  });

  it('lays compositionPresets.json over the preset defaults', async () => {
    const home = join(root, 'home');
    writePrompt(
      home,
      'compositionPresets.json',
      '{ "frameThreadTitle": "겉이야기", "omnibusEpisodeCount": 4 }',
    );

    const report = await loadResourceOverrides(new NodeFileSystem(), [NodeUri.file(home)]);

    expect(report.problems).toEqual([]);
    expect(report.applied.map((entry) => entry.kind)).toEqual(['compositionPresets']);
    expect(buildCompositionPreset({ composition: 'frame' }).setting.threads?.frame?.title).toBe(
      '겉이야기',
    );
    expect(
      Object.keys(buildCompositionPreset({ composition: 'omnibus' }).setting.threads ?? {}),
    ).toHaveLength(4);

    await loadResourceOverrides(new NodeFileSystem(), []);

    expect(buildCompositionPreset({ composition: 'frame' }).setting.threads?.frame?.title).toBe(
      '외화',
    );
  });

  it('lays pipelines/*.yaml over the bundled stage order, workspace last', async () => {
    const home = join(root, 'home');
    const workspace = join(root, 'ws', '.storyboard');
    writePrompt(
      join(home, 'pipelines'),
      'scene.yaml',
      'version: 1\nstages:\n  - buildPersonas\n  - describeBackground\n  - draftSkeleton\n  - expandSection\n',
    );
    writePrompt(
      join(workspace, 'pipelines'),
      'novel.yaml',
      'version: 1\nstages:\n  - outline\n  - characters\n  - seeds\n  - chapters\n  - id: review\n    enabled: false\n  - summaries\n',
    );

    const report = await loadResourceOverrides(new NodeFileSystem(), [
      NodeUri.file(home),
      NodeUri.file(workspace),
    ]);

    expect(report.problems).toEqual([]);
    expect(report.applied.map((entry) => entry.kind)).toEqual(['scenePipeline', 'novelPipeline']);
    expect(resolveScenePipelinePlan()).toEqual([
      'buildPersonas',
      'describeBackground',
      'draftSkeleton',
      'expandSection',
    ]);
    expect(resolveNovelPipelinePlan()).toEqual([
      'outline',
      'characters',
      'seeds',
      'chapters',
      'summaries',
    ]);

    await loadResourceOverrides(new NodeFileSystem(), []);

    expect(resolveScenePipelinePlan()).toEqual(sceneStageIds);
    expect(resolveNovelPipelinePlan()).toEqual(novelStageNames);
  });

  // characters 단계가 생기기 전에 쓴 파일이다. 예전에는 통째로 버려져 꺼 둔 유료 단계까지 돌았다.
  it('keeps the order of a novel.yaml written before the characters stage', async () => {
    const workspace = join(root, 'ws', '.storyboard');
    writePrompt(
      join(workspace, 'pipelines'),
      'novel.yaml',
      'version: 1\nstages:\n  - outline\n  - seeds\n  - chapters\n  - id: review\n    enabled: false\n',
    );

    const report = await loadResourceOverrides(new NodeFileSystem(), [NodeUri.file(workspace)]);

    expect(report.problems).toEqual([]);
    expect(resolveNovelPipelinePlan()).toEqual(['outline', 'characters', 'seeds', 'chapters']);

    await loadResourceOverrides(new NodeFileSystem(), []);
  });

  it('reports a pipeline spec that drops a required stage and keeps the bundled order', async () => {
    const home = join(root, 'home');
    writePrompt(join(home, 'pipelines'), 'scene.yaml', 'version: 1\nstages:\n  - expandSection\n');
    writePrompt(join(home, 'pipelines'), 'novel.yaml', 'stages: [');

    const report = await loadResourceOverrides(new NodeFileSystem(), [NodeUri.file(home)]);

    expect(report.applied).toEqual([]);
    expect(report.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining('buildPersonas'),
      expect.stringContaining('YAML'),
    ]);
    expect(resolveScenePipelinePlan()).toEqual(sceneStageIds);
  });

  it('lists nothing when the directories do not exist', async () => {
    const report = await loadResourceOverrides(new NodeFileSystem(), [
      NodeUri.file(join(root, 'missing')),
    ]);

    expect(report).toEqual({ applied: [], problems: [] });
  });
});
