import {
  compositionCatalog,
  contractFieldLabels,
  narrativeTenseLabels,
  narratorKnowledgeLabels,
  narratorPersonLabels,
  pointOfViewCatalog,
  type CompositionKind,
  type ContractFieldKey,
  type NarrativeTense,
  type NarratorKnowledge,
  type NarratorPerson,
  type PointOfView,
} from '@storyboard/story-model/contracts';

import type { NarrationSummary, UiLanguage } from '@/shared/dto';

import type { Translate } from './i18n';

// Korean names belong to story-model; only their English translations live here.
const englishPointOfView: Record<PointOfView, string> = {
  first: 'First person',
  'first-retrospective': 'First person, looking back (the narrator knows the ending)',
  second: 'Second person',
  'third-limited': 'Third person limited',
  'third-omniscient': 'Third person omniscient',
};

const englishComposition: Record<CompositionKind, string> = {
  linear: 'Linear — one continuous thread',
  omnibus: 'Omnibus — each part has its own events and ending',
  'alternating-pov': 'Alternating — the narrator changes by chapter',
  frame: 'Frame — an outer story holds an inner one',
};

const englishPerson: Record<NarratorPerson, string> = { first: 'first person', second: 'second person', third: 'third person' };
const englishKnowledge: Record<NarratorKnowledge, string> = {
  witnessed: 'knows only what they witness',
  omniscient: 'omniscient',
  retrospective: 'looking back',
};
const englishTense: Record<NarrativeTense, string> = { past: 'past tense', present: 'present tense' };

export function pointOfViewLabel(language: UiLanguage, pov: PointOfView): string {
  return language === 'ko' ? pointOfViewCatalog[pov].optionLabel : englishPointOfView[pov];
}

export function compositionLabel(language: UiLanguage, composition: CompositionKind): string {
  return language === 'ko' ? compositionCatalog[composition].optionLabel : englishComposition[composition];
}

export function personLabel(language: UiLanguage, person: NarratorPerson): string {
  return language === 'ko' ? narratorPersonLabels[person] : englishPerson[person];
}

export function knowledgeLabel(language: UiLanguage, knowledge: NarratorKnowledge): string {
  return language === 'ko' ? narratorKnowledgeLabels[knowledge] : englishKnowledge[knowledge];
}

export function tenseLabel(language: UiLanguage, tense: NarrativeTense): string {
  return language === 'ko' ? narrativeTenseLabels[tense] : englishTense[tense];
}

export function describeNarration(language: UiLanguage, t: Translate, narration: NarrationSummary): string {
  return [
    narration.person === undefined ? undefined : personLabel(language, narration.person),
    narration.knowledge === undefined ? undefined : knowledgeLabel(language, narration.knowledge),
    narration.tense === undefined ? undefined : tenseLabel(language, narration.tense),
    narration.focal === undefined ? undefined : t('notes.focal', { name: narration.focal }),
    narration.narratorName === undefined ? undefined : t('notes.narrator', { name: narration.narratorName }),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');
}

const englishContractField: Record<ContractFieldKey, string> = {
  genre: 'genre',
  audience: 'readers',
  pov: 'point of view',
  targetWordCount: 'target length',
};

export function contractFieldLabel(language: UiLanguage, key: ContractFieldKey): string {
  return language === 'ko' ? contractFieldLabels[key] : englishContractField[key];
}
