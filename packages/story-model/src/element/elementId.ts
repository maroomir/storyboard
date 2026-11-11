import { z } from 'zod';

export const elementIdPattern: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const elementSlugPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export function isElementId(value: string): boolean {
  return elementIdPattern.test(value);
}

export function isElementSlug(value: string): boolean {
  return elementSlugPattern.test(value);
}

export const elementIdSchema: z.ZodType<string> = z.string().refine(isElementId, {
  message: '요소 id 는 uuid 여야 합니다.',
});

export const elementSlugSchema: z.ZodType<string> = z.string().refine(isElementSlug, {
  message: 'slug 는 영소문자·숫자·하이픈만 쓸 수 있습니다.',
});

export const headerTextSchema: z.ZodType<string> = z.string().trim().min(1);

export const headerTextListSchema: z.ZodType<readonly string[]> = z.array(headerTextSchema).readonly();
