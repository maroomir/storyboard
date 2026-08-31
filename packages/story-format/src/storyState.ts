// NOTE: 씬 사이의 기억. 직전 드래프트 꼬리만으로는 앞 화가 확립한 사실·관계·공개된 정보가 다음 씬에
// 전달되지 않아 씬 경계마다 상태가 리셋된다. 씬 생성 직후 이 원장을 갱신하고, 다음 씬 프롬프트에
// [이야기 상태]로 주입해 장거리 연속성을 유지한다.

export const storyStateSectionLabels = {
  facts: '확정 사실',
  relations: '인물 관계와 말투',
  revealed: '공개된 정보',
  motifs: '살아 있는 모티프',
} as const;

export type StoryStateSection = keyof typeof storyStateSectionLabels;

export interface StoryStateEntry {
  readonly section: StoryStateSection;
  readonly text: string;
  // NOTE: 그 항목이 확립된 씬 번호. 앞 씬을 다시 생성할 때 뒤 씬의 상태를 읽지 않으려면
  // 항목마다 시점이 있어야 한다. 번호가 없는 항목(구 버전 원장)은 항상 유효한 것으로 본다.
  readonly throughScene?: number;
}

export interface StoryState {
  readonly throughSceneOrder: number;
  readonly entries: readonly StoryStateEntry[];
}

export interface StoryStateFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>;
}

const throughLinePattern = /^<!--\s*through-scene:\s*(\d+)\s*-->$/;
const sectionEntries = Object.entries(storyStateSectionLabels) as [StoryStateSection, string][];
const labelToSection = new Map(sectionEntries.map(([section, label]) => [label, section]));

export function createEmptyStoryState(): StoryState {
  return { throughSceneOrder: 0, entries: [] };
}

export function parseStoryState(content: string): StoryState {
  const lines = content.split('\n');
  let throughSceneOrder = 0;
  let current: StoryStateSection | undefined;
  const entries: StoryStateEntry[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const throughMatch = throughLinePattern.exec(line);
    if (throughMatch?.[1]) {
      throughSceneOrder = Number.parseInt(throughMatch[1], 10);
      continue;
    }

    if (line.startsWith('## ')) {
      current = labelToSection.get(line.slice(3).trim());
      continue;
    }

    if (current && line.startsWith('- ')) {
      const entry = parseEntryLine(current, line.slice(2).trim());
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return { throughSceneOrder, entries };
}

const entrySceneTagPattern = /^\[(\d+)\]\s*(.+)$/;

function parseEntryLine(section: StoryStateSection, text: string): StoryStateEntry | undefined {
  if (text.length === 0) {
    return undefined;
  }

  const tagged = entrySceneTagPattern.exec(text);
  if (tagged?.[1] && tagged[2]) {
    return { section, text: tagged[2], throughScene: Number.parseInt(tagged[1], 10) };
  }

  return { section, text };
}

export function serializeStoryState(state: StoryState): string {
  const blocks: string[] = ['# 이야기 상태', `<!-- through-scene: ${state.throughSceneOrder} -->`];

  for (const [section, label] of sectionEntries) {
    const items = state.entries.filter((entry) => entry.section === section);
    if (items.length === 0) {
      continue;
    }

    blocks.push(
      `## ${label}`,
      ...items.map((item) =>
        item.throughScene === undefined
          ? `- ${item.text}`
          : `- [${item.throughScene}] ${item.text}`,
      ),
    );
  }

  return `${blocks.join('\n')}\n`;
}

export async function readStoryState(
  uri: unknown,
  fileSystem: Pick<StoryStateFileSystem, 'readFile'>,
): Promise<StoryState> {
  try {
    const content = new TextDecoder().decode(await fileSystem.readFile(uri));
    return parseStoryState(content);
  } catch {
    return createEmptyStoryState();
  }
}

export async function writeStoryState(
  uri: unknown,
  state: StoryState,
  fileSystem: Pick<StoryStateFileSystem, 'writeFile'>,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeStoryState(state)));
}

// 섹션별 주입 예산. 원장에서 항목을 버리는 상한이 아니라, 한 번의 프롬프트에 실어 보낼 개수다.
// 버리기로 예산을 맞추면 32씬짜리 작품도 6씬 만에 1막의 사실을 잃는다.
const sectionInjectionBudget = 24;

export function mergeStoryState(
  previous: StoryState,
  additions: readonly StoryStateEntry[],
  throughSceneOrder: number,
): StoryState {
  // NOTE: 같은 씬을 다시 생성하면 그 씬이 앞서 남긴 항목은 낡은 판본이므로 걷어내고 새로 쌓는다.
  // 그러지 않으면 폐기된 전개가 원장에 남아 뒤 씬으로 계속 전달된다.
  const merged: StoryStateEntry[] = previous.entries.filter(
    (entry) => entry.throughScene !== throughSceneOrder,
  );
  const seen = new Set(merged.map((entry) => `${entry.section}:${entry.text}`));

  for (const addition of additions) {
    const text = addition.text.trim();
    if (text.length === 0) {
      continue;
    }

    const key = `${addition.section}:${text}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({ section: addition.section, text, throughScene: throughSceneOrder });
  }

  return {
    throughSceneOrder: Math.max(previous.throughSceneOrder, throughSceneOrder),
    entries: merged,
  };
}

// NOTE: 예산을 넘으면 최근 것만 남기는 대신 이번 씬과 겹치는 낱말이 많은 항목을 먼저 고른다.
// 1막에서 심은 사실이 3막 씬에 그 이름이 등장할 때 되살아나야 복선 회수가 가능하다. 캐넌의
// selectInjectedFacts가 같은 문제를 같은 방식으로 푼다.
function selectWithinBudget(
  entries: readonly StoryStateEntry[],
  sceneText: string | undefined,
  budget: number,
): StoryStateEntry[] {
  if (entries.length <= budget) {
    return [...entries];
  }

  if (sceneText === undefined) {
    return entries.slice(-budget);
  }

  const sceneTextCompact = compactForOverlap(sceneText);
  const ranked = entries
    .map((entry, position) => ({
      entry,
      position,
      score: countTextOverlap(entry.text, sceneTextCompact),
    }))
    .sort((left, right) => right.score - left.score || right.position - left.position)
    .slice(0, budget);

  // 고른 뒤에는 쌓인 순서로 되돌린다. 읽는 쪽에는 시간 순서가 자연스럽다.
  return ranked.sort((left, right) => left.position - right.position).map((item) => item.entry);
}

// NOTE: 한국어는 낱말에 조사가 붙어 "대상0호가"와 "대상0호를"이 다른 문자열이 된다. 낱말 단위로
// 맞추면 같은 대상을 가리켜도 어긋나므로, 공백을 걷어낸 글자 3-gram이 얼마나 겹치는지로 센다.
const overlapGramSize = 3;

function countTextOverlap(text: string, sceneTextCompact: string): number {
  const compact = compactForOverlap(text);
  if (compact.length < overlapGramSize) {
    return 0;
  }

  const grams = new Set<string>();
  for (let offset = 0; offset + overlapGramSize <= compact.length; offset += 1) {
    grams.add(compact.slice(offset, offset + overlapGramSize));
  }

  let hits = 0;
  for (const gram of grams) {
    if (sceneTextCompact.includes(gram)) {
      hits += 1;
    }
  }

  return hits;
}

function compactForOverlap(text: string): string {
  return text.toLowerCase().replace(/[^0-9a-z가-힣]+/g, '');
}

export function selectStoryStateEntries(
  state: StoryState,
  section: StoryStateSection,
  beforeSceneOrder: number | undefined,
  sceneText?: string,
): StoryStateEntry[] {
  const visible = state.entries.filter(
    (entry) =>
      entry.section === section &&
      (beforeSceneOrder === undefined ||
        entry.throughScene === undefined ||
        entry.throughScene < beforeSceneOrder),
  );

  return selectWithinBudget(visible, sceneText, sectionInjectionBudget);
}

// NOTE: beforeSceneOrder를 주면 그 씬보다 앞에서 확립된 항목만 남긴다. 앞 씬을 다시 생성할 때
// 뒤 씬의 상태가 프롬프트로 새는 것을 막는다.
export function formatStoryStateForPrompt(
  state: StoryState,
  beforeSceneOrder?: number,
  sceneText?: string,
): string | undefined {
  const blocks = sectionEntries.flatMap(([section, label]) => {
    const items = selectStoryStateEntries(state, section, beforeSceneOrder, sceneText);
    return items.length > 0 ? [`${label}:`, ...items.map((item) => `- ${item.text}`)] : [];
  });

  if (blocks.length === 0) {
    return undefined;
  }

  return ['[이야기 상태]', ...blocks].join('\n');
}
