import type { RecentWorkspace } from '@/shared/dto';

import { useI18n } from '@/renderer/lib/i18n';

interface WelcomeProps {
  readonly recentWorkspaces: readonly RecentWorkspace[];
  readonly onNew: () => void;
  readonly onOpen: (recentPath?: string) => void;
}

export function Welcome(props: WelcomeProps): JSX.Element {
  const { t, language } = useI18n();
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium' });

  return (
    <main className="centered">
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <h1 className="brand">Storyboard</h1>
        <p className="tagline">{t('welcome.tagline')}</p>
      </div>
      <div className="row">
        <button type="button" className="button button-primary" onClick={props.onNew}>
          {t('welcome.newWork')}
        </button>
        <button type="button" className="button" onClick={() => props.onOpen()}>
          {t('welcome.openWork')}
        </button>
      </div>
      <section className="stack" style={{ width: 'min(640px, 100%)' }} aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="field-label">
          {t('welcome.recent')}
        </h2>
        {props.recentWorkspaces.length === 0 ? (
          <p className="muted">{t('welcome.noRecent')}</p>
        ) : (
          <ul className="recent-list">
            {props.recentWorkspaces.map((workspace) => (
              <li key={workspace.path}>
                <button type="button" className="recent-item" onClick={() => props.onOpen(workspace.path)}>
                  <span>
                    <span className="work-title">{workspace.title}</span>
                    <span className="muted small" style={{ display: 'block' }}>
                      {workspace.path}
                    </span>
                  </span>
                  <span className="muted small">{dateFormat.format(new Date(workspace.openedAt))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
