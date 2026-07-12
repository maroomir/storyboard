import { type PromptArtifact, type PromptVariantId } from './types';

export interface CardCandidateExtraction {
  readonly attributes: readonly { readonly key: string; readonly value: string }[];
  readonly relations: readonly { readonly target: string; readonly type: string }[];
  readonly description: readonly string[];
  readonly voice: readonly string[];
  readonly desire: readonly string[];
  readonly arc?: { readonly summary: string };
}

export const CardCandidateExtractionPrompt = {
  config: {
    temperature: 0.2,
    maxTokens: 700,
  },
  build(
    body: string,
    characterName: string,
    aliases?: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return variant === 'xs'
      ? buildXs(body, characterName, aliases)
      : buildGeneric(body, characterName, aliases);
  },
} as const;

function aliasHint(characterName: string, aliases?: readonly string[]): string | undefined {
  const labels = (aliases ?? []).map((alias) => alias.trim()).filter((alias) => alias.length > 0);
  if (labels.length === 0) {
    return undefined;
  }
  return `"${characterName}"은(는) 본문에서 ${labels.map((alias) => `"${alias}"`).join(', ')}(으)로도 지칭된다. 같은 인물로 간주하라.`;
}

function buildGeneric(
  body: string,
  characterName: string,
  aliases?: readonly string[],
): PromptArtifact {
  return {
    system: [
      `"${characterName}"에 대해 본문에 명시된 정보만 추출하라.`,
      aliasHint(characterName, aliases),
      'attributes: 나이·외형·소속 같은 고정 설정만 {key,value}로.',
      `relations: "${characterName}"과 다른 인물 사이의 관계만 {target,type}으로. target은 상대 인물의 이름.`,
      "relations.type은 '소꿉친구', '짝사랑'처럼 1~5단어의 짧은 라벨로. 문장으로 풀어 쓰지 말 것.",
      'description: 외형·배경·처지 등 인물을 묘사하는 서술 문장. key-value 속성이나 성격 단어와 겹치지 않게.',
      'voice: 존댓말/반말·어조·말버릇 등 이 인물의 화법 특성. 대사 원문이 아니라 화법을 요약한 한 줄로.',
      'desire: 이 인물이 원하는 것·동기. 장면 진행(arc)이 아니라 지속적인 욕망으로.',
      'arc.summary: 이 장면에서 이 인물의 진행을 한 줄로.',
      '본문에 명시되지 않은 내용은 추측하지 말고 비워 두라.',
      '설명 없이 JSON 객체만 출력하라.',
      '{"attributes":[{"key":"","value":""}],"relations":[{"target":"","type":""}],"description":[""],"voice":[""],"desire":[""],"arc":{"summary":""}}',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    user: ['[본문]', body].join('\n'),
  };
}

function buildXs(body: string, characterName: string, aliases?: readonly string[]): PromptArtifact {
  return {
    system: [
      `"${characterName}" 정보를 JSON으로: {"attributes":[{"key":"","value":""}],"relations":[{"target":"","type":""}],"description":[""],"voice":[""],"desire":[""],"arc":{"summary":""}}. relations.type은 1~5단어 짧은 라벨, description은 인물 묘사 서술 문장, voice는 화법 특성, desire는 욕망/동기. 본문에 없는 건 비워 둘 것.`,
      aliasHint(characterName, aliases),
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    user: body,
  };
}

export function coerceCardCandidateExtraction(
  value: Record<string, unknown> | null,
): CardCandidateExtraction {
  if (value === null) {
    return { attributes: [], relations: [], description: [], voice: [], desire: [] };
  }

  return {
    attributes: coerceStringRecords(value.attributes, 'key', 'value').map((entry) => ({
      key: entry.left,
      value: entry.right,
    })),
    relations: coerceStringRecords(value.relations, 'target', 'type').map((entry) => ({
      target: entry.left,
      type: entry.right,
    })),
    description: coerceStringList(value.description),
    voice: coerceStringList(value.voice),
    desire: coerceStringList(value.desire),
    ...coerceArc(value.arc),
  };
}

function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function coerceStringRecords(
  value: unknown,
  leftField: string,
  rightField: string,
): { readonly left: string; readonly right: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const records: { readonly left: string; readonly right: string }[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const left = record[leftField];
    const right = record[rightField];

    if (
      typeof left === 'string' &&
      typeof right === 'string' &&
      left.trim().length > 0 &&
      right.trim().length > 0
    ) {
      records.push({ left: left.trim(), right: right.trim() });
    }
  }

  return records;
}

function coerceArc(value: unknown): { readonly arc?: { readonly summary: string } } {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const summary = (value as Record<string, unknown>).summary;

  if (typeof summary !== 'string' || summary.trim().length === 0) {
    return {};
  }

  return { arc: { summary: summary.trim() } };
}
