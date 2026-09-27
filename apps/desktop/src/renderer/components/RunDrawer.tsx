import { useEffect, useRef, useState } from 'react';

import { novelRunModes, novelStageNames, type NovelRunMode } from '@storyboard/story-engine/contracts';

import type { RunSnapshot, WorkspaceOverview } from '@/shared/dto';

import { call, messageOf } from '@/renderer/lib/call';
import { useI18n } from '@/renderer/lib/i18n';
import { contractFieldLabel } from '@/renderer/lib/narrativeLabels';
import { budgetProgress, formatUsd, stageRail } from '@/renderer/lib/runView';

interface RunDrawerProps {
  readonly overview: WorkspaceOverview;
  readonly run: RunSnapshot;
  readonly onRunChange: (run: RunSnapshot) => void;
  readonly onClose: () => void;
  readonly onError: (message: string) => void;
  readonly onSceneOpen: (stem: string) => void;
}

export function RunDrawer(props: RunDrawerProps): JSX.Element {
  const { t, language } = useI18n();
  const { run } = props;
  const [mode, setMode] = useState<NovelRunMode>(run.resumable?.mode ?? 'chapter-approval');
  const [budget, setBudget] = useState(String(run.budgetUsd));
  const logEnd = useRef<HTMLLIElement>(null);
  const progress = budgetProgress(run);
  const missing = props.overview.missingContractFields;
  const isIdle = run.status === 'idle';
  const isForeignLocked = props.overview.foreignLock !== undefined;

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [run.log.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  const act = async (action: () => Promise<RunSnapshot>): Promise<void> => {
    try {
      props.onRunChange(await action());
    } catch (failure) {
      props.onError(messageOf(failure));
    }
  };

  const saveBudget = (): void => {
    const value = Math.max(0, Math.floor(Number(budget)));
    if (Number.isFinite(value) && value !== run.budgetUsd) {
      void act(() => call('run.setBudget', { budgetUsd: value }));
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={props.onClose} aria-hidden="true" />
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="run-heading">
        <div className="spread">
          <div className="row">
            <h2 id="run-heading" style={{ margin: 0, fontSize: 16 }}>
              {t('run.title')}
            </h2>
            <span className="pill">{t(`run.status.${run.status}`)}</span>
          </div>
          <button type="button" className="button button-quiet" onClick={props.onClose}>
            {t('common.close')}
          </button>
        </div>

        <ol className="rail" aria-label={t('run.title')}>
          {stageRail(run).map(({ stage, state }) => (
            <li key={stage} className="rail-step" data-state={state}>
              {t(`run.stage.${stage}`)}
            </li>
          ))}
        </ol>

        {run.approval === undefined ? null : (
          <div className="approval" role="alert">
            <span>{run.approval.info}</span>
            <span className="row">
              <button type="button" className="button" onClick={() => void act(() => call('run.answerApproval', { approved: false }))}>
                {t('run.decline')}
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void act(() => call('run.answerApproval', { approved: true }))}
              >
                {t('run.approve')}
              </button>
            </span>
          </div>
        )}

        <div className="row" style={{ flexWrap: 'wrap' }}>
          {isIdle ? (
            <>
              <label className="row">
                <span className="field-label">{t('run.modeLabel')}</span>
                <select className="select" style={{ width: 'auto' }} value={mode} onChange={(event) => setMode(event.target.value as NovelRunMode)}>
                  {novelRunModes.map((option) => (
                    <option key={option} value={option}>
                      {t(`run.mode.${option}`)}
                    </option>
                  ))}
                </select>
              </label>
              {run.resumable === undefined ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={missing.length > 0 || isForeignLocked}
                  onClick={() => void act(() => call('run.startNovel', { mode, resume: false }))}
                >
                  {t('run.start')}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={isForeignLocked}
                    onClick={() => void act(() => call('run.startNovel', { mode, resume: true }))}
                  >
                    {t('run.resume')}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={missing.length > 0 || isForeignLocked}
                    onClick={() => void act(() => call('run.startNovel', { mode, resume: false }))}
                  >
                    {t('run.restart')}
                  </button>
                </>
              )}
            </>
          ) : (
            <button
              type="button"
              className="button"
              disabled={run.status === 'pausing'}
              onClick={() => void act(() => call('run.pause', {}))}
            >
              {t('run.pause')}
            </button>
          )}
          {run.resumable === undefined || !isIdle ? null : (
            <span className="muted small">
              {t('run.resumable', { done: run.resumable.completedStages.length, total: novelStageNames.length })}
            </span>
          )}
          {missing.length === 0 ? null : (
            <span className="error-text small">
              {t('run.contractMissing', { fields: missing.map((key) => contractFieldLabel(language, key)).join(', ') })}
            </span>
          )}
          {props.overview.foreignLock === undefined ? null : (
            <span className="error-text small">{props.overview.foreignLock.message}</span>
          )}
          {run.lastOutcome === undefined || !isIdle ? null : <span className="small">{run.lastOutcome.message}</span>}
        </div>

        <div className="drawer-grid">
          <div className="panel">
            <h3>{t('run.scenes')}</h3>
            <div className="scene-grid">
              {props.overview.chapters.flatMap((chapter) =>
                chapter.scenes.map((scene) => (
                  <button
                    key={scene.stem}
                    type="button"
                    className="scene-cell"
                    data-status={run.sceneStem === scene.stem && !isIdle ? 'generating' : scene.status}
                    title={`${scene.title} · ${t(`status.${scene.status}`)}`}
                    onClick={() => props.onSceneOpen(scene.stem)}
                  >
                    <span>{scene.order}</span>
                    <span className="muted">{scene.length === 0 ? '' : `${(scene.length / 1000).toFixed(1)}k`}</span>
                  </button>
                )),
              )}
            </div>
          </div>
          <div className="panel">
            <h3>{t('run.log')}</h3>
            {run.log.length === 0 ? <p className="muted small">{t('run.logEmpty')}</p> : null}
            <ol className="log" aria-live="polite">
              {run.log.map((line, index) => (
                <li key={`${line.at}-${index}`} data-tone={line.tone} ref={index === run.log.length - 1 ? logEnd : undefined}>
                  {line.message}
                </li>
              ))}
            </ol>
          </div>
          <div className="panel">
            <h3>{t('run.cost')}</h3>
            <div>
              <div className="muted small">{t('run.thisRun')}</div>
              <div className="big-number">{formatUsd(run.spentUsd)}</div>
              <div className="muted small">{t('run.tokens', { count: run.spentTokens.toLocaleString(language) })}</div>
            </div>
            {progress === undefined ? null : (
              <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <span style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            <div className="spread small">
              <span className="muted">{t('run.project')}</span>
              <span>{formatUsd(run.projectSpentUsd)}</span>
            </div>
            <label className="field">
              <span className="field-label">{t('run.budget')}</span>
              <input
                className="input"
                type="number"
                min={0}
                max={10000}
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                onBlur={saveBudget}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    saveBudget();
                  }
                }}
              />
              <span className="field-hint">{t('run.budgetHint')}</span>
            </label>
            {run.hasUnpricedUsage ? <p className="muted small">{t('run.unpriced')}</p> : null}
          </div>
        </div>
      </section>
    </>
  );
}
