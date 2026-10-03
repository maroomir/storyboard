import { useState } from 'react';

import { compositionKinds, pointOfViews } from '@storyboard/story-model/contracts';

import type { WorkspaceOverview } from '@/shared/dto';
import type { WorkspaceCreateRequest } from '@/shared/ipcContract';

import { call, messageOf } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';
import { compositionLabel, pointOfViewLabel } from '@/renderer/lib/narrativeLabels';
import { initialWizardForm, isStepComplete, lengthHint, wizardSteps, type WizardStep } from '@/renderer/lib/wizardForm';

interface WizardProps {
  readonly defaultParentDirectory: string;
  readonly onCancel: () => void;
  readonly onCreated: (overview: WorkspaceOverview) => void;
}

export function Wizard(props: WizardProps): JSX.Element {
  const { t, language } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<WorkspaceCreateRequest>(initialWizardForm);
  const [parentDirectory, setParentDirectory] = useState(props.defaultParentDirectory);
  const [isCreating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const step: WizardStep = wizardSteps[stepIndex] ?? 'story';
  const isLastStep = stepIndex === wizardSteps.length - 1;
  const update = <K extends keyof WorkspaceCreateRequest>(key: K, value: WorkspaceCreateRequest[K]): void =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const hint = lengthHint(form);

  const chooseLocation = async (): Promise<void> => {
    const { directory } = await call('workspace.chooseParentDirectory', {});
    if (directory !== undefined) {
      setParentDirectory(directory);
    }
  };

  const advance = async (): Promise<void> => {
    if (!isStepComplete(step, form)) {
      setError(t('wizard.fillAll'));
      return;
    }

    setError(undefined);

    if (!isLastStep) {
      setStepIndex(stepIndex + 1);
      return;
    }

    setCreating(true);
    try {
      props.onCreated(await call('workspace.create', { parentDirectory, request: form }));
    } catch (failure) {
      setError(messageOf(failure));
      setCreating(false);
    }
  };

  return (
    <main className="centered">
      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault();
          void advance();
        }}
      >
        <div className="spread">
          <span className="field-label">{t('wizard.title')}</span>
          <span className="muted small">{t('wizard.step', { current: stepIndex + 1, total: wizardSteps.length })}</span>
        </div>

        {step === 'story' ? (
          <>
            <h2>{t('wizard.story.heading')}</h2>
            <TextField label={t('wizard.titleLabel')} value={form.title} onChange={(value) => update('title', value)} autoFocus />
            <TextField
              label={t('wizard.genreLabel')}
              value={form.genre}
              placeholder={t('wizard.genrePlaceholder')}
              onChange={(value) => update('genre', value)}
            />
            <TextField
              label={t('wizard.audienceLabel')}
              value={form.audience}
              placeholder={t('wizard.audiencePlaceholder')}
              onChange={(value) => update('audience', value)}
            />
          </>
        ) : null}

        {step === 'telling' ? (
          <>
            <h2>{t('wizard.telling.heading')}</h2>
            <label className="field">
              <span className="field-label">{t('wizard.povLabel')}</span>
              <select className="select" value={form.pov} onChange={(event) => update('pov', event.target.value as WorkspaceCreateRequest['pov'])}>
                {pointOfViews.map((pov) => (
                  <option key={pov} value={pov}>
                    {pointOfViewLabel(language, pov)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="field-label">{t('wizard.compositionLabel')}</legend>
              <div className="choice-list">
                {compositionKinds.map((composition) => (
                  <label key={composition} className="choice">
                    <input
                      type="radio"
                      name="composition"
                      value={composition}
                      checked={form.composition === composition}
                      onChange={() => update('composition', composition)}
                    />
                    <span>{compositionLabel(language, composition)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-row">
              <NumberField label={t('wizard.chapterCount')} value={form.chapterCount} min={1} max={200} onChange={(value) => update('chapterCount', value)} />
              <NumberField label={t('wizard.scenesPerChapter')} value={form.scenesPerChapter} min={1} max={20} onChange={(value) => update('scenesPerChapter', value)} />
              <NumberField
                label={t('wizard.targetWordCount')}
                value={form.targetWordCount}
                min={1_000}
                max={2_000_000}
                step={1_000}
                onChange={(value) => update('targetWordCount', value)}
              />
            </div>
            <p className="field-hint">{t('wizard.lengthHint', { scenes: hint.scenes, perScene: hint.perScene.toLocaleString(language) })}</p>
          </>
        ) : null}

        {step === 'concept' ? (
          <>
            <h2>{t('wizard.concept.heading')}</h2>
            <label className="field">
              <span className="field-label">{t('wizard.conceptLabel')}</span>
              <textarea
                className="textarea"
                rows={6}
                value={form.concept}
                placeholder={t('wizard.conceptPlaceholder')}
                onChange={(event) => update('concept', event.target.value)}
                autoFocus
              />
            </label>
            <div className="field">
              <span className="field-label">{t('wizard.locationLabel')}</span>
              <div className="spread">
                <span className="muted small">{parentDirectory}</span>
                <button type="button" className="button" onClick={() => void chooseLocation()}>
                  {t('wizard.changeLocation')}
                </button>
              </div>
            </div>
          </>
        ) : null}

        {error === undefined ? null : (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <div className="spread">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => (stepIndex === 0 ? props.onCancel() : setStepIndex(stepIndex - 1))}
            disabled={isCreating}
          >
            {stepIndex === 0 ? t('common.cancel') : t('common.back')}
          </button>
          <button type="submit" className="button button-primary" disabled={isCreating}>
            {isCreating ? t('wizard.creating') : isLastStep ? t('wizard.create') : t('common.next')}
          </button>
        </div>
      </form>
    </main>
  );
}

function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input
        className="input"
        value={props.value}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input
        className="input"
        type="number"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}
