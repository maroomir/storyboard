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

export interface WorkspaceFolder {
  readonly uri: Uri
  readonly name: string
  readonly index: number
}

export const workspace: {
  getWorkspaceFolder: (uri: Uri) => WorkspaceFolder | undefined
} = {
  getWorkspaceFolder: () => undefined
}

export class Uri {
  public constructor(
    public readonly scheme: string,
    public readonly fsPath: string
  ) {}

  public get path(): string {
    return this.fsPath
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
