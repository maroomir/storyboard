import type { SeedError, SeedErrorCode } from "@/services/seedcoat/loader"

export const UNSUPPORTED_LEGACY_SEED_FILE_MESSAGE =
  "이 `.seed` 파일은 이전 형식(평문 JSON envelope)입니다. Storyboard는 암호화 컨테이너 형식만 지원합니다. seedcoat v0.2.0 이상으로 보낸 `.seed` 파일을 사용해 주세요."

export const SEED_PASSPHRASE_REQUIRED_MESSAGE = "패스프레이즈가 필요합니다."

export const SEED_LEGACY_FORMAT_REJECTED_MESSAGE = UNSUPPORTED_LEGACY_SEED_FILE_MESSAGE

export const SEED_DECRYPTION_FAILED_MESSAGE =
  "패스프레이즈가 올바르지 않거나 파일이 손상되었습니다."

export const SEED_INPUT_LIMITS_EXCEEDED_MESSAGE = "Seed 파일이 처리 한도를 초과했습니다."

export const SEED_MALFORMED_JSON_MESSAGE = "Seed 파일 데이터 형식이 올바르지 않아 처리할 수 없습니다."

export const SEED_INVALID_VERSION_MESSAGE = "지원하지 않는 Seed 파일 버전입니다."

export const SEED_SCHEMA_VIOLATION_MESSAGE = "Seed 파일 구조가 올바르지 않습니다."

export const SEED_UNKNOWN_ERROR_MESSAGE = "Seed 파일을 처리하는 중 알 수 없는 오류가 발생했습니다."

const SEED_ERROR_MESSAGES: Record<SeedErrorCode, string> = {
  LEGACY_FORMAT_REJECTED: SEED_LEGACY_FORMAT_REJECTED_MESSAGE,
  DECRYPTION_FAILED: SEED_DECRYPTION_FAILED_MESSAGE,
  INPUT_LIMITS_EXCEEDED: SEED_INPUT_LIMITS_EXCEEDED_MESSAGE,
  MALFORMED_JSON: SEED_MALFORMED_JSON_MESSAGE,
  INVALID_VERSION: SEED_INVALID_VERSION_MESSAGE,
  SCHEMA_VIOLATION: SEED_SCHEMA_VIOLATION_MESSAGE,
  UNKNOWN: SEED_UNKNOWN_ERROR_MESSAGE
}

export function mapSeedErrorToMessage(error: SeedError): string {
  return SEED_ERROR_MESSAGES[error.code] ?? SEED_UNKNOWN_ERROR_MESSAGE
}
