import { AlertCircle, CheckCircle2, LoaderCircle, PlugZap } from 'lucide-react';
import React from 'react';

import { type ConnectionTestState } from './settingsSnapshot';

export function StatusPill({
  tone,
  children,
}: {
  readonly tone: 'neutral' | 'success' | 'warning' | 'error';
  readonly children: React.ReactNode;
}): React.ReactElement {
  const toneClass = {
    neutral: 'border-sb-border text-sb-fg-muted',
    success: 'border-sb-border-focus text-sb-fg',
    warning: 'border-sb-border-warning text-sb-fg',
    error: 'border-sb-fg-error text-sb-fg-error',
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

export function ConnectionTestButton({
  state,
  onClick,
}: {
  readonly state: ConnectionTestState;
  readonly onClick: () => void;
}): React.ReactElement {
  const iconClass = 'h-4 w-4';
  const stateView = {
    idle: {
      label: '연결 테스트',
      icon: <PlugZap className={iconClass} aria-hidden />,
      className: 'text-sb-fg-muted',
    },
    loading: {
      label: '연결 확인 중',
      icon: <LoaderCircle className={`${iconClass} animate-spin`} aria-hidden />,
      className: 'text-sb-fg-muted',
    },
    ok: {
      label: '연결 성공',
      icon: <CheckCircle2 className={iconClass} aria-hidden />,
      className: 'text-sb-fg',
    },
    error: {
      label: '연결 실패',
      icon: <AlertCircle className={iconClass} aria-hidden />,
      className: 'text-sb-fg-error',
    },
    'not-installed': {
      label: 'CLI 미설치',
      icon: <AlertCircle className={iconClass} aria-hidden />,
      className: 'text-sb-fg-error',
    },
  }[state];

  return (
    <button
      type="button"
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-sb-border bg-sb-bg-widget outline-none transition hover:border-sb-border-focus focus-visible:border-sb-border-focus focus-visible:ring-1 focus-visible:ring-sb-border-focus ${stateView.className}`}
      aria-label={stateView.label}
      title={stateView.label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state !== 'loading') {
          onClick();
        }
      }}
      disabled={state === 'loading'}
    >
      {stateView.icon}
    </button>
  );
}
