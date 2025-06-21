#!/usr/bin/env node
import http from 'http';
import fs   from 'fs';
import path from 'path';

const PORT = 8081;
const ROOT = process.argv[2] || 'tiles';

const server = http.createServer((req, res) => {
  const urlPath = req.url.replace(/^\/+/, '');
  const filePath = path.join(ROOT, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
    } else {
      res.statusCode = 200;
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Tile server listening on http://localhost:${PORT}/`);
});
