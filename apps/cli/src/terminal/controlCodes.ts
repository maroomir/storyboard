// 다른 프로그램이 낸 출력을 화면 안에 다시 보여 줄 때 쓴다. 커서 이동·화면 지우기 같은 제어 코드가
// 남으면 화면을 다시 그릴 때마다 재생되어 화면을 덮으므로, 글자와 색만 남긴다.

/* eslint-disable no-control-regex -- these patterns match terminal control bytes on purpose. */
// CSI sequences (`ESC [ … final`); the color ones end in `m`.
const csiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// OSC sequences (titles, links), ended by BEL or ESC \.
const oscPattern = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
// Two-byte escapes (`ESC =`, `ESC >`, `ESC 7`) and character set picks (`ESC ( B`).
const shortEscapePattern = /\u001b(?:[()*+][0-9A-Za-z]|[@-Z\\^_=>78])/g;
// Every other control byte except tab and newline; an ESC left now opens a color code.
const controlBytePattern = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]|\u001b(?!\[)/g;
/* eslint-enable no-control-regex */

// Keeps the text and its colors. A carriage return redraws its line, so only what was written last
// on each line stays, as a terminal would have shown it.
export function keepTextAndColors(output: string): string {
  return output
    .replace(oscPattern, '')
    .replace(csiPattern, (sequence) => (sequence.endsWith('m') ? sequence : ''))
    .replace(shortEscapePattern, '')
    .split('\n')
    .map((line) => line.replace(/\r+$/, '').split('\r').at(-1) ?? '')
    .join('\n')
    .replace(controlBytePattern, '');
}
