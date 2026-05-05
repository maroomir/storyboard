import clsx from "clsx"
import type React from "react"

import { sbControlButtonClass } from "./formClasses"

export type ButtonVariant = "primary" | "secondary" | "ghost"

const variantClass: Record<ButtonVariant, string> = {
  primary: sbControlButtonClass,
  secondary:
    "cursor-pointer rounded border border-sb-border bg-sb-bg-widget px-2 py-1.5 text-sm text-sb-fg hover:border-sb-border-focus",
  ghost:
    "cursor-pointer rounded border border-transparent bg-transparent px-2 py-1.5 text-sm text-sb-fg-link hover:bg-sb-bg-list-hover"
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant
}

export function Button({ variant = "primary", className, type = "button", ...rest }: ButtonProps): React.ReactElement {
  return <button type={type} className={clsx(variantClass[variant], className)} {...rest} />
}
