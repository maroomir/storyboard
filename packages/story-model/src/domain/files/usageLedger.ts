import type { StoryUri } from '#model/format/storyUri';
import type { AiProviderId } from '#model/contracts/providerCatalog';
import type {
  AiTaskName,
  UsageAmount,
  UsageCacheAmount,
  UsageSummaryByEntity,
} from '#model/contracts/ai';
import type {
  AiUsage,
  EntityKind,
  EntityRef,
  UsageAttribution,
  UsageRecord,
} from '#model/contracts/aiTypes';
import { z } from 'zod';

import {
  aiProviderIds,
  storyboardModelPricing,
  type ModelPricePerMillion,
} from '#model/contracts/providerCatalog';
import { addUsageAmount, aiTaskNames, emptyUsageAmount } from '#model/contracts/ai';
type UsageLedgerVersion = 1;

const usageLedgerVersion: UsageLedgerVersion = 1;

export type UsageLedgerEntry = UsageRecord & {
  readonly id: string;
  readonly recordedAt: string;
};

const entityKindSchema: z.ZodType<EntityKind> = z.enum([
  'scene',
  'character',
  'background',
  'project',
]);

const entityRefSchema: z.ZodType<EntityRef> = z.object({
  kind: entityKindSchema,
  id: z.string().trim().min(1),
});

const usageAttributionSchema: z.ZodType<UsageAttribution> = z.object({
  primary: entityRefSchema.optional(),
  participants: z.array(entityRefSchema).optional(),
});

const aiUsageSchema: z.ZodType<AiUsage> = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  cacheCreationInputTokens: z.number().nonnegative().optional(),
});

interface UsageLedgerEntryPayload {
  id: string;
  recordedAt: string;
  taskName: AiTaskName;
  providerId: AiProviderId;
  attribution: UsageAttribution;
  model?: string;
  usage?: AiUsage;
  costUsd?: number;
}

const usageLedgerEntrySchema: z.ZodType<UsageLedgerEntryPayload> = z.object({
  id: z.string().trim().min(1),
  recordedAt: z.string().trim().min(1),
  taskName: z.enum(aiTaskNames),
  providerId: z.enum(aiProviderIds),
  model: z.string().optional(),
  usage: aiUsageSchema.optional(),
  costUsd: z.number().optional(),
  attribution: usageAttributionSchema,
});

interface UsageLedgerFile {
  version: 1;
  entries: UsageLedgerEntryPayload[];
}

const usageLedgerFileSchema: z.ZodType<UsageLedgerFile> = z.object({
  version: z.literal(usageLedgerVersion),
  entries: z.array(usageLedgerEntrySchema),
});

export interface UsageLedgerFileSystem {
  readonly readFile: (uri: StoryUri) => Promise<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => Promise<void>;
  readonly createDirectory: (uri: StoryUri) => Promise<void>;
}

export function emptyUsageSummary(): UsageSummaryByEntity {
  return {
    scenes: {},
    characters: {},
    backgrounds: {},
    total: emptyUsageAmount(),
  };
}

function usageCacheOfEntry(
  entry: Pick<UsageLedgerEntry, 'usage' | 'providerId' | 'model'>,
): UsageCacheAmount | undefined {
  const usage: AiUsage | undefined = entry.usage;
  if (
    usage === undefined ||
    (usage.cacheReadInputTokens === undefined && usage.cacheCreationInputTokens === undefined)
  ) {
    return undefined;
  }

  const cachedTokens: number = usage.cacheReadInputTokens ?? 0;
  const table: Readonly<Record<string, ModelPricePerMillion>> = storyboardModelPricing[
    entry.providerId
  ] as Readonly<Record<string, ModelPricePerMillion>>;
  const row: ModelPricePerMillion | undefined =
    entry.model === undefined ? undefined : table[entry.model];
  const savedPerMillion: number =
    row === undefined || row.cacheReadPricePerMillion === undefined
      ? 0
      : row.inputPricePerMillion - row.cacheReadPricePerMillion;

  return {
    promptTokens: usage.inputTokens + cachedTokens + (usage.cacheCreationInputTokens ?? 0),
    cachedTokens,
    savedUsd: (cachedTokens / 1_000_000) * savedPerMillion,
  };
}

export function usageAmountOfEntry(
  entry: Pick<UsageLedgerEntry, 'costUsd' | 'usage' | 'providerId' | 'model'>,
): UsageAmount {
  const tokens: number = entry.usage ? entry.usage.inputTokens + entry.usage.outputTokens : 0;
  const cache: UsageCacheAmount | undefined = usageCacheOfEntry(entry);

  return {
    costUsd: entry.costUsd ?? 0,
    tokens,
    hasUnpricedUsage: entry.costUsd === undefined && tokens > 0,
    ...(cache === undefined ? {} : { cache }),
  };
}

function scaleUsageAmount(amount: UsageAmount, factor: number): UsageAmount {
  return {
    ...amount,
    costUsd: amount.costUsd * factor,
    tokens: amount.tokens * factor,
    ...(amount.cache === undefined
      ? {}
      : {
          cache: {
            promptTokens: amount.cache.promptTokens * factor,
            cachedTokens: amount.cache.cachedTokens * factor,
            savedUsd: amount.cache.savedUsd * factor,
          },
        }),
  };
}

export function mergeUsageLedgerEntryIntoSummary(
  summary: UsageSummaryByEntity,
  entry: Pick<UsageLedgerEntry, 'costUsd' | 'usage' | 'attribution' | 'providerId' | 'model'>,
): UsageSummaryByEntity {
  const nextScenes: Record<string, UsageAmount> = { ...summary.scenes };
  const nextCharacters: Record<string, UsageAmount> = { ...summary.characters };
  const nextBackgrounds: Record<string, UsageAmount> = { ...summary.backgrounds };

  const add = (kind: EntityKind, entityId: string, delta: UsageAmount): void => {
    switch (kind) {
      case 'scene': {
        nextScenes[entityId] = addUsageAmount(nextScenes[entityId] ?? emptyUsageAmount(), delta);
        return;
      }
      case 'character': {
        nextCharacters[entityId] = addUsageAmount(
          nextCharacters[entityId] ?? emptyUsageAmount(),
          delta,
        );
        return;
      }
      case 'background': {
        nextBackgrounds[entityId] = addUsageAmount(
          nextBackgrounds[entityId] ?? emptyUsageAmount(),
          delta,
        );
        return;
      }
      case 'project': {
        return;
      }
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  };

  const amount: UsageAmount = usageAmountOfEntry(entry);
  const total: UsageAmount = addUsageAmount(summary.total, amount);

  const { primary, participants = [] } = entry.attribution;

  if (primary) {
    add(primary.kind, primary.id, amount);
  }

  if (participants.length > 0) {
    const share: UsageAmount = scaleUsageAmount(amount, 1 / participants.length);

    for (const participant of participants) {
      add(participant.kind, participant.id, share);
    }
  }

  return {
    scenes: nextScenes,
    characters: nextCharacters,
    backgrounds: nextBackgrounds,
    total,
  };
}

export function computeUsageSummaryFromEntries(
  entries: readonly UsageLedgerEntry[],
): UsageSummaryByEntity {
  let summary: UsageSummaryByEntity = emptyUsageSummary();

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

  const decoded: z.ZodSafeParseResult<UsageLedgerFile> = usageLedgerFileSchema.safeParse(parsed);

  if (!decoded.success) {
    warn?.(
      'Storyboard usage ledger is corrupted (unexpected shape); starting from an empty ledger.',
    );
    return [];
  }

  return decoded.data.entries.map(toUsageLedgerEntry);
}

interface SerializedUsageLedger {
  readonly version: UsageLedgerVersion;
  readonly entries: UsageLedgerEntryPayload[];
}

export function serializeUsageLedger(entries: readonly UsageLedgerEntry[]): Uint8Array {
  const payload: SerializedUsageLedger = {
    version: usageLedgerVersion,
    entries: entries.map(serializeLedgerEntry),
  };

  return new TextEncoder().encode(JSON.stringify(payload));
}

export async function readUsageLedgerFromUri(
  fs: UsageLedgerFileSystem,
  ledgerUri: StoryUri,
  warn?: (message: string) => void,
): Promise<UsageLedgerEntry[]> {
  try {
    const bytes: Uint8Array = await fs.readFile(ledgerUri);
    return parseUsageLedgerBytes(bytes, warn);
  } catch {
    return [];
  }
}

export async function writeUsageLedgerToUri(
  fs: UsageLedgerFileSystem,
  ledgerUri: StoryUri,
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

function serializeLedgerEntry(entry: UsageLedgerEntry): UsageLedgerEntryPayload {
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
