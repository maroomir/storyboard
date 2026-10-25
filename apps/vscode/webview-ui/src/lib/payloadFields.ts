export type PayloadFields = Readonly<Record<string, unknown>>;

export function readPayloadFields(payload: unknown): PayloadFields {
  return payload && typeof payload === 'object' ? (payload as PayloadFields) : {};
}
