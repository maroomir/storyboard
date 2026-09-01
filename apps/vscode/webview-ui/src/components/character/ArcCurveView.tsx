import type React from 'react';

import type { CharacterArc } from '@webview/lib/types';

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 140;
const PADDING_X = 28;
const PADDING_Y = 36;

function buildCurvePath(points: readonly { readonly x: number; readonly y: number }[]): string {
  const [start] = points;

  if (!start) {
    return '';
  }

  let path = `M ${start.x} ${start.y}`;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (!previous || !current) {
      continue;
    }

    const controlX = (previous.x + current.x) / 2;

    path += ` C ${controlX} ${previous.y}, ${controlX} ${current.y}, ${current.x} ${current.y}`;
  }

  return path;
}

export function ArcCurveView({
  arc,
}: {
  readonly arc: readonly CharacterArc[];
}): React.ReactElement {
  const stages = arc.filter((item) => item.stage.trim().length > 0);

  if (stages.length === 0) {
    return (
      <p className="m-0 rounded-md border border-dashed border-sb-border px-3 py-4 text-center text-sm text-sb-fg-muted">
        아크 단계가 없습니다. stage를 추가하면 타임라인 곡선이 표시됩니다.
      </p>
    );
  }

  const points = stages.map((item, index) => {
    const x =
      stages.length === 1
        ? VIEW_WIDTH / 2
        : PADDING_X + (index / (stages.length - 1)) * (VIEW_WIDTH - PADDING_X * 2);
    const wave = index % 2 === 0 ? -14 : 14;
    const y = VIEW_HEIGHT / 2 + (stages.length > 2 ? wave : 0);

    return { x, y, item };
  });

  const curvePath = buildCurvePath(points);

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-xs font-medium uppercase tracking-wide text-sb-fg-muted">
        Arc preview
      </p>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full rounded-md border border-sb-border bg-[var(--vscode-editor-background)]"
        role="img"
        aria-label="캐릭터 아크 타임라인"
      >
        <path
          d={curvePath}
          fill="none"
          stroke="var(--vscode-focusBorder)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {points.map(({ x, y, item }, index) => (
          <g key={`arc-point-${index}`}>
            <circle
              cx={x}
              cy={y}
              r={5}
              fill="var(--vscode-button-background)"
              stroke="var(--vscode-focusBorder)"
              strokeWidth={1.5}
            />
            <text
              x={x}
              y={y < VIEW_HEIGHT / 2 ? y + PADDING_Y : y - PADDING_Y + 8}
              textAnchor="middle"
              fill="var(--vscode-foreground)"
              fontSize={11}
              fontWeight={600}
            >
              {item.stage.length > 14 ? `${item.stage.slice(0, 13)}…` : item.stage}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
