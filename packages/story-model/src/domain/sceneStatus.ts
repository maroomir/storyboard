export function isOutlineStale(outlineMtime: number | undefined, sceneMtime: number): boolean {
  return outlineMtime !== undefined && outlineMtime > sceneMtime;
}
