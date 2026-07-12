import { pointOfViewLabels } from './outline';
import type { PointOfView, ProjectSetting } from './project';

// NOTE: Shared narrative-style context injected into every scene-generation prompt so point of
// view, genre/tone, and style constraints survive from project settings into persona, dialogue,
// and genre-format steps. Runtime-agnostic; no vscode imports.
export interface StyleDirective {
  readonly pov?: PointOfView;
  readonly genre?: string;
  readonly styleConstraints?: readonly string[];
  readonly relationStage?: string;
}

export function buildStyleDirective(
  setting: ProjectSetting | undefined,
  relationStage?: string,
): StyleDirective | undefined {
  const styleConstraints =
    setting?.styleConstraints && setting.styleConstraints.length > 0
      ? setting.styleConstraints
      : undefined;
  const trimmedRelationStage = relationStage?.trim();
  const directive: StyleDirective = {
    pov: setting?.pov,
    genre: setting?.genre,
    styleConstraints,
    relationStage:
      trimmedRelationStage && trimmedRelationStage.length > 0 ? trimmedRelationStage : undefined,
  };

  return directive.pov || directive.genre || directive.styleConstraints || directive.relationStage
    ? directive
    : undefined;
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

function relationLine(directive: StyleDirective): string | undefined {
  return directive.relationStage
    ? `이 장면의 인물 관계 단계: ${directive.relationStage} — 이 단계에 맞는 태도와 거리감으로 표현하라.`
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
    relationLine(directive),
  ].filter((line): line is string => Boolean(line));
}

// 페르소나·대사처럼 시점이 중립인 단계용: 톤·문체·관계 단계를 반영한다.
export function voiceStyleLines(directive: StyleDirective | undefined): string[] {
  if (!directive) {
    return [];
  }

  return [genreLine(directive), styleConstraintLine(directive), relationLine(directive)].filter(
    (line): line is string => Boolean(line),
  );
}
