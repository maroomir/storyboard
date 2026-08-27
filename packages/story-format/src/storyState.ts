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
      const text = line.slice(2).trim();
      if (text.length > 0) {
        entries.push({ section: current, text });
      }
    }
  }

  return { throughSceneOrder, entries };
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

    blocks.push(`## ${label}`, ...items.map((item) => `- ${item.text}`));
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
  const merged: StoryStateEntry[] = [...previous.entries];
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
    merged.push({ section: addition.section, text });
  }

  const bounded = sectionEntries.flatMap(([section]) =>
    merged.filter((entry) => entry.section === section).slice(-sectionEntryLimit),
  );

  return {
    throughSceneOrder: Math.max(previous.throughSceneOrder, throughSceneOrder),
    entries: bounded,
  };
}

export function formatStoryStateForPrompt(state: StoryState): string | undefined {
  if (state.entries.length === 0) {
    return undefined;
  }

  const blocks = sectionEntries.flatMap(([section, label]) => {
    const items = state.entries.filter((entry) => entry.section === section);
    return items.length > 0 ? [`${label}:`, ...items.map((item) => `- ${item.text}`)] : [];
  });

  return ['[이야기 상태]', ...blocks].join('\n');
}
