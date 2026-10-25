import { useEffect, useState } from 'react';

import { decimalSettingStep, extractErrorMessage, parseSettingNumberInput, type AiProviderId } from '@storyboard/story-model/contracts';

import type { DesktopSettings, ProviderOption, SettingEntry, UiLanguage } from '@/shared/dto';

import { call } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';

const englishBasicSettings: Readonly<Record<string, { readonly label: string; readonly description: string }>> = {
  'budget.run.limitUsd': {
    label: 'Budget per novel run (USD)',
    description: 'The most one novel run may spend on AI. Past it, the run finishes the scene in progress and pauses. 0 means no limit.',
  },
  'revise.loop.afterGenerate': {
    label: 'Review and revise right after drafting',
    description: 'Runs the review-and-revise loop on every new draft.',
  },
  'editor.draft.keepHistory': {
    label: 'Keep earlier drafts',
    description: 'Keeps the previous draft in .draft/ whenever a draft is replaced.',
  },
};

interface SettingsProps {
  readonly onError: (message: string) => void;
  readonly onLanguageChange: (language: UiLanguage) => void;
}

export function Settings(props: SettingsProps): JSX.Element {
  const { translate, language } = useI18n();
  const [settings, setSettings] = useState<DesktopSettings>();
  const [showAdvancedProviders, setShowAdvancedProviders] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [keyMessage, setKeyMessage] = useState<string>();
  const [notionToken, setNotionToken] = useState('');

  useEffect(() => {
    void call('settings.read', {}).then(setSettings);
  }, []);

  const update = async (action: () => Promise<DesktopSettings>): Promise<void> => {
    try {
      setSettings(await action());
    } catch (failure) {
      props.onError(extractErrorMessage(failure));
    }
  };

  if (settings === undefined) {
    return <main className="workspace-page" aria-busy="true" />;
  }

  const providers: ProviderOption[] = settings.providers.filter((provider) => showAdvancedProviders || !provider.isAdvanced || provider.id === settings.defaultProvider);
  const selected: ProviderOption | undefined = settings.providers.find((provider) => provider.id === settings.defaultProvider);

  const saveKey = async (): Promise<void> => {
    if (selected === undefined || apiKey.trim().length === 0) {
      return;
    }
    setKeyMessage(undefined);
    try {
      setSettings(await call('settings.setApiKey', { providerId: selected.id, apiKey: apiKey.trim() }));
      setApiKey('');
      setKeyMessage(translate('provider.connected'));
    } catch (failure) {
      setKeyMessage(extractErrorMessage(failure));
      setSettings(await call('settings.read', {}));
    }
  };

  const labelOf = (entry: SettingEntry): { readonly label: string; readonly description: string } =>
    (language === 'en' ? englishBasicSettings[entry.key] : undefined) ?? entry;

  return (
    <main className="workspace-page">
      <div className="workspace-page-inner">
        <h1 className="page-title">{translate('settings.title')}</h1>

        <section className="section stack">
          <h2>{translate('settings.ai')}</h2>
          <label className="field">
            <span className="field-label">{translate('settings.defaultProvider')}</span>
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
            {translate('settings.showAdvancedProviders')}
          </label>
          {selected === undefined ? null : (
            <>
              <label className="field">
                <span className="field-label">{translate('settings.model')}</span>
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
                    {translate('settings.apiKey')} — {selected.hasApiKey ? translate('settings.keyStored') : translate('settings.keyMissing')}
                  </span>
                  <div className="row">
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      aria-label={translate('settings.apiKey')}
                      value={apiKey}
                      placeholder={translate('provider.keyPlaceholder')}
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                    <button type="button" className="button" disabled={apiKey.trim().length === 0} onClick={() => void saveKey()}>
                      {translate('settings.replaceKey')}
                    </button>
                  </div>
                  <span className="field-hint">{translate('provider.keyHint')}</span>
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
          <h2>{translate('settings.notion')}</h2>
          <div className="field">
            <span className="field-label">
              {translate('settings.notion')} — {settings.hasNotionToken ? translate('settings.keyStored') : translate('settings.keyMissing')}
            </span>
            <div className="row">
              <input
                className="input"
                type="password"
                autoComplete="off"
                aria-label={translate('settings.notion')}
                value={notionToken}
                placeholder={translate('settings.notionPlaceholder')}
                onChange={(event) => setNotionToken(event.target.value)}
              />
              <button
                type="button"
                className="button"
                disabled={notionToken.trim().length === 0}
                onClick={() =>
                  void update(async () => {
                    const next: DesktopSettings = await call('notes.connectNotion', { token: notionToken.trim() });
                    setNotionToken('');
                    return next;
                  })
                }
              >
                {translate('settings.saveToken')}
              </button>
            </div>
            <span className="field-hint">{translate('settings.notionHint')}</span>
          </div>
        </section>

        <section className="section">
          <h2>{translate('settings.language')}</h2>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={settings.language}
            aria-label={translate('settings.language')}
            onChange={(event) => {
              const next: UiLanguage = event.target.value as UiLanguage;
              setSettings({ ...settings, language: next });
              props.onLanguageChange(next);
            }}
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </section>

        <section className="section stack">
          <h2>{translate('settings.basic')}</h2>
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
          <summary>{translate('settings.advanced')}</summary>
          <p className="muted small">{translate('settings.advancedHint')}</p>
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
  const { translate } = useI18n();
  const [value, setValue] = useState(props.initial);

  return (
    <label className="field">
      <span className="field-label">{translate('settings.ollama')}</span>
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
    const typed: string | number | undefined = entry.kind === 'string' ? draft : parseSettingNumberInput(draft);
    if (typed === undefined) {
      setDraft(String(entry.value));
      return;
    }
    const value: string | number = entry.kind === 'integer' && typeof typed === 'number' ? Math.floor(typed) : typed;
    if (String(value) !== String(entry.value)) {
      props.onChange(value);
    }
  };

  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input
        className="input"
        type={entry.kind === 'integer' || entry.kind === 'decimal' ? 'number' : 'text'}
        step={entry.kind === 'decimal' ? decimalSettingStep : undefined}
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
