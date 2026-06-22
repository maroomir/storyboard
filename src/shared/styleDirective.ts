import { pointOfViewLabels } from "./outline"
import type { PointOfView, ProjectSetting } from "./project"

// NOTE: Shared narrative-style context injected into every scene-generation prompt so point of
// view, genre/tone, and style constraints survive from project settings into persona, dialogue,
// and genre-format steps. Runtime-agnostic; no vscode imports.
export interface StyleDirective {
  readonly pov?: PointOfView
  readonly genre?: string
  readonly styleConstraints?: readonly string[]
}

export function buildStyleDirective(setting: ProjectSetting | undefined): StyleDirective | undefined {
  if (!setting) {
    return undefined
  }

  const styleConstraints =
    setting.styleConstraints && setting.styleConstraints.length > 0 ? setting.styleConstraints : undefined
  const directive: StyleDirective = {
    pov: setting.pov,
    genre: setting.genre,
    styleConstraints
  }

  return directive.pov || directive.genre || directive.styleConstraints ? directive : undefined
}

function povLine(directive: StyleDirective): string | undefined {
  return directive.pov ? `서술 시점: ${pointOfViewLabels[directive.pov]} — 처음부터 끝까지 이 시점을 유지하라.` : undefined
}

function genreLine(directive: StyleDirective): string | undefined {
  return directive.genre ? `장르·톤: ${directive.genre}` : undefined
}

function styleConstraintLine(directive: StyleDirective): string | undefined {
  return directive.styleConstraints && directive.styleConstraints.length > 0
    ? `문체 제약: ${directive.styleConstraints.join(" / ")}`
    : undefined
}

// genreFormatting처럼 최종 시점을 확정하는 단계용: 시점까지 포함한다.
export function narrativeStyleLines(directive: StyleDirective | undefined): string[] {
  if (!directive) {
    return []
  }

  return [povLine(directive), genreLine(directive), styleConstraintLine(directive)].filter(
    (line): line is string => Boolean(line)
  )
}

// 페르소나·대사처럼 시점이 중립인 단계용: 톤·문체만 반영한다.
export function voiceStyleLines(directive: StyleDirective | undefined): string[] {
  if (!directive) {
    return []
  }

  return [genreLine(directive), styleConstraintLine(directive)].filter((line): line is string => Boolean(line))
}
