export interface IExtensionCommand {
  readonly id: string;
  run(...args: never[]): unknown;
}
