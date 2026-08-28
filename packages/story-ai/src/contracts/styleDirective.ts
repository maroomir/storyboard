import {
  pointOfViewLabels,
  resolveCraftContract,
  resolveSceneTargetLength,
  sceneGroundingFieldLabels,
} from '@storyboard/story-format';
import type {
  CraftContractOverride,
  PointOfView,
  ProjectSetting,
  SceneGrounding,
} from '@storyboard/story-format';
// NOTE: Shared narrative-style context injected into every scene-generation prompt so point of
// view, genre/tone, and style constraints survive from project settings into persona, dialogue,
// and genre-format steps. Runtime-agnostic; no vscode imports.
export interface StyleDirective {
  readonly pov?: PointOfView;
  readonly genre?: string;
  readonly styleConstraints?: readonly string[];
  readonly prohibitions?: readonly string[];
  readonly relationStage?: string;
  readonly povCharacter?: string;
  readonly targetWordCount?: number;
  readonly craftContract?: CraftContractOverride;
}

// NOTE: sceneBody를 주면 목표 분량이 없는 씬도 작법 계약의 배수로 예산을 파생한다. 주지 않으면
// 종전대로 명시값이 있을 때만 분량 제약이 걸린다.
export function buildStyleDirective(
  setting: ProjectSetting | undefined,
  relationStage?: string,
  targetWordCount?: number,
  sceneBody?: string,
  povCharacter?: string,
): StyleDirective | undefined {
  const resolvedTargetWordCount =
    sceneBody === undefined
      ? targetWordCount
      : resolveSceneTargetLength(
          targetWordCount,
          sceneBody,
          resolveCraftContract(setting?.craftContract).sceneLengthMultiplier,
        );
  const styleConstraints =
    setting?.styleConstraints && setting.styleConstraints.length > 0
      ? setting.styleConstraints
      : undefined;
  const prohibitions =
    setting?.prohibitions && setting.prohibitions.length > 0 ? setting.prohibitions : undefined;
  const trimmedRelationStage = relationStage?.trim();
  const trimmedPovCharacter = povCharacter?.trim();
  const directive: StyleDirective = {
    pov: setting?.pov,
    genre: setting?.genre,
    craftContract: setting?.craftContract,
    styleConstraints,
    prohibitions,
    relationStage:
      trimmedRelationStage && trimmedRelationStage.length > 0 ? trimmedRelationStage : undefined,
    povCharacter:
      trimmedPovCharacter && trimmedPovCharacter.length > 0 ? trimmedPovCharacter : undefined,
    targetWordCount:
      typeof resolvedTargetWordCount === 'number' &&
      Number.isInteger(resolvedTargetWordCount) &&
      resolvedTargetWordCount > 0
        ? resolvedTargetWordCount
        : undefined,
  };

  return directive.pov ||
    directive.genre ||
    directive.craftContract ||
    directive.styleConstraints ||
    directive.prohibitions ||
    directive.relationStage ||
    directive.povCharacter ||
    directive.targetWordCount
    ? directive
    : undefined;
}

// NOTE: 프로젝트가 아무 설정도 하지 않아도 기본 계약이 걸리도록, directive가 없어도 항상 렌더한다.
export function craftContractLines(override: CraftContractOverride | undefined): string[] {
  const contract = resolveCraftContract(override);
  const lines: string[] = [];

  if (contract.banTelling) {
    lines.push(
      '대사나 행동으로 이미 드러난 감정·의미를 뒤이은 서술로 다시 설명하지 마라. 해석은 독자 몫으로 남겨라.',
    );
  }

  // NOTE: 심상만 제한하면 제목·후렴 같은 반복 대사가 규제 밖으로 새어 몇 배로 늘어난다.
  lines.push(
    `같은 심상·소재(예: 흐릿한 길, 문틈)는 물론 같은 대사·후렴구·문장도 장면 전체에서 ${contract.motifRepeatLimit}회를 넘겨 반복하지 마라.`,
  );

  if (contract.stockGestureBlacklist.length > 0) {
    lines.push(
      `다음 상투 표현은 쓰지 말고 그 인물만의 구체적 반응으로 대체하라: ${contract.stockGestureBlacklist.join(', ')}.`,
    );
  }

  if (contract.requireCharacterInterior) {
    lines.push(
      '위로하거나 조언하는 인물도 자기 목적이나 결점을 최소 한 번 드러내라. 조언만 하는 장치가 되지 않게 하라.',
    );
  }

  // NOTE: 밀도 지시가 장면 유형과 무관하게 걸려 전투 대목까지 장식으로 덮이던 문제를 막는다.
  if (contract.actionClarity) {
    lines.push(
      '동작·전투·추격처럼 몸이 움직이는 대목은 한 문장에 한 동작을 담고 원인과 결과를 잇달아 써서 인과가 한 번에 읽히게 하라. 그 사이에 회상·비유·긴 감각 묘사를 끼워 넣지 말고, 승패를 가른 한 수는 무엇이 무엇을 어떻게 했는지 물리적으로 분명히 밝혀라.',
    );
  }

  if (contract.modulateDensity) {
    lines.push(
      '장면 전체의 밀도를 일정하게 유지하지 마라. 사건이 빠르게 움직이는 대목은 문장을 짧고 곧게 쓰고, 인물이 머무르거나 정서가 쌓이는 대목에서만 묘사를 두텁게 하라.',
    );
  }

  return lines;
}

// 씬을 구체적 사건에 못박는 사실. 추상적 씬이 은유만으로 전개되는 것을 막는다.
export function sceneGroundingLines(grounding: SceneGrounding | undefined): string[] {
  if (!grounding) {
    return [];
  }

  const entries = Object.entries(sceneGroundingFieldLabels).flatMap(([key, label]) => {
    const value = grounding[key as keyof SceneGrounding];
    return value ? [`- ${label}: ${value}`] : [];
  });

  return entries.length > 0 ? ['[이 장면의 확정 사실]', ...entries] : [];
}

function povLine(directive: StyleDirective): string | undefined {
  return directive.pov
    ? `서술 시점: ${pointOfViewLabels[directive.pov]} — 처음부터 끝까지 이 시점을 유지하라.`
    : undefined;
}

function genreLine(directive: StyleDirective): string | undefined {
  return directive.genre ? `장르·톤: ${directive.genre}` : undefined;
}

function styleConstraintLine(directive: StyleDirective): string | undefined {
  return directive.styleConstraints && directive.styleConstraints.length > 0
    ? `문체 제약: ${directive.styleConstraints.join(' / ')}`
    : undefined;
}

function prohibitionLine(directive: StyleDirective): string | undefined {
  return directive.prohibitions && directive.prohibitions.length > 0
    ? `작품 금지 규칙 — 어떤 장면에서도 위반하지 마라: ${directive.prohibitions.join(' / ')}`
    : undefined;
}

function povCharacterLine(directive: StyleDirective): string | undefined {
  return directive.povCharacter
    ? `이 장면의 시점 인물: ${directive.povCharacter} — 이 인물의 지각과 내면만 서술하고, 다른 인물의 속마음은 겉으로 드러난 행동·표정으로만 전하라.`
    : undefined;
}

function relationLine(directive: StyleDirective): string | undefined {
  return directive.relationStage
    ? `이 장면의 인물 관계 단계: ${directive.relationStage} — 이 단계에 맞는 태도와 거리감으로 표현하라.`
    : undefined;
}

function lengthLine(directive: StyleDirective): string | undefined {
  return directive.targetWordCount
    ? `이 장면의 목표 분량: 약 ${directive.targetWordCount.toLocaleString()}자 (공백 포함). ±20% 안에서 마무리하라.`
    : undefined;
}

// genreFormatting처럼 최종 시점을 확정하는 단계용: 시점까지 포함한다.
export function narrativeStyleLines(directive: StyleDirective | undefined): string[] {
  if (!directive) {
    return [];
  }

  return [
    povLine(directive),
    genreLine(directive),
    styleConstraintLine(directive),
    prohibitionLine(directive),
    povCharacterLine(directive),
    relationLine(directive),
    lengthLine(directive),
  ].filter((line): line is string => Boolean(line));
}

// 페르소나·대사처럼 시점이 중립인 단계용: 톤·문체·관계 단계를 반영한다.
export function voiceStyleLines(directive: StyleDirective | undefined): string[] {
  if (!directive) {
    return [];
  }

  return [
    genreLine(directive),
    styleConstraintLine(directive),
    prohibitionLine(directive),
    povCharacterLine(directive),
    relationLine(directive),
  ].filter((line): line is string => Boolean(line));
}
