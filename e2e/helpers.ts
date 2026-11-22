import { spawn, execFile, type ChildProcess } from 'node:child_process';

export interface DemoServer {
  url: string;
  close(): Promise<void>;
}

/** Start `livesay serve` on a free port and wait for it to print its URL. */
export async function startDemo(): Promise<DemoServer> {
  const child: ChildProcess = spawn(process.execPath, ['dist/cli.js', 'serve', '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`demo server did not start:\n${buffer}`)), 15_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += String(chunk);
      const match = /listening on (http:\/\/\S+)/.exec(buffer);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      buffer += String(chunk);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`demo server exited (${code}):\n${buffer}`));
    });
  });

  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the built CLI and capture its exit code instead of throwing. */
export function runCli(args: string[], timeoutMs = 90_000): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['dist/cli.js', ...args],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
