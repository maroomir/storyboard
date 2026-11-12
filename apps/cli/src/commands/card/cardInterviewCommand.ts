import type { ChoiceOption, IPrompter } from '@/adapters/prompter';
import { flagBoolean, flagString } from '@/cliArguments';
import { invalidLimitMessage, parsePositiveInteger } from '@/commands/card/interviewFlags';
import {
  formatConfirmTitle,
  formatKeepLabel,
  formatQuestionTitle,
  listOtherValues,
  newValueNamePrompt,
  writtenAnswerPrompt,
} from '@/commands/card/interviewQuestionLabels';
import { InterviewStepRunner } from '@/commands/card/interviewStepRunner';
import type { CommandSpec } from '@/commands/catalog';
import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type {
  InterviewConfirmation,
  InterviewOpening,
  InterviewSessionRequest,
  InterviewStartResult,
} from '@storyboard/story-engine';
import { createCustomValueId } from '@storyboard/story-model';
import type {
  InterviewAnswerInput,
  InterviewAnswerOutcome,
  InterviewClassification,
  InterviewQuestion,
  InterviewSessionSummary,
  SceneListItem,
} from '@storyboard/story-model';

type InterviewChoice = InterviewAnswerInput | { readonly kind: 'stop' };

type ConfirmChoice =
  | { readonly kind: 'keep' }
  | { readonly kind: 'rename' }
  | { readonly kind: 'value'; readonly valueId: string };

interface InterviewSessionHandle {
  readonly container: CliContainer;
  readonly prompter: IPrompter;
  readonly cardId: string;
  readonly sessionId: string;
  readonly sceneStems: readonly string[] | undefined;
  readonly limit: number | undefined;
}

function sessionRequest(handle: InterviewSessionHandle): InterviewSessionRequest {
  return {
    workspaceRoot: handle.container.workspaceRoot,
    cardId: handle.cardId,
    sessionId: handle.sessionId,
    ...(handle.sceneStems === undefined ? {} : { sceneStems: handle.sceneStems }),
  };
}

const sceneOrderRangePattern: RegExp = /^(\d+)\.\.(\d+)$/;

function describeOpening(opening: InterviewOpening): string[] {
  const openAxisLabels: string[] = opening.coverage.openAxes.map((axis) => axis.axisLabel);

  return [
    `┌  ${opening.name} 인터뷰`,
    `│  다가올 씬: ${opening.coverage.upcomingSceneStems.join(', ') || '(없음)'}`,
    `│  열린 축: ${openAxisLabels.join(' · ') || '(없음 — 모두 정해졌습니다)'}`,
    ...(opening.isContractStale
      ? ['│  작품 계약이 바뀌었습니다. 축을 다시 뽑으려면 --reset-axes 를 주세요.']
      : []),
  ];
}

function describeSummary(summary: InterviewSessionSummary): string[] {
  return [
    `└  답 ${summary.answered} · 건너뜀 ${summary.skipped} · 카드 후보 ${summary.candidateCount}건`,
    ...(summary.undecidedAxisLabels.length > 0
      ? [`   아직 정해지지 않은 축: ${summary.undecidedAxisLabels.join(' · ')}`]
      : []),
    ...(summary.candidateCount > 0 ? ['   storyboard card promote 로 반영할 수 있습니다'] : []),
  ];
}

export class CardInterviewCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'card interview',
    group: '카드와 정전',
    usage: 'card interview <id> [--step --json [--answer <n> | --write <text> | --skip | --confirm <n> | --rename <name> | --finish | --abandon]]',
    summary:
      '다가올 씬의 상황을 하나씩 내고 그 인물(또는 장소)이 어떻게 하는지 고르게 해, 선택의 패턴을 카드 후보로 증류합니다 (대화형 화면, 또는 --step --json 으로 한 단계씩)',
    flags: ['scenes', 'limit', 'reset-axes', 'step', 'session', 'answer', 'write', 'skip', 'confirm', 'rename', 'finish', 'abandon'],
    examples: [
      'storyboard card interview hana',
      'storyboard card interview tavern --scenes 3..5',
      'storyboard card interview hana --step --json',
      'storyboard card interview hana --step --json --answer 2',
    ],
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const cardId: string | undefined = args.positionals[0];
    if (cardId === undefined) {
      return failure('카드 id 를 지정해 주세요: storyboard card interview <id>');
    }

    if (flagBoolean(args.flags, 'step')) {
      return this.runStep(container, cardId, args.flags);
    }

    const prompter: IPrompter | undefined = container.prompter;
    if (prompter === undefined) {
      return failure(
        '인터뷰는 대화형 화면에서 하거나, 에이전트라면 --step --json 으로 한 단계씩 돌려 질문을 작가에게 전하세요.',
      );
    }

    const limitText: string | undefined = flagString(args.flags, 'limit');
    const limit: number | undefined = parsePositiveInteger(limitText);
    if (limitText !== undefined && limit === undefined) {
      return failure(invalidLimitMessage);
    }

    const sceneStems: readonly string[] | undefined = await this.resolveSceneStems(
      container,
      flagString(args.flags, 'scenes'),
    );
    const started: InterviewStartResult = await container.interviews.start({
      workspaceRoot: container.workspaceRoot,
      cardId,
      ...(sceneStems === undefined ? {} : { sceneStems }),
      ...(flagBoolean(args.flags, 'reset-axes') ? { shouldResetAxes: true } : {}),
    });
    if (!started.ok) {
      return failure(started.message);
    }

    for (const line of describeOpening(started.opening)) {
      prompter.announce(line);
    }

    const handle: InterviewSessionHandle = {
      container,
      prompter,
      cardId,
      sessionId: started.opening.sessionId,
      sceneStems,
      limit,
    };
    const answered: number = await this.askUntilDone(handle);
    const summary: InterviewSessionSummary = await container.interviews.finish(sessionRequest(handle));

    for (const line of describeSummary(summary)) {
      prompter.announce(line);
    }

    return success(
      `${started.opening.name} 인터뷰를 마쳤습니다 (답 ${answered}, 카드 후보 ${summary.candidateCount}건).`,
      summary,
    );
  }

  private async runStep(
    container: CliContainer,
    cardId: string,
    flags: Readonly<Record<string, string | boolean>>,
  ): Promise<CommandOutcome> {
    if (!flagBoolean(flags, 'json')) {
      return failure('--step 은 --json 과 함께 씁니다: storyboard card interview <id> --step --json');
    }

    return new InterviewStepRunner(container).run({
      cardId,
      sceneStems: await this.resolveSceneStems(container, flagString(flags, 'scenes')),
      flags,
    });
  }

  private async askUntilDone(handle: InterviewSessionHandle): Promise<number> {
    let answered: number = 0;

    while (handle.limit === undefined || answered < handle.limit) {
      const question: InterviewQuestion | undefined = await handle.container.interviews.next(
        sessionRequest(handle),
      );
      if (question === undefined) {
        break;
      }

      const choice: InterviewChoice | undefined = await this.ask(handle, question, answered + 1);
      if (choice === undefined || choice.kind === 'stop') {
        break;
      }

      const answer: InterviewAnswerInput | undefined =
        choice.kind === 'written' ? await this.askWrittenAnswer(handle.prompter) : choice;
      if (answer === undefined) {
        break;
      }

      await this.submitAnswer(handle, question, answer);
      answered += answer.kind === 'skipped' ? 0 : 1;
    }

    return answered;
  }

  private ask(
    handle: InterviewSessionHandle,
    question: InterviewQuestion,
    ordinal: number,
  ): Promise<InterviewChoice | undefined> {
    const options: ChoiceOption<InterviewChoice>[] = [
      ...question.options.map(
        (option, index): ChoiceOption<InterviewChoice> => ({
          label: option.text,
          value: { kind: 'chosen', index },
        }),
      ),
      { label: '직접 쓰기', value: { kind: 'written', text: '' } },
      { label: '건너뛰기', value: { kind: 'skipped' } },
      { label: '여기까지', value: { kind: 'stop' } },
    ];
    return handle.prompter.choose({
      title: formatQuestionTitle(question, ordinal),
      details: [question.situation, '', question.question],
      options,
    });
  }

  private async askWrittenAnswer(prompter: IPrompter): Promise<InterviewAnswerInput | undefined> {
    const text: string | undefined = await prompter.askText({
      title: writtenAnswerPrompt,
    });

    return text === undefined ? undefined : text.trim().length === 0 ? { kind: 'skipped' } : { kind: 'written', text: text.trim() };
  }

  private async submitAnswer(
    handle: InterviewSessionHandle,
    question: InterviewQuestion,
    answer: InterviewAnswerInput,
  ): Promise<void> {
    const outcome: InterviewAnswerOutcome = await handle.container.interviews.answer({
      ...sessionRequest(handle),
      questionId: question.id,
      answer,
    });

    if (outcome.isRebuilt) {
      handle.prompter.announce('◇  직접 쓴 답이 이어져 지금까지의 이해를 처음부터 다시 썼습니다.');
    }
    if (outcome.classification !== undefined) {
      await this.confirmClassification(handle, question, outcome.classification);
    }
  }

  private async confirmClassification(
    handle: InterviewSessionHandle,
    question: InterviewQuestion,
    { valueId, valueLabel }: InterviewClassification,
  ): Promise<void> {
    const options: ChoiceOption<ConfirmChoice>[] = [
      { label: formatKeepLabel(valueLabel), value: { kind: 'keep' } },
      ...listOtherValues(question, valueId)
        .map((value): ChoiceOption<ConfirmChoice> => ({
          label: value.label,
          value: { kind: 'value', valueId: value.id },
        })),
      { label: '새 값으로 이름 붙이기', value: { kind: 'rename' } },
    ];
    const choice: ConfirmChoice | undefined = await handle.prompter.choose({
      title: formatConfirmTitle(valueLabel),
      details: [],
      options,
    });
    const confirmation: InterviewConfirmation | undefined = await this.toConfirmation(
      handle.prompter,
      question,
      valueId,
      choice,
    );
    if (confirmation === undefined) {
      return;
    }

    await handle.container.interviews.confirm({
      ...sessionRequest(handle),
      questionId: question.id,
      confirmation,
    });
  }

  private async toConfirmation(
    prompter: IPrompter,
    question: InterviewQuestion,
    readValueId: string,
    choice: ConfirmChoice | undefined,
  ): Promise<InterviewConfirmation | undefined> {
    if (choice === undefined) {
      return undefined;
    }
    if (choice.kind !== 'rename') {
      return { kind: 'value', valueId: choice.kind === 'keep' ? readValueId : choice.valueId };
    }

    const label: string | undefined = await prompter.askText({
      title: newValueNamePrompt,
    });
    const trimmed: string = label?.trim() ?? '';

    return trimmed.length === 0
      ? undefined
      : { kind: 'newValue', id: createCustomValueId(question.values), label: trimmed };
  }

  private async resolveSceneStems(
    container: CliContainer,
    spec: string | undefined,
  ): Promise<readonly string[] | undefined> {
    if (spec === undefined || spec.trim().length === 0) {
      return undefined;
    }

    const scenes: SceneListItem[] = await container.drafts.listScenes(container.workspaceRoot);
    const stemsByOrder: Map<number, string> = new Map(scenes.map((scene) => [scene.order, scene.stem]));

    return spec.split(',').flatMap((token): string[] => {
      const trimmed: string = token.trim();
      const range: RegExpExecArray | null = sceneOrderRangePattern.exec(trimmed);
      if (range !== null) {
        const from: number = Number.parseInt(range[1] ?? '0', 10);
        const to: number = Number.parseInt(range[2] ?? '0', 10);
        return scenes
          .filter((scene) => scene.order >= from && scene.order <= to)
          .map((scene) => scene.stem);
      }

      const order: number = Number.parseInt(trimmed, 10);
      const byOrder: string | undefined = /^\d+$/.test(trimmed) ? stemsByOrder.get(order) : undefined;

      return byOrder === undefined ? [trimmed] : [byOrder];
    });
  }
}
