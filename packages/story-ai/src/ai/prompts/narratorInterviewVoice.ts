import type { TemplateValue } from '#ai/ai/prompts/template';

export interface NarratorInterviewVoice {
  readonly name: string;
  readonly person: string;
  readonly knowledge: string;
  readonly tense?: string;
  readonly focal?: string;
  readonly voice: readonly string[];
}

export function narratorView(narrator: NarratorInterviewVoice): Record<string, TemplateValue> {
  return {
    name: narrator.name,
    person: narrator.person,
    knowledge: narrator.knowledge,
    tense: narrator.tense,
    focal: narrator.focal,
    hasVoice: narrator.voice.length > 0,
    voice: narrator.voice,
  };
}

export function promptListText(entry: unknown): string {
  if (typeof entry === 'string') {
    return entry.trim();
  }

  const text: unknown = typeof entry === 'object' && entry !== null ? (entry as { text?: unknown }).text : undefined;
  return typeof text === 'string' ? text.trim() : '';
}
