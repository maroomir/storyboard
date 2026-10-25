import { parseJsonObject } from '@storyboard/story-model';

export interface SceneBeatCharacter {
  readonly name: string;
  readonly persona: string;
  readonly catchphrases?: readonly string[];
  readonly knowledge?: readonly string[];
  readonly speechToOthers?: readonly string[];
  readonly relationChanges?: readonly string[];
  readonly notes?: readonly string[];
  readonly witnessed?: string;
}

export interface SceneBeatDirective {
  readonly number: number;
  readonly text: string;
  readonly coordinates?: string;
}

function listBlock(label: string, items: readonly string[] | undefined): string | undefined {
  return items && items.length > 0
    ? `[${label}]\n${items.map((item) => `- ${item}`).join('\n')}`
    : undefined;
}

export function renderBeatCharacterBlock(character: SceneBeatCharacter): string {
  return [
    `[인물] ${character.name}`,
    character.persona.trim().length > 0 ? character.persona : undefined,
    listBlock('입버릇 — 대목 하나에 통틀어 한 번까지', character.catchphrases),
    listBlock('상대별 말투', character.speechToOthers),
    listBlock('관계 변화 — 이 장면 이전', character.relationChanges),
    listBlock('아는 것 — 이 장면 이전', character.knowledge),
    listBlock('앞 대목에서 받은 지적 — 피할 것', character.notes),
  ]
    .filter((block): block is string => block !== undefined)
    .join('\n\n');
}

export function renderBeatDirective(beat: SceneBeatDirective): string {
  const coordinates: string = beat.coordinates === undefined ? '' : `\n(${beat.coordinates})`;

  return `[감독 지시 — 대목 ${beat.number}]\n${beat.text}${coordinates}`;
}

export function renderNextBeats(nextBeats: readonly SceneBeatDirective[]): string {
  if (nextBeats.length === 0) {
    return '[아직 아니다 — 다음 대목]\n(이 장면의 마지막 대목이다. 지시된 데서 끝내고 그 뒤를 쓰지 마라.)';
  }

  const lines: string = nextBeats.map((beat) => `(대목 ${beat.number}) ${beat.text}`).join('\n');

  return `[아직 아니다 — 다음 대목들]\n${lines}\n위 소재·대사·사건은 뒤 대목의 것이다. 이번 대목에서 미리 일으키거나 그 대사를 꺼내지 마라. 반대로 뒤 대목의 일을 이번 대목에서 하지 않았다고 흠잡지도 마라.`;
}

export function parseBeatJsonObject(response: string): Record<string, unknown> | null {
  return (
    parseJsonObject(response) ??
    parseJsonObject(response.replace(/,\s*"?\s*(?=[}\]])/g, ''))
  );
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];
}
