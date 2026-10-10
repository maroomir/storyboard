import type { StoryUri } from './storyUri';
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
  // NOTE: 그 항목을 낳은 입력이 더 이상 워크스페이스에 없다는 표시. 지우지 않고 표시만 하는 것은
  // 사람이 무엇이 버려졌는지 원장에서 볼 수 있어야 하기 때문이다. 프롬프트에서만 빠진다.
  readonly isStale?: boolean;
  // NOTE: 그 사실이 확립된 씬에 있던 인물들. 목격 범위 서술자는 초점 인물이 여기 없는 항목을
  // 프롬프트에서 받지 못한다 — 화자가 모르는 사실을 서술하는 것이 시점 이탈이기 때문이다.
  // 목격자가 적히지 않은 항목(구 버전 원장)은 판정할 수 없으므로 그대로 통과시킨다.
  readonly witnesses?: readonly string[];
}

export interface StoryState {
  readonly throughSceneOrder: number;
  // NOTE: 항목을 낳은 씬의 입력 해시(scene cache와 같은 computeSceneInputHash 값). 카드나 씬을
  // 고친 뒤 그 씬을 다시 생성하지 않으면 원장만 옛 전제를 붙들고 있으므로, 기록해 두고 대조한다.
  // 해시가 없는 씬(0.8 이전 원장)은 대조할 수 없으므로 유효한 것으로 본다.
  readonly sceneInputHashes: ReadonlyMap<number, string>;
  readonly entries: readonly StoryStateEntry[];
}

export interface StoryStateFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
}

const throughLinePattern = /^<!--\s*through-scene:\s*(\d+)\s*-->$/;
const sceneInputLinePattern = /^<!--\s*scene-input:\s*(\d+)\s+(sha256:[0-9a-f]{64})\s*-->$/;
const sectionEntries = Object.entries(storyStateSectionLabels) as [StoryStateSection, string][];
const labelToSection = new Map(sectionEntries.map(([section, label]) => [label, section]));

export function createEmptyStoryState(): StoryState {
  return { throughSceneOrder: 0, sceneInputHashes: new Map(), entries: [] };
}

export function parseStoryState(content: string): StoryState {
  const lines = content.split('\n');
  let throughSceneOrder = 0;
  let current: StoryStateSection | undefined;
  const entries: StoryStateEntry[] = [];
  const sceneInputHashes = new Map<number, string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const throughMatch = throughLinePattern.exec(line);
    if (throughMatch?.[1]) {
      throughSceneOrder = Number.parseInt(throughMatch[1], 10);
      continue;
    }

    const sceneInputMatch = sceneInputLinePattern.exec(line);
    if (sceneInputMatch?.[1] && sceneInputMatch[2]) {
      sceneInputHashes.set(Number.parseInt(sceneInputMatch[1], 10), sceneInputMatch[2]);
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

  return { throughSceneOrder, sceneInputHashes, entries };
}

// `[12]`·`[12!]`·`[12|hana,jun]`·`[12!|hana,jun]` 네 형태를 모두 읽는다. `!` 는 낡은 항목,
// `|` 뒤는 목격자다. 둘 다 없는 형태가 구 버전 원장이다.
const entrySceneTagPattern = /^\[(\d+)(!?)(?:\|([^\]]*))?\]\s*(.+)$/;

function parseEntryLine(section: StoryStateSection, text: string): StoryStateEntry | undefined {
  if (text.length === 0) {
    return undefined;
  }

  const tagged = entrySceneTagPattern.exec(text);
  if (tagged?.[1] && tagged[4]) {
    const witnesses = parseWitnesses(tagged[3]);

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
  const names = (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  return names.length > 0 ? names : undefined;
}

// 태그처럼 생겼지만 태그로 읽히지 않는 줄. 손으로 고치다 `[3!!]`이나 `[삼]`처럼 만들면 대괄호가
// 본문의 일부가 되어 씬 번호도 목격자도 붙지 않는다 — 파싱은 계속되지만 그 항목은 시점 필터도
// 낡음 판정도 받지 못하므로, doctor가 사람에게 알린다.
const suspectTagPattern = /^\[[^\]]*\]/;

export function findUnreadableStoryStateLines(content: string): string[] {
  const unreadable: string[] = [];
  let insideSection = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (line.startsWith('## ')) {
      insideSection = labelToSection.has(line.slice(3).trim());
      continue;
    }

    if (!insideSection || !line.startsWith('- ')) {
      continue;
    }

    const text = line.slice(2).trim();
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
    const items = state.entries.filter((entry) => entry.section === section);
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

  const witnesses =
    entry.witnesses && entry.witnesses.length > 0 ? `|${entry.witnesses.join(',')}` : '';

  return `[${entry.throughScene}${entry.isStale === true ? '!' : ''}${witnesses}] `;
}

export async function readStoryState(
  uri: StoryUri,
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
  uri: StoryUri,
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
  sceneInputHash: string,
): StoryState {
  // NOTE: 같은 씬을 다시 생성하면 그 씬이 앞서 남긴 항목은 낡은 판본이므로 걷어내고 새로 쌓는다.
  // 그러지 않으면 폐기된 전개가 원장에 남아 뒤 씬으로 계속 전달된다.
  const merged: StoryStateEntry[] = rewindEntriesAfter(
    previous.entries.filter((entry) => entry.throughScene !== throughSceneOrder),
    throughSceneOrder,
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

// 항목은 그대로 두고 이번 판본의 기준만 남긴다. 원장 갱신이 실패해도 되감기와 입력 해시는 남아야
// 다음 감사가 옳은 기준으로 대조한다. 그 씬의 기존 항목까지 지우지는 않는다 — 갱신 실패로 기억을
// 잃는 쪽이 더 나쁘다.
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

// 되감기. 다시 만든 씬보다 뒤 항목은 이제 폐기된 판본을 전제로 뽑힌 것이다. 지우지 않고 표시만
// 하므로, 그 씬을 다시 생성하면 mergeStoryState가 통째로 갈아 끼우면서 표시도 함께 사라진다.
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
  const sceneInputHashes = new Map(previous.sceneInputHashes);
  sceneInputHashes.set(throughSceneOrder, sceneInputHash);

  return sceneInputHashes;
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

// NOTE: 인물별 «아는 것». 초점 필터는 서술자 한 명에게만 걸리고 대화하는 나머지 인물에게는 원장
// 전체가 보였다. 뼈대·다듬기가 인물마다 이것만 보게 하면 «아직 못 들은 사실을 말하는» 경계 위반을
// 지시문이 아니라 재료로 막는다. 목격자가 없는 구 항목은 판정할 수 없으므로 모두에게 보인다.
const characterKnowledgeSections: readonly StoryStateSection[] = ['facts', 'revealed'];
const characterKnowledgeBudget = 8;

export function selectCharacterKnowledge(
  state: StoryState,
  characterId: string,
  beforeSceneOrder: number | undefined,
  sceneText?: string,
): string[] {
  const visible = state.entries.filter(
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

// NOTE: 인물별 «관계 변화». 카드 relations 의 speech 는 처음 정한 말투라, 앞선 장면에서 «이제 반말을
// 쓴다»처럼 바뀐 관계를 모른다. 다듬기가 카드만 보면 뼈대가 맞게 바꾼 말투를 카드의 초기값으로
// 되돌리므로, 원장의 관계 항목 중 그 인물의 이름이 나오는 최근 것을 함께 준다.
const characterRelationBudget = 4;

export function selectCharacterRelations(
  state: StoryState,
  character: { readonly id: string; readonly names: readonly string[] },
  beforeSceneOrder: number | undefined,
): string[] {
  const names = character.names.filter((name) => name.trim().length > 0);

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

// 목격 범위 서술자의 초점 인물. 주면 그 인물이 목격하지 않은 항목을 주입에서 뺀다.
// witnessedByAll 을 주면 그 인물 모두가 목격한 항목만 남긴다 — 뼈대는 모든 인물의 대사를 쓰므로,
// 한 인물만 아는 사실이 공용 맥락에 있으면 다른 인물이 그것을 말해 버린다(#104).
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
  const visible = state.entries.filter(
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
  const witnesses = entry.witnesses;
  if (!focalFilter || !witnesses || witnesses.length === 0) {
    return true;
  }

  if (focalFilter.focal !== undefined && !witnesses.includes(focalFilter.focal)) {
    return false;
  }

  return (focalFilter.witnessedByAll ?? []).every((id) => witnesses.includes(id));
}

// NOTE: beforeSceneOrder를 주면 그 씬보다 앞에서 확립된 항목만 남긴다. 앞 씬을 다시 생성할 때
// 뒤 씬의 상태가 프롬프트로 새는 것을 막는다.
export function formatStoryStateForPrompt(
  state: StoryState,
  beforeSceneOrder?: number,
  sceneText?: string,
  focalFilter?: StoryStateFocalFilter,
): string | undefined {
  const blocks = sectionEntries.flatMap(([section, label]) => {
    const items = selectStoryStateEntries(state, section, beforeSceneOrder, sceneText, focalFilter);
    return items.length > 0 ? [`${label}:`, ...items.map((item) => `- ${item.text}`)] : [];
  });

  if (blocks.length === 0) {
    return undefined;
  }

  return ['[이야기 상태]', ...blocks].join('\n');
}

// NOTE: 원장 항목이 어떤 입력에서 나왔는지를 대조하는 감사. 판정은 두 가지다.
//   1) 기록된 입력 해시와 현재 해시가 다르면 그 씬의 항목은 낡았다(카드·씬을 고쳤다).
//   2) 어떤 씬을 다시 생성하면 그보다 뒤 항목이 낡는다 — 이쪽은 mergeStoryState가 표시한다.
// 해시가 기록되지 않은 씬(0.8 이전 원장)은 대조할 근거가 없으므로 유효로 두고 봉인 대상으로만
// 보고한다. 없는 근거로 사실을 버리는 쪽이 더 나쁘다.
export interface StoryStateAudit {
  readonly state: StoryState;
  readonly staleSceneOrders: readonly number[];
  readonly unsealedSceneOrders: readonly number[];
  readonly staleEntryCount: number;
}

export function storyStateSceneOrders(state: StoryState): number[] {
  const orders = new Set<number>();

  for (const entry of state.entries) {
    if (entry.throughScene !== undefined) {
      orders.add(entry.throughScene);
    }
  }

  return [...orders].sort((left, right) => left - right);
}

// beforeSceneOrder를 주면 그 씬보다 앞에서 확립된 것만 보고한다. 뒤 씬의 낡은 항목은 어차피
// 이번 프롬프트에 실리지 않으므로, 32씬을 순서대로 다시 만드는 동안 매 씬 경고가 뜨는 것을 막는다.
// 표시(state) 자체는 언제나 원장 전체에 대해 매긴다.
export function auditStoryState(
  state: StoryState,
  currentSceneInputHashes: ReadonlyMap<number, string>,
  beforeSceneOrder?: number,
): StoryStateAudit {
  const unsealedSceneOrders: number[] = [];
  const staleOrders = new Set<number>();

  for (const order of storyStateSceneOrders(state)) {
    const recorded = state.sceneInputHashes.get(order);

    if (recorded === undefined) {
      unsealedSceneOrders.push(order);
      continue;
    }

    if (currentSceneInputHashes.get(order) !== recorded) {
      staleOrders.add(order);
    }
  }

  // 되감기로 이미 표시된 씬도 같은 낡음이다. 감사 결과가 보고하는 범위에 함께 넣는다.
  for (const entry of state.entries) {
    if (entry.isStale === true && entry.throughScene !== undefined) {
      staleOrders.add(entry.throughScene);
    }
  }

  const entries = state.entries.map((entry) =>
    entry.throughScene !== undefined && staleOrders.has(entry.throughScene)
      ? { ...entry, isStale: true }
      : entry,
  );

  const isReported = (order: number): boolean =>
    beforeSceneOrder === undefined || order < beforeSceneOrder;
  const reportedStaleOrders = [...staleOrders]
    .filter(isReported)
    .sort((left, right) => left - right);
  const reportedStaleSet = new Set(reportedStaleOrders);

  return {
    state: { ...state, entries },
    staleSceneOrders: reportedStaleOrders,
    unsealedSceneOrders: unsealedSceneOrders.filter(isReported),
    staleEntryCount: entries.filter(
      (entry) => entry.throughScene !== undefined && reportedStaleSet.has(entry.throughScene),
    ).length,
  };
}

// 봉인은 대조 근거를 만드는 일회성 조치다. 이미 기록된 씬은 건드리지 않는다 — 덮어쓰면 고쳐 놓고
// 다시 생성하지 않은 씬이 유효한 것으로 둔갑한다.
export function sealStoryState(
  state: StoryState,
  currentSceneInputHashes: ReadonlyMap<number, string>,
): StoryState {
  const sceneInputHashes = new Map(state.sceneInputHashes);

  for (const order of storyStateSceneOrders(state)) {
    const current = currentSceneInputHashes.get(order);

    if (current !== undefined && !sceneInputHashes.has(order)) {
      sceneInputHashes.set(order, current);
    }
  }

  return { ...state, sceneInputHashes };
}

// NOTE: 봉인과 달리 이미 기록된 해시를 덮어쓰고 낡음 표시를 지운다. 카드만 고치고 초안은 그대로
// 쓰기로 한 판단을 원장에 반영하는 유일한 길이므로, 대상 씬을 반드시 명시적으로 받는다.
export function resealStoryState(
  state: StoryState,
  currentSceneInputHashes: ReadonlyMap<number, string>,
  sceneOrders: ReadonlySet<number>,
): StoryState {
  const sceneInputHashes = new Map(state.sceneInputHashes);

  for (const order of sceneOrders) {
    const current = currentSceneInputHashes.get(order);

    if (current !== undefined) {
      sceneInputHashes.set(order, current);
    }
  }

  const entries = state.entries.map((entry) => {
    if (entry.throughScene === undefined || !sceneOrders.has(entry.throughScene)) {
      return entry;
    }

    const { isStale: _cleared, ...kept } = entry;

    return kept;
  });

  return { ...state, sceneInputHashes, entries };
}

export function formatSceneOrderRanges(orders: readonly number[]): string {
  const sorted = [...new Set(orders)].sort((left, right) => left - right);
  const ranges: { start: number; end: number }[] = [];

  for (const order of sorted) {
    const last = ranges[ranges.length - 1];

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
