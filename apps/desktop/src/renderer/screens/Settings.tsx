import { useEffect, useState } from 'react';

import type { AiProviderId } from '@storyboard/story-engine/contracts';

import type { DesktopSettings, SettingEntry, UiLanguage } from '@/shared/dto';

import { call, messageOf } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';

// The catalog names its settings in Korean. The few on the basic list are translated here; the rest
// say in the advanced section that they are Korean only.
const englishBasicSettings: Readonly<Record<string, { readonly label: string; readonly description: string }>> = {
  'budget.runLimitUsd': {
    label: 'Budget per novel run (USD)',
    description: 'The most one novel run may spend on AI. Past it, the run finishes the scene in progress and pauses. 0 means no limit.',
  },
  'draft.reviseAfterGenerate': {
    label: 'Review and revise right after drafting',
    description: 'Runs the review-and-revise loop on every new draft.',
  },
  'draft.keepHistory': {
    label: 'Keep earlier drafts',
    description: 'Keeps the previous draft in .draft/ whenever a draft is replaced.',
  },
};

interface SettingsProps {
  readonly onError: (message: string) => void;
  readonly onLanguageChange: (language: UiLanguage) => void;
}

export function Settings(props: SettingsProps): JSX.Element {
  const { t, language } = useI18n();
  const [settings, setSettings] = useState<DesktopSettings>();
  const [showAdvancedProviders, setShowAdvancedProviders] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [keyMessage, setKeyMessage] = useState<string>();

  useEffect(() => {
    void call('settings.read', {}).then(setSettings);
  }, []);

  const update = async (action: () => Promise<DesktopSettings>): Promise<void> => {
    try {
      setSettings(await action());
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  if (settings === undefined) {
    return <main className="workspace-page" aria-busy="true" />;
  }

  const providers = settings.providers.filter((provider) => showAdvancedProviders || !provider.isAdvanced || provider.id === settings.defaultProvider);
  const selected = settings.providers.find((provider) => provider.id === settings.defaultProvider);

  const saveKey = async (): Promise<void> => {
    if (selected === undefined || apiKey.trim().length === 0) {
      return;
    }
    setKeyMessage(undefined);
    try {
      setSettings(await call('settings.setApiKey', { providerId: selected.id, apiKey: apiKey.trim() }));
      setApiKey('');
      setKeyMessage(t('provider.connected'));
    } catch (failure) {
      setKeyMessage(messageOf(failure));
      setSettings(await call('settings.read', {}));
    }
  };

  const labelOf = (entry: SettingEntry): { readonly label: string; readonly description: string } =>
    (language === 'en' ? englishBasicSettings[entry.key] : undefined) ?? entry;

  return (
    <main className="workspace-page">
      <div className="workspace-page-inner">
        <h1 className="page-title">{t('settings.title')}</h1>

        <section className="section stack">
          <h2>{t('settings.ai')}</h2>
          <label className="field">
            <span className="field-label">{t('settings.defaultProvider')}</span>
            <select
              className="select"
              value={selected === undefined ? '' : selected.id}
              onChange={(event) =>
                void update(() => call('settings.setDefaultProvider', { providerId: event.target.value as AiProviderId }))
              }
            >
              {selected === undefined ? <option value="">—</option> : null}
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row small">
            <input type="checkbox" checked={showAdvancedProviders} onChange={(event) => setShowAdvancedProviders(event.target.checked)} />
            {t('settings.showAdvancedProviders')}
          </label>
          {selected === undefined ? null : (
            <>
              <label className="field">
                <span className="field-label">{t('settings.model')}</span>
                <select
                  className="select"
                  value={selected.model}
                  onChange={(event) => void update(() => call('settings.setModel', { providerId: selected.id, model: event.target.value }))}
                >
                  {selected.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              {selected.requiresApiKey ? (
                <div className="field">
                  <span className="field-label">
                    {t('settings.apiKey')} — {selected.hasApiKey ? t('settings.keyStored') : t('settings.keyMissing')}
                  </span>
                  <div className="row">
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      aria-label={t('settings.apiKey')}
                      value={apiKey}
                      placeholder={t('provider.keyPlaceholder')}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                    <button type="button" className="button" disabled={apiKey.trim().length === 0} onClick={() => void saveKey()}>
                      {t('settings.replaceKey')}
                    </button>
                  </div>
                  <span className="field-hint">{t('provider.keyHint')}</span>
                  {keyMessage === undefined ? null : <span className="small">{keyMessage}</span>}
                </div>
              ) : (
                <OllamaAddress
                  initial={settings.ollamaBaseUrl}
                  onSave={(baseUrl) => void update(() => call('settings.setOllamaBaseUrl', { baseUrl }))}
                />
              )}
            </>
          )}
        </section>

        <section className="section">
          <h2>{t('settings.language')}</h2>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={settings.language}
            aria-label={t('settings.language')}
            onChange={(event) => {
              const next = event.target.value as UiLanguage;
              setSettings({ ...settings, language: next });
              props.onLanguageChange(next);
            }}
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </section>

        <section className="section stack">
          <h2>{t('settings.basic')}</h2>
          {settings.entries
            .filter((entry) => entry.isBasic)
            .map((entry) => (
              <SettingControl
                key={entry.key}
                entry={entry}
                {...labelOf(entry)}
                onChange={(value) => void update(() => call('settings.setValue', { key: entry.key, value }))}
              />
            ))}
        </section>

        <details className="section">
          <summary>{t('settings.advanced')}</summary>
          <p className="muted small">{t('settings.advancedHint')}</p>
          <div className="stack">
            {settings.entries
              .filter((entry) => !entry.isBasic)
              .map((entry) => (
                <SettingControl
                  key={entry.key}
                  entry={entry}
                  label={entry.label}
                  description={entry.description}
                  onChange={(value) => void update(() => call('settings.setValue', { key: entry.key, value }))}
                />
              ))}
          </div>
        </details>
      </div>
    </main>
  );
}

function OllamaAddress(props: { readonly initial: string; readonly onSave: (baseUrl: string) => void }): JSX.Element {
  const { t } = useI18n();
  const [value, setValue] = useState(props.initial);

  return (
    <label className="field">
      <span className="field-label">{t('settings.ollama')}</span>
      <input
        className="input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => value !== props.initial && props.onSave(value)}
      />
    </label>
  );
}

function SettingControl(props: {
  readonly entry: SettingEntry;
  readonly label: string;
  readonly description: string;
  readonly onChange: (value: boolean | number | string) => void;
}): JSX.Element {
  const { entry } = props;
  const [draft, setDraft] = useState(String(entry.value));

  if (entry.kind === 'boolean') {
    return (
      <label className="choice">
        <input type="checkbox" checked={entry.value === true} onChange={(event) => props.onChange(event.target.checked)} />
        <span>
          {props.label}
          <span className="field-hint" style={{ display: 'block' }}>
            {props.description}
          </span>
        </span>
      </label>
    );
  }

  const commit = (): void => {
    const value = entry.kind === 'integer' ? Math.floor(Number(draft)) : draft;
    if (String(value) !== String(entry.value) && (entry.kind !== 'integer' || Number.isFinite(value))) {
      props.onChange(value);
    }
  };

  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input
        className="input"
        type={entry.kind === 'integer' ? 'number' : 'text'}
        min={entry.minimum}
        max={entry.maximum}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
      <span className="field-hint">{props.description}</span>
    </label>
  );
}
