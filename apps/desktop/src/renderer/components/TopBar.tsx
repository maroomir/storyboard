import type { RunSnapshot, WorkspaceOverview } from '@/shared/dto';

import { useI18n } from '@/renderer/lib/i18n';

export type WorkspaceView = 'desk' | 'bible' | 'settings' | 'history';

const views: readonly { readonly view: WorkspaceView; readonly label: 'desk.toc' | 'desk.bible' | 'desk.settings' | 'desk.history' }[] = [
  { view: 'desk', label: 'desk.toc' },
  { view: 'bible', label: 'desk.bible' },
  { view: 'history', label: 'desk.history' },
  { view: 'settings', label: 'desk.settings' },
];

interface TopBarProps {
  readonly overview: WorkspaceOverview;
  readonly run: RunSnapshot | undefined;
  readonly view: WorkspaceView;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly onOpenDrawer: () => void;
  readonly onClose: () => void;
}

export function TopBar(props: TopBarProps): JSX.Element {
  const { t } = useI18n();
  const status = props.run?.status ?? 'idle';

  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="work-title">{props.overview.title}</span>
        {props.overview.genre === undefined ? null : <span>{props.overview.genre}</span>}
      </div>
      <nav className="topbar-actions" aria-label={props.overview.title}>
        {views.map(({ view, label }) => (
          <button
            key={view}
            type="button"
            className="nav-tab"
            aria-current={props.view === view ? 'page' : undefined}
            onClick={() => props.onViewChange(view)}
          >
            {t(label)}
          </button>
        ))}
        <button type="button" className="button" onClick={props.onOpenDrawer}>
          {t('desk.run')}
          {status === 'idle' ? null : (
            <>
              {' '}
              <span className="pill">
                <span className="pill-dot" aria-hidden="true" />
                {t(`run.status.${status}`)}
              </span>
            </>
          )}
        </button>
        <button type="button" className="button button-quiet" onClick={props.onClose}>
          {t('desk.closeWork')}
        </button>
      </nav>
    </header>
  );
}
