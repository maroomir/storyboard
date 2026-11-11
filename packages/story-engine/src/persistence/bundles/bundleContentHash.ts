import { createHash } from 'node:crypto';

const contentHashPrefix: string = 'sha256:';

const bundleFileSeparator: string = '\0';

export function computeBundleCardHash(cardText: string, statementsText: string): string {
  const digest: string = createHash('sha256')
    .update(cardText)
    .update(bundleFileSeparator)
    .update(statementsText)
    .digest('hex');

  return `${contentHashPrefix}${digest}`;
}
