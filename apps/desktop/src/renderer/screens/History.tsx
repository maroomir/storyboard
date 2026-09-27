import { useEffect, useState } from 'react';

import type { RunSnapshot, SnapshotEntry } from '@/shared/dto';

import type { WorkspaceChange } from '@/renderer/lib/workspaceChange';
import { call, messageOf } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';

interface HistoryProps {
  readonly run: RunSnapshot | undefined;
  readonly change: WorkspaceChange;
  readonly onError: (message: string) => void;
}

export function History(props: HistoryProps): JSX.Element {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<readonly SnapshotEntry[]>();
  const [isRestoring, setRestoring] = useState(false);
  const isBusy = props.run !== undefined && props.run.status !== 'idle';
  const timeFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  useEffect(() => {
    void call('history.list', {})
      .then(setEntries)
      .catch((failure: unknown) => props.onError(messageOf(failure)));
  }, [props.change.sequence, props.run?.status]);

  const restore = async (entry: SnapshotEntry): Promise<void> => {
    if (!window.confirm(t('history.restoreConfirm', { message: entry.message }))) {
      return;
    }
    setRestoring(true);
    try {
      setEntries(await call('history.restore', { id: entry.id }));
    } catch (failure) {
      props.onError(messageOf(failure));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <main className="workspace-page">
      <div className="workspace-page-inner">
        <h1 className="page-title">{t('history.title')}</h1>
        <p className="muted">{t('history.intro')}</p>
        {entries !== undefined && entries.length === 0 ? <p className="muted">{t('history.empty')}</p> : null}
        <ol className="list">
          {(entries ?? []).map((entry, index) => (
            <li key={entry.id} className="spread section">
              <span>
                {entry.message}
                <span className="muted small" style={{ display: 'block' }}>
                  {timeFormat.format(new Date(entry.time))}
                </span>
              </span>
              {index === 0 ? null : (
                <button type="button" className="button" disabled={isBusy || isRestoring} onClick={() => void restore(entry)}>
                  {t('history.restore')}
                </button>
              )}
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
