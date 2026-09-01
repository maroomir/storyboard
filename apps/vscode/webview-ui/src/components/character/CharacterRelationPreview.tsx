import { useMemo } from 'react';
import type React from 'react';

import {
  buildCharacterRosterLookup,
  resolveCharacterDisplayName,
} from '@webview/lib/characterRosterLookup';
import type { CharacterRelation, CharacterRole, CharacterRosterEntry } from '@webview/lib/types';

const VIEW_WIDTH = 420;
const VIEW_HEIGHT = 280;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = VIEW_HEIGHT / 2;
const ORBIT_RADIUS = 96;

const CENTER_NODE_W = 108;
const CENTER_NODE_H = 54;
const TARGET_NODE_W = 92;
const TARGET_NODE_H = 44;

const EDGE_GRADIENT_START = '#d97706';
const EDGE_GRADIENT_END = '#0d9488';

const roleAccent: Record<
  CharacterRole,
  { readonly stroke: string; readonly fill: string; readonly glow: string }
> = {
  main: {
    stroke: '#f59e0b',
    fill: 'rgba(245, 158, 11, 0.18)',
    glow: 'rgba(251, 191, 36, 0.45)',
  },
  supporting: {
    stroke: '#94a3b8',
    fill: 'rgba(148, 163, 184, 0.16)',
    glow: 'rgba(148, 163, 184, 0.35)',
  },
  extra: {
    stroke: '#737373',
    fill: 'rgba(115, 115, 115, 0.14)',
    glow: 'rgba(163, 163, 163, 0.25)',
  },
};

function shortenLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function shortenLineSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  insetStart: number,
  insetEnd: number,
):
  | { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | undefined {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);

  if (length < insetStart + insetEnd + 4) {
    return undefined;
  }

  const ux = dx / length;
  const uy = dy / length;

  return {
    x1: x1 + ux * insetStart,
    y1: y1 + uy * insetStart,
    x2: x2 - ux * insetEnd,
    y2: y2 - uy * insetEnd,
  };
}

function relationNodeStyle(
  role: CharacterRole | undefined,
  isCenter: boolean,
): {
  readonly stroke: string;
  readonly fill: string;
  readonly glow?: string;
} {
  if (role) {
    return roleAccent[role];
  }

  return {
    stroke: isCenter ? 'var(--vscode-focusBorder)' : 'var(--vscode-panel-border)',
    fill: isCenter ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.04)',
  };
}

function RelationNode({
  x,
  y,
  width,
  height,
  name,
  subtitle,
  role,
  isCenter,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly name: string;
  readonly subtitle?: string;
  readonly role?: CharacterRole;
  readonly isCenter: boolean;
}): React.ReactElement {
  const halfW = width / 2;
  const halfH = height / 2;
  const style = relationNodeStyle(role, isCenter);

  return (
    <g transform={`translate(${x},${y})`}>
      {isCenter && style.glow ? (
        <rect
          x={-halfW - 4}
          y={-halfH - 4}
          width={width + 8}
          height={height + 8}
          rx={16}
          fill={style.glow}
          opacity={0.55}
        />
      ) : null}
      <rect
        x={-halfW}
        y={-halfH}
        width={width}
        height={height}
        rx={12}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={isCenter ? 2 : 1.5}
      />
      <rect
        x={-halfW + 1}
        y={-halfH + 1}
        width={width - 2}
        height={height * 0.35}
        rx={11}
        fill="rgba(255,255,255,0.05)"
      />
      <text
        x={0}
        y={subtitle ? -4 : 1}
        textAnchor="middle"
        fill="var(--vscode-foreground)"
        fontSize={isCenter ? 13 : 12}
        fontWeight={700}
      >
        {shortenLabel(name, isCenter ? 12 : 10)}
      </text>
      {subtitle ? (
        <text
          x={0}
          y={12}
          textAnchor="middle"
          fill="var(--vscode-descriptionForeground)"
          fontSize={9}
        >
          {shortenLabel(subtitle, 14)}
        </text>
      ) : null}
    </g>
  );
}

export function CharacterRelationPreview({
  characterName,
  characterRole,
  characterRoster = [],
  relations,
}: {
  readonly characterName: string;
  readonly characterRole?: CharacterRole;
  readonly characterRoster?: readonly CharacterRosterEntry[];
  readonly relations: readonly CharacterRelation[];
}): React.ReactElement {
  const rosterLookup = useMemo(
    () => buildCharacterRosterLookup(characterRoster),
    [characterRoster],
  );

  const linkedRelations = relations.filter(
    (relation) => relation.target.trim().length > 0 && relation.type.trim().length > 0,
  );

  if (linkedRelations.length === 0) {
    return (
      <p className="m-0 rounded-xl border border-dashed border-sb-border/80 bg-[var(--vscode-editor-background)]/40 px-3 py-4 text-center text-sm text-sb-fg-muted">
        관계가 없습니다. target과 type을 추가하면 미리보기가 표시됩니다.
      </p>
    );
  }

  const targets = linkedRelations.map((relation, index) => {
    const angle = (index / linkedRelations.length) * Math.PI * 2 - Math.PI / 2;
    const resolved = resolveCharacterDisplayName(relation.target, rosterLookup);

    return {
      relation,
      resolved,
      x: CENTER_X + Math.cos(angle) * ORBIT_RADIUS,
      y: CENTER_Y + Math.sin(angle) * ORBIT_RADIUS,
    };
  });

  const centerInset = Math.max(CENTER_NODE_W, CENTER_NODE_H) * 0.42;
  const targetInset = Math.max(TARGET_NODE_W, TARGET_NODE_H) * 0.42;

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-xs font-medium uppercase tracking-wide text-sb-fg-muted">
        Relation preview
      </p>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-auto w-full overflow-hidden rounded-xl border border-sb-border/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_32px_rgba(0,0,0,0.22)]"
        role="img"
        aria-label={`${characterName} 관계 미리보기`}
      >
        <defs>
          <radialGradient id="relation-preview-bg" cx="50%" cy="42%" r="68%">
            <stop offset="0%" stopColor="rgba(217, 119, 6, 0.12)" />
            <stop offset="55%" stopColor="rgba(13, 148, 136, 0.08)" />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0.18)" />
          </radialGradient>
          <marker
            id="relation-preview-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_GRADIENT_END} opacity="0.9" />
          </marker>
          {targets.map(({ x, y }, index) => {
            const segment = shortenLineSegment(CENTER_X, CENTER_Y, x, y, centerInset, targetInset);
            if (segment == null) {
              return null;
            }

            return (
              <linearGradient
                key={`edge-gradient-${index}`}
                id={`relation-preview-edge-${index}`}
                gradientUnits="userSpaceOnUse"
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
              >
                <stop offset="0%" stopColor={EDGE_GRADIENT_START} stopOpacity={0.95} />
                <stop offset="100%" stopColor={EDGE_GRADIENT_END} stopOpacity={0.95} />
              </linearGradient>
            );
          })}
        </defs>

        <rect
          x={0}
          y={0}
          width={VIEW_WIDTH}
          height={VIEW_HEIGHT}
          fill="url(#relation-preview-bg)"
        />
        <rect
          x={8}
          y={8}
          width={VIEW_WIDTH - 16}
          height={VIEW_HEIGHT - 16}
          rx={18}
          fill="var(--vscode-editor-background)"
          opacity={0.55}
        />
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={ORBIT_RADIUS + 8}
          fill="none"
          stroke="var(--vscode-focusBorder)"
          strokeWidth={1}
          strokeDasharray="4 6"
          opacity={0.35}
        />

        {targets.map(({ relation, resolved, x, y }, index) => {
          const segment = shortenLineSegment(CENTER_X, CENTER_Y, x, y, centerInset, targetInset);
          if (segment == null) {
            return null;
          }

          const labelX = (segment.x1 + segment.x2) / 2;
          const labelY = (segment.y1 + segment.y2) / 2;
          const label = shortenLabel(relation.type, 10);
          const labelWidth = Math.max(label.length * 7 + 14, 34);

          return (
            <g key={`relation-edge-${index}`}>
              <line
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                stroke={`url(#relation-preview-edge-${index})`}
                strokeWidth={2}
                strokeLinecap="round"
                markerEnd="url(#relation-preview-arrow)"
              />
              <rect
                x={labelX - labelWidth / 2}
                y={labelY - 10}
                width={labelWidth}
                height={18}
                rx={9}
                fill="var(--vscode-badge-background)"
                stroke="var(--vscode-badge-foreground)"
                strokeWidth={0.5}
                opacity={0.92}
              />
              <text
                x={labelX}
                y={labelY + 3}
                textAnchor="middle"
                fill="var(--vscode-badge-foreground)"
                fontSize={10}
                fontWeight={600}
              >
                {label}
              </text>
            </g>
          );
        })}

        <RelationNode
          x={CENTER_X}
          y={CENTER_Y}
          width={CENTER_NODE_W}
          height={CENTER_NODE_H}
          name={characterName}
          role={characterRole}
          isCenter
        />

        {targets.map(({ relation, resolved, x, y }, index) => (
          <RelationNode
            key={`relation-node-${index}`}
            x={x}
            y={y}
            width={TARGET_NODE_W}
            height={TARGET_NODE_H}
            name={resolved.displayName}
            subtitle={resolved.isKnown ? undefined : '미등록'}
            role={resolved.role}
            isCenter={false}
          />
        ))}
      </svg>
    </div>
  );
}
