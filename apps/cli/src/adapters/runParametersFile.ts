import { readFileSync } from 'node:fs';

import { RunParametersError, splitRunParameters, type RunParameters } from '@storyboard/story-app';
import { ConfigFileError, validateConfigSettings, type ConfigKeyWarning } from '@storyboard/story-config';

export type RunParametersRead =
  | { readonly ok: true; readonly parameters: RunParameters }
  | { readonly ok: false; readonly message: string };

function refuse(message: string): RunParametersRead {
  return { ok: false, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(file: string): Record<string, unknown> | string {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return `--params 파일을 읽지 못했습니다: ${file}`;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : `--params 파일의 최상위는 객체여야 합니다: ${file}`;
  } catch {
    return `--params 파일이 올바른 JSON이 아닙니다: ${file}`;
  }
}

export function readRunParametersFile(file: string): RunParametersRead {
  const raw: Record<string, unknown> | string = readJsonObject(file);
  if (typeof raw === 'string') {
    return refuse(raw);
  }

  try {
    const parameters: RunParameters = splitRunParameters(raw);
    const unknownKeys: readonly ConfigKeyWarning[] = validateConfigSettings(file, {
      ...parameters.configOverrides,
    });
    const firstUnknown: ConfigKeyWarning | undefined = unknownKeys[0];

    return firstUnknown === undefined
      ? { ok: true, parameters }
      : refuse(`--params 파일에 알 수 없는 키가 있습니다: ${firstUnknown.key} (${file})`);
  } catch (error) {
    if (error instanceof RunParametersError || error instanceof ConfigFileError) {
      return refuse(`${error.message}\n  --params 파일: ${file}`);
    }
    throw error;
  }
}
