import { parseJsonObject } from '@storyboard/story-model';

// What the beat prompts (actor, arbiter, judge) share: the character block an actor plays and a
// judge scores by, the beat the director hands down, and the beats that are still to come.

export interface SceneBeatCharacter {
  readonly name: string;
  readonly persona: string;
  readonly catchphrases?: readonly string[];
  // 이 씬 이전에 아는 것. 원장의 목격자 태그로 고른 항목이다.
  readonly knowledge?: readonly string[];
  readonly speechToOthers?: readonly string[];
  readonly relationChanges?: readonly string[];
  // 앞 대목의 심판이 이 인물에게 남긴 «피할 것». 대사 문구는 들어오지 않는다.
  readonly notes?: readonly string[];
  // 이 인물이 이 장면에서 지금까지 직접 본 대목. 다른 인물의 속마음(속 줄)은 빠져 있다.
  readonly witnessed?: string;
}

export interface SceneBeatDirective {
  readonly number: number;
  readonly text: string;
  // «출연: … / 장소: … / 시각: …». 좌표 없는 비트는 없다.
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
  const coordinates = beat.coordinates === undefined ? '' : `\n(${beat.coordinates})`;

  return `[감독 지시 — 대목 ${beat.number}]\n${beat.text}${coordinates}`;
}

// NOTE: 모든 역할이 다음 두 대목을 «아직 아니다»로 본다. 다음 하나만 주면 심판이 n+2 의 사건을
// «안 했다»고 감점하고, 배우는 n+2 의 소재를 앞당긴다(실측 2차).
export function renderNextBeats(nextBeats: readonly SceneBeatDirective[]): string {
  if (nextBeats.length === 0) {
    return '[아직 아니다 — 다음 대목]\n(이 장면의 마지막 대목이다. 지시된 데서 끝내고 그 뒤를 쓰지 마라.)';
  }

  const lines = nextBeats.map((beat) => `(대목 ${beat.number}) ${beat.text}`).join('\n');

  return `[아직 아니다 — 다음 대목들]\n${lines}\n위 소재·대사·사건은 뒤 대목의 것이다. 이번 대목에서 미리 일으키거나 그 대사를 꺼내지 마라. 반대로 뒤 대목의 일을 이번 대목에서 하지 않았다고 흠잡지도 마라.`;
}

// 모델이 닫는 괄호 앞에 `,"` 나 쉼표를 흘리는 일이 있다(실측 3차에서 심판 응답 1회). 정상 파싱이
// 실패했을 때만 그 자리를 지우고 다시 읽는다.
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
