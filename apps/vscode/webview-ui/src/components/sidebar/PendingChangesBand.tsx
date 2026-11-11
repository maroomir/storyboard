import { Inbox } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { Button } from '@webview/components/ui/Button';
import { callRpc } from '@webview/lib/rpcClient';
import type { CardPendingChangeView, CardPendingOrigin } from '@storyboard/story-model/contracts';
import type { VscodeApi } from '@webview/lib/vscodeApi';

const originLabels: Readonly<Record<CardPendingOrigin, string>> = {
  studio: '스튜디오',
  interview: '인터뷰',
  absorb: '노트 흡수',
};

interface PendingListResponse {
  readonly ok: boolean;
  readonly message?: string;
  readonly changes: readonly CardPendingChangeView[];
}

interface PendingSettleResponse {
  readonly ok: boolean;
  readonly message: string;
}

export type PendingChangesBandProps = {
  readonly slug: string;
  readonly refreshKey: string;
  readonly vscodeApi?: VscodeApi;
  readonly onSettled: () => void;
};

function PendingChange({ change }: { readonly change: CardPendingChangeView }): React.ReactElement {
  return (
    <li className="flex flex-col gap-1">
      <p className="m-0 text-xs text-sb-fg-muted">
        {originLabels[change.origin]} · {change.summary}
      </p>
      {change.sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-0.5">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-sb-fg-muted">
            {section.label}
          </p>
          {section.lines.map((line, index) => (
            <p key={`${section.id}-${index}`} className="m-0 text-sm text-sb-fg">
              {line.label === undefined ? null : (
                <span className="mr-1.5 text-sb-fg-muted">{line.label}</span>
              )}
              {line.text}
            </p>
          ))}
        </div>
      ))}
    </li>
  );
}

export function PendingChangesBand({
  slug,
  refreshKey,
  vscodeApi,
  onSettled,
}: PendingChangesBandProps): React.ReactElement | null {
  const [changes, setChanges] = useState<readonly CardPendingChangeView[]>([]);
  const [notice, setNotice] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const reload: () => void = useCallback((): void => {
    if (vscodeApi === undefined) {
      return;
    }

    void callRpc<PendingListResponse>(vscodeApi, 'cards.pending.list', { slug })
      .then((response) => setChanges(response.changes))
      .catch(() => setChanges([]));
  }, [vscodeApi, slug]);

  useEffect(() => {
    setNotice(undefined);
    reload();
  }, [reload, refreshKey]);

  const settle = (method: 'cards.pending.apply' | 'cards.pending.discard'): void => {
    if (vscodeApi === undefined) {
      return;
    }

    setIsBusy(true);
    void callRpc<PendingSettleResponse>(vscodeApi, method, { slug })
      .then((response) => setNotice(response.message))
      .catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : '처리하지 못했어요.'),
      )
      .finally(() => {
        setIsBusy(false);
        reload();
        onSettled();
      });
  };

  if (changes.length === 0) {
    return notice === undefined ? null : (
      <p role="status" className="m-0 text-xs text-sb-fg-muted">
        {notice}
      </p>
    );
  }

  return (
    <section
      aria-label="기다리는 제안"
      className="flex flex-col gap-2 rounded-lg border border-sb-border border-l-2 border-l-sb-border-focus bg-sb-bg-widget px-3 py-2.5"
    >
      <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-sb-fg">
        <Inbox className="h-3.5 w-3.5 shrink-0 text-sb-fg-muted" aria-hidden />이 카드에 제안{' '}
        {changes.length}건이 기다려요
      </p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {changes.map((change, index) => (
          <PendingChange key={`${change.origin}-${index}`} change={change} />
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Button disabled={isBusy} onClick={() => settle('cards.pending.apply')}>
          적용
        </Button>
        <Button
          variant="secondary"
          disabled={isBusy}
          onClick={() => settle('cards.pending.discard')}
        >
          버림
        </Button>
      </div>
      {notice === undefined ? null : <p className="m-0 text-xs text-sb-fg-muted">{notice}</p>}
    </section>
  );
}
