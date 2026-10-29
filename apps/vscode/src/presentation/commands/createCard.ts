import { cardIdPattern } from '@storyboard/story-model';

export function needsCardIdPrompt(name: string): boolean {
  return suggestCardId(name) === fallbackCardId;
}

export function validateCardId(value: string): string | undefined {
  const id: string = value.trim();

  if (id.length === 0) {
    return 'ID를 입력해 주세요.';
  }

  if (!cardIdPattern.test(id)) {
    return 'ID는 영문 소문자, 숫자, 하이픈만 사용할 수 있고 숫자/문자로 시작해야 합니다.';
  }

  return undefined;
}

const fallbackCardId: string = 'new-card';

export function suggestCardId(name: string): string {
  const normalizedName: string = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalizedName.length > 0 ? normalizedName : fallbackCardId;
}
