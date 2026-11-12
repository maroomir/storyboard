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
export type UsageLedgerEntry = UsageRecord & {
  readonly id: string;
  readonly recordedAt: string;
};

const entityKindSchema: z.ZodType<EntityKind> = z.enum([
  'scene',
  'character',
  'background',
  'narrator',
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

class EntityUsageTally {
  private readonly scenes: Record<string, UsageAmount>;
  private readonly characters: Record<string, UsageAmount>;
  private readonly backgrounds: Record<string, UsageAmount>;

  public constructor(summary: UsageSummaryByEntity) {
    this.scenes = { ...summary.scenes };
    this.characters = { ...summary.characters };
    this.backgrounds = { ...summary.backgrounds };
  }

  public add(kind: EntityKind, entityId: string, delta: UsageAmount): void {
    switch (kind) {
      case 'scene': {
        this.scenes[entityId] = addUsageAmount(this.scenes[entityId] ?? emptyUsageAmount(), delta);
        return;
      }
      case 'character': {
        this.characters[entityId] = addUsageAmount(
          this.characters[entityId] ?? emptyUsageAmount(),
          delta,
        );
        return;
      }
      case 'background': {
        this.backgrounds[entityId] = addUsageAmount(
          this.backgrounds[entityId] ?? emptyUsageAmount(),
          delta,
        );
        return;
      }
      case 'narrator':
      case 'project': {
        return;
      }
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }

  public toSummary(total: UsageAmount): UsageSummaryByEntity {
    return {
      scenes: this.scenes,
      characters: this.characters,
      backgrounds: this.backgrounds,
      total,
    };
  }
}

export function mergeUsageLedgerEntryIntoSummary(
  summary: UsageSummaryByEntity,
  entry: Pick<UsageLedgerEntry, 'costUsd' | 'usage' | 'attribution' | 'providerId' | 'model'>,
): UsageSummaryByEntity {
  const tally: EntityUsageTally = new EntityUsageTally(summary);
  const amount: UsageAmount = usageAmountOfEntry(entry);
  const total: UsageAmount = addUsageAmount(summary.total, amount);

  const { primary, participants = [] } = entry.attribution;

  if (primary) {
    tally.add(primary.kind, primary.id, amount);
  }

  if (participants.length > 0) {
    const share: UsageAmount = scaleUsageAmount(amount, 1 / participants.length);

    for (const participant of participants) {
      tally.add(participant.kind, participant.id, share);
    }
  }

  return tally.toSummary(total);
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

export function serializeUsageLedgerEntry(entry: UsageLedgerEntry): string {
  return JSON.stringify(usageLedgerEntrySchema.parse(serializeLedgerEntry(entry)));
}

export function parseUsageLedgerEntry(text: string): UsageLedgerEntry | undefined {
  const parsed: z.ZodSafeParseResult<UsageLedgerEntryPayload> = usageLedgerEntrySchema.safeParse(
    JSON.parse(text),
  );

  return parsed.success ? toUsageLedgerEntry(parsed.data) : undefined;
}
