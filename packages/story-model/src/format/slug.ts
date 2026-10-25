export function slugify(value: string): string | undefined {
  const slug: string = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : undefined;
}

export function reserveUniqueSlug(slug: string, usedSlugs: Set<string>): string {
  if (!usedSlugs.has(slug)) {
    usedSlugs.add(slug);
    return slug;
  }

  let suffix: number = 2;
  while (usedSlugs.has(`${slug}-${suffix}`)) {
    suffix += 1;
  }

  const uniqueSlug: string = `${slug}-${suffix}`;
  usedSlugs.add(uniqueSlug);
  return uniqueSlug;
}
