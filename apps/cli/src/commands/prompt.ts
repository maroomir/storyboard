import { createInterface } from 'node:readline/promises';

// 터미널에서 사람에게 묻는 두 가지. 일반 입력과, 화면에 남지 않아야 하는 비밀 입력.

const endOfText = '\u0003';
const deleteChar = '\u007f';

export async function askLine(prompt: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stderr });

  try {
    return (await readline.question(prompt)).trim();
  } finally {
    readline.close();
  }
}

// Echo is switched off while the key is typed so it never lands in the scrollback.
export async function askSecret(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let value = '';

    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === endOfText) {
          cleanup();
          process.stderr.write('\n');
          process.exit(130);
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === deleteChar || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on('data', onData);
  });
}

