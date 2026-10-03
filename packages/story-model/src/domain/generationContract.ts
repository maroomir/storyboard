import { contractFieldKeys, mainThreadId } from '#model/format/project';
import { resolveCompositionPresetDefaults } from '#model/format/compositionPresets';
import type { ContractFieldKey, ProjectSetting } from '#model/format/project';

const minReasonableTargetWordCount = 1_000;
const maxReasonableTargetWordCount = 2_000_000;

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

  warnings.push(...findCompositionWarnings(setting));

  return warnings;
}

// NOTE: 구성 설정은 씬을 만들기 전에 어긋나는 편이 낫다. 감싸는 대상이 없는 액자나 편이 하나뿐인
// 옴니버스는 생성이 끝난 뒤에야 결과에서 드러나고, 그때는 이미 원고를 다시 만들어야 한다.
function findCompositionWarnings(setting: ProjectSetting): string[] {
  const warnings: string[] = [];
  const threads = setting.threads ?? {};
  const threadIds = new Set([...Object.keys(threads), mainThreadId]);

  for (const [threadId, thread] of Object.entries(threads)) {
    for (const wrapped of thread.wraps ?? []) {
      if (wrapped === threadId) {
        warnings.push(`줄기 "${threadId}"이(가) 자기 자신을 감쌉니다.`);
        continue;
      }

      if (!threadIds.has(wrapped)) {
        warnings.push(`줄기 "${threadId}"이(가) 정의되지 않은 줄기 "${wrapped}"을(를) 감쌉니다.`);
      }
    }
  }

  const minimumOmnibusEpisodes = resolveCompositionPresetDefaults().minimumOmnibusEpisodes;

  if (setting.composition === 'omnibus' && Object.keys(threads).length < minimumOmnibusEpisodes) {
    warnings.push(
      `옴니버스는 편을 ${minimumOmnibusEpisodes}개 이상 두어야 합니다. threads에 편을 추가해 주세요.`,
    );
  }

  if (setting.composition === 'frame' && !hasWrappingThread(setting)) {
    warnings.push('액자식은 다른 줄기를 감싸는 외화 줄기가 필요합니다. wraps를 설정해 주세요.');
  }

  if (setting.composition === 'alternating-pov' && setting.pov === 'third-omniscient') {
    warnings.push('전지적 시점은 시점 교차와 맞지 않습니다. 제한 시점이나 1인칭을 골라 주세요.');
  }

  return warnings;
}

function hasWrappingThread(setting: ProjectSetting): boolean {
  return Object.values(setting.threads ?? {}).some((thread) => (thread.wraps ?? []).length > 0);
}

function findProhibitionConflicts(setting: ProjectSetting): string[] {
  // project.json is hand-editable, so an omitted array reaches here as undefined despite the type.
  const allowedTerms = new Set(
    [setting.genre, ...(setting.tags ?? [])]
      .filter(isNonEmpty)
      .map((term) => term.trim().toLowerCase()),
  );

  return (setting.prohibitions ?? [])
    .filter(isNonEmpty)
    .filter((prohibition) => allowedTerms.has(prohibition.trim().toLowerCase()));
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
