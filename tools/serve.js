// Static dev server for app/. No dependencies: node:http and node:fs only.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 4173;

/** @type {Record<string, string>} */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

/**
 * @param {string} root absolute path of the folder to serve
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(root, req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  let filePath = path.join(root, pathname);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return sendText(res, 403, 'Forbidden');
  }
  try {
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = await stat(filePath);
    }
    if (!info.isFile()) return sendText(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath)
      .on('error', () => res.destroy())
      .pipe(res);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

/**
 * Serve the files under `root` over HTTP on localhost.
 * @param {{ root: string, port: number }} options port 0 picks a free port
 * @returns {Promise<{ port: number, close(): Promise<void> }>}
 */
export function startServer({ root, port }) {
  const absRoot = path.resolve(root);
  const server = http.createServer((req, res) => {
    handle(absRoot, req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, 'localhost', () => {
      server.off('error', reject);
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({
        port: address.port,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../app/', import.meta.url));
  const { port } = await startServer({ root, port: DEFAULT_PORT });
  console.log(`Serving app/ at http://localhost:${port}`);
}
