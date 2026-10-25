import type { DesktopError, DesktopErrorCode } from '@/shared/ipcContract';

export interface ServiceFailure {
  readonly ok: false;
  readonly error: DesktopError;
}

export type ServiceResult<T> = { readonly ok: true; readonly data: T } | ServiceFailure;

export function succeed<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail(code: DesktopErrorCode, message: string): ServiceFailure {
  return { ok: false, error: { code, message } };
}
