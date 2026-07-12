import { z } from 'zod';

import type { UsageSummaryByEntity } from '../services/ai/types';
import {
  aiProviderIds,
  aiTaskNames,
  type AiProviderId,
  type AiTaskName,
  type AiUsage,
  type EntityKind,
  type UsageAttribution,
  type UsageRecord,
} from '../services/ai/types';

const usageLedgerVersion = 1 as const;

export type UsageLedgerEntry = UsageRecord & {
  readonly id: string;
  readonly recordedAt: string;
};

const entityKindSchema = z.enum(['scene', 'character', 'background']);

const entityRefSchema = z.object({
  kind: entityKindSchema,
  id: z.string().trim().min(1),
});

const usageAttributionSchema = z.object({
  primary: entityRefSchema.optional(),
  participants: z.array(entityRefSchema).optional(),
});

const aiUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  cacheCreationInputTokens: z.number().nonnegative().optional(),
});

const usageLedgerEntrySchema = z.object({
  id: z.string().trim().min(1),
  recordedAt: z.string().trim().min(1),
  taskName: z.enum(aiTaskNames),
  providerId: z.enum(aiProviderIds),
  model: z.string().optional(),
  usage: aiUsageSchema.optional(),
  costUsd: z.number(),
  attribution: usageAttributionSchema,
});

const usageLedgerFileSchema = z.object({
  version: z.literal(usageLedgerVersion),
  entries: z.array(usageLedgerEntrySchema),
});

export interface UsageLedgerFileSystem {
  readonly readFile: (uri: unknown) => Promise<Uint8Array>;
  readonly writeFile: (uri: unknown, content: Uint8Array) => Promise<void>;
  readonly createDirectory: (uri: unknown) => Promise<void>;
}

export function emptyUsageSummary(): UsageSummaryByEntity {
  return {
    scenes: {},
    characters: {},
    backgrounds: {},
    totalUsd: 0,
  };
}

export function mergeUsageLedgerEntryIntoSummary(
  summary: UsageSummaryByEntity,
  entry: Pick<UsageLedgerEntry, 'costUsd' | 'attribution'>,
): UsageSummaryByEntity {
  const nextScenes = { ...summary.scenes };
  const nextCharacters = { ...summary.characters };
  const nextBackgrounds = { ...summary.backgrounds };

  const add = (kind: EntityKind, entityId: string, delta: number): void => {
    switch (kind) {
      case 'scene': {
        nextScenes[entityId] = (nextScenes[entityId] ?? 0) + delta;
        return;
      }
      case 'character': {
        nextCharacters[entityId] = (nextCharacters[entityId] ?? 0) + delta;
        return;
      }
      case 'background': {
        nextBackgrounds[entityId] = (nextBackgrounds[entityId] ?? 0) + delta;
        return;
      }
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  };

  const totalUsd = summary.totalUsd + entry.costUsd;

  const { primary, participants = [] } = entry.attribution;

  if (primary) {
    add(primary.kind, primary.id, entry.costUsd);
  }

  if (participants.length > 0) {
    const share = entry.costUsd / participants.length;

    for (const participant of participants) {
      add(participant.kind, participant.id, share);
    }
  }

  return {
    scenes: nextScenes,
    characters: nextCharacters,
    backgrounds: nextBackgrounds,
    totalUsd,
  };
}

export function computeUsageSummaryFromEntries(
  entries: readonly UsageLedgerEntry[],
): UsageSummaryByEntity {
  let summary = emptyUsageSummary();

  for (const entry of entries) {
    summary = mergeUsageLedgerEntryIntoSummary(summary, entry);
  }

  return summary;
}

export function parseUsageLedgerBytes(
  bytes: Uint8Array,
  warn?: (message: string) => void,
): UsageLedgerEntry[] {
  let text: string;

  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    warn?.('Storyboard usage ledger is not valid UTF-8; starting from an empty ledger.');
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    warn?.('Storyboard usage ledger is corrupted (invalid JSON); starting from an empty ledger.');
    return [];
  }

  const decoded = usageLedgerFileSchema.safeParse(parsed);

  if (!decoded.success) {
    warn?.(
      'Storyboard usage ledger is corrupted (unexpected shape); starting from an empty ledger.',
    );
    return [];
  }

  return decoded.data.entries.map(toUsageLedgerEntry);
}

export function serializeUsageLedger(entries: readonly UsageLedgerEntry[]): Uint8Array {
  const payload = {
    version: usageLedgerVersion,
    entries: entries.map(serializeLedgerEntry),
  };

  return new TextEncoder().encode(JSON.stringify(payload));
}

export async function readUsageLedgerFromUri(
  fs: UsageLedgerFileSystem,
  ledgerUri: unknown,
  warn?: (message: string) => void,
): Promise<UsageLedgerEntry[]> {
  try {
    const bytes = await fs.readFile(ledgerUri);
    return parseUsageLedgerBytes(bytes, warn);
  } catch {
    return [];
  }
}

export async function writeUsageLedgerToUri(
  fs: UsageLedgerFileSystem,
  ledgerUri: unknown,
  entries: readonly UsageLedgerEntry[],
): Promise<void> {
  await fs.writeFile(ledgerUri, serializeUsageLedger(entries));
}

export function appendLedgerEntryIfNew(
  entries: readonly UsageLedgerEntry[],
  entry: UsageLedgerEntry,
): { readonly entries: UsageLedgerEntry[]; readonly appended: boolean } {
  if (entries.some((existing) => existing.id === entry.id)) {
    return { entries: [...entries], appended: false };
  }

  return { entries: [...entries, entry], appended: true };
}

function serializeLedgerEntry(entry: UsageLedgerEntry): SerializedLedgerEntry {
  return {
    id: entry.id,
    recordedAt: entry.recordedAt,
    taskName: entry.taskName,
    providerId: entry.providerId,
    model: entry.model,
    usage: entry.usage,
    costUsd: entry.costUsd,
    attribution: entry.attribution,
  };
}

interface SerializedLedgerEntry {
  readonly id: string;
  readonly recordedAt: string;
  readonly taskName: AiTaskName;
  readonly providerId: AiProviderId;
  readonly model?: string;
  readonly usage?: AiUsage;
  readonly costUsd: number;
  readonly attribution: UsageAttribution;
}

function toUsageLedgerEntry(value: z.infer<typeof usageLedgerEntrySchema>): UsageLedgerEntry {
  return {
    id: value.id,
    recordedAt: value.recordedAt,
    taskName: value.taskName,
    providerId: value.providerId,
    model: value.model,
    usage: value.usage,
    costUsd: value.costUsd,
    attribution: value.attribution,
  };
}
