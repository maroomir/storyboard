import { createInterface, type Interface } from 'node:readline/promises';

const endOfText: string = '\u0003';
const deleteChar: string = '\u007f';

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

export async function askLine(prompt: string): Promise<string> {
  const readline: Interface = createInterface({ input: process.stdin, output: process.stderr });

  try {
    return (await readline.question(prompt)).trim();
  } finally {
    readline.close();
  }
}

export async function askSecret(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const stdin: NodeJS.ReadStream = process.stdin;
  const wasRaw: boolean = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let typedSecret: string = '';

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
          resolve(typedSecret);
          return;
        }
        if (char === deleteChar || char === '\b') {
          typedSecret = typedSecret.slice(0, -1);
          continue;
        }
        typedSecret += char;
      }
    };

    stdin.on('data', onData);
  });
}
