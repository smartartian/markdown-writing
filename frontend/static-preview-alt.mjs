import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const port = 5111;
const entry = path.join(root, 'index.html');

const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  let target = path.join(root, url);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    target = entry;
  }
  if (!target.startsWith(root)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const stream = fs.createReadStream(target);
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream' });
    stream.pipe(res);
  });
  stream.on('error', () => {
    res.writeHead(500);
    res.end('Server error');
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Static preview at http://localhost:${port}`);
});
