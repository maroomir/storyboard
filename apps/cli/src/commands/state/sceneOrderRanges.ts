export function parseSceneOrders(raw: string): readonly number[] | undefined {
  const orders: Set<number> = new Set<number>();

  for (const part of raw.split(',')) {
    const bounds: RegExpExecArray | null = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    const start: number = Number(bounds?.[1]);

    if (bounds === undefined || bounds === null || !Number.isInteger(start)) {
      return undefined;
    }

    const end: number = bounds[2] === undefined ? start : Number(bounds[2]);

    if (end < start) {
      return undefined;
    }

    for (let order: number = start; order <= end; order += 1) {
      orders.add(order);
    }
  }

  return [...orders];
}
