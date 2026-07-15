import {
  SEED_UNKNOWN_ERROR_MESSAGE,
  mapSeedErrorToMessage,
} from '../../infrastructure/seedcoat/projectStorageMessages';
import {
  decodeSeedToWritePlan,
  isSeedError,
  type DecodedSeedContent,
} from '../../infrastructure/seedcoat/projectAdapter';

export type DecodeSeedResult =
  | { readonly kind: 'decoded'; readonly ok: true; readonly seed: DecodedSeedContent }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false };

export class DecodeSeedUseCase {
  public async execute(bytes: Uint8Array): Promise<DecodeSeedResult> {
    try {
      return { kind: 'decoded', ok: true, seed: await decodeSeedToWritePlan(bytes) };
    } catch (error) {
      return { kind: 'failed', message: this.formatError(error), ok: false };
    }
  }

  private formatError(error: unknown): string {
    if (isSeedError(error)) {
      return mapSeedErrorToMessage(error);
    }

    return error instanceof Error ? error.message : SEED_UNKNOWN_ERROR_MESSAGE;
  }
}
