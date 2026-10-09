import type { StoryUri } from '#model/format/storyUri';
import yaml from 'js-yaml';
import { ZodError } from 'zod';
import { z } from 'zod';

const revisionPlanVersion = '1.0.0';

export interface RevisionPlanEntry {
  readonly sceneStem: string;
  readonly checkedAt: string;
  readonly revisionCount: number;
  readonly remainingBlocking: number;
  readonly instructions: readonly string[];
  readonly preservedOriginal?: boolean;
  readonly rejection?: {
    readonly reason: 'empty' | 'meta-response' | 'too-short' | 'not-shorter' | 'scene-breaks-changed';
    readonly originalLength: number;
    readonly candidateLength: number;
  };
}

export interface RevisionPlan {
  readonly version: typeof revisionPlanVersion;
  readonly entries: readonly RevisionPlanEntry[];
}

export interface RevisionPlanFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
}

export type RevisionPlanParseErrorCode = 'invalid-yaml' | 'invalid-revision-plan-schema';

export class RevisionPlanParseError extends Error {
  public constructor(
    public readonly code: RevisionPlanParseErrorCode,
    message: string,
    cause?: unknown,
  ) {
    // NOTE: `cause` goes through Error's own options rather than a parameter property, which would
    // shadow the base member.
    super(message, { cause });
    this.name = 'RevisionPlanParseError';
  }
}

const revisionPlanEntrySchema = z.object({
  sceneStem: z.string().trim().min(1),
  checkedAt: z.string().datetime(),
  revisionCount: z.number().int().nonnegative(),
  remainingBlocking: z.number().int().nonnegative(),
  instructions: z.array(z.string().trim().min(1)).default([]),
  preservedOriginal: z.boolean().optional(),
  rejection: z
    .object({
      reason: z.enum(['empty', 'meta-response', 'too-short', 'not-shorter', 'scene-breaks-changed']),
      originalLength: z.number().int().nonnegative(),
      candidateLength: z.number().int().nonnegative(),
    })
    .optional(),
});

const revisionPlanSchema = z.object({
  version: z.literal(revisionPlanVersion),
  entries: z.array(revisionPlanEntrySchema).default([]),
});

export function createEmptyRevisionPlan(): RevisionPlan {
  return { version: revisionPlanVersion, entries: [] };
}

export function upsertRevisionEntry(plan: RevisionPlan, entry: RevisionPlanEntry): RevisionPlan {
  const others = plan.entries.filter((existing) => existing.sceneStem !== entry.sceneStem);
  const entries = [...others, entry].sort((a, b) => a.sceneStem.localeCompare(b.sceneStem));

  return { version: revisionPlanVersion, entries };
}

export function serializeRevisionPlan(plan: RevisionPlan): string {
  return yaml.dump(revisionPlanSchema.parse(plan), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

export function parseRevisionPlan(rawPlan: string): RevisionPlan {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawPlan);
  } catch (error) {
    throw new RevisionPlanParseError(
      'invalid-yaml',
      'revision-plan.yaml을 파싱할 수 없습니다.',
      error,
    );
  }

  try {
    return revisionPlanSchema.parse(parsedYaml);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new RevisionPlanParseError(
        'invalid-revision-plan-schema',
        'revision-plan.yaml 스키마가 올바르지 않습니다.',
        error,
      );
    }

    throw error;
  }
}

export async function readRevisionPlanFile(
  uri: StoryUri,
  fileSystem: RevisionPlanFileSystem,
): Promise<RevisionPlan> {
  const bytes = await fileSystem.readFile(uri);
  return parseRevisionPlan(new TextDecoder().decode(bytes));
}

export async function writeRevisionPlanFile(
  uri: StoryUri,
  fileSystem: RevisionPlanFileSystem,
  plan: RevisionPlan,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeRevisionPlan(plan)));
}
