import { useEffect, useState } from 'react';

import type { AiProviderId } from '@storyboard/story-model/contracts';

import type { ProviderOption } from '@/shared/dto';

import { call, messageOf } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';

// The first run asks for one key and nothing else. Local models and the rest of the provider
// settings wait in Settings.
export function ProviderSetup(props: { readonly onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const [providers, setProviders] = useState<readonly ProviderOption[]>([]);
  const [providerId, setProviderId] = useState<AiProviderId>();
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'connected'>('idle');
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void call('settings.read', {}).then((settings) => {
      const keyed = settings.providers.filter((provider) => !provider.isAdvanced);
      setProviders(keyed);
      setProviderId(keyed[0]?.id);
    });
  }, []);

  const connect = async (): Promise<void> => {
    if (providerId === undefined || apiKey.trim().length === 0) {
      return;
    }

    setStatus('checking');
    setMessage(undefined);
    try {
      await call('settings.setApiKey', { providerId, apiKey: apiKey.trim() });
      setStatus('connected');
      setMessage(t('provider.connected'));
      props.onDone();
    } catch (failure) {
      setStatus('idle');
      setMessage(messageOf(failure));
    }
  };

  return (
    <div className="modal-backdrop">
      <form
        className="card stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-heading"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <h2 id="provider-heading">{t('provider.heading')}</h2>
        <p className="muted">{t('provider.intro')}</p>
        <label className="field">
          <span className="field-label">{t('provider.service')}</span>
          <select
            className="select"
            value={providerId ?? ''}
            onChange={(event) => setProviderId(event.target.value as AiProviderId)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('provider.keyLabel')}</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={t('provider.keyPlaceholder')}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <span className="field-hint">{t('provider.keyHint')}</span>
        </label>
        {message === undefined ? null : (
          <p className={status === 'connected' ? 'muted' : 'error-text'} role="status">
            {message}
          </p>
        )}
        <div className="spread">
          <button type="button" className="button button-quiet" onClick={props.onDone}>
            {t('provider.later')}
          </button>
          <button type="submit" className="button button-primary" disabled={status === 'checking' || apiKey.trim().length === 0}>
            {status === 'checking' ? t('provider.connecting') : t('provider.connect')}
          </button>
        </div>
      </form>
    </div>
  );
}
