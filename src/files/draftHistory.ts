const draftHistoryArchivePattern = /^(\d{4}-\d{2}-\d{2}-\d{2}-\d{2})-rev-(\d{2,})\.md$/

function padTwo(value: number): string {
  return value.toString().padStart(2, "0")
}

export function formatDraftHistoryTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    padTwo(date.getMonth() + 1),
    padTwo(date.getDate()),
    padTwo(date.getHours()),
    padTwo(date.getMinutes())
  ].join("-")
}

export function parseDraftHistoryRevision(fileName: string): number | undefined {
  const match = draftHistoryArchivePattern.exec(fileName)
  const rawRevision = match?.[2]

  return rawRevision === undefined ? undefined : Number.parseInt(rawRevision, 10)
}

export function nextDraftHistoryRevision(existingFileNames: readonly string[]): number {
  const maxRevision = existingFileNames.reduce((max, fileName) => {
    const revision = parseDraftHistoryRevision(fileName)
    return revision !== undefined && revision > max ? revision : max
  }, 0)

  return maxRevision + 1
}

export function draftHistoryArchiveFileName(timestamp: string, revision: number): string {
  return `${timestamp}-rev-${padTwo(revision)}.md`
}

export interface DraftHistoryFileSystem {
  readonly exists: (uri: unknown) => PromiseLike<boolean>
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>
  readonly createDirectory: (uri: unknown) => PromiseLike<void>
  readonly listFileNames: (uri: unknown) => PromiseLike<readonly string[]>
}

export interface ArchiveExistingDraftParams {
  readonly draftUri: unknown
  readonly historyDirectory: unknown
  readonly resolveArchiveUri: (fileName: string) => unknown
  readonly fileSystem: DraftHistoryFileSystem
  readonly now?: Date
}

export async function archiveExistingDraft(
  params: ArchiveExistingDraftParams
): Promise<string | undefined> {
  const { draftUri, historyDirectory, resolveArchiveUri, fileSystem } = params

  if (!(await fileSystem.exists(draftUri))) {
    return undefined
  }

  const existingBytes = await fileSystem.readFile(draftUri)

  await fileSystem.createDirectory(historyDirectory)

  const existingFileNames = await fileSystem.listFileNames(historyDirectory)
  const revision = nextDraftHistoryRevision(existingFileNames)
  const fileName = draftHistoryArchiveFileName(
    formatDraftHistoryTimestamp(params.now ?? new Date()),
    revision
  )

  await fileSystem.writeFile(resolveArchiveUri(fileName), existingBytes)

  return fileName
}
