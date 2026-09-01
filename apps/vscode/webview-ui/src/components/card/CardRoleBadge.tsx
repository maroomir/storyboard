import clsx from 'clsx';
import type React from 'react';

import { CHARACTER_ROLE_OPTIONS } from '@webview/lib/characterSidebarGroups';
import type { CharacterRole } from '@webview/lib/types';

type CardRoleBadgeSize = 'sm' | 'md';

export type CardRoleBadgeProps = {
  readonly role: CharacterRole;
  readonly size?: CardRoleBadgeSize;
  readonly className?: string;
};

const roleLabelByValue = Object.fromEntries(
  CHARACTER_ROLE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<CharacterRole, string>;

const sizeClass: Record<CardRoleBadgeSize, { readonly shell: string; readonly glyph: string }> = {
  sm: { shell: 'h-6 w-6 text-[0.55rem]', glyph: 'h-2.5 w-2.5' },
  md: { shell: 'h-9 w-9 text-xs', glyph: 'h-4 w-4' },
};

const roleFrameClass: Record<CharacterRole, string> = {
  main: 'bg-gradient-to-br from-amber-200 via-amber-500 to-amber-900 shadow-[0_0_10px_rgba(251,191,36,0.45),inset_0_1px_0_rgba(255,255,255,0.5)]',
  supporting:
    'bg-gradient-to-br from-slate-100 via-slate-300 to-slate-600 shadow-[0_0_8px_rgba(148,163,184,0.35),inset_0_1px_0_rgba(255,255,255,0.55)]',
  extra:
    'bg-gradient-to-br from-neutral-300 via-neutral-500 to-neutral-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]',
};

function RoleGlyph({
  role,
  className,
}: {
  readonly role: CharacterRole;
  readonly className?: string;
}): React.ReactElement {
  if (role === 'main') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M12 2.5l2.38 6.52 6.9.38-5.2 4.12 1.78 6.73L12 16.9l-5.86 3.35 1.78-6.73-5.2-4.12 6.9-.38L12 2.5z"
        />
      </svg>
    );
  }

  if (role === 'supporting') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <path fill="currentColor" d="M12 4.5 19 12 12 19.5 5 12 12 4.5z" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    </svg>
  );
}

export function CardRoleBadge({
  role,
  size = 'md',
  className,
}: CardRoleBadgeProps): React.ReactElement {
  const dimensions = sizeClass[size];

  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-black/35 font-bold leading-none text-black/85',
        dimensions.shell,
        roleFrameClass[role],
        className,
      )}
      title={roleLabelByValue[role]}
      aria-label={roleLabelByValue[role]}
    >
      <RoleGlyph role={role} className={dimensions.glyph} />
    </span>
  );
}
