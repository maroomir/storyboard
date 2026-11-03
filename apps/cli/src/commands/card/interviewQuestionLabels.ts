import type { InterviewAxisValue, InterviewQuestion } from '@storyboard/story-model';

export function describeQuestionSource(question: InterviewQuestion): string {
  if (question.source.kind === 'beat') {
    return `${question.source.sceneStem} · 사건 ${question.source.beatIndex + 1}`;
  }

  return question.source.kind === 'relation' ? '상대별 말투' : '사건 밖';
}

export function formatQuestionTitle(question: InterviewQuestion, ordinal: number): string {
  return `${ordinal}번째 · ${question.axisLabel} (${describeQuestionSource(question)})`;
}

export function formatConfirmTitle(valueLabel: string): string {
  return `이 답을 「${valueLabel}」로 읽었습니다. 맞나요?`;
}

export function formatKeepLabel(valueLabel: string): string {
  return `맞다 — ${valueLabel}`;
}

export function listOtherValues(
  question: InterviewQuestion,
  readValueId: string,
): InterviewAxisValue[] {
  return question.values.filter((value) => value.id !== readValueId);
}

export const writtenAnswerPrompt: string = '이 인물이라면 어떻게 하나요? 행동이나 말 한두 문장';
export const newValueNamePrompt: string = '새 값의 이름 (두세 낱말)';
