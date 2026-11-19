import type { InterviewDistillExclusion } from '@storyboard/story-model';

export function describeInterviewExclusion(exclusion: InterviewDistillExclusion): string {
  const reason: string | undefined =
    exclusion.existingLine !== undefined
      ? `카드에 이미 있는 줄과 같은 뜻: «${exclusion.existingLine}»`
      : exclusion.note;

  return reason === undefined ? `제외: ${exclusion.value}` : `제외: ${exclusion.value} (${reason})`;
}
