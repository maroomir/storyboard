// NOTE: 로컬 런타임에 없는 모델을 부르면 호출마다 404 가 나고, 실행기는 씬마다 실패를 기록하며
// 끝까지 간다. 11지점 선별이 빈 기록 11줄로 끝날 수 있다. 첫 호출 전에 태그 목록을 한 번 보고 막는다.

export interface LocalModelList {
  readonly models?: readonly { readonly name: string }[];
}

export async function listLocalModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly string[]> {
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/tags`);

  if (!response.ok) {
    throw new Error(`${baseUrl} 가 ${response.status} 로 답했습니다.`);
  }

  const body = (await response.json()) as LocalModelList;
  return (body.models ?? []).map((model) => model.name);
}

// ollama 는 태그 없는 이름을 `:latest` 로 본다. 사람이 `qwen3` 라고 적어도 `qwen3:latest` 와 같다.
function canonical(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}

export function missingLocalModels(
  available: readonly string[],
  wanted: readonly string[],
): readonly string[] {
  const have = new Set(available.map(canonical));
  return [...new Set(wanted)].filter((name) => !have.has(canonical(name)));
}
