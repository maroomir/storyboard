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
  const blocks: string[] = [
    '# 이야기 상태',
    `<!-- through-scene: ${state.throughSceneOrder} -->`,
  ];

  for (const [section, label] of sectionEntries) {
    const items = state.entries.filter((entry) => entry.section === section);
    if (items.length === 0) {
      continue;
    }

    blocks.push(
      `## ${label}`,
      ...items.map((item) =>
        item.throughScene === undefined ? `- ${item.text}` : `- [${item.throughScene}] ${item.text}`,
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

// 섹션별 상한. 오래된 항목부터 밀어내 원장이 프롬프트 예산을 잠식하지 않게 한다.
const sectionEntryLimit = 24;

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

  const bounded = sectionEntries.flatMap(([section]) =>
    merged.filter((entry) => entry.section === section).slice(-sectionEntryLimit),
  );

  return {
    throughSceneOrder: Math.max(previous.throughSceneOrder, throughSceneOrder),
    entries: bounded,
  };
}

// NOTE: beforeSceneOrder를 주면 그 씬보다 앞에서 확립된 항목만 남긴다. 앞 씬을 다시 생성할 때
// 뒤 씬의 상태가 프롬프트로 새는 것을 막는다.
export function formatStoryStateForPrompt(
  state: StoryState,
  beforeSceneOrder?: number,
): string | undefined {
  const visible =
    beforeSceneOrder === undefined
      ? state.entries
      : state.entries.filter(
          (entry) => entry.throughScene === undefined || entry.throughScene < beforeSceneOrder,
        );

  if (visible.length === 0) {
    return undefined;
  }

  const blocks = sectionEntries.flatMap(([section, label]) => {
    const items = visible.filter((entry) => entry.section === section);
    return items.length > 0 ? [`${label}:`, ...items.map((item) => `- ${item.text}`)] : [];
  });

  return ['[이야기 상태]', ...blocks].join('\n');
}
