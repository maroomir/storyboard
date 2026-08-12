import { contractFieldKeys } from '@seedkernel/wasm';
import type { ContractFieldKey, ProjectSetting } from '@seedkernel/wasm';

export const minReasonableTargetWordCount = 1_000;
export const maxReasonableTargetWordCount = 2_000_000;

export interface GenerationContractReadiness {
  readonly isReady: boolean;
  readonly missing: ContractFieldKey[];
  readonly warnings: string[];
}

export function validateGenerationContract(
  setting: ProjectSetting | undefined,
): GenerationContractReadiness {
  const missing = findMissingFields(setting);
  const warnings = findWarnings(setting);

  return {
    isReady: missing.length === 0 && warnings.length === 0,
    missing,
    warnings,
  };
}

function findMissingFields(setting: ProjectSetting | undefined): ContractFieldKey[] {
  return contractFieldKeys.filter((key) => !hasContractValue(setting, key));
}

function hasContractValue(setting: ProjectSetting | undefined, key: ContractFieldKey): boolean {
  if (!setting) {
    return false;
  }

  switch (key) {
    case 'genre':
      return isNonEmpty(setting.genre);
    case 'audience':
      return isNonEmpty(setting.audience);
    case 'pov':
      return setting.pov !== undefined;
    case 'targetWordCount':
      return typeof setting.targetWordCount === 'number';
  }
}

function findWarnings(setting: ProjectSetting | undefined): string[] {
  if (!setting) {
    return [];
  }

  const warnings: string[] = [];

  const { targetWordCount } = setting;
  if (
    typeof targetWordCount === 'number' &&
    (targetWordCount < minReasonableTargetWordCount ||
      targetWordCount > maxReasonableTargetWordCount)
  ) {
    warnings.push(
      `목표 분량 ${targetWordCount.toLocaleString()}자가 일반적인 범위(${minReasonableTargetWordCount.toLocaleString()}~${maxReasonableTargetWordCount.toLocaleString()}자)를 벗어났습니다.`,
    );
  }

  for (const conflict of findProhibitionConflicts(setting)) {
    warnings.push(`금지 조건 "${conflict}"이(가) 장르 또는 태그와 충돌합니다.`);
  }

  return warnings;
}

function findProhibitionConflicts(setting: ProjectSetting): string[] {
  const allowedTerms = new Set(
    [setting.genre, ...setting.tags].filter(isNonEmpty).map((term) => term.trim().toLowerCase()),
  );

  return setting.prohibitions
    .filter(isNonEmpty)
    .filter((prohibition) => allowedTerms.has(prohibition.trim().toLowerCase()));
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
