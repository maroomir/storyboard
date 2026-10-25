export interface LocalModelList {
  readonly models?: readonly { readonly name: string }[];
}

export async function listLocalModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly string[]> {
  const response: Response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/tags`);

  if (!response.ok) {
    throw new Error(`${baseUrl} 가 ${response.status} 로 답했습니다.`);
  }

  const body: LocalModelList = (await response.json()) as LocalModelList;
  return (body.models ?? []).map((model) => model.name);
}

function canonical(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}

export function missingLocalModels(
  available: readonly string[],
  wanted: readonly string[],
): readonly string[] {
  const have: Set<string> = new Set(available.map(canonical));
  return [...new Set(wanted)].filter((name) => !have.has(canonical(name)));
}
