import type { ReadWriteFileSystem } from '#model/format/files/readWriteFileSystem';
import type { StoryUri } from '#model/format/storyUri';

export type StoryStateSection = 'facts' | 'relations' | 'revealed' | 'motifs';

export const storyStateSectionLabels: Readonly<Record<StoryStateSection, string>> = {
  facts: '확정 사실',
  relations: '인물 관계와 말투',
  revealed: '공개된 정보',
  motifs: '살아 있는 모티프',
};

export interface StoryStateEntry {
  readonly section: StoryStateSection;
  readonly text: string;
  readonly throughScene?: number;
  readonly isStale?: boolean;
  readonly witnesses?: readonly string[];
}

export interface StoryState {
  readonly throughSceneOrder: number;
  readonly sceneInputHashes: ReadonlyMap<number, string>;
  readonly entries: readonly StoryStateEntry[];
}

const throughLinePattern: RegExp = /^<!--\s*through-scene:\s*(\d+)\s*-->$/;
const sceneInputLinePattern: RegExp = /^<!--\s*scene-input:\s*(\d+)\s+(sha256:[0-9a-f]{64})\s*-->$/;
const sectionEntries: [StoryStateSection, string][] = Object.entries(storyStateSectionLabels) as [
  StoryStateSection,
  string,
][];
const labelToSection: Map<string, StoryStateSection> = new Map(
  sectionEntries.map(([section, label]) => [label, section]),
);

interface RankedStoryStateEntry {
  readonly entry: StoryStateEntry;
  readonly position: number;
  readonly score: number;
}

export function createEmptyStoryState(): StoryState {
  return { throughSceneOrder: 0, sceneInputHashes: new Map(), entries: [] };
}

export function parseStoryState(content: string): StoryState {
  const lines: string[] = content.split('\n');
  let throughSceneOrder: number = 0;
  let current: StoryStateSection | undefined;
  const entries: StoryStateEntry[] = [];
  const sceneInputHashes: Map<number, string> = new Map<number, string>();

  for (const rawLine of lines) {
    const line: string = rawLine.trim();

    const throughMatch: RegExpExecArray | null = throughLinePattern.exec(line);
    if (throughMatch?.[1]) {
      throughSceneOrder = Number.parseInt(throughMatch[1], 10);
      continue;
    }

    const sceneInputMatch: RegExpExecArray | null = sceneInputLinePattern.exec(line);
    if (sceneInputMatch?.[1] && sceneInputMatch[2]) {
      sceneInputHashes.set(Number.parseInt(sceneInputMatch[1], 10), sceneInputMatch[2]);
      continue;
    }

    if (line.startsWith('## ')) {
      current = labelToSection.get(line.slice(3).trim());
      continue;
    }

    if (current && line.startsWith('- ')) {
      const entry: StoryStateEntry | undefined = parseEntryLine(current, line.slice(2).trim());
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return { throughSceneOrder, sceneInputHashes, entries };
}

const entrySceneTagPattern: RegExp = /^\[(\d+)(!?)(?:\|([^\]]*))?\]\s*(.+)$/;

function parseEntryLine(section: StoryStateSection, text: string): StoryStateEntry | undefined {
  if (text.length === 0) {
    return undefined;
  }

  const tagged: RegExpExecArray | null = entrySceneTagPattern.exec(text);
  if (tagged?.[1] && tagged[4]) {
    const witnesses: readonly string[] | undefined = parseWitnesses(tagged[3]);

    return {
      section,
      text: tagged[4],
      throughScene: Number.parseInt(tagged[1], 10),
      ...(tagged[2] === '!' ? { isStale: true } : {}),
      ...(witnesses ? { witnesses } : {}),
    };
  }

  return { section, text };
}

function parseWitnesses(raw: string | undefined): readonly string[] | undefined {
  const names: string[] = (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  return names.length > 0 ? names : undefined;
}

const suspectTagPattern: RegExp = /^\[[^\]]*\]/;

export function findUnreadableStoryStateLines(content: string): string[] {
  const unreadable: string[] = [];
  let insideSection: boolean = false;

  for (const rawLine of content.split('\n')) {
    const line: string = rawLine.trim();

    if (line.startsWith('## ')) {
      insideSection = labelToSection.has(line.slice(3).trim());
      continue;
    }

    if (!insideSection || !line.startsWith('- ')) {
      continue;
    }

    const text: string = line.slice(2).trim();
    if (suspectTagPattern.test(text) && !entrySceneTagPattern.test(text)) {
      unreadable.push(text);
    }
  }

  return unreadable;
}

export function serializeStoryState(state: StoryState): string {
  const blocks: string[] = ['# 이야기 상태', `<!-- through-scene: ${state.throughSceneOrder} -->`];

  for (const order of [...state.sceneInputHashes.keys()].sort((left, right) => left - right)) {
    blocks.push(`<!-- scene-input: ${order} ${state.sceneInputHashes.get(order) as string} -->`);
  }

  for (const [section, label] of sectionEntries) {
    const items: StoryStateEntry[] = state.entries.filter((entry) => entry.section === section);
    if (items.length === 0) {
      continue;
    }

    blocks.push(`## ${label}`, ...items.map((item) => `- ${formatEntryTag(item)}${item.text}`));
  }

  return `${blocks.join('\n')}\n`;
}

function formatEntryTag(entry: StoryStateEntry): string {
  if (entry.throughScene === undefined) {
    return '';
  }

  const witnesses: string =
    entry.witnesses && entry.witnesses.length > 0 ? `|${entry.witnesses.join(',')}` : '';

  return `[${entry.throughScene}${entry.isStale === true ? '!' : ''}${witnesses}] `;
}

export async function readStoryState(
  uri: StoryUri,
  fileSystem: Pick<ReadWriteFileSystem, 'readFile'>,
): Promise<StoryState> {
  try {
    const content: string = new TextDecoder().decode(await fileSystem.readFile(uri));
    return parseStoryState(content);
  } catch {
    return createEmptyStoryState();
  }
}

export async function writeStoryState(
  uri: StoryUri,
  state: StoryState,
  fileSystem: Pick<ReadWriteFileSystem, 'writeFile'>,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeStoryState(state)));
}

const sectionInjectionBudget: number = 24;

export function mergeStoryState(
  previous: StoryState,
  additions: readonly StoryStateEntry[],
  throughSceneOrder: number,
  sceneInputHash: string,
): StoryState {
  const merged: StoryStateEntry[] = rewindEntriesAfter(
    previous.entries.filter((entry) => entry.throughScene !== throughSceneOrder),
    throughSceneOrder,
  );
  const seen: Set<string> = new Set(merged.map((entry) => `${entry.section}:${entry.text}`));

  for (const addition of additions) {
    const text: string = addition.text.trim();
    if (text.length === 0) {
      continue;
    }

    const key: string = `${addition.section}:${text}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({
      section: addition.section,
      text,
      throughScene: throughSceneOrder,
      ...(addition.witnesses && addition.witnesses.length > 0
        ? { witnesses: addition.witnesses }
        : {}),
    });
  }

  return {
    throughSceneOrder: Math.max(previous.throughSceneOrder, throughSceneOrder),
    sceneInputHashes: withSceneInputHash(previous, throughSceneOrder, sceneInputHash),
    entries: merged,
  };
}

export function recordStoryStateScene(
  previous: StoryState,
  throughSceneOrder: number,
  sceneInputHash: string,
): StoryState {
  return {
    throughSceneOrder: Math.max(previous.throughSceneOrder, throughSceneOrder),
    sceneInputHashes: withSceneInputHash(previous, throughSceneOrder, sceneInputHash),
    entries: rewindEntriesAfter(previous.entries, throughSceneOrder),
  };
}

function rewindEntriesAfter(
  entries: readonly StoryStateEntry[],
  throughSceneOrder: number,
): StoryStateEntry[] {
  return entries.map((entry) =>
    entry.throughScene !== undefined && entry.throughScene > throughSceneOrder
      ? { ...entry, isStale: true }
      : entry,
  );
}

function withSceneInputHash(
  previous: StoryState,
  throughSceneOrder: number,
  sceneInputHash: string,
): ReadonlyMap<number, string> {
  const sceneInputHashes: Map<number, string> = new Map(previous.sceneInputHashes);
  sceneInputHashes.set(throughSceneOrder, sceneInputHash);

  return sceneInputHashes;
}

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

  const sceneTextCompact: string = compactForOverlap(sceneText);
  const ranked: RankedStoryStateEntry[] = entries
    .map(
      (entry, position): RankedStoryStateEntry => ({
        entry,
        position,
        score: countTextOverlap(entry.text, sceneTextCompact),
      }),
    )
    .sort((left, right) => right.score - left.score || right.position - left.position)
    .slice(0, budget);

  return ranked.sort((left, right) => left.position - right.position).map((item) => item.entry);
}

const overlapGramSize: number = 3;

function countTextOverlap(text: string, sceneTextCompact: string): number {
  const compact: string = compactForOverlap(text);
  if (compact.length < overlapGramSize) {
    return 0;
  }

  const grams: Set<string> = new Set<string>();
  for (let offset: number = 0; offset + overlapGramSize <= compact.length; offset += 1) {
    grams.add(compact.slice(offset, offset + overlapGramSize));
  }

  let hits: number = 0;
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

const characterKnowledgeSections: readonly StoryStateSection[] = ['facts', 'revealed'];
const characterKnowledgeBudget: number = 8;

export function selectCharacterKnowledge(
  state: StoryState,
  characterId: string,
  beforeSceneOrder: number | undefined,
  sceneText?: string,
): string[] {
  const visible: StoryStateEntry[] = state.entries.filter(
    (entry) =>
      characterKnowledgeSections.includes(entry.section) &&
      entry.isStale !== true &&
      (beforeSceneOrder === undefined ||
        entry.throughScene === undefined ||
        entry.throughScene < beforeSceneOrder) &&
      isWitnessedBy(entry, { focal: characterId }),
  );

  return selectWithinBudget(visible, sceneText, characterKnowledgeBudget).map(
    (entry) => entry.text,
  );
}

const characterRelationBudget: number = 4;

export function selectCharacterRelations(
  state: StoryState,
  character: { readonly id: string; readonly names: readonly string[] },
  beforeSceneOrder: number | undefined,
): string[] {
  const names: string[] = character.names.filter((name) => name.trim().length > 0);

  return state.entries
    .filter(
      (entry) =>
        entry.section === 'relations' &&
        entry.isStale !== true &&
        (beforeSceneOrder === undefined ||
          entry.throughScene === undefined ||
          entry.throughScene < beforeSceneOrder) &&
        isWitnessedBy(entry, { focal: character.id }) &&
        names.some((name) => entry.text.includes(name)),
    )
    .slice(-characterRelationBudget)
    .map((entry) => entry.text);
}

export interface StoryStateFocalFilter {
  readonly focal?: string;
  readonly witnessedByAll?: readonly string[];
}

export function selectStoryStateEntries(
  state: StoryState,
  section: StoryStateSection,
  beforeSceneOrder: number | undefined,
  sceneText?: string,
  focalFilter?: StoryStateFocalFilter,
): StoryStateEntry[] {
  const visible: StoryStateEntry[] = state.entries.filter(
    (entry) =>
      entry.section === section &&
      entry.isStale !== true &&
      (beforeSceneOrder === undefined ||
        entry.throughScene === undefined ||
        entry.throughScene < beforeSceneOrder) &&
      isWitnessedBy(entry, focalFilter),
  );

  return selectWithinBudget(visible, sceneText, sectionInjectionBudget);
}

function isWitnessedBy(
  entry: StoryStateEntry,
  focalFilter: StoryStateFocalFilter | undefined,
): boolean {
  const witnesses: readonly string[] | undefined = entry.witnesses;
  if (!focalFilter || !witnesses || witnesses.length === 0) {
    return true;
  }

  if (focalFilter.focal !== undefined && !witnesses.includes(focalFilter.focal)) {
    return false;
  }

  return (focalFilter.witnessedByAll ?? []).every((id) => witnesses.includes(id));
}

export function formatStoryStateForPrompt(
  state: StoryState,
  beforeSceneOrder?: number,
  sceneText?: string,
  focalFilter?: StoryStateFocalFilter,
): string | undefined {
  const blocks: string[] = sectionEntries.flatMap(([section, label]) => {
    const items: StoryStateEntry[] = selectStoryStateEntries(
      state,
      section,
      beforeSceneOrder,
      sceneText,
      focalFilter,
    );
    return items.length > 0 ? [`${label}:`, ...items.map((item) => `- ${item.text}`)] : [];
  });

  if (blocks.length === 0) {
    return undefined;
  }

  return ['[이야기 상태]', ...blocks].join('\n');
}

export interface StoryStateAudit {
  readonly state: StoryState;
  readonly staleSceneOrders: readonly number[];
  readonly unsealedSceneOrders: readonly number[];
  readonly staleEntryCount: number;
}

export function storyStateSceneOrders(state: StoryState): number[] {
  const orders: Set<number> = new Set<number>();

  for (const entry of state.entries) {
    if (entry.throughScene !== undefined) {
      orders.add(entry.throughScene);
    }
  }

  return [...orders].sort((left, right) => left - right);
}

export function auditStoryState(
  state: StoryState,
  currentSceneInputHashes: ReadonlyMap<number, string>,
  beforeSceneOrder?: number,
): StoryStateAudit {
  const unsealedSceneOrders: number[] = [];
  const staleOrders: Set<number> = new Set<number>();

  for (const order of storyStateSceneOrders(state)) {
    const recorded: string | undefined = state.sceneInputHashes.get(order);

    if (recorded === undefined) {
      unsealedSceneOrders.push(order);
      continue;
    }

    if (currentSceneInputHashes.get(order) !== recorded) {
      staleOrders.add(order);
    }
  }

  for (const entry of state.entries) {
    if (entry.isStale === true && entry.throughScene !== undefined) {
      staleOrders.add(entry.throughScene);
    }
  }

  const entries: StoryStateEntry[] = state.entries.map((entry) =>
    entry.throughScene !== undefined && staleOrders.has(entry.throughScene)
      ? { ...entry, isStale: true }
      : entry,
  );

  const isReported = (order: number): boolean =>
    beforeSceneOrder === undefined || order < beforeSceneOrder;
  const reportedStaleOrders: number[] = [...staleOrders]
    .filter(isReported)
    .sort((left, right) => left - right);
  const reportedStaleSet: Set<number> = new Set(reportedStaleOrders);

  return {
    state: { ...state, entries },
    staleSceneOrders: reportedStaleOrders,
    unsealedSceneOrders: unsealedSceneOrders.filter(isReported),
    staleEntryCount: entries.filter(
      (entry) => entry.throughScene !== undefined && reportedStaleSet.has(entry.throughScene),
    ).length,
  };
}

export function sealStoryState(
  state: StoryState,
  currentSceneInputHashes: ReadonlyMap<number, string>,
): StoryState {
  const sceneInputHashes: Map<number, string> = new Map(state.sceneInputHashes);

  for (const order of storyStateSceneOrders(state)) {
    const current: string | undefined = currentSceneInputHashes.get(order);

    if (current !== undefined && !sceneInputHashes.has(order)) {
      sceneInputHashes.set(order, current);
    }
  }

  return { ...state, sceneInputHashes };
}

export function resealStoryState(
  state: StoryState,
  currentSceneInputHashes: ReadonlyMap<number, string>,
  sceneOrders: ReadonlySet<number>,
): StoryState {
  const sceneInputHashes: Map<number, string> = new Map(state.sceneInputHashes);

  for (const order of sceneOrders) {
    const current: string | undefined = currentSceneInputHashes.get(order);

    if (current !== undefined) {
      sceneInputHashes.set(order, current);
    }
  }

  const entries: StoryStateEntry[] = state.entries.map((entry): StoryStateEntry => {
    if (entry.throughScene === undefined || !sceneOrders.has(entry.throughScene)) {
      return entry;
    }

    const { isStale: _cleared, ...kept } = entry;

    return kept;
  });

  return { ...state, sceneInputHashes, entries };
}

export function formatSceneOrderRanges(orders: readonly number[]): string {
  const sorted: number[] = [...new Set(orders)].sort((left, right) => left - right);
  const ranges: { start: number; end: number }[] = [];

  for (const order of sorted) {
    const last: { start: number; end: number } | undefined = ranges[ranges.length - 1];

    if (last !== undefined && order === last.end + 1) {
      last.end = order;
      continue;
    }

    ranges.push({ start: order, end: order });
  }

  return ranges
    .map((range) => (range.start === range.end ? `${range.start}` : `${range.start}~${range.end}`))
    .join(', ');
}

export function formatStoryStateStaleWarning(audit: StoryStateAudit): string | undefined {
  if (audit.staleSceneOrders.length === 0) {
    return undefined;
  }

  return `이야기 상태 원장에 낡은 항목 ${audit.staleEntryCount}개가 있습니다 (씬 ${formatSceneOrderRanges(audit.staleSceneOrders)}). 프롬프트에서 제외했습니다 — 해당 씬을 다시 생성하면 사라집니다.`;
}
