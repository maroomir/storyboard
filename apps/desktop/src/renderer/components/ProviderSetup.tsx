import { useEffect, useState } from 'react';

import { extractErrorMessage, type AiProviderId } from '@storyboard/story-model/contracts';

import type { ProviderOption } from '@/shared/dto';

import { call } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';

export function ProviderSetup(props: { readonly onDone: () => void }): JSX.Element {
  const { translate } = useI18n();
  const [providers, setProviders] = useState<readonly ProviderOption[]>([]);
  const [providerId, setProviderId] = useState<AiProviderId>();
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'connected'>('idle');
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void call('settings.read', {}).then((settings) => {
      const keyed: ProviderOption[] = settings.providers.filter((provider) => !provider.isAdvanced);
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
      setMessage(translate('provider.connected'));
      props.onDone();
    } catch (failure) {
      setStatus('idle');
      setMessage(extractErrorMessage(failure));
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
        <h2 id="provider-heading">{translate('provider.heading')}</h2>
        <p className="muted">{translate('provider.intro')}</p>
        <label className="field">
          <span className="field-label">{translate('provider.service')}</span>
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
          <span className="field-label">{translate('provider.keyLabel')}</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={translate('provider.keyPlaceholder')}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <span className="field-hint">{translate('provider.keyHint')}</span>
        </label>
        {message === undefined ? null : (
          <p className={status === 'connected' ? 'muted' : 'error-text'} role="status">
            {message}
          </p>
        )}
        <div className="spread">
          <button type="button" className="button button-quiet" onClick={props.onDone}>
            {translate('provider.later')}
          </button>
          <button type="submit" className="button button-primary" disabled={status === 'checking' || apiKey.trim().length === 0}>
            {status === 'checking' ? translate('provider.connecting') : translate('provider.connect')}
          </button>
        </div>
      </form>
    </div>
  );
}
