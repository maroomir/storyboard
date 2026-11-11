export const elementIdPattern: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const elementSlugPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export function isElementId(value: string): boolean {
  return elementIdPattern.test(value);
}

export function isElementSlug(value: string): boolean {
  return elementSlugPattern.test(value);
}
