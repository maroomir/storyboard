import { useCallback, useEffect, useState } from 'react';

import type { AppBootstrap, RunSnapshot, UiLanguage, WorkspaceOverview } from '@/shared/dto';

import { ProviderSetup } from './components/ProviderSetup';
import { RunDrawer } from './components/RunDrawer';
import { TopBar, type WorkspaceView } from './components/TopBar';
import { desktopBridge } from './lib/bridge';
import { call, messageOf } from './lib/call';
import { I18nProvider, useI18n } from './lib/i18n';
import type { WorkspaceChange } from './lib/workspaceChange';
import { Bible } from './screens/Bible';
import { Desk } from './screens/Desk';
import { History } from './screens/History';
import { Settings } from './screens/Settings';
import { Welcome } from './screens/Welcome';
import { Wizard } from './screens/Wizard';

export function App(): JSX.Element {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [language, setLanguage] = useState<UiLanguage>('ko');

  useEffect(() => {
    void call('app.bootstrap', {}).then((data) => {
      setBootstrap(data);
      setLanguage(data.language);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  if (bootstrap === undefined) {
    return <div className="centered" aria-busy="true" />;
  }

  return (
    <I18nProvider language={language}>
      <Workbench bootstrap={bootstrap} onBootstrapChange={setBootstrap} onLanguageChange={setLanguage} />
    </I18nProvider>
  );
}

interface WorkbenchProps {
  readonly bootstrap: AppBootstrap;
  readonly onBootstrapChange: (bootstrap: AppBootstrap) => void;
  readonly onLanguageChange: (language: UiLanguage) => void;
}

function Workbench(props: WorkbenchProps): JSX.Element {
  const { t } = useI18n();
  const [overview, setOverview] = useState<WorkspaceOverview>();
  const [isWizardOpen, setWizardOpen] = useState(false);
  const [isProviderSetupOpen, setProviderSetupOpen] = useState(!props.bootstrap.isProviderReady);
  const [view, setView] = useState<WorkspaceView>('desk');
  const [run, setRun] = useState<RunSnapshot>();
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [change, setChange] = useState<WorkspaceChange>({ areas: [], draftStems: [], sequence: 0 });
  const [error, setError] = useState<string>();
  const [updateVersion, setUpdateVersion] = useState<string>();
  const [requestedStem, setRequestedStem] = useState<string>();

  const refreshBootstrap = useCallback(async () => {
    props.onBootstrapChange(await call('app.bootstrap', {}));
  }, [props]);

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await call('workspace.overview', {}));
    } catch (failure) {
      setError(messageOf(failure));
    }
  }, []);

  useEffect(() => {
    const bridge = desktopBridge();
    const offRun = bridge.on('run.changed', setRun);
    const offChange = bridge.on('workspace.changed', (payload) =>
      setChange((previous) => ({ ...payload, sequence: previous.sequence + 1 })),
    );
    const offUpdate = bridge.on('app.updateReady', ({ version }) => setUpdateVersion(version));

    return () => {
      offRun();
      offChange();
      offUpdate();
    };
  }, []);

  // A finished run and any change on disk may move the table of contents.
  useEffect(() => {
    if (overview !== undefined && change.sequence > 0) {
      void refreshOverview();
    }
  }, [change.sequence]);

  useEffect(() => {
    if (overview !== undefined && run?.status === 'idle') {
      void refreshOverview();
    }
  }, [run?.status]);

  const openWorkspace = async (recentPath?: string): Promise<void> => {
    setError(undefined);
    try {
      const opened = await call('workspace.open', recentPath === undefined ? {} : { recentPath });
      if (!('cancelled' in opened)) {
        setOverview(opened);
        setView('desk');
        setRun(await call('run.status', {}));
      }
    } catch (failure) {
      setError(messageOf(failure));
    }
    await refreshBootstrap();
  };

  const closeWorkspace = async (): Promise<void> => {
    try {
      await call('workspace.close', {});
      setOverview(undefined);
      setRun(undefined);
      setDrawerOpen(false);
      await refreshBootstrap();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  const changeLanguage = async (language: UiLanguage): Promise<void> => {
    await call('app.setLanguage', { language });
    props.onLanguageChange(language);
  };

  const banners = (
    <>
      {error === undefined ? null : (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="button button-quiet" onClick={() => setError(undefined)}>
            {t('common.close')}
          </button>
        </div>
      )}
      {updateVersion === undefined ? null : (
        <div className="banner" role="status">
          <span>{t('update.ready', { version: updateVersion })}</span>
          <button type="button" className="button" onClick={() => void call('app.installUpdate', {})}>
            {t('update.restart')}
          </button>
        </div>
      )}
    </>
  );

  const providerSetup = isProviderSetupOpen ? (
    <ProviderSetup
      onDone={() => {
        setProviderSetupOpen(false);
        void refreshBootstrap();
      }}
    />
  ) : null;

  if (overview === undefined) {
    return (
      <div className="shell">
        {banners}
        {isWizardOpen ? (
          <Wizard
            defaultParentDirectory={props.bootstrap.defaultParentDirectory}
            onCancel={() => setWizardOpen(false)}
            onCreated={(created) => {
              setWizardOpen(false);
              setOverview(created);
              setView('desk');
              void call('run.status', {}).then(setRun);
              void refreshBootstrap();
            }}
          />
        ) : (
          <Welcome
            recentWorkspaces={props.bootstrap.recentWorkspaces}
            onNew={() => setWizardOpen(true)}
            onOpen={(path) => void openWorkspace(path)}
          />
        )}
        {providerSetup}
      </div>
    );
  }

  return (
    <div className="shell">
      <TopBar
        overview={overview}
        run={run}
        view={view}
        onViewChange={setView}
        onOpenDrawer={() => setDrawerOpen(true)}
        onClose={() => void closeWorkspace()}
      />
      {banners}
      {view === 'desk' ? (
        <Desk
          overview={overview}
          run={run}
          change={change}
          requestedStem={requestedStem}
          onError={setError}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
      ) : null}
      {view === 'bible' ? <Bible run={run} change={change} onError={setError} /> : null}
      {view === 'settings' ? (
        <Settings onError={setError} onLanguageChange={(language) => void changeLanguage(language)} />
      ) : null}
      {view === 'history' ? <History run={run} change={change} onError={setError} /> : null}
      {isDrawerOpen && run !== undefined ? (
        <RunDrawer
          overview={overview}
          run={run}
          onRunChange={setRun}
          onClose={() => setDrawerOpen(false)}
          onError={setError}
          onSceneOpen={(stem) => {
            setRequestedStem(stem);
            setView('desk');
            setDrawerOpen(false);
          }}
        />
      ) : null}
      {providerSetup}
    </div>
  );
}
