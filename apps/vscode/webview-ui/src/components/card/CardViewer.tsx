import { CircleAlert, FileText, SquarePen } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@webview/components/ui/Button';
import { parseCardViewerData } from '@webview/lib/messaging';
import { callRpc } from '@webview/lib/rpcClient';
import type { CardViewerData, CardViewSection } from '@webview/lib/types';
import type { VscodeApi } from '@webview/lib/vscodeApi';

const emptySectionText: string = '아직 없음';

function ViewerSection({ section }: { readonly section: CardViewSection }): React.ReactElement {
  return (
    <section aria-label={section.label} className="flex flex-col gap-1">
      <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-sb-fg-muted">
        {section.label}
      </h2>
      {section.lines.length === 0 ? (
        <p className="m-0 text-sm text-sb-fg-muted">{emptySectionText}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {section.lines.map((line, index) => (
            <li key={`${section.id}-${index}`} className="text-sm leading-normal text-sb-fg">
              {line.label === undefined ? null : (
                <span className="mr-2 font-medium text-sb-fg-muted">{line.label}</span>
              )}
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WarningList({
  warnings,
}: {
  readonly warnings: readonly string[];
}): React.ReactElement | null {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/10 p-2">
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-1.5 text-xs text-amber-500">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {warning}
        </li>
      ))}
    </ul>
  );
}

function useViewerData(initialData: CardViewerData): CardViewerData {
  const [data, setData] = useState<CardViewerData>(initialData);

  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const message: {
        readonly type?: string;
        readonly method?: string;
        readonly payload?: unknown;
      } = event.data ?? {};
      if (message.type === 'event' && message.method === 'cards.changed') {
        setData(parseCardViewerData(message.payload));
      }
    };

    window.addEventListener('message', handler);
    return (): void => window.removeEventListener('message', handler);
  }, []);

  return data;
}

export function CardViewer({
  initialData,
}: {
  readonly initialData: CardViewerData;
}): React.ReactElement {
  const vscodeApi: VscodeApi | undefined = useMemo(() => window.acquireVsCodeApi?.(), []);
  const data: CardViewerData = useViewerData(initialData);
  const [actionError, setActionError] = useState<string | undefined>();

  const runAction = (method: 'cards.openText' | 'cards.editInStudio'): void => {
    if (vscodeApi === undefined) {
      return;
    }

    setActionError(undefined);
    callRpc<Record<string, never>>(vscodeApi, method, {}).catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.');
    });
  };

  const actions: React.ReactElement = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => runAction('cards.openText')}>
        <FileText className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        텍스트로 열기
      </Button>
      <Button onClick={() => runAction('cards.editInStudio')}>
        <SquarePen className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        스튜디오에서 고치기
      </Button>
    </div>
  );

  if (data.view === undefined) {
    return (
      <main className="flex min-h-screen flex-col gap-3 bg-sb-bg p-6 text-sb-fg">
        <p className="m-0 flex items-start gap-1.5 text-sm text-sb-fg-error">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {data.error ?? '카드를 읽을 수 없습니다.'}
        </p>
        {actions}
      </main>
    );
  }

  const { view } = data;
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-sb-bg p-6 text-sb-fg">
      <header className="flex items-start gap-4">
        {data.imageUri === undefined ? null : (
          <img src={data.imageUri} alt="" className="h-24 w-24 shrink-0 rounded object-cover" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display m-0 text-2xl">{view.name}</h1>
          {view.facts.length === 0 ? null : (
            <p className="m-0 text-sm text-sb-fg-muted">{view.facts.join(' · ')}</p>
          )}
          <p className="m-0 text-xs text-sb-fg-muted">읽기 전용 · 수정은 스튜디오에서</p>
        </div>
      </header>
      <WarningList warnings={data.warnings} />
      {view.sections.map((section) => (
        <ViewerSection key={section.id} section={section} />
      ))}
      {actions}
      {actionError === undefined ? null : (
        <p className="m-0 text-xs text-sb-fg-error">{actionError}</p>
      )}
    </main>
  );
}
