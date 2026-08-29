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

  // NOTE: 동작 대목의 실패는 두 방향이다. 장식이 두꺼우면 무슨 일이 벌어졌는지 안 읽히고, 동작만
  // 나열하면 정확해도 긴장이 죽는다. 명료성과 긴장을 함께 요구해 어느 한쪽으로 쏠리지 않게 한다.
  if (contract.actionClarity) {
    lines.push(
      '동작·전투·추격 대목은 무엇이 무엇을 어떻게 했는지 한 번에 읽히게 써라. 한 동작과 그 결과를 붙여 쓰고, 회상이나 비유로 동작 사이를 끊지 마라.',
      '동시에 그 대목을 건조한 중계로 만들지 마라. 이 합에서 무엇이 걸려 있는지, 빗나가면 무엇을 잃는지 시점 인물의 몸이 먼저 알아채게 하고, 상대의 반응과 판단이 바뀌는 순간을 놓치지 마라. 승패를 가른 한 수는 그것이 왜 통했는지까지 드러나야 한다.',
    );
  }

  if (contract.modulateDensity) {
    lines.push(
      '장면 전체의 밀도를 일정하게 유지하지 마라. 위기가 조여드는 대목은 문장을 짧게 끊어 호흡을 몰고, 인물이 머무르거나 정서가 쌓이는 대목에서는 묘사를 두텁게 하라. 문장 길이의 완급 자체가 긴장을 만든다.',
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
// NOTE: 시제와 따옴표는 어느 프롬프트에서도 지정하지 않아 장면마다 달라졌다. 액션 씬이 현재형으로
// 흐르고 한 편만 직선 따옴표로 나온 것이 그 결과다. 한 작품 안에서 갈리면 안 되는 규약이라 고정한다.
export const proseConventionLines: readonly string[] = [
  '서술은 과거형으로 쓰고 한 장면 안에서 시제를 섞지 마라. 대사 안의 시제는 인물의 말이므로 예외다.',
  '대사는 곡선 큰따옴표(\u201c \u201d)로 감싸라. 직선 따옴표나 다른 기호로 대신하지 마라.',
];

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
