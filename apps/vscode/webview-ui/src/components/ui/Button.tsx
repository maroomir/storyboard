import clsx from "clsx"
import type React from "react"

import { sbControlButtonClass } from "./formClasses"

type ButtonVariant = "primary" | "secondary" | "ghost"

const variantClass: Record<ButtonVariant, string> = {
  primary: sbControlButtonClass,
  secondary:
    "cursor-pointer rounded border border-sb-border bg-sb-bg-widget px-2 py-1.5 text-sm text-sb-fg outline-none hover:border-sb-border-focus focus-visible:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus",
  ghost:
    "cursor-pointer rounded border border-transparent bg-transparent px-2 py-1.5 text-sm text-sb-fg-link outline-none hover:bg-sb-bg-list-hover focus-visible:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus"
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant
}

export function Button({ variant = "primary", className, type = "button", ...rest }: ButtonProps): React.ReactElement {
  const primaryFocus =
    variant === "primary"
      ? "outline-none focus-visible:ring-1 focus-visible:ring-sb-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-sb-bg-sidebar"
      : ""
  return <button type={type} className={clsx(variantClass[variant], primaryFocus, className)} {...rest} />
}
