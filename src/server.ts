/**
 * Tiny static server for the bundled demo. No framework, no dependencies, and
 * it only ever serves `demo/` and `dist/`.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface DemoServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}

const root = packageRoot();
const allowedRoots = [join(root, 'demo'), join(root, 'dist')];

function resolveTarget(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname.split('?')[0] ?? '/');
  let relative = decoded === '/' ? '/demo/index.html' : decoded;
  // bare paths are demo pages: /bad.html === /demo/bad.html
  if (!relative.startsWith('/demo/') && !relative.startsWith('/dist/')) relative = `/demo${relative}`;
  const candidate = normalize(join(root, relative));
  const allowed = allowedRoots.some((base) => candidate === base || candidate.startsWith(`${base}${sep}`));
  if (!allowed) return null;
  return candidate;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = request.url ?? '/';
  if (url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  const target = resolveTarget(url);
  if (!target) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`not found: ${url}`);
  }
}

/** Start the demo site on `port` (0 picks a free port). */
export async function startServer(options: { port?: number; host?: string } = {}): Promise<DemoServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createServer((request, response) => {
    void handle(request, response);
  });

  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolveReady());
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
  const url = `http://${host}:${port}`;

  return {
    url,
    port,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}
