import { describe, expect, it } from 'vitest';

import {
  isStoryboardRequestMethod,
  storyboardRequestPayloadSchemas,
  storyboardResponsePayloadSchemas,
} from '@storyboard/story-engine';

const expectedMethods = [
  'ai.generate',
  'ai.generateStream',
  'ai.providers.checkConnection',
  'ai.providers.list',
  'cards.applyCollect',
  'cards.collect',
  'cards.createPlaceholder',
  'cards.delete',
  'cards.list',
  'cards.open',
  'cards.previewCollect',
  'cards.read',
  'cards.resolveImageUri',
  'cards.structureScene',
  'cards.write',
  'cards.writeRaw',
  'project.readContract',
  'project.updateContract',
  'relations.list',
  'scenes.generateDraft',
  'scenes.list',
  'scenes.openDraft',
  'scenes.openScene',
  'secrets.deleteApiKey',
  'secrets.writeApiKey',
  'settings.read',
  'settings.updateDefaultProvider',
  'settings.updateProviderBaseUrl',
  'settings.updateProviderModel',
  'settings.updateSettingValue',
  'settings.updateTaskAiConfig',
  'studio.card.update',
  'studio.chat.cancel',
  'studio.chat.send',
  'studio.followUp.dismiss',
  'studio.followUp.list',
  'studio.followUp.open',
  'studio.proposal.apply',
  'studio.proposal.preview',
  'studio.session.latest',
  'studio.session.list',
  'studio.session.load',
  'studio.session.save',
  'studio.stage',
  'usage.read',
  'workspace.runCommand',
];

describe('storyboard RPC registry', () => {
  it('exposes exactly the expected request methods', () => {
    expect(Object.keys(storyboardRequestPayloadSchemas).sort()).toEqual(expectedMethods);
  });

  it('exposes the same method set for responses', () => {
    expect(Object.keys(storyboardResponsePayloadSchemas).sort()).toEqual(expectedMethods);
  });

  it('isStoryboardRequestMethod agrees with the request registry', () => {
    for (const method of expectedMethods) {
      expect(isStoryboardRequestMethod(method)).toBe(true);
    }
    expect(isStoryboardRequestMethod('cards.unknown')).toBe(false);
  });
});
