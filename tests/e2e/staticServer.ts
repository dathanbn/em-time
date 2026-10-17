import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export interface StaticServer {
  origin: string;
  /** Serve a different sw.js body from now on (simulates a new deploy). */
  deploy(): void;
  requests: string[];
  close(): Promise<void>;
}

/** Serves ./dist under /em-time/ exactly as GitHub Pages would. `deploy()` changes sw.js by one comment. */
export async function serveDist(): Promise<StaticServer> {
  const root = resolve(import.meta.dirname, '../../dist');
  let version = 0;
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    requests.push(url.pathname);
    if (!url.pathname.startsWith('/em-time/')) {
      res.writeHead(404).end('not under /em-time/');
      return;
    }
    let rel = normalize(decodeURIComponent(url.pathname.slice('/em-time/'.length)));
    if (rel === '' || rel === '.' || rel.endsWith('/')) rel = join(rel, 'index.html');
    const file = join(root, rel);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    let body: Buffer | string = readFileSync(file);
    if (rel === 'sw.js' && version > 0) body = body.toString('utf8') + `\n// qa deploy ${version}\n`;
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    deploy: () => void version++,
    requests,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
