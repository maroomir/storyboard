const positiveIntegerPattern: RegExp = /^[1-9]\d*$/;

export const invalidLimitMessage: string = '--limit 에는 1 이상의 정수를 주세요.';

export function parsePositiveInteger(text: string | undefined): number | undefined {
  return text !== undefined && positiveIntegerPattern.test(text.trim())
    ? Number.parseInt(text.trim(), 10)
    : undefined;
}
