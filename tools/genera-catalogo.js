// genera-catalogo.js - Il catalogo dei modelli per la pagina (src/pulze-catalogo.js), da due fonti:
//
// 1. reference/hotone/algorithm.json, il catalogo della Pulze Editor V2.1.3 (dall'APK): per ogni slot
//    i modelli ammessi, e per ogni modello le manopole con la posizione nel blocco (ID), i limiti,
//    il passo, il valore di fabbrica e quale Sync comanda quale tempo. È quello che usa l'app, quindi
//    vince: dove Reniori ha dedotto (il Tape Dly, i delay fino a 4000 ms) l'app dice altro.
// 2. reference/reniori/ (MIT): le ETICHETTE dei selettori e le unità, che nel catalogo dell'app non ci
//    sono (stanno nel codice: «ValToStr_090» e così via).
//
// Uso: node tools/genera-catalogo.js          (dalla cartella editor)
//
// Un modello si riconosce dall'UID (il «Code» dell'app): categoria << 24 | numero, uguale ai byte 8-11
// del corpo del blocco.
// Per modello: n nome, f famiglia, k manopole, r ruolo (Reniori), i riga dell'app, z valori di fabbrica
// per posizione.
// Le manopole: [nome, posizione, tipo, ...]
//   ['c', min, max, unità, passo]           continua (unità '' se non c'è)
//   ['t']                                   interruttore 0/1
//   ['e', {valore: etichetta}]              selettore
//   ['o', min, max, unità, '<'|'>']         continua con «Off» sotto il minimo o sopra il massimo
//   ['d', min, max, unità, posSync, passo]  tempo o velocità: numero se Sync = 0, divisione se Sync = 1
const fs = require('fs');
const path = require('path');

const radice = path.join(__dirname, '..');
const leggi = (...p) => JSON.parse(fs.readFileSync(path.join(radice, 'reference', ...p), 'utf8'));
const ufficiale = leggi('hotone', 'algorithm.json').PluginProperties.Modules.Catalog;
const amps = leggi('reniori', 'amps.json');
const cat = leggi('reniori', 'EFFECT_CATALOG_v1.json');
const commit = fs.readFileSync(path.join(radice, 'reference', 'reniori', 'COMMIT.txt'), 'utf8').trim();

const DIV = cat.shared_encodings.div_enum_11.domain;
const PITCH = cat.shared_encodings.pitch_enum_31.domain;
const avvisi = [];

// ------------------------------------------------------------------ Reniori: etichette e unità

/** Da una descrizione di Reniori: le etichette di un selettore, o l'unità di una manopola. */
function daReniori(s) {
  const t = String(s);
  if (/pitch_enum/i.test(t)) return { o: PITCH };
  if (/rotary enum|INDEXED rotary/i.test(t)) {
    const o = {};
    for (const x of t.matchAll(/(-?\d+)\s*=\s*([^,;)]+?)(?=\s*(?:,|;|\)|$|\s+-?\d+\s*=))/g)) o[x[1]] = x[2].trim();
    return Object.keys(o).length >= 2 ? { o } : {};
  }
  if (/signed_dB/.test(t)) return { u: 'dB' };
  if (/semitones/.test(t)) return { u: 'st' };
  if (/cents/.test(t)) return { u: 'c' };
  if (/direct_percent/.test(t)) return { u: '%' };
  if (/Hz_direct|direct Hz/.test(t)) return { u: 'Hz' };
  if (/ms\b/.test(t) && !/DUAL/.test(t)) return { u: 'ms' };
  return {};
}

const reniori = {};       // uid → nome della manopola → { o, u }
for (const a of Object.values(amps)) {
  const m = reniori[parseInt(a.uid, 16)] = {};
  for (const [nome, v] of Object.entries(a.knobs || {})) {
    if (v.encoding === 'enum_0_indexed' && v.options) {
      const o = {}; v.options.forEach((x, i) => { o[i] = x; });
      m[nome] = { o };
    }
  }
}
for (const e of cat.effects) {
  const m = reniori[parseInt(e.uid, 16)] = reniori[parseInt(e.uid, 16)] || {};
  for (const [nome, enc] of Object.entries(e.param_encodings || {})) m[nome] = daReniori(enc);
}
const ruoli = {};
for (const a of Object.values(amps)) if (a.role) ruoli[parseInt(a.uid, 16)] = a.role;

// ------------------------------------------------------------------ l'app: modelli e manopole

// Unità dalle funzioni di scrittura dell'app, quando Reniori non le dà.
const UNITA = { ValToStr_025: 'ms', ValToStr_136: 'ms', ValToStr_150: 'ms', ValToStr_142: 'Hz',
  ValToStr_144: 'Hz', ValToStr_147: 'Hz', ValToStr_070: 'dB', ValToStr_126: 'dB', ValToStr_086: 'st',
  ValToStr_088: 'c', ValToStr_030: '%' };

const num = s => parseFloat(String(s).replace('+', ''));
const widget = a => (a.Widget ? [].concat(a.Widget) : []);

function manopole(a) {
  const uid = +a.Code;
  const w = widget(a);
  const sync = new Set(w.filter(x => x.Sync != null).map(x => num(x.Sync)));
  const r = reniori[uid] || {};
  const k = [];
  for (const x of w) {
    const pos = Math.round(num(x.ID));
    if (sync.has(pos) && x.Type === '3') continue;              // il Sync va col suo tempo
    const min = num(x.DisplayMin), max = num(x.DisplayMax);
    // le bande degli EQ (Type 4) non hanno passo e il Mini tiene i decimali (14.5, -9.7 letti)
    const passo = num(x.Step) || (x.Type === '4' ? 0.1 : 1);
    const ren = r[x.Name] || {};
    let tipo;
    if (x.Sync != null) tipo = ['d', min, max, x.Codeing === 'ValToStr_025' ? 'ms' : 'Hz', num(x.Sync), passo];
    else if (x.Codeing === 'ValToStr_022') tipo = ['o', min + 1, max, 'Hz', '<'];       // Low Cut, Off = 19
    else if (x.Codeing === 'ValToStr_023') tipo = ['o', min, max - 1, 'Hz', '>'];       // High Cut, Off = 20001
    else if (x.Type === '3') tipo = ['t'];
    else if (x.Type === '2') {
      let o = ren.o;
      if (!o) {
        o = {}; for (let i = min; i <= max; i++) o[i] = String(i);
        avvisi.push(a.Name + ' / ' + x.Name + ': selettore senza etichette (' + x.Codeing + ')');
      }
      tipo = ['e', o];
    } else tipo = ['c', min, max, ren.u || UNITA[x.Codeing] || '', passo];
    k.push([x.Name, pos, ...tipo]);
  }
  return k.sort((p, q) => p[1] - q[1]);
}

const modelli = {};
const moduli = {};        // slot → gli UID ammessi, nell'ordine dell'app
for (const m of ufficiale) {
  const slot = +m.index;
  moduli[slot] = [];
  for (const a of m.Alg) {
    const uid = +a.Code;
    moduli[slot].push(uid);
    if (modelli[uid]) continue;
    modelli[uid] = { n: a.Name, f: a.classify || '', k: manopole(a) };
    if (ruoli[uid]) modelli[uid].r = ruoli[uid];
    // per «Crea preset…»: la riga dell'app («Based on …», senza i marchi ®™*) e i valori di fabbrica
    // per posizione (anche i Sync), da cui parte un blocco nuovo
    const info = String(a.desInforEN || '').replace(/[®™*]/g, '').replace(/\s+/g, ' ').trim();
    if (info) modelli[uid].i = info;
    const z = {};
    for (const x of widget(a)) if (x.DefaultValue != null && x.DefaultValue !== '') z[Math.round(num(x.ID))] = num(x.DefaultValue);
    modelli[uid].z = z;
  }
}
for (const u of Object.keys(reniori)) if (!modelli[u]) avvisi.push('in Reniori ma non nell\'app: 0x' + (+u).toString(16));

const SLOT = ['PRE', 'AMP', 'DYN', 'CAB', 'EQ/MOD', 'FX1', 'FX2'];
const testa = `// pulze-catalogo.js - GENERATO da tools/genera-catalogo.js: non si modifica a mano.
// Modelli, posizioni e limiti: catalogo della Pulze Editor V2.1.3 (Hotone Audio), per l'interoperabilità.
// Etichette dei selettori e unità: Reniori, pulze-tone-generator (https://github.com/Reniori/pulze-tone-generator),
// commit ${commit}, licenza MIT (reference/reniori/LICENSE): Copyright (c) 2026 reniori.
`;
const corpo = `(function (g) {
  const C = ${JSON.stringify({ divisioni: DIV, moduli, modelli })};
  if (typeof module !== 'undefined' && module.exports) module.exports = C; else g.PulzeCatalogo = C;
})(this);
`;
fs.writeFileSync(path.join(radice, 'src', 'pulze-catalogo.js'), testa + corpo);
console.log(Object.keys(modelli).length + ' modelli; per slot: ' +
  Object.entries(moduli).map(([s, l]) => SLOT[s] + ' ' + l.length).join(', '));
for (const a of avvisi) console.log('  ' + a);
