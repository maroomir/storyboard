import {
  mapSeedErrorToMessage as mapSeedErrorToMessageWith,
  type SeedError,
  type SeedErrorMessages,
} from '@seedcoat/wasm';

export const SEED_UNSUPPORTED_FORMAT_MESSAGE =
  '지원하지 않는 Seed 파일 형식입니다. 이전 암호화 형식(패스프레이즈 기반)이나 구 저장소 형식(v1)의 `.seed` 파일은 더 이상 열 수 없습니다. 보낸 쪽에서 최신 형식으로 다시 내보낸 파일을 사용해 주세요.';

export const SEED_MALFORMED_CONTAINER_MESSAGE = 'Seed 파일 구조가 손상되어 읽을 수 없습니다.';

export const SEED_HASH_MISMATCH_MESSAGE =
  'Seed 파일 내용이 손상되었거나 변조되었습니다(객체 해시 불일치).';

export const SEED_INVALID_REPOSITORY_MESSAGE = 'Seed 저장소 구조가 올바르지 않습니다.';

export const SEED_INVALID_STATE_MESSAGE = 'Seed 파일의 프로젝트 데이터가 올바르지 않습니다.';

export const SEED_UNKNOWN_REVISION_MESSAGE = 'Seed 파일에서 요청한 리비전을 찾을 수 없습니다.';

export const SEED_UNKNOWN_CHANGE_MESSAGE = 'Seed 파일에서 요청한 변경 내역을 찾을 수 없습니다.';

export const SEED_EMPTY_NOTE_MESSAGE = '기록할 변경 내용이 없습니다.';

export const SEED_REVERT_CONFLICT_MESSAGE =
  '되돌리기가 이후 변경 내용과 충돌하여 적용할 수 없습니다.';

export const SEED_INPUT_LIMITS_EXCEEDED_MESSAGE = 'Seed 파일이 처리 한도를 초과했습니다.';

export const SEED_ENTITY_NOT_FOUND_MESSAGE = '요청한 항목을 Seed 파일에서 찾을 수 없습니다.';

export const SEED_UNKNOWN_ERROR_MESSAGE = 'Seed 파일을 처리하는 중 알 수 없는 오류가 발생했습니다.';

export const SEED_NO_HISTORY_MESSAGE = 'Seed 파일에 기록된 변경 이력이 없어 가져올 수 없습니다.';

const SEED_ERROR_MESSAGES: SeedErrorMessages = {
  UNSUPPORTED_FORMAT: SEED_UNSUPPORTED_FORMAT_MESSAGE,
  MALFORMED_CONTAINER: SEED_MALFORMED_CONTAINER_MESSAGE,
  HASH_MISMATCH: SEED_HASH_MISMATCH_MESSAGE,
  INVALID_REPOSITORY: SEED_INVALID_REPOSITORY_MESSAGE,
  INVALID_STATE: SEED_INVALID_STATE_MESSAGE,
  UNKNOWN_REVISION: SEED_UNKNOWN_REVISION_MESSAGE,
  UNKNOWN_CHANGE: SEED_UNKNOWN_CHANGE_MESSAGE,
  EMPTY_NOTE: SEED_EMPTY_NOTE_MESSAGE,
  REVERT_CONFLICT: SEED_REVERT_CONFLICT_MESSAGE,
  INPUT_LIMITS_EXCEEDED: SEED_INPUT_LIMITS_EXCEEDED_MESSAGE,
  ENTITY_NOT_FOUND: SEED_ENTITY_NOT_FOUND_MESSAGE,
  UNKNOWN: SEED_UNKNOWN_ERROR_MESSAGE,
};

export function mapSeedErrorToMessage(error: SeedError): string {
  return mapSeedErrorToMessageWith(error, SEED_ERROR_MESSAGES, SEED_UNKNOWN_ERROR_MESSAGE);
}
