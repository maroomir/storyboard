import yaml from 'js-yaml';
import { z } from 'zod';

// A pipeline spec is the ordered list of stages a run executes, as a YAML file an author may lay
// over the bundled order (`.storyboard/pipelines/<name>.yaml`). The stages themselves are code; the
// file only says which run, in what order. A stage entry is its id, or `{ id, enabled: false }` to
// leave a stage out while keeping it listed.
type StageEntry = string | { id: string; enabled?: boolean };

const stageEntrySchema: z.ZodType<StageEntry> = z.union([
  z.string().trim().min(1),
  z.object({ id: z.string().trim().min(1), enabled: z.boolean().optional() }),
]);

export interface PipelineSpec {
  version: 1;
  stages: StageEntry[];
}

export const pipelineSpecSchema: z.ZodType<PipelineSpec> = z.object({
  version: z.literal(1),
  stages: z.array(stageEntrySchema).min(1),
});

export interface PipelineStageEntry {
  readonly id: string;
  readonly enabled: boolean;
}

// What a pipeline says about each of its stages, so a spec can be checked before a run starts.
export interface PipelineStageDefinition {
  readonly id: string;
  readonly label: string;
  // A stage the pipeline cannot run without; a spec must list it enabled.
  readonly required?: boolean;
  // Stages whose output this one reads; each must be enabled and come earlier.
  readonly requires?: readonly string[];
  // A stage this one stands in for. With this one enabled, the other's `required` and the
  // `requires` that name it count as met, and a spec may not enable both.
  readonly replaces?: string;
  // Left out of the bundled plan; runs only when a spec names it.
  readonly isOptIn?: boolean;
}

export class PipelineSpecError extends Error {
  public constructor(
    public readonly code:
      | 'invalid-yaml'
      | 'invalid-shape'
      | 'unknown-stage'
      | 'duplicate-stage'
      | 'missing-stage'
      | 'stage-order'
      | 'stage-conflict',
    message: string,
  ) {
    super(message);
    this.name = 'PipelineSpecError';
  }
}

export function parsePipelineSpec(text: string): PipelineSpec {
  let loaded: unknown;

  try {
    loaded = yaml.load(text);
  } catch (error) {
    const detail: string = error instanceof Error ? error.message : String(error);
    throw new PipelineSpecError(
      'invalid-yaml',
      `파이프라인 명세를 YAML로 읽을 수 없습니다: ${detail}`,
    );
  }

  const parsed = pipelineSpecSchema.safeParse(loaded);

  if (!parsed.success) {
    const issue: z.core.$ZodIssue | undefined = parsed.error.issues[0];
    const path: string = issue?.path.map(String).join('.') ?? '';
    throw new PipelineSpecError(
      'invalid-shape',
      `파이프라인 명세의 꼴이 맞지 않습니다: ${[path, issue?.message].filter(Boolean).join(' ')}`,
    );
  }

  return parsed.data;
}

export function pipelineStageEntries(spec: PipelineSpec): PipelineStageEntry[] {
  return spec.stages.map((entry) =>
    typeof entry === 'string'
      ? { id: entry, enabled: true }
      : { id: entry.id, enabled: entry.enabled ?? true },
  );
}

export function defaultPipelineSpec(catalog: readonly PipelineStageDefinition[]): PipelineSpec {
  return {
    version: 1,
    stages: catalog
      .filter((definition) => definition.isOptIn !== true)
      .map((definition) => definition.id),
  };
}

// The enabled stage ids in run order, or the first reason the spec cannot drive this pipeline.
export function resolvePipelinePlan(
  spec: PipelineSpec,
  catalog: readonly PipelineStageDefinition[],
): readonly string[] {
  const known: Map<string, PipelineStageDefinition> = new Map(
    catalog.map((definition) => [definition.id, definition]),
  );
  const seen: Set<string> = new Set<string>();
  const plan: string[] = [];

  for (const entry of pipelineStageEntries(spec)) {
    if (!known.has(entry.id)) {
      throw new PipelineSpecError('unknown-stage', `알 수 없는 단계입니다: ${entry.id}`);
    }

    if (seen.has(entry.id)) {
      throw new PipelineSpecError('duplicate-stage', `단계가 두 번 나옵니다: ${entry.id}`);
    }

    seen.add(entry.id);

    if (entry.enabled) {
      plan.push(entry.id);
    }
  }

  // replaced stage id → the enabled stage standing in for it.
  const standIns: Map<string, string> = new Map<string, string>();

  for (const id of plan) {
    const replaces: string | undefined = known.get(id)?.replaces;

    if (replaces === undefined) {
      continue;
    }

    if (plan.includes(replaces)) {
      throw new PipelineSpecError(
        'stage-conflict',
        `${id} 단계는 ${replaces} 단계를 대신하므로 둘을 함께 켤 수 없습니다.`,
      );
    }

    standIns.set(replaces, id);
  }

  for (const definition of catalog) {
    if (definition.required && !plan.includes(definition.id) && !standIns.has(definition.id)) {
      throw new PipelineSpecError(
        'missing-stage',
        `빠뜨릴 수 없는 단계입니다: ${definition.id} (${definition.label})`,
      );
    }
  }

  for (const [index, id] of plan.entries()) {
    for (const dependency of known.get(id)?.requires ?? []) {
      const position: number = plan.indexOf(standIns.get(dependency) ?? dependency);

      if (position === -1 || position > index) {
        throw new PipelineSpecError(
          'stage-order',
          `${id} 단계는 ${dependency} 단계가 먼저 켜져 있어야 합니다.`,
        );
      }
    }
  }

  return plan;
}

export function renderPipelineSpec(spec: PipelineSpec): string {
  return yaml.dump(spec, { lineWidth: 100 });
}
