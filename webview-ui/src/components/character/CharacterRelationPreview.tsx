import type React from "react"

import type { CharacterRelation } from "@webview/lib/types"

const VIEW_WIDTH = 360
const VIEW_HEIGHT = 220
const CENTER_X = VIEW_WIDTH / 2
const CENTER_Y = VIEW_HEIGHT / 2
const ORBIT_RADIUS = 72
const NODE_RADIUS = 28

function shortenLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

export function CharacterRelationPreview({
  characterId,
  characterName,
  relations
}: {
  readonly characterId: string
  readonly characterName: string
  readonly relations: readonly CharacterRelation[]
}): React.ReactElement {
  const linkedRelations = relations.filter(
    (relation) => relation.target.trim().length > 0 && relation.type.trim().length > 0
  )

  if (linkedRelations.length === 0) {
    return (
      <p className="m-0 rounded-md border border-dashed border-sb-border px-3 py-4 text-center text-sm text-sb-fg-muted">
        관계가 없습니다. target과 type을 추가하면 미리보기가 표시됩니다.
      </p>
    )
  }

  const targets = linkedRelations.map((relation, index) => {
    const angle = (index / linkedRelations.length) * Math.PI * 2 - Math.PI / 2
    return {
      relation,
      x: CENTER_X + Math.cos(angle) * ORBIT_RADIUS,
      y: CENTER_Y + Math.sin(angle) * ORBIT_RADIUS
    }
  })

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-xs font-medium uppercase tracking-wide text-sb-fg-muted">Relation preview</p>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full rounded-md border border-sb-border bg-[var(--vscode-editor-background)]"
        role="img"
        aria-label={`${characterName} 관계 미리보기`}
      >
        {targets.map(({ relation, x, y }, index) => {
          const labelX = (CENTER_X + x) / 2
          const labelY = (CENTER_Y + y) / 2 - 6

          return (
            <g key={`relation-edge-${index}`}>
              <line
                x1={CENTER_X}
                y1={CENTER_Y}
                x2={x}
                y2={y}
                stroke="var(--vscode-focusBorder)"
                strokeWidth={1.5}
                strokeLinecap="round"
                opacity={0.85}
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                fill="var(--vscode-descriptionForeground)"
                fontSize={10}
              >
                {shortenLabel(relation.type, 12)}
              </text>
            </g>
          )
        })}
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={NODE_RADIUS}
          fill="var(--vscode-button-background)"
          stroke="var(--vscode-focusBorder)"
          strokeWidth={1.5}
        />
        <text x={CENTER_X} y={CENTER_Y - 4} textAnchor="middle" fill="var(--vscode-foreground)" fontSize={11} fontWeight={700}>
          {shortenLabel(characterName, 10)}
        </text>
        <text x={CENTER_X} y={CENTER_Y + 10} textAnchor="middle" fill="var(--vscode-descriptionForeground)" fontSize={9}>
          {shortenLabel(characterId, 12)}
        </text>
        {targets.map(({ relation, x, y }, index) => (
          <g key={`relation-node-${index}`}>
            <circle
              cx={x}
              cy={y}
              r={NODE_RADIUS - 4}
              fill="var(--vscode-editorWidget-background)"
              stroke="var(--vscode-panel-border)"
              strokeWidth={1.25}
            />
            <text x={x} y={y + 4} textAnchor="middle" fill="var(--vscode-foreground)" fontSize={10} fontWeight={600}>
              {shortenLabel(relation.target, 10)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
