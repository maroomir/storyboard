import { findGenerationParameter, type GenerationKnobs } from '@storyboard/story-model';
import { promptResourceKeys, type PromptTuningOverrides } from '@storyboard/story-ai';

export type RunParametersErrorCode = 'unknown-prompt' | 'invalid-value' | 'out-of-range';

export class RunParametersError extends Error {
  public constructor(
    public readonly code: RunParametersErrorCode,
    public readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunParametersError';
  }
}

export interface RunParameters {
  readonly configOverrides: Readonly<Record<string, unknown>>;
  readonly generationKnobs: GenerationKnobs;
  readonly promptConfigs: PromptTuningOverrides;
}

export const emptyRunParameters: RunParameters = {
  configOverrides: {},
  generationKnobs: {},
  promptConfigs: {},
};

type PromptSamplingField = 'temperature' | 'maxTokens';

interface PromptSamplingKey {
  readonly promptKey: string;
  readonly field: PromptSamplingField;
}

const promptSamplingKeyPattern: RegExp = /^prompt\.([^.]+)\.(temperature|maxTokens)$/;
const promptKeyPrefix: string = 'prompt.';
const temperatureMinimum: number = 0;
const temperatureMaximum: number = 2;

export function listRunParameterKeys(parameters: RunParameters): readonly string[] {
  return [
    ...Object.keys(parameters.configOverrides),
    ...Object.keys(parameters.generationKnobs),
    ...Object.entries(parameters.promptConfigs).flatMap(([promptKey, config]) =>
      Object.keys(config ?? {}).map((field) => `${promptKeyPrefix}${promptKey}.${field}`),
    ),
  ];
}

function readPromptSamplingKey(key: string): PromptSamplingKey {
  const match: RegExpExecArray | null = promptSamplingKeyPattern.exec(key);
  const promptKey: string | undefined = match?.[1];

  if (match === null || promptKey === undefined || !promptResourceKeys().includes(promptKey)) {
    throw new RunParametersError(
      'unknown-prompt',
      key,
      `알 수 없는 프롬프트 값입니다: ${key}\n쓸 수 있는 형태: prompt.<프롬프트 이름>.temperature|maxTokens`,
    );
  }

  return { promptKey, field: match[2] === 'maxTokens' ? 'maxTokens' : 'temperature' };
}

function requireNumber(key: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RunParametersError('invalid-value', key, `숫자여야 합니다: ${key}`);
  }

  return value;
}

function requireWithin(key: string, value: number, minimum: number, maximum: number): number {
  if (value < minimum || value > maximum) {
    throw new RunParametersError(
      'out-of-range',
      key,
      `${key} 값은 ${minimum} 이상 ${maximum} 이하여야 합니다: ${value}`,
    );
  }

  return value;
}

function readPromptValue(key: string, field: PromptSamplingField, value: unknown): number {
  const amount: number = requireNumber(key, value);

  if (field === 'temperature') {
    return requireWithin(key, amount, temperatureMinimum, temperatureMaximum);
  }
  if (!Number.isInteger(amount) || amount < 1) {
    throw new RunParametersError('out-of-range', key, `${key} 값은 1 이상의 정수여야 합니다: ${amount}`);
  }

  return amount;
}

export function splitRunParameters(raw: Readonly<Record<string, unknown>>): RunParameters {
  const configOverrides: Record<string, unknown> = {};
  const generationKnobs: Record<string, number> = {};
  const promptConfigs: Record<string, Partial<Record<PromptSamplingField, number>>> = {};

  for (const [key, value] of Object.entries(raw)) {
    const bounds: { readonly min: number; readonly max: number } | undefined =
      findGenerationParameter(key)?.bounds;

    if (bounds !== undefined) {
      generationKnobs[key] = requireWithin(key, requireNumber(key, value), bounds.min, bounds.max);
    } else if (key.startsWith(promptKeyPrefix)) {
      const { promptKey, field }: PromptSamplingKey = readPromptSamplingKey(key);
      promptConfigs[promptKey] = { ...promptConfigs[promptKey], [field]: readPromptValue(key, field, value) };
    } else {
      configOverrides[key] = value;
    }
  }

  return { configOverrides, generationKnobs, promptConfigs };
}
