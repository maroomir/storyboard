import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { commands } from '../src/commands/index';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vscode/package.json', import.meta.url)), 'utf8'),
) as { contributes: { commands: { command: string }[] } };

const editorOnlyCommands = new Set([
  'storyboard.relationGraph.open',
  'storyboard.settings.open',
  'storyboard.scene.openDraft',
]);

const pendingVerbs = new Set([]);

const commandToVerb: Readonly<Record<string, string>> = {
  'storyboard.character.rename': 'card rename',
  'storyboard.background.rename': 'card rename',
  'storyboard.draft.condense': 'draft condense',
  'storyboard.draft.expand': 'draft expand',
  'storyboard.draft.augmentSelection': 'draft augment',
  'storyboard.draft.editSelection': 'draft edit',
  'storyboard.state.reseal': 'state reseal',
  'storyboard.scene.beats': 'scene plot',
  'storyboard.scene.generateAllSeeds': 'scene seed',
  'storyboard.scene.completeStory': 'scene complete',
  'storyboard.cards.buildFromScenes': 'card build',
  'storyboard.bible.canonDiff': 'canon diff',
  'storyboard.character.create': 'card create',
  'storyboard.background.create': 'card create',
  'storyboard.scene.create': 'scene create',
  'storyboard.scene.rename': 'scene rename',
  'storyboard.draft.applyFormat': 'draft format',
  'storyboard.draft.augment': 'draft augment',
  'storyboard.draft.export': 'manuscript export',
  'storyboard.init': 'init',
  'storyboard.notes.absorb': 'notes absorb',
  'storyboard.draft.grammarCheck': 'draft check',
  'storyboard.draft.continuityCheck': 'draft check',
  'storyboard.draft.slopCheck': 'draft check',
  'storyboard.apiKey.set': 'apikey set',
  'storyboard.character.recommend': 'card recommend',
  'storyboard.background.recommend': 'card recommend',
  'storyboard.cards.promoteCandidates': 'card promote',
  'storyboard.bible.promoteCandidates': 'canon promote',
  'storyboard.draft.generate': 'draft generate',
  'storyboard.draft.regenerate': 'draft generate',
  'storyboard.draft.generateAll': 'draft generate',
  'storyboard.draft.reviseLoop': 'draft revise',
  'storyboard.outline.generate': 'outline generate',
  'storyboard.novel.generate': 'novel generate',
  'storyboard.manuscript.assemble': 'manuscript assemble',
  'storyboard.manuscript.review': 'manuscript review',
  'storyboard.manuscript.summaries': 'manuscript summarize',
};

describe('extension/CLI parity', () => {
  it('maps every extension command to a CLI verb, an editor-only exemption, or a tracked gap', () => {
    const unmapped = manifest.contributes.commands
      .map(({ command }) => command)
      .filter(
        (command) =>
          commandToVerb[command] === undefined &&
          !editorOnlyCommands.has(command) &&
          !pendingVerbs.has(command),
      );

    expect(unmapped).toEqual([]);
  });

  it('points every mapping at a verb the CLI actually implements', () => {
    for (const verb of Object.values(commandToVerb)) {
      expect(Object.keys(commands)).toContain(verb);
    }
  });

  it('keeps the exemption lists free of commands the extension no longer contributes', () => {
    const contributed = new Set(manifest.contributes.commands.map(({ command }) => command));
    const stale = [...editorOnlyCommands, ...pendingVerbs].filter(
      (command) => !contributed.has(command),
    );

    expect(stale).toEqual([]);
  });
});
