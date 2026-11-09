// genera-esempio.js - Un tone vero da mostrare senza il Mini (index.html#esempio): «To Rachael», il
// tone intero dalla rassegna del 4 novembre 2026 e i suoi sette blocchi letti uno per uno, come
// pacchetti BLE MIDI. La pagina li fa passare dalla stessa strada dei pacchetti veri.
// Uso: node tools/genera-esempio.js          (dalla cartella editor)
const fs = require('fs');
const path = require('path');
const P = require('../src/pulze-protocollo.js');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const righe = f => fs.readFileSync(path.join(TOOLS, f), 'utf8').split(/\r?\n/)
  .map(r => r.match(/<- 7772e5db\s+([0-9a-f ]+?)\s*$/)).filter(Boolean).map(m => m[1].trim());

let tone = null;
const ric = P.Ricompositore(m => {
  if (m.comando === 0x12 && m.tipo === P.TIPO.TONE && P.leggiTone(m.corpo).nome === 'To Rachael') tone = m;
});
const lettore = P.Lettore(ric);
for (const r of righe('registro-rassegna.txt')) lettore(r.split(' ').map(h => parseInt(h, 16)));
if (!tone) throw new Error('To Rachael non trovato');

const hex = a => a.map(x => x.toString(16).padStart(2, '0')).join(' ');
const pacchetti = P.sysex(0, tone.gruppo, 0x12, tone.D).flatMap(sx => P.pacchetti(sx, 180)).map(hex)
  .concat(righe('registro-blocchi7.txt'));

fs.writeFileSync(path.join(__dirname, '..', 'test', 'esempio.js'),
  '// esempio.js - GENERATO da tools/genera-esempio.js: «To Rachael» come pacchetti BLE MIDI del Mini.\n' +
  'window.PulzeEsempio = ' + JSON.stringify(pacchetti, null, 1) + ';\n');
console.log(pacchetti.length + ' pacchetti');
