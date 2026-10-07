import clsx from 'clsx';
import type React from 'react';

import {
  formatUsageBadgeLabel,
  formatUsageBadgeTooltip,
  isEmptyUsageDisplay,
} from '@webview/lib/costFormat';
import type { UsageAmount } from '@webview/lib/types';

export type CostBadgeProps = {
  readonly usage: UsageAmount;
  readonly className?: string;
  readonly tooltip?: string;
};

export function CostBadge({ usage, className, tooltip }: CostBadgeProps): React.ReactElement {
  const label = formatUsageBadgeLabel(usage);
  const isPlaceholder = isEmptyUsageDisplay(usage);

  return (
    <span
      role="status"
      className={clsx(
        'inline-flex max-w-full items-center rounded-full border border-sb-border bg-sb-bg-sidebar/80 px-1.5 py-0.5 text-[0.65rem] font-medium tabular-nums transition-colors hover:bg-sb-bg-list-hover/80',
        isPlaceholder ? 'text-sb-fg-muted' : 'text-sb-fg',
        className,
      )}
      title={tooltip ?? formatUsageBadgeTooltip(usage)}
      aria-label={`AI 사용량 ${label}`}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
