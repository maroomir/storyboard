import { useState } from 'react';

import type { NotesApplyView, NotesEstimateView, NotesPlanView } from '@/shared/dto';

import { call, messageOf } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';
import { formatUsd } from '@/renderer/lib/runView';

interface NotesAbsorbProps {
  readonly fillContract: boolean;
  readonly hasNotionToken: boolean;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}

type Step =
  | { readonly kind: 'pick' }
  | { readonly kind: 'estimate'; readonly estimate: NotesEstimateView }
  | { readonly kind: 'plan'; readonly plan: NotesPlanView }
  | { readonly kind: 'done'; readonly result: NotesApplyView };

export function NotesAbsorb(props: NotesAbsorbProps): JSX.Element {
  const { translate, language } = useI18n();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [notionUrl, setNotionUrl] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const attempt = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const readLocation = (location: Parameters<typeof call<'notes.collect'>>[1]['location']): Promise<void> =>
    attempt(async () => setStep({ kind: 'estimate', estimate: await call('notes.collect', { location }) }));

  const pickAndRead = (kind: 'folder' | 'zip'): Promise<void> =>
    attempt(async () => {
      const { path } = await call('notes.chooseLocation', { kind });
      if (path !== undefined) {
        setStep({ kind: 'estimate', estimate: await call('notes.collect', { location: { kind: 'path', path } }) });
      }
    });

  const sort = (): Promise<void> => attempt(async () => setStep({ kind: 'plan', plan: await call('notes.plan', {}) }));

  const apply = (): Promise<void> =>
    attempt(async () =>
      setStep({ kind: 'done', result: await call('notes.apply', { fillContract: props.fillContract }) }),
    );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={translate('notes.title')}>
      <div className="card stack" style={{ maxWidth: 560 }}>
        <h2>{translate('notes.title')}</h2>

        {step.kind === 'pick' ? (
          <>
            <p className="muted small">{translate('notes.intro')}</p>
            <div className="row">
              <button type="button" className="button" disabled={isBusy} onClick={() => void pickAndRead('folder')}>
                {translate('notes.pickFolder')}
              </button>
              <button type="button" className="button" disabled={isBusy} onClick={() => void pickAndRead('zip')}>
                {translate('notes.pickZip')}
              </button>
            </div>
            <label className="field">
              <span className="field-label">{translate('notes.notionUrl')}</span>
              <div className="row">
                <input
                  className="input"
                  value={notionUrl}
                  placeholder={translate('notes.notionUrlPlaceholder')}
                  onChange={(event) => setNotionUrl(event.target.value)}
                />
                <button
                  type="button"
                  className="button"
                  disabled={isBusy || notionUrl.trim().length === 0 || !props.hasNotionToken}
                  onClick={() => void readLocation({ kind: 'notion', pageUrl: notionUrl.trim() })}
                >
                  {isBusy ? translate('notes.reading') : translate('notes.read')}
                </button>
              </div>
              {props.hasNotionToken ? null : <span className="field-hint">{translate('notes.notionNeedsToken')}</span>}
            </label>
          </>
        ) : null}

        {step.kind === 'estimate' ? (
          <>
            <h3>{translate('notes.estimateHeading')}</h3>
            <p className="small">{step.estimate.location}</p>
            <p>
              {translate('notes.estimate', {
                notes: step.estimate.noteCount.toLocaleString(language),
                chars: step.estimate.characterCount.toLocaleString(language),
                skipped: step.estimate.skippedCount.toLocaleString(language),
              })}
            </p>
            <p>
              {translate('notes.estimateCost', {
                requests: String(step.estimate.requestCount),
                model: `${step.estimate.providerId} / ${step.estimate.model}`,
                cost: step.estimate.costCeilingUsd === undefined ? translate('notes.costUnknown') : `≤ ${formatUsd(step.estimate.costCeilingUsd)}`,
              })}
            </p>
          </>
        ) : null}

        {step.kind === 'plan' ? (
          <>
            <h3>{translate('notes.planHeading')}</h3>
            <ul className="small">
              <li>{translate('notes.planCards', { count: String(step.plan.newCards.length), names: step.plan.newCards.join(', ') || '—' })}</li>
              <li>
                {translate('notes.planChanged', { count: String(step.plan.changedCards.length), names: step.plan.changedCards.join(', ') || '—' })}
              </li>
              <li>{translate('notes.planScenes', { count: String(step.plan.sceneCount), skipped: String(step.plan.skippedSceneCount) })}</li>
              <li>
                {translate('notes.planSynopsis', {
                  state: step.plan.hasSynopsis ? translate('notes.yes') : translate('notes.no'),
                  canon: String(step.plan.canonCandidateCount),
                })}
              </li>
              {step.plan.unclassifiedNotes.length > 0 ? (
                <li>{translate('notes.planUnclassified', { names: step.plan.unclassifiedNotes.join(', ') })}</li>
              ) : null}
              {step.plan.warnings.map((warning) => (
                <li key={warning} className="muted">
                  {warning}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {step.kind === 'done' ? (
          <ul className="small">
            <li>
              {translate('notes.done', {
                cards: String(step.result.createdCards.length),
                scenes: String(step.result.createdScenes.length),
              })}
            </li>
            {step.result.pendingCandidateCards.length > 0 ? (
              <li>{translate('notes.donePending', { count: String(step.result.pendingCandidateCards.length) })}</li>
            ) : null}
            {step.result.canonCandidateCount > 0 ? <li>{translate('notes.doneCanon', { count: String(step.result.canonCandidateCount) })}</li> : null}
            {step.result.synopsis === 'written' ? <li>{translate('notes.doneSynopsis')}</li> : null}
            {step.result.synopsis === 'candidate' ? <li>{translate('notes.doneSynopsisCandidate')}</li> : null}
            {step.result.filledSettingKeys.length > 0 ? (
              <li>{translate('notes.doneContract', { keys: step.result.filledSettingKeys.join(', ') })}</li>
            ) : null}
          </ul>
        ) : null}

        {error === undefined ? null : (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <div className="spread">
          <button type="button" className="button button-quiet" disabled={isBusy} onClick={step.kind === 'done' ? props.onDone : props.onCancel}>
            {step.kind === 'done' ? translate('common.close') : translate('common.cancel')}
          </button>
          {step.kind === 'estimate' ? (
            <button type="button" className="button button-primary" disabled={isBusy} onClick={() => void sort()}>
              {isBusy ? translate('notes.sorting') : translate('notes.sort')}
            </button>
          ) : null}
          {step.kind === 'plan' ? (
            <button type="button" className="button button-primary" disabled={isBusy} onClick={() => void apply()}>
              {isBusy ? translate('notes.applying') : translate('notes.apply')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
