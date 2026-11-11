import React, { useCallback, useEffect, useState } from 'react';

import { Button } from '@webview/components/ui/Button';
import { SectionHeader } from '@webview/components/ui/SectionHeader';
import { sbInputClass } from '@webview/components/ui/formClasses';
import { callRpc } from '@webview/lib/rpcClient';
import { createCustomValueId } from '@storyboard/story-model/contracts';
import type {
  InterviewAnswerInput,
  InterviewAnswerOutcome,
  InterviewClassification,
  InterviewConfirmation,
  InterviewOpening,
  InterviewQuestion,
  InterviewSessionSummary,
} from '@webview/lib/types';
import type { VscodeApi } from '@webview/lib/vscodeApi';

const panelClass: string =
  'flex flex-col gap-4 rounded-xl border border-sb-border bg-sb-bg-sidebar/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]';
const optionClass: string =
  'flex w-full cursor-pointer items-start gap-2 rounded-md border border-sb-border px-3 py-2 text-left text-sm leading-normal hover:bg-sb-bg-list-hover disabled:cursor-default disabled:opacity-60';

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'stale'; readonly opening: InterviewOpening }
  | { readonly kind: 'asking'; readonly opening: InterviewOpening }
  | {
      readonly kind: 'question';
      readonly opening: InterviewOpening;
      readonly question: InterviewQuestion;
    }
  | {
      readonly kind: 'writing';
      readonly opening: InterviewOpening;
      readonly question: InterviewQuestion;
    }
  | {
      readonly kind: 'confirming';
      readonly opening: InterviewOpening;
      readonly question: InterviewQuestion;
      readonly outcome: InterviewAnswerOutcome;
    }
  | { readonly kind: 'finishing'; readonly opening: InterviewOpening }
  | { readonly kind: 'finished'; readonly summary: InterviewSessionSummary };

interface StartOptions {
  readonly shouldResetAxes: boolean;
}

const staleContractNotice: string =
  '축 어휘를 뽑은 뒤 작품 계약(장르·독자층·컨셉)이 바뀌었습니다. 어휘는 그대로 쓰이고 있습니다. 축을 다시 뽑으면 표와 작업 모델도 비워집니다.';

export type InterviewPanelProps = {
  readonly cardKey: string;
  readonly documentUri: string;
  readonly vscodeApi?: VscodeApi;
  readonly onStatusChange?: (status: string) => void;
};

function describeSource(question: InterviewQuestion): string {
  if (question.source.kind === 'beat') {
    return `${question.source.sceneStem} · 사건 ${question.source.beatIndex + 1}`;
  }

  return question.source.kind === 'relation' ? '상대별 말투' : '사건 밖';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function InterviewPanel({
  cardKey,
  documentUri,
  vscodeApi,
  onStatusChange,
}: InterviewPanelProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [answered, setAnswered] = useState<number>(0);
  const [writtenText, setWrittenText] = useState<string>('');
  const [newValueLabel, setNewValueLabel] = useState<string>('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setPhase({ kind: 'idle' });
    setAnswered(0);
    setError(undefined);
  }, [cardKey]);

  const fail: (failure: unknown, fallback: string) => void = useCallback(
    (failure: unknown, fallback: string): void => {
      const message: string = errorMessage(failure, fallback);
      setError(message);
      onStatusChange?.(message);
    },
    [onStatusChange],
  );

  const finish: (opening: InterviewOpening) => void = useCallback(
    (opening: InterviewOpening): void => {
      if (!vscodeApi) {
        return;
      }

      setPhase({ kind: 'finishing', opening });
      void callRpc<{ readonly summary: InterviewSessionSummary }>(vscodeApi, 'interviews.finish', {
        uri: documentUri,
        sessionId: opening.sessionId,
      })
        .then((result) => {
          setError(undefined);
          setPhase({ kind: 'finished', summary: result.summary });
          onStatusChange?.(
            result.summary.candidateCount > 0
              ? `인터뷰를 마쳤습니다. 읽은 줄 ${result.summary.candidateCount}건은 스튜디오의 «적용»으로 카드에 씁니다.`
              : '인터뷰를 마쳤습니다. 아직 특성으로 굳은 축이 없습니다.',
          );
        })
        .catch((finishError: unknown) => {
          fail(finishError, '인터뷰를 마치지 못했습니다.');
          setPhase({ kind: 'idle' });
        });
    },
    [vscodeApi, documentUri, fail, onStatusChange],
  );

  const askNext: (opening: InterviewOpening) => void = useCallback(
    (opening: InterviewOpening): void => {
      if (!vscodeApi) {
        return;
      }

      setPhase({ kind: 'asking', opening });
      void callRpc<{ readonly question: InterviewQuestion | null }>(vscodeApi, 'interviews.next', {
        uri: documentUri,
        sessionId: opening.sessionId,
      })
        .then((result) => {
          setError(undefined);
          if (result.question === null) {
            finish(opening);
            return;
          }
          setWrittenText('');
          setPhase({ kind: 'question', opening, question: result.question });
        })
        .catch((nextError: unknown) => {
          fail(nextError, '다음 질문을 만들지 못했습니다.');
          setPhase({ kind: 'idle' });
        });
    },
    [vscodeApi, documentUri, fail, finish],
  );

  const start: (options?: StartOptions) => void = useCallback(
    (options?: StartOptions): void => {
      if (!vscodeApi) {
        setError('VS Code API를 사용할 수 없습니다.');
        return;
      }

      const shouldResetAxes: boolean = options?.shouldResetAxes === true;
      setError(undefined);
      setAnswered(0);
      setPhase({ kind: 'starting' });
      onStatusChange?.(
        shouldResetAxes ? '축 어휘를 다시 뽑는 중입니다…' : '인터뷰를 준비하는 중입니다…',
      );

      void callRpc<{ readonly opening: InterviewOpening }>(vscodeApi, 'interviews.start', {
        uri: documentUri,
        ...(shouldResetAxes ? { shouldResetAxes: true } : {}),
      })
        .then((result) => {
          if (result.opening.isContractStale && !shouldResetAxes) {
            setPhase({ kind: 'stale', opening: result.opening });
            return;
          }
          askNext(result.opening);
        })
        .catch((startError: unknown) => {
          fail(startError, '인터뷰를 시작하지 못했습니다.');
          setPhase({ kind: 'idle' });
        });
    },
    [vscodeApi, documentUri, onStatusChange, askNext, fail],
  );

  const submit: (
    opening: InterviewOpening,
    question: InterviewQuestion,
    answer: InterviewAnswerInput,
  ) => void = useCallback(
    (
      opening: InterviewOpening,
      question: InterviewQuestion,
      answer: InterviewAnswerInput,
    ): void => {
      if (!vscodeApi) {
        return;
      }

      setPhase({ kind: 'asking', opening });
      void callRpc<{ readonly outcome: InterviewAnswerOutcome }>(vscodeApi, 'interviews.answer', {
        uri: documentUri,
        sessionId: opening.sessionId,
        questionId: question.id,
        answer,
      })
        .then((result) => {
          setError(undefined);
          if (answer.kind !== 'skipped') {
            setAnswered((count) => count + 1);
          }
          if (result.outcome.isRebuilt) {
            onStatusChange?.('직접 쓴 답이 이어져 지금까지의 이해를 처음부터 다시 썼습니다.');
          }
          if (result.outcome.classification !== undefined) {
            setNewValueLabel('');
            setPhase({ kind: 'confirming', opening, question, outcome: result.outcome });
            return;
          }
          askNext(opening);
        })
        .catch((answerError: unknown) => {
          fail(answerError, '답을 기록하지 못했습니다.');
          setPhase({ kind: 'question', opening, question });
        });
    },
    [vscodeApi, documentUri, onStatusChange, askNext, fail],
  );

  const confirm: (
    opening: InterviewOpening,
    question: InterviewQuestion,
    confirmation: InterviewConfirmation | undefined,
  ) => void = useCallback(
    (
      opening: InterviewOpening,
      question: InterviewQuestion,
      confirmation: InterviewConfirmation | undefined,
    ): void => {
      if (!vscodeApi || confirmation === undefined) {
        askNext(opening);
        return;
      }

      setPhase({ kind: 'asking', opening });
      void callRpc<Record<string, never>>(vscodeApi, 'interviews.confirm', {
        uri: documentUri,
        sessionId: opening.sessionId,
        questionId: question.id,
        confirmation,
      })
        .then(() => {
          setError(undefined);
          askNext(opening);
        })
        .catch((confirmError: unknown) => {
          fail(confirmError, '값을 고치지 못했습니다.');
          askNext(opening);
        });
    },
    [vscodeApi, documentUri, askNext, fail],
  );

  const header: React.ReactElement = (
    <SectionHeader
      title="인터뷰"
      eyebrow="Interview"
      description="다가올 씬의 사건을 하나씩 내고 이 인물(또는 장소)이 어떻게 하는지 고릅니다. 고른 대사가 아니라 선택의 패턴이 카드에 쓸 제안이 됩니다."
    />
  );

  if (phase.kind === 'idle' || phase.kind === 'starting') {
    return (
      <div className={panelClass}>
        {header}
        {error ? <p className="m-0 text-sm text-sb-fg-error">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!vscodeApi || phase.kind === 'starting'}
            onClick={() => start()}
          >
            {phase.kind === 'starting' ? '준비 중…' : '인터뷰 시작'}
          </Button>
          <Button
            disabled={!vscodeApi || phase.kind === 'starting'}
            onClick={() => start({ shouldResetAxes: true })}
          >
            축 다시 뽑고 시작
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'finished') {
    return (
      <div className={panelClass}>
        {header}
        <p className="m-0 text-sm">
          답 {phase.summary.answered} · 건너뜀 {phase.summary.skipped} · 읽은 줄{' '}
          {phase.summary.candidateCount}건
        </p>
        {phase.summary.undecidedAxisLabels.length > 0 ? (
          <p className="m-0 text-xs text-sb-fg-muted">
            아직 정해지지 않은 축: {phase.summary.undecidedAxisLabels.join(' · ')}
          </p>
        ) : null}
        {phase.summary.candidateCount > 0 ? (
          <p className="m-0 text-xs text-sb-fg-muted">
            대화로 돌아가 «기다리는 제안»에서 «적용»하거나 «버림»합니다.
          </p>
        ) : null}
        <Button onClick={() => start()}>다시 인터뷰</Button>
      </div>
    );
  }

  const { opening } = phase;
  const progress: string = `${answered}/${opening.maxQuestions} 답 · 열린 축 ${opening.coverage.openAxes.length}`;

  if (phase.kind === 'stale') {
    return (
      <div className={panelClass}>
        {header}
        <p className="m-0 text-sm text-sb-fg-muted">⚠ {staleContractNotice}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => start({ shouldResetAxes: true })}>
            축 다시 뽑기
          </Button>
          <Button onClick={() => askNext(opening)}>그대로 계속</Button>
        </div>
      </div>
    );
  }

  if (phase.kind === 'asking' || phase.kind === 'finishing') {
    return (
      <div className={panelClass}>
        {header}
        <p className="m-0 text-xs text-sb-fg-muted">{progress}</p>
        <p className="m-0 text-sm text-sb-fg-muted">
          {phase.kind === 'finishing'
            ? '답을 카드 제안으로 증류하는 중입니다…'
            : '다음 질문을 만드는 중입니다…'}
        </p>
      </div>
    );
  }

  const { question } = phase;

  if (phase.kind === 'confirming') {
    const classification: InterviewClassification | undefined = phase.outcome.classification;
    return (
      <div className={panelClass}>
        {header}
        <p className="m-0 text-sm">
          이 답을 「{classification?.valueLabel}」로 읽었습니다. 맞나요?
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={optionClass}
            onClick={() =>
              confirm(
                opening,
                question,
                classification === undefined
                  ? undefined
                  : { kind: 'value', valueId: classification.valueId },
              )
            }
          >
            맞다 — {classification?.valueLabel}
          </button>
          {question.values
            .filter((value) => value.id !== classification?.valueId)
            .map((value) => (
              <button
                key={value.id}
                type="button"
                className={optionClass}
                onClick={() => confirm(opening, question, { kind: 'value', valueId: value.id })}
              >
                {value.label}
              </button>
            ))}
          <div className="flex gap-2">
            <input
              className={sbInputClass}
              placeholder="새 값의 이름 (두세 낱말)"
              value={newValueLabel}
              onChange={(event) => setNewValueLabel(event.target.value)}
            />
            <Button
              disabled={newValueLabel.trim().length === 0}
              onClick={() =>
                confirm(opening, question, {
                  kind: 'newValue',
                  id: createCustomValueId(question.values),
                  label: newValueLabel.trim(),
                })
              }
            >
              새 값으로
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={panelClass}>
      {header}
      <p className="m-0 text-xs text-sb-fg-muted">
        {progress} · {question.axisLabel} ({describeSource(question)})
      </p>
      <p className="m-0 whitespace-pre-wrap text-sm text-sb-fg-muted">{question.situation}</p>
      <p className="m-0 text-sm font-medium">{question.question}</p>
      {error ? <p className="m-0 text-sm text-sb-fg-error">{error}</p> : null}
      <div className="flex flex-col gap-2">
        {question.options.map((option, index) => (
          <button
            key={option.valueId}
            type="button"
            className={optionClass}
            onClick={() => submit(opening, question, { kind: 'chosen', index })}
          >
            <span className="text-sb-fg-muted">{index + 1}.</span>
            <span className="flex-1">{option.text}</span>
          </button>
        ))}
      </div>
      {phase.kind === 'writing' ? (
        <div className="flex flex-col gap-2">
          <textarea
            className={`${sbInputClass} min-h-[4rem]`}
            placeholder="이 인물이라면 어떻게 하나요? 행동이나 말 한두 문장"
            value={writtenText}
            onChange={(event) => setWrittenText(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={writtenText.trim().length === 0}
              onClick={() =>
                submit(opening, question, { kind: 'written', text: writtenText.trim() })
              }
            >
              이렇게 한다
            </Button>
            <Button onClick={() => setPhase({ kind: 'question', opening, question })}>취소</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPhase({ kind: 'writing', opening, question })}>
            직접 쓰기
          </Button>
          <Button onClick={() => submit(opening, question, { kind: 'skipped' })}>건너뛰기</Button>
          <Button onClick={() => finish(opening)}>여기까지</Button>
        </div>
      )}
    </div>
  );
}
