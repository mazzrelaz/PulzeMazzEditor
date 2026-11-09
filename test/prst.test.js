// prst.test.js - Prova pulze-prst.js sui 40 file di Reniori: letti e riscritti tornano uguali.
// Uso: node test/prst.test.js          (dalla cartella editor)
const fs = require('fs');
const path = require('path');
const X = require('../src/pulze-prst.js');
const C = require('../src/pulze-catalogo.js');

let ok = 0, ko = 0;
function prova(nome, cond, dettaglio) {
  if (cond) ok++; else { ko++; console.log('NO  ' + nome + (dettaglio ? ' — ' + dettaglio : '')); }
}
const cartella = path.join(__dirname, 'prst');
const file = fs.readdirSync(cartella).filter(f => f.endsWith('.prst'));
prova('ci sono i file di prova', file.length >= 40, file.length);
for (const f of file) {
  const testo = fs.readFileSync(path.join(cartella, f), 'utf8').trim();
  const t = X.aTone(testo);
  const c = t.grezzo.corpo;
  const rifatto = X.scrivi(t, { id: c.ID, rapideModulo: c.quickKnobModule, rapideParam: c.quickKnobParam, autore: t.grezzo.testa.author });
  prova(f + ': riscritto uguale', rifatto === testo, rifatto === testo ? '' : Buffer.from(rifatto, 'base64').toString().slice(0, 200));
  // 0x0A000000 è il segnaposto «auto cab» di Reniori (writer.py, AUTO_CAB_UID), non un modello del Mini
  for (const b of t.blocchi) prova(f + ': modello dello slot ' + b.slot + ' nel catalogo', !!C.modelli[b.uid] || b.uid === 0x0A000000, '0x' + b.uid.toString(16));
}
prova('nome con spazi codificato come Python', X.quote('Crunch Rhythm (2)') === 'Crunch%20Rhythm%20%282%29');
prova('numeri come Python', X.numeroPy(20) === '20.0' && X.numeroPy(Math.fround(61.8)) === '61.79999923706055');
console.log(ok + ' prove passate, ' + ko + ' fallite');
process.exit(ko ? 1 : 0);
