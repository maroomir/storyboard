import { flagBoolean, flagString } from '@/cliArguments';
import {
  formatConfirmTitle,
  formatKeepLabel,
  formatQuestionTitle,
  listOtherValues,
} from '@/commands/card/interviewQuestionLabels';
import { invalidLimitMessage, parsePositiveInteger } from '@/commands/card/interviewFlags';
import type { CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type {
  InterviewConfirmation,
  InterviewOpening,
  InterviewOpenSession,
  InterviewSessionRequest,
  InterviewStartResult,
} from '@storyboard/story-engine';
import { createCustomValueId } from '@storyboard/story-model';
import type {
  InterviewAnswerInput,
  InterviewAnswerOutcome,
  InterviewAxisValue,
  InterviewClassification,
  InterviewQuestion,
  InterviewSessionSummary,
} from '@storyboard/story-model';

export interface InterviewStepRequest {
  readonly cardId: string;
  readonly sceneStems: readonly string[] | undefined;
  readonly flags: Readonly<Record<string, string | boolean>>;
}

type StepAction =
  | { readonly kind: 'show' }
  | { readonly kind: 'answer'; readonly input: InterviewAnswerInput }
  | { readonly kind: 'confirm'; readonly choice: number }
  | { readonly kind: 'rename'; readonly label: string }
  | { readonly kind: 'finish' }
  | { readonly kind: 'abandon' };

interface StepSession {
  readonly opening: InterviewOpening;
  readonly request: InterviewSessionRequest;
  readonly limit: number | undefined;
}

interface StepOption {
  readonly index: number;
  readonly label: string;
}

const actionFlagNames: readonly string[] = [
  'answer',
  'write',
  'skip',
  'confirm',
  'rename',
  'finish',
  'abandon',
];
const keepChoiceIndex: number = 1;

function parseAction(flags: Readonly<Record<string, string | boolean>>): StepAction | string {
  const given: string[] = actionFlagNames.filter(
    (name) => flags[name] !== undefined && flags[name] !== false,
  );
  const [only] = given;
  if (given.length > 1) {
    return `--${given.join(', --')} 는 함께 쓸 수 없습니다. 한 번에 하나만 주세요.`;
  }

  switch (only) {
    case undefined:
      return { kind: 'show' };
    case 'answer': {
      const index: number | undefined = parsePositiveInteger(flagString(flags, 'answer'));
      return index === undefined
        ? '--answer 에는 선택지 번호(1부터)를 주세요. 직접 쓴 답은 --write "<문장>" 으로 넘깁니다.'
        : { kind: 'answer', input: { kind: 'chosen', index: index - 1 } };
    }
    case 'write': {
      const text: string = flagString(flags, 'write')?.trim() ?? '';
      return text.length === 0
        ? '--write 에 작가가 쓴 답을 주세요.'
        : { kind: 'answer', input: { kind: 'written', text } };
    }
    case 'skip':
      return { kind: 'answer', input: { kind: 'skipped' } };
    case 'confirm': {
      const choice: number | undefined = parsePositiveInteger(flagString(flags, 'confirm'));
      return choice === undefined
        ? '--confirm 에는 확인 선택지 번호(1 = 맞다)를 주세요.'
        : { kind: 'confirm', choice };
    }
    case 'rename': {
      const label: string = flagString(flags, 'rename')?.trim() ?? '';
      return label.length === 0 ? '--rename 에 새 값의 이름을 주세요.' : { kind: 'rename', label };
    }
    default:
      return only === 'finish' ? { kind: 'finish' } : { kind: 'abandon' };
  }
}

function questionOptions(question: InterviewQuestion): StepOption[] {
  return question.options.map(
    (option, index): StepOption => ({ index: index + 1, label: option.text }),
  );
}

function confirmOptions(
  question: InterviewQuestion,
  classification: InterviewClassification,
): StepOption[] {
  return [
    { index: keepChoiceIndex, label: formatKeepLabel(classification.valueLabel) },
    ...listOtherValues(question, classification.valueId).map(
      (value, position): StepOption => ({
        index: position + keepChoiceIndex + 1,
        label: value.label,
      }),
    ),
  ];
}

function describeFinished(summary: InterviewSessionSummary): string {
  return summary.candidateCount > 0
    ? `인터뷰를 마쳤습니다 (답 ${summary.answered}, 카드 제안 ${summary.candidateCount}건). storyboard card apply ${summary.cardId} 로 반영할 수 있습니다.`
    : `인터뷰를 마쳤습니다 (답 ${summary.answered}, 카드 후보 없음).`;
}

export class InterviewStepRunner {
  public constructor(private readonly container: CliContainer) {}

  public async run(request: InterviewStepRequest): Promise<CommandOutcome> {
    const action: StepAction | string = parseAction(request.flags);
    const limitText: string | undefined = flagString(request.flags, 'limit');
    const limit: number | undefined = parsePositiveInteger(limitText);
    if (typeof action === 'string') {
      return failure(action);
    }
    if (limitText !== undefined && limit === undefined) {
      return failure(invalidLimitMessage);
    }

    const open: InterviewOpenSession | undefined = await this.container.interviews.findOpenSession({
      workspaceRoot: this.container.workspaceRoot,
      cardId: request.cardId,
      ...(request.sceneStems === undefined ? {} : { sceneStems: request.sceneStems }),
    });
    const sessionMismatch: string | undefined = this.checkRequestedSession(request.flags, open);
    if (sessionMismatch !== undefined) {
      return failure(sessionMismatch);
    }

    return open === undefined
      ? this.startSession(request, action, limit)
      : this.continueSession(request, open, action, limit);
  }

  private checkRequestedSession(
    flags: Readonly<Record<string, string | boolean>>,
    open: InterviewOpenSession | undefined,
  ): string | undefined {
    const requested: string | undefined = flagString(flags, 'session');
    if (requested === undefined || requested === open?.opening.sessionId) {
      return undefined;
    }

    return open === undefined
      ? `세션 ${requested} 은(는) 열려 있지 않습니다. --session 없이 --step 으로 새 세션을 여세요.`
      : `세션 ${requested} 은(는) 열려 있지 않습니다. 이 카드의 열린 세션은 ${open.opening.sessionId} 입니다.`;
  }

  private async startSession(
    request: InterviewStepRequest,
    action: StepAction,
    limit: number | undefined,
  ): Promise<CommandOutcome> {
    if (action.kind !== 'show') {
      return failure('열린 인터뷰 세션이 없습니다. 답 없이 --step 만 주어 새 세션을 여세요.');
    }

    const started: InterviewStartResult = await this.container.interviews.start({
      workspaceRoot: this.container.workspaceRoot,
      cardId: request.cardId,
      ...(request.sceneStems === undefined ? {} : { sceneStems: request.sceneStems }),
      ...(flagBoolean(request.flags, 'reset-axes') ? { shouldResetAxes: true } : {}),
    });
    if (!started.ok) {
      return failure(started.message);
    }

    return this.askNextOrFinish(this.toSession(request, started.opening, limit), 0);
  }

  private async continueSession(
    request: InterviewStepRequest,
    open: InterviewOpenSession,
    action: StepAction,
    limit: number | undefined,
  ): Promise<CommandOutcome> {
    if (flagBoolean(request.flags, 'reset-axes')) {
      return failure(
        `열린 세션 ${open.opening.sessionId} 이 있어 축을 다시 뽑을 수 없습니다. --abandon 으로 닫은 뒤 다시 하세요.`,
      );
    }

    const session: StepSession = this.toSession(request, open.opening, limit);
    switch (action.kind) {
      case 'show':
        return open.step.kind === 'confirm'
          ? this.reportConfirm(session, open.question, open.step.classification)
          : this.reportQuestion(session, open.question, open.answeredCount);
      case 'answer':
        return this.submitAnswer(session, open, action.input);
      case 'confirm':
      case 'rename':
        return this.submitConfirmation(session, open, action);
      case 'finish':
        return this.finish(session);
      case 'abandon':
        await this.container.interviews.abandon(session.request);
        return success(`세션 ${session.opening.sessionId} 을(를) 증류 없이 닫았습니다.`, {
          state: 'abandoned',
          session: session.opening.sessionId,
        });
    }
  }

  private async submitAnswer(
    session: StepSession,
    open: InterviewOpenSession,
    input: InterviewAnswerInput,
  ): Promise<CommandOutcome> {
    if (open.step.kind === 'confirm') {
      return failure(
        '직접 쓴 답을 어떻게 읽었는지 먼저 확인하세요: --confirm <n> 또는 --rename "<이름>".',
      );
    }
    if (input.kind === 'chosen' && open.question.options[input.index] === undefined) {
      return failure(`선택지는 1~${open.question.options.length} 번입니다.`);
    }

    const outcome: InterviewAnswerOutcome = await this.container.interviews.answer({
      ...session.request,
      questionId: open.question.id,
      answer: input,
    });
    if (outcome.classification !== undefined) {
      return this.reportConfirm(session, open.question, outcome.classification);
    }

    return this.askNextOrFinish(session, open.answeredCount + (input.kind === 'skipped' ? 0 : 1));
  }

  private async submitConfirmation(
    session: StepSession,
    open: InterviewOpenSession,
    action: Extract<StepAction, { readonly kind: 'confirm' | 'rename' }>,
  ): Promise<CommandOutcome> {
    if (open.step.kind !== 'confirm') {
      return failure(
        '확인할 답이 없습니다. 지금 질문에는 --answer <n>, --write "<문장>", --skip 으로 답하세요.',
      );
    }

    const confirmation: InterviewConfirmation | undefined = this.toConfirmation(
      open.question,
      open.step.classification,
      action,
    );
    if (confirmation === undefined) {
      return failure(
        `확인 선택지는 1~${confirmOptions(open.question, open.step.classification).length} 번입니다.`,
      );
    }

    await this.container.interviews.confirm({
      ...session.request,
      questionId: open.question.id,
      confirmation,
    });

    return this.askNextOrFinish(session, open.answeredCount);
  }

  private toConfirmation(
    question: InterviewQuestion,
    classification: InterviewClassification,
    action: Extract<StepAction, { readonly kind: 'confirm' | 'rename' }>,
  ): InterviewConfirmation | undefined {
    if (action.kind === 'rename') {
      return { kind: 'newValue', id: createCustomValueId(question.values), label: action.label };
    }
    if (action.choice === keepChoiceIndex) {
      return { kind: 'value', valueId: classification.valueId };
    }

    const chosen: InterviewAxisValue | undefined = listOtherValues(
      question,
      classification.valueId,
    )[action.choice - keepChoiceIndex - 1];

    return chosen === undefined ? undefined : { kind: 'value', valueId: chosen.id };
  }

  private async askNextOrFinish(
    session: StepSession,
    answeredCount: number,
  ): Promise<CommandOutcome> {
    const hasReachedLimit: boolean = session.limit !== undefined && answeredCount >= session.limit;
    if (hasReachedLimit) {
      return this.finish(session);
    }

    const question: InterviewQuestion | undefined = await this.container.interviews.next(
      session.request,
    );

    return question === undefined
      ? this.finish(session)
      : this.reportQuestion(session, question, answeredCount);
  }

  private async finish(session: StepSession): Promise<CommandOutcome> {
    const summary: InterviewSessionSummary = await this.container.interviews.finish(
      session.request,
    );

    return success(describeFinished(summary), {
      state: 'finished',
      session: session.opening.sessionId,
      summary,
    });
  }

  private reportQuestion(
    session: StepSession,
    question: InterviewQuestion,
    answeredCount: number,
  ): CommandOutcome {
    const title: string = formatQuestionTitle(question, answeredCount + 1);

    return success(title, {
      state: 'question',
      session: session.opening.sessionId,
      card: { id: session.opening.cardId, name: session.opening.name },
      isContractStale: session.opening.isContractStale,
      question: {
        id: question.id,
        title,
        axis: question.axisLabel,
        source: question.source,
        situation: question.situation,
        text: question.question,
        options: questionOptions(question),
        allowsText: true,
        canSkip: true,
      },
      answered: answeredCount,
      limit: session.limit ?? session.opening.maxQuestions,
    });
  }

  private reportConfirm(
    session: StepSession,
    question: InterviewQuestion,
    classification: InterviewClassification,
  ): CommandOutcome {
    const title: string = formatConfirmTitle(classification.valueLabel);

    return success(title, {
      state: 'confirm',
      session: session.opening.sessionId,
      questionId: question.id,
      title,
      read: classification,
      options: confirmOptions(question, classification),
      allowsRename: true,
    });
  }

  private toSession(
    request: InterviewStepRequest,
    opening: InterviewOpening,
    limit: number | undefined,
  ): StepSession {
    return {
      opening,
      limit,
      request: {
        workspaceRoot: this.container.workspaceRoot,
        cardId: request.cardId,
        sessionId: opening.sessionId,
        ...(request.sceneStems === undefined ? {} : { sceneStems: request.sceneStems }),
      },
    };
  }
}
