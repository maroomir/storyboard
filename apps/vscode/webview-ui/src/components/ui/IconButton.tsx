import clsx from 'clsx';
import { Minus, Pencil, Plus, Save, X } from 'lucide-react';
import type React from 'react';

type IconButtonSize = 'sm' | 'md';
type IconButtonIcon = 'add' | 'remove' | 'edit' | 'save' | 'cancel';

const sizeClass: Record<IconButtonSize, { button: string; icon: string }> = {
  sm: { button: 'h-7 w-7', icon: 'h-3.5 w-3.5' },
  md: { button: 'h-8 w-8', icon: 'h-4 w-4' },
};

const baseClass =
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded border border-[color:var(--vscode-button-border)] bg-sb-bg-button p-0 text-sb-fg-button outline-none hover:bg-sb-bg-button-hover focus-visible:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus';

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  readonly 'aria-label': string;
  readonly icon: IconButtonIcon;
  readonly size?: IconButtonSize;
};

const iconComponents: Record<IconButtonIcon, typeof Plus> = {
  add: Plus,
  remove: Minus,
  edit: Pencil,
  save: Save,
  cancel: X,
};

export function IconButton({
  icon,
  size = 'sm',
  className,
  type = 'button',
  ...rest
}: IconButtonProps): React.ReactElement {
  const LucideIcon = iconComponents[icon];
  const sizes = sizeClass[size];

  return (
    <button
      type={type}
      className={clsx(
        baseClass,
        sizes.button,
        (icon === 'remove' || icon === 'cancel') && 'hover:text-sb-fg-error',
        className,
      )}
      {...rest}
    >
      <LucideIcon className={sizes.icon} aria-hidden />
    </button>
  );
}
