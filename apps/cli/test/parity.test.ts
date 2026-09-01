import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { commands } from '../src/commands/index';

// Storyboard's CLI is the reference implementation: a feature that exists only in the editor is a
// feature other AI agents cannot reach. This test is the enforcement — add a command to the
// extension without a CLI verb and the build fails.
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vscode/package.json', import.meta.url)), 'utf8'),
) as { contributes: { commands: { command: string }[] } };

// Editor surface that has no terminal meaning. Adding a line here is a deliberate, reviewable act —
// it says "this capability is the editor's chrome", not "we skipped it".
const editorOnlyCommands = new Set([
  'storyboard.relationGraph.open',
  'storyboard.settings.open',
  'storyboard.scene.openDraft',
]);

// Verbs still to be written. This list must only ever shrink.
const pendingVerbs = new Set([
  'storyboard.character.rename',
  'storyboard.background.rename',
  'storyboard.cards.migrateTextToList',
  'storyboard.scene.migrate',
  'storyboard.draft.augmentSelection',
  'storyboard.draft.editSelection',
  'storyboard.draft.condense',
  'storyboard.draft.expand',
]);

const commandToVerb: Readonly<Record<string, string>> = {
  'storyboard.scene.generateAllSeeds': 'scene seeds',
  'storyboard.scene.completeStory': 'scene complete',
  'storyboard.cards.buildFromScenes': 'cards build',
  'storyboard.bible.canonDiff': 'canon diff',
  'storyboard.character.create': 'card create character',
  'storyboard.background.create': 'card create background',
  'storyboard.scene.create': 'scene create',
  'storyboard.draft.applyFormat': 'draft format',
  'storyboard.draft.augment': 'draft augment',
  'storyboard.draft.export': 'manuscript export',
  'storyboard.init': 'init',
  'storyboard.draft.grammarCheck': 'check grammar',
  'storyboard.draft.continuityCheck': 'check continuity',
  'storyboard.draft.slopCheck': 'check slop',
  'storyboard.apiKey.set': 'apikey set',
  'storyboard.character.recommend': 'card recommend character',
  'storyboard.background.recommend': 'card recommend background',
  'storyboard.cards.promoteCandidates': 'card promote',
  'storyboard.bible.promoteCandidates': 'bible promote',
  'storyboard.draft.generate': 'scene generate',
  'storyboard.draft.regenerate': 'scene generate',
  'storyboard.draft.generateAll': 'scene generate',
  'storyboard.draft.reviseLoop': 'scene revise',
  'storyboard.outline.generate': 'outline generate',
  'storyboard.novel.generate': 'novel generate',
  'storyboard.manuscript.assemble': 'manuscript assemble',
  'storyboard.manuscript.review': 'manuscript review',
  'storyboard.manuscript.summaries': 'manuscript summaries',
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
