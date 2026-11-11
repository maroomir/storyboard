import * as vscode from 'vscode';

import type { CardManager, CardReading, InterviewManager } from '@storyboard/story-app';
import type { InterviewStartResult } from '@storyboard/story-engine';
import {
  parseCardIdFromPath,
  type InterviewQuestion,
  type StoryboardCard,
  type StoryboardRequestPayload,
  type StoryboardResponsePayload,
} from '@storyboard/story-model';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';

export interface StudioInterviewRpcDependencies {
  readonly interviews: Pick<InterviewManager, 'start' | 'next' | 'answer' | 'confirm' | 'finish'>;
  readonly cards: Pick<CardManager, 'read'>;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
}

interface InterviewedCard {
  readonly workspaceRoot: vscode.Uri;
  readonly cardId: string;
  readonly card: StoryboardCard;
}

const missingCardMessage: string = '인터뷰할 카드를 찾을 수 없습니다.';

function sceneStemsOf(payload: { readonly sceneStems?: readonly string[] }): {
  readonly sceneStems?: readonly string[];
} {
  return payload.sceneStems === undefined ? {} : { sceneStems: payload.sceneStems };
}

export class StudioInterviewRpc {
  public constructor(private readonly deps: StudioInterviewRpcDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'interviews.start': this.start,
      'interviews.next': this.next,
      'interviews.answer': this.answer,
      'interviews.confirm': this.confirm,
      'interviews.finish': this.finish,
    };
  }

  private async loadCard(uri: string): Promise<InterviewedCard> {
    const workspaceRoot: vscode.Uri | undefined = await this.deps.getProjectRoot();
    const slug: string | undefined = parseCardIdFromPath(vscode.Uri.parse(uri));
    const reading: CardReading | undefined =
      workspaceRoot === undefined || slug === undefined
        ? undefined
        : await this.deps.cards.read(workspaceRoot, slug);

    if (workspaceRoot === undefined || reading === undefined) {
      throw new Error(missingCardMessage);
    }

    return { workspaceRoot, cardId: reading.card.id, card: reading.card };
  }

  private readonly start = async (
    payload: StoryboardRequestPayload<'interviews.start'>,
  ): Promise<StoryboardResponsePayload<'interviews.start'>> => {
    const started: InterviewStartResult = await this.deps.interviews.start({
      ...(await this.loadCard(payload.uri)),
      ...sceneStemsOf(payload),
      ...(payload.shouldResetAxes === true ? { shouldResetAxes: true } : {}),
    });
    if (!started.ok) {
      throw new Error(started.message);
    }

    return { opening: started.opening };
  };

  private readonly next = async (
    payload: StoryboardRequestPayload<'interviews.next'>,
  ): Promise<StoryboardResponsePayload<'interviews.next'>> => {
    const question: InterviewQuestion | undefined = await this.deps.interviews.next({
      ...(await this.loadCard(payload.uri)),
      sessionId: payload.sessionId,
      ...sceneStemsOf(payload),
    });

    return { question: question ?? null };
  };

  private readonly answer = async (
    payload: StoryboardRequestPayload<'interviews.answer'>,
  ): Promise<StoryboardResponsePayload<'interviews.answer'>> => ({
    outcome: await this.deps.interviews.answer({
      ...(await this.loadCard(payload.uri)),
      sessionId: payload.sessionId,
      ...sceneStemsOf(payload),
      questionId: payload.questionId,
      answer: payload.answer,
    }),
  });

  private readonly confirm = async (
    payload: StoryboardRequestPayload<'interviews.confirm'>,
  ): Promise<StoryboardResponsePayload<'interviews.confirm'>> => {
    await this.deps.interviews.confirm({
      ...(await this.loadCard(payload.uri)),
      sessionId: payload.sessionId,
      ...sceneStemsOf(payload),
      questionId: payload.questionId,
      confirmation: payload.confirmation,
    });

    return {};
  };

  private readonly finish = async (
    payload: StoryboardRequestPayload<'interviews.finish'>,
  ): Promise<StoryboardResponsePayload<'interviews.finish'>> => ({
    summary: await this.deps.interviews.finish({
      ...(await this.loadCard(payload.uri)),
      sessionId: payload.sessionId,
      ...sceneStemsOf(payload),
    }),
  });
}
