import {
  narratorKnowledges,
  narratorPersons,
  narrativeTenses,
  type NarratorCard,
  type NarratorKnowledge,
  type NarratorPerson,
  type NarrativeTense,
} from '@storyboard/story-model';
import { flagString } from '@/cliArguments';
import type { CommandOutcome } from '@/commands/outcome';
import { failure } from '@/commands/outcomes';

export const narratorIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export type BuildCardResult =
  | { readonly ok: true; readonly card: NarratorCard }
  | { readonly ok: false; readonly outcome: CommandOutcome };

export function buildCard(
  id: string,
  flags: Readonly<Record<string, string | boolean>>,
): BuildCardResult {
  const person: string | undefined = flagString(flags, 'person');
  const knowledge: string | undefined = flagString(flags, 'knowledge');
  const tense: string | undefined = flagString(flags, 'tense');
  const focal: string | undefined = flagString(flags, 'focal');
  const name: string | undefined = flagString(flags, 'name');
  const voice: string | undefined = flagString(flags, 'voice');

  if (person !== undefined && !isPerson(person)) {
    return invalid('person', narratorPersons);
  }

  if (knowledge !== undefined && !isKnowledge(knowledge)) {
    return invalid('knowledge', narratorKnowledges);
  }

  if (tense !== undefined && !isTense(tense)) {
    return invalid('tense', narrativeTenses);
  }

  const voiceItems: string[] = (voice ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return {
    ok: true,
    card: {
      type: 'narrator',
      id,
      name: name?.trim() && name.trim().length > 0 ? name.trim() : id,
      person: person ?? 'third',
      knowledge: knowledge ?? 'witnessed',
      ...(tense === undefined ? {} : { tense }),
      ...(focal === undefined ? {} : { focal }),
      ...(voiceItems.length > 0 ? { voice: voiceItems } : {}),
    },
  };
}

export function invalid(flagName: string, allowed: readonly string[]): BuildCardResult {
  return {
    ok: false,
    outcome: failure(`--${flagName} 는 ${allowed.join(', ')} 중 하나여야 합니다.`),
  };
}

export function isPerson(value: string): value is NarratorPerson {
  return (narratorPersons as readonly string[]).includes(value);
}

export function isKnowledge(value: string): value is NarratorKnowledge {
  return (narratorKnowledges as readonly string[]).includes(value);
}

export function isTense(value: string): value is NarrativeTense {
  return (narrativeTenses as readonly string[]).includes(value);
}
