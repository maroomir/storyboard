import { isAiProviderId, isUnpricedProvider } from '@storyboard/story-ai';

import type {
  FailureReason,
  GenJob,
  JobClass,
  JobKind,
  JobLog,
  JobLogEntry,
  JobSpec,
  JobState,
  JobTarget,
  JobUsage,
} from './types';
import { buildTargetKey, EMPTY_JOB_USAGE } from './types';
import type { IAccessJobStore, StateTransition, UsageLedgerEntry } from './jobStorePort';
import type { BotDatabase } from '@/store/db';

interface GenJobRow {
  readonly id: number;
  readonly kind: string;
  readonly class: string;
  readonly target: string;
  readonly target_key: string;
  readonly options: string;
  readonly state: string;
  readonly failure_reason: string | null;
  readonly provider: string;
  readonly chat_id: number;
  readonly progress_message_id: number | null;
  readonly usage: string;
  readonly result_ref: string | null;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly finished_at: number | null;
}

interface UsageTotalsRow {
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cost_usd: number | null;
}

interface UsageProviderRow {
  readonly provider_id: string;
}

export class SqliteJobStore implements IAccessJobStore {
  public constructor(private readonly db: BotDatabase) {}

  public insert(spec: JobSpec, now: number): GenJob {
    const targetKey = buildTargetKey(spec.target);
    const result = this.db
      .prepare(
        `INSERT INTO gen_jobs (
          kind, class, target, target_key, options, state, failure_reason, provider,
          chat_id, progress_message_id, usage, result_ref, created_at, started_at, finished_at
        ) VALUES (
          @kind, @class, @target, @targetKey, @options, 'queued', NULL, @provider,
          @chatId, NULL, @usage, NULL, @createdAt, NULL, NULL
        )`,
      )
      .run({
        kind: spec.kind,
        class: spec.class,
        target: JSON.stringify(spec.target),
        targetKey,
        options: JSON.stringify(spec.options ?? {}),
        provider: JSON.stringify(spec.provider ?? {}),
        chatId: spec.chatId,
        usage: JSON.stringify(EMPTY_JOB_USAGE),
        createdAt: now,
      });

    return this.load(Number(result.lastInsertRowid))!;
  }

  public updateState(jobId: number, transition: StateTransition): GenJob {
    const existing = this.load(jobId);
    if (!existing) {
      throw new Error(`job not found: ${jobId}`);
    }

    const nextUsage = transition.usage ?? existing.usage;
    this.db
      .prepare(
        `UPDATE gen_jobs SET
          state = @state,
          failure_reason = COALESCE(@failureReason, failure_reason),
          started_at = COALESCE(@startedAt, started_at),
          finished_at = COALESCE(@finishedAt, finished_at),
          result_ref = COALESCE(@resultRef, result_ref),
          progress_message_id = COALESCE(@progressMessageId, progress_message_id),
          usage = @usage
        WHERE id = @jobId`,
      )
      .run({
        jobId,
        state: transition.state,
        failureReason: transition.failureReason ?? null,
        startedAt: transition.startedAt ?? null,
        finishedAt: transition.finishedAt ?? null,
        resultRef: transition.resultRef ?? null,
        progressMessageId: transition.progressMessageId ?? null,
        usage: JSON.stringify(nextUsage),
      });

    return this.load(jobId)!;
  }

  public load(jobId: number): GenJob | undefined {
    const row = this.db.prepare(`SELECT * FROM gen_jobs WHERE id = ?`).get(jobId) as
      | GenJobRow
      | undefined;
    return row ? toGenJob(row) : undefined;
  }

  public loadByState(state: JobState): GenJob[] {
    const rows = this.db
      .prepare(`SELECT * FROM gen_jobs WHERE state = ? ORDER BY created_at ASC`)
      .all(state) as GenJobRow[];
    return rows.map(toGenJob);
  }

  public findActiveByTarget(targetKey: string): GenJob | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM gen_jobs
         WHERE target_key = ? AND state IN ('queued', 'running')
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(targetKey) as GenJobRow | undefined;
    return row ? toGenJob(row) : undefined;
  }

  public listRecent(limit: number): GenJob[] {
    const rows = this.db
      .prepare(`SELECT * FROM gen_jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as GenJobRow[];
    return rows.map(toGenJob);
  }

  public recordUsage(entry: Omit<UsageLedgerEntry, 'recordedAt'>, recordedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO usage_ledger (
          job_id, task_name, provider_id, input_tokens, output_tokens, cost_usd, recorded_at
        ) VALUES (
          @jobId, @taskName, @providerId, @inputTokens, @outputTokens, @costUsd, @recordedAt
        )`,
      )
      .run({ ...entry, recordedAt });

    const job = this.load(entry.jobId);
    if (!job) {
      return;
    }

    const usage: JobUsage = {
      inputTokens: job.usage.inputTokens + entry.inputTokens,
      outputTokens: job.usage.outputTokens + entry.outputTokens,
      costUsd: job.usage.costUsd + entry.costUsd,
      hasUnpricedUsage:
        job.usage.hasUnpricedUsage === true ||
        (isAiProviderId(entry.providerId) && isUnpricedProvider(entry.providerId)),
    };
    this.updateState(entry.jobId, { state: job.state, usage });
  }

  public appendLog(jobId: number, entry: Omit<JobLogEntry, 'at'>, at: number): void {
    this.db
      .prepare(
        `INSERT INTO gen_job_log (job_id, level, stage, message, recorded_at)
         VALUES (@jobId, @level, @stage, @message, @recordedAt)`,
      )
      .run({
        jobId,
        level: entry.level,
        stage: entry.stage,
        message: entry.message,
        recordedAt: at,
      });
  }

  public getLog(jobId: number): JobLog {
    const rows = this.db
      .prepare(
        `SELECT level, stage, message, recorded_at
         FROM gen_job_log
         WHERE job_id = ?
         ORDER BY recorded_at ASC`,
      )
      .all(jobId) as Array<{
      readonly level: string;
      readonly stage: string;
      readonly message: string;
      readonly recorded_at: number;
    }>;

    return {
      jobId,
      entries: rows.map((row) => ({
        at: row.recorded_at,
        level: row.level as JobLogEntry['level'],
        stage: row.stage,
        message: row.message,
      })),
    };
  }

  public sumUsageSince(since: number): JobUsage {
    const row = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM usage_ledger
         WHERE recorded_at >= ?`,
      )
      .get(since) as UsageTotalsRow;

    // The ledger records the provider, not the model, which is enough: a provider with no price
    // table has no priced model either.
    const providerRows = this.db
      .prepare(`SELECT DISTINCT provider_id FROM usage_ledger WHERE recorded_at >= ?`)
      .all(since) as UsageProviderRow[];
    const hasUnpricedUsage = providerRows.some(
      ({ provider_id: providerId }) =>
        isAiProviderId(providerId) && isUnpricedProvider(providerId),
    );

    return {
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      costUsd: Number(row.cost_usd ?? 0),
      hasUnpricedUsage,
    };
  }
}

function toGenJob(row: GenJobRow): GenJob {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    class: row.class as JobClass,
    target: JSON.parse(row.target) as JobTarget,
    targetKey: row.target_key,
    options: JSON.parse(row.options) as Record<string, unknown>,
    state: row.state as JobState,
    failureReason: row.failure_reason as FailureReason,
    provider: JSON.parse(row.provider) as Record<string, unknown>,
    chatId: row.chat_id,
    progressMessageId: row.progress_message_id,
    usage: JSON.parse(row.usage) as JobUsage,
    resultRef: row.result_ref,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
