import { z } from 'zod';

import craftContractData from './craftContract.params.json';

const craftContractShape = {
  banTelling: z.boolean(),
  motifRepeatLimit: z.number().int().positive(),
  stockGestureBlacklist: z.array(z.string()).readonly(),
  requireCharacterInterior: z.boolean(),
  actionClarity: z.boolean(),
  modulateDensity: z.boolean(),
  sceneLengthMultiplier: z.number().nonnegative(),
} satisfies z.ZodRawShape;

export interface CraftContract {
  banTelling: boolean;
  motifRepeatLimit: number;
  stockGestureBlacklist: readonly string[];
  requireCharacterInterior: boolean;
  actionClarity: boolean;
  modulateDensity: boolean;
  sceneLengthMultiplier: number;
}

export const craftContractSchema: z.ZodType<CraftContract> = z.object(craftContractShape);

export interface CraftContractOverride {
  banTelling?: boolean;
  motifRepeatLimit?: number;
  stockGestureBlacklist?: readonly string[];
  requireCharacterInterior?: boolean;
  actionClarity?: boolean;
  modulateDensity?: boolean;
  sceneLengthMultiplier?: number;
}

export const craftContractOverrideSchema: z.ZodType<CraftContractOverride> = z
  .object(craftContractShape)
  .partial();

export const craftContractOverrideFileSchema: z.ZodType<CraftContractOverride> = z
  .object(craftContractShape)
  .partial()
  .strict();

export const defaultCraftContract: CraftContract = craftContractSchema.parse(craftContractData);

function mergeCraftContract(base: CraftContract, override: CraftContractOverride): CraftContract {
  return {
    banTelling: override.banTelling ?? base.banTelling,
    motifRepeatLimit: override.motifRepeatLimit ?? base.motifRepeatLimit,
    stockGestureBlacklist: override.stockGestureBlacklist ?? base.stockGestureBlacklist,
    requireCharacterInterior: override.requireCharacterInterior ?? base.requireCharacterInterior,
    actionClarity: override.actionClarity ?? base.actionClarity,
    modulateDensity: override.modulateDensity ?? base.modulateDensity,
    sceneLengthMultiplier: override.sceneLengthMultiplier ?? base.sceneLengthMultiplier,
  };
}

let craftContractDefaults: CraftContract = defaultCraftContract;

export function overrideCraftContractDefaults(override: CraftContractOverride): void {
  craftContractDefaults = mergeCraftContract(craftContractDefaults, override);
}

export function resetCraftContractDefaults(): void {
  craftContractDefaults = defaultCraftContract;
}

export function resolveCraftContract(override: CraftContractOverride | undefined): CraftContract {
  return override ? mergeCraftContract(craftContractDefaults, override) : craftContractDefaults;
}
