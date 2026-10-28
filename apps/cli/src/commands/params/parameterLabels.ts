import type { ParameterEntry, ParameterOrigin } from '@storyboard/story-app';

export const parameterKindLabels: Record<ParameterEntry['kind'], string> = {
  setting: '설정 (config.json)',
  generation: '생성 손잡이 (모델 실측 → 파이프라인 기본값)',
  prompt: '프롬프트 온도·출력 상한 (프롬프트 파일 머리말)',
};

export const parameterOriginLabels: Record<ParameterEntry['origin'], string> = {
  workspace: '이 작품',
  user: '공통',
  model: '모델 실측',
  default: '기본값',
  'provider-unsupported': '프로바이더 미지원',
};

export const originsWithoutDefaultNote: Set<ParameterOrigin> = new Set<ParameterEntry['origin']>([
  'default',
  'provider-unsupported',
]);
