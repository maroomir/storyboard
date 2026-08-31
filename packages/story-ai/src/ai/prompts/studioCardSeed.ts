import type { PromptArtifact } from './types';

export const StudioCardSeedPrompt = {
  config: {
    temperature: 0.1,
    maxTokens: 300,
  },
  build(description: string): PromptArtifact {
    return {
      system: [
        '너는 소설 워크스페이스의 카드 생성 도우미다. 작가의 설명문에서 새 카드의 기본 정보만 뽑는다.',
        '설명 없이 JSON 객체 하나만 출력하라.',
        '{"kind":"character|background","name":"카드 이름","id":"roman-kebab-id"}',
        '',
        '[규칙]',
        '- 인물이면 character, 장소·조직·시대·사회 배경이면 background다.',
        '- name은 설명문이 부르는 그대로의 이름이다. 설명문 첫머리의 고유명사가 보통 이름이다.',
        '- id는 이름의 로마자 표기를 소문자와 하이픈만으로 적는다. 예: 정난정 → jeong-nan-jeong.',
        '- 판단이 안 서면 kind는 character로 하라.',
      ].join('\n'),
      user: ['[설명문]', description].join('\n'),
    };
  },
} as const;
