// serve.js - Serve la cartella editor su http://localhost:8100 (il Bluetooth delle pagine web vuole
// https o localhost). Uso: node tools/serve.js [porta]
const http = require('http');
const fs = require('fs');
const path = require('path');

const radice = path.join(__dirname, '..');
const porta = +process.argv[2] || 8100;
const tipi = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  // La pagina manda qui il suo registro Bluetooth quando qualcosa non torna: finisce in
  // editor/registro-pagina.txt, in coda.
  if (req.method === 'POST' && req.url === '/registro') {
    let testo = '';
    req.on('data', d => { testo += d; if (testo.length > 2e6) req.destroy(); });
    req.on('end', () => {
      fs.appendFile(path.join(radice, 'registro-pagina.txt'), testo, () => { res.writeHead(204); res.end(); });
    });
    return;
  }
  const via = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const file = path.normalize(path.join(radice, via === '/' ? 'index.html' : via));
  if (!file.startsWith(radice)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, dati) => {
    if (err) { res.writeHead(404); res.end('non trovato'); return; }
    res.writeHead(200, { 'Content-Type': tipi[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(dati);
  });
}).listen(porta, '127.0.0.1', () => console.log('http://localhost:' + porta + '/'));
