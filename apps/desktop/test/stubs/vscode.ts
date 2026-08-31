export interface IDisposable {
  readonly dispose: () => void
}

export class EventEmitter<T = void> {
  private listeners: Array<(event: T) => unknown> = []

  readonly event = (
    listener: (event: T) => unknown,
    _thisArgs?: unknown,
    disposables?: IDisposable[]
  ): IDisposable => {
    this.listeners.push(listener)
    const disposable: IDisposable = {
      dispose: () => {
        const index = this.listeners.indexOf(listener)
        if (index >= 0) {
          this.listeners.splice(index, 1)
        }
      }
    }
    disposables?.push(disposable)
    return disposable
  }

  fire(data: T): void {
    for (const listener of [...this.listeners]) {
      void listener(data)
    }
  }

  dispose(): void {
    this.listeners = []
  }
}

export interface UriLike {
  readonly fsPath: string
  toString(): string
}

export interface WorkspaceFolder {
  readonly uri: UriLike
  readonly name: string
  readonly index: number
}

export class Position {
  public constructor(
    public readonly line: number,
    public readonly character: number
  ) {}
}

export class Range {
  public constructor(
    public readonly start: Position,
    public readonly end: Position
  ) {}
}

export class RelativePattern {
  public constructor(
    public readonly base: Uri | WorkspaceFolder,
    public readonly pattern: string
  ) {}
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3
}

export interface TextEditReplacement {
  readonly uri: UriLike
  readonly range: Range
  readonly text: string
}

export interface FileRename {
  readonly oldUri: UriLike
  readonly newUri: UriLike
  readonly options?: unknown
}

export class WorkspaceEdit {
  private readonly replacements: TextEditReplacement[] = []
  private readonly renames: FileRename[] = []

  replace(uri: UriLike, range: Range, text: string): void {
    this.replacements.push({ uri, range, text })
  }

  renameFile(oldUri: UriLike, newUri: UriLike, options?: unknown): void {
    this.renames.push({ oldUri, newUri, options })
  }

  getReplacements(): readonly TextEditReplacement[] {
    return this.replacements
  }

  getRenames(): readonly FileRename[] {
    return this.renames
  }
}

export class Disposable implements IDisposable {
  public constructor(private readonly callOnDispose?: () => void) {}

  dispose(): void {
    this.callOnDispose?.()
  }

  static from(...disposables: IDisposable[]): IDisposable {
    return {
      dispose: (): void => {
        for (const disposable of disposables) {
          disposable.dispose()
        }
      }
    }
  }
}

export interface WillRenameFilesEvent {
  readonly files: ReadonlyArray<{ readonly oldUri: UriLike; readonly newUri: UriLike }>
  waitUntil(thenable: Promise<WorkspaceEdit | undefined>): void
}

const willRenameFilesEmitter = new EventEmitter<WillRenameFilesEvent>()

export const workspace: {
  workspaceFolders: readonly WorkspaceFolder[] | undefined
  getWorkspaceFolder: (uri: UriLike) => WorkspaceFolder | undefined
  fs: {
    readFile: (uri: UriLike) => Promise<Uint8Array>
    stat: (uri: UriLike) => Promise<{ type: FileType; mtime?: number }>
    readDirectory: (uri: UriLike) => Promise<Array<[string, FileType]>>
    rename: (source: UriLike, target: UriLike, options?: { overwrite?: boolean }) => Promise<void>
  }
  findFiles: (
    include: RelativePattern,
    exclude?: RelativePattern | null,
    maxResults?: number
  ) => Promise<UriLike[]>
  applyEdit: (edit: WorkspaceEdit) => Promise<boolean>
  onWillRenameFiles: (listener: (event: WillRenameFilesEvent) => void) => IDisposable
} = {
  workspaceFolders: undefined,
  getWorkspaceFolder: () => undefined,
  fs: {
    readFile: async () => new Uint8Array(),
    stat: async () => ({ type: FileType.File }),
    readDirectory: async () => [],
    rename: async () => undefined
  },
  findFiles: async () => [],
  applyEdit: async () => true,
  onWillRenameFiles: (listener) => willRenameFilesEmitter.event(listener)
}

export function fireWillRenameFiles(event: WillRenameFilesEvent): void {
  willRenameFilesEmitter.fire(event)
}

export const window: {
  showInputBox: (options?: unknown) => Promise<string | undefined>
  showWarningMessage: (message: string) => Promise<void>
  showErrorMessage: (message: string) => Promise<void>
  activeTextEditor: { document: { uri: Uri } } | undefined
} = {
  showInputBox: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  activeTextEditor: undefined
}

export const commands = {
  registerCommand: (command: string, callback: (...args: unknown[]) => unknown): IDisposable => {
    void command
    void callback
    return { dispose: (): void => undefined }
  }
}

export class Uri {
  public constructor(
    public readonly scheme: string,
    public readonly fsPath: string
  ) {}

  public get path(): string {
    return this.fsPath
  }

  toString(): string {
    return this.fsPath
  }

  // 실제 vscode.Uri와 같이 일부 구성요소만 바꾼 사본을 만든다. 원자적 쓰기가 임시 경로를
  // 만들 때 쓴다.
  public with(change: { readonly path?: string }): Uri {
    return new Uri(this.scheme, change.path ?? this.fsPath)
  }

  static file(path: string): Uri {
    return new Uri("file", path)
  }

  static joinPath(base: Uri, ...pathSegments: string[]): Uri {
    const sep = base.fsPath.includes("\\") ? "\\" : "/"
    let next = base.fsPath.replace(new RegExp(`${sep}$`), "")
    for (const segment of pathSegments) {
      next = `${next}${sep}${segment}`
    }
    return Uri.file(next)
  }
}
