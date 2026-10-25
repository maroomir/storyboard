/* eslint-disable no-control-regex -- these patterns match terminal control bytes on purpose. */
const controlSequencePattern: RegExp = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const operatingSystemCommandPattern: RegExp = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const shortEscapePattern: RegExp = /\u001b(?:[()*+][0-9A-Za-z]|[@-Z\\^_=>78])/g;
const controlByteExceptTabAndNewlinePattern: RegExp =
  /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]|\u001b(?!\[)/g;
const fullScreenDrawingPattern: RegExp = /\u001b\[(?:\d*(?:;\d*)?[Hf]|[23]J|\?(?:1049|1047|47)h)/;
/* eslint-enable no-control-regex */

export function isScreenDrawing(output: string): boolean {
  return fullScreenDrawingPattern.test(output);
}

export function keepTextAndColors(output: string): string {
  return output
    .replace(operatingSystemCommandPattern, '')
    .replace(controlSequencePattern, (sequence) => (sequence.endsWith('m') ? sequence : ''))
    .replace(shortEscapePattern, '')
    .split('\n')
    .map((line) => line.replace(/\r+$/, '').split('\r').at(-1) ?? '')
    .join('\n')
    .replace(controlByteExceptTabAndNewlinePattern, '');
}
