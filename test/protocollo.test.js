// protocollo.test.js - Prova pulze-protocollo.js e il catalogo sui registri veri del Mini (tools/).
// Uso: node test/protocollo.test.js          (dalla cartella editor)
const fs = require('fs');
const path = require('path');
const P = require('../src/pulze-protocollo.js');
const C = require('../src/pulze-catalogo.js');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
let ok = 0, ko = 0;
function prova(nome, cond, dettaglio) {
  if (cond) ok++; else { ko++; console.log('NO  ' + nome + (dettaglio ? ' — ' + dettaglio : '')); }
}
const hex = a => Array.from(a, x => x.toString(16).padStart(2, '0')).join(' ');

/** Tutti i messaggi Hotone che il Mini ha mandato in un registro di pulze-ble.exe. */
function messaggiDel(registro) {
  const msg = [];
  const ric = P.Ricompositore(m => msg.push(m));
  const lettore = P.Lettore(ric);
  for (const r of fs.readFileSync(path.join(TOOLS, registro), 'utf8').split(/\r?\n/)) {
    const m = r.match(/<- 7772e5db\s+([0-9a-f ]+?)\s*$/); if (!m) continue;
    lettore(m[1].trim().split(/\s+/).map(h => parseInt(h, 16)));
  }
  return msg;
}

// 1. Le richieste, byte per byte come quelle già provate (registro-blocchi7, cattura del 5 novembre).
const inviata = fs.readFileSync(path.join(TOOLS, 'registro-blocchi7.txt'), 'utf8')
  .match(/-> 7772e5db\s+([0-9a-f ]+?)\s+\(/)[1];
prova('richiesta del blocco 0 come pulze-ble', hex(P.chiediBlocco(0x14, 0)[0]) === inviata, hex(P.chiediBlocco(0x14, 0)[0]));
const sxTesta = P.sysex(0x17, 0, 0x11, P.datiVeri(1, 0, []))[0];
prova('richiesta della testa come l\'app', hex(sxTesta) ===
  '21 25 41 50 17 00 00 11 08 00 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00', hex(sxTesta));
prova('conferma come il pedale', hex(P.conferma(0, 0x50, 0x00)[0]) === '80 80 f0 21 25 41 50 00 00 00 14 50 00 50 00 80 f7');

// 2. Pezzi lunghi: un messaggio da 133 byte veri spezzato in pacchetti piccoli torna uguale.
const D = P.datiVeri(6, 2, Array.from({ length: 124 }, (_, i) => (i * 37) & 0xff));
const ricomposti = [];
const lett = P.Lettore(P.Ricompositore(m => ricomposti.push(m)));
for (const sx of P.sysex(0, 2, 0x12, D)) for (const p of P.pacchetti(sx, 20)) lett(p);
prova('ricomposizione di un messaggio in due pezzi e pacchetti da 20', ricomposti.length === 1 && hex(ricomposti[0].D) === hex(D));

// 3. La rassegna dei tone (4 novembre): i tone interi si leggono e i modelli sono nel catalogo.
const rassegna = messaggiDel('registro-rassegna.txt').filter(m => m.comando === 0x12 && m.tipo === P.TIPO.TONE);
const tone = new Map();
for (const m of rassegna) { const t = P.leggiTone(m.corpo); if (t) tone.set(t.numero, t); }
prova('tone letti dalla rassegna', tone.size >= 110, tone.size + ' tone');
const t1 = tone.get(1);
prova('Proggy Drive', t1 && t1.nome === 'Proggy Drive' && t1.volume === 30 && t1.tempo === 100, JSON.stringify(t1));
prova('Proggy Drive, catena DYN PRE AMP …', t1 && t1.catena.join('') === '2013456');
const nomeDi = u => (C.modelli[u] || {}).n;
prova('Proggy Drive, AMP = Glacian Clean', t1 && nomeDi(t1.uid[1]) === 'Glacian Clean', t1 && t1.uid[1].toString(16));
prova('Proggy Drive, PRE = T-Mee', t1 && nomeDi(t1.uid[0]) === 'T-Mee');
const ignoti = new Map();
for (const t of tone.values()) t.uid.forEach((u, s) => {
  if (!C.modelli[u]) ignoti.set(u, (ignoti.get(u) || '') + ' ' + t.nome + '/' + P.SLOT[s]);
});
prova('tutti i modelli della rassegna sono nel catalogo', ignoti.size === 0,
  [...ignoti].map(([u, d]) => '0x' + u.toString(16) + ':' + d).join(';'));
// Il byte dei blocchi accesi va per slot: in «Heavy Riff» suonano PRE, AMP e CAB (non la catena).
const heavy = [...tone.values()].find(t => t.nome === 'Heavy Riff');
prova('Heavy Riff, accesi PRE AMP CAB', heavy && heavy.accesi === 0b0001011, heavy && heavy.accesi.toString(2));

// 4. I sette blocchi letti uno per uno (4 novembre): posizione → slot come dice la catena comune.
const blocchi = messaggiDel('registro-blocchi7.txt').filter(m => m.comando === 0x12 && m.tipo === P.TIPO.BLOCCO)
  .map(m => P.leggiBlocco(m.corpo)).filter(Boolean);
prova('blocchi letti', blocchi.length >= 6, blocchi.length + ' blocchi');
const catena = [2, 0, 1, 3, 4, 5, 6];
for (const b of blocchi) prova('blocco in posizione ' + b.posizione + ' = slot ' + catena[b.posizione], b.slot === catena[b.posizione], 'slot ' + b.slot);
const cab = blocchi.find(b => b.slot === 3);
prova('cabinet: Volume 30, Low Cut 80, High Cut 20001', cab && cab.valori[1] === 30 && cab.valori[5] === 80 && cab.valori[6] === 20001,
  cab && cab.valori.join(' '));
for (const b of blocchi) prova('modello del blocco ' + b.posizione + ' nel catalogo', !!C.modelli[b.uid], '0x' + b.uid.toString(16));

// 5. Il Petrus Crunch di «Prova 1» (registro-amp): sei manopole a 50 e tre interruttori a 1.
const amp = messaggiDel('registro-amp.txt').filter(m => m.comando === 0x12 && m.tipo === P.TIPO.BLOCCO).map(m => P.leggiBlocco(m.corpo))[0];
prova('Petrus Crunch', amp && nomeDi(amp.uid) === 'Petrus Crunch' && amp.valori.slice(0, 9).join(',') === '50,50,50,50,50,50,1,1,1',
  amp && (nomeDi(amp.uid) + ' ' + amp.valori.join(',')));

// 6. Scrivere una manopola (registro-manopola, 4 novembre): il PC ha mandato il blocco AMP col primo
// valore a 20 (num 06), il Mini l'ha confermato e riletto uguale. Rifatto dal blocco riletto, torna
// byte per byte; e il corpo di un blocco non toccato è identico a quello letto.
const righeManopola = fs.readFileSync(path.join(TOOLS, 'registro-manopola.txt'), 'utf8').split(/\r?\n/);
const mandata = righeManopola.map(r => r.match(/-> 7772e5db\s+(80 80 f0 21 25 41 50 06 [0-9a-f ]+?)\s*(\(|$)/)).find(Boolean)[1];
const riletto = messaggiDel('registro-manopola.txt').filter(m => m.comando === 0x12 && m.tipo === P.TIPO.BLOCCO).map(m => P.leggiBlocco(m.corpo))[0];
prova('blocco riletto col primo valore a 20', riletto && riletto.valori[0] === 20);
const rifatta = P.scriviBlocco(6, riletto, 180).map(hex).join(' ');
prova('scrittura della manopola come pulze-ble', rifatta === mandata, rifatta + '\n    ' + mandata);
for (const b of blocchi) prova('corpo del blocco ' + b.posizione + ' rifatto uguale', hex(P.corpoBlocco(b)) === hex(b.corpo));
const cambiato = Object.assign({}, riletto, { valori: riletto.valori.slice() });
cambiato.valori[3] = 72.5;
prova('valore cambiato e riletto', P.leggiBlocco(P.corpoBlocco(cambiato)).valori[3] === 72.5);

// 7. On/off come l'app (cattura del 4 novembre, 197,671 s: num 39, posizione 1, spento).
const onoff = P.sysex(0x39, 2, 0x12, P.datiVeri(7, 2, [1, 0, 0, 0]))[0];
const app = P.accendiBlocco(0x39, 1, false, 180)[0];
prova('on/off come l\'app', hex(app) === hex([0x80, 0x80, 0xf0, ...onoff, 0x80, 0xf7]) &&
  hex(onoff).startsWith('21 25 41 50 39 00 02 12 0c 00 00 00 00 07 00 00 00 02 00 00 00 04'), hex(onoff));

// 8. Cambio di modello, testa e salvataggio, contro la cattura della Pulze Editor del 4 novembre
// (conversazione.txt: una riga per SysEx, «<tempo>s APP|MINI sysex <n> <byte>»).
const conversazione = fs.readFileSync(path.join(__dirname, '..', '..', 'captures', '2026-11-04-pulze-editor', 'conversazione.txt'), 'utf8')
  .split(/\r?\n/).map(r => r.match(/^\s*([\d.]+)s\s+(APP|MINI)\s+sysex\s+\d+\s+(.*)$/)).filter(Boolean)
  .map(m => ({ t: +m[1], chi: m[2], sx: m[3].trim().split(' ').map(h => parseInt(h, 16)) }));
const alTempo = (t, chi, fino) => {
  let trovato = null;
  const ric = P.Ricompositore(m => { trovato = m; });
  for (const r of conversazione) if (r.chi === chi && r.t >= t - 0.002 && r.t <= (fino || t) + 0.002) ric(r.sx);
  return trovato;
};
const sxDi = (t, chi) => hex(conversazione.find(r => r.chi === chi && Math.abs(r.t - t) < 0.005).sx);
const marshell = P.leggiBlocco(alTempo(223.956, 'MINI').corpo);
prova('blocco letto prima del cambio: Marshell 50', marshell && nomeDi(marshell.uid) === 'Marshell 50');
const petrus = Object.assign({}, marshell, { uid: 0x0700008a });
const sx0 = P.cambiaModello(0x3e, petrus, 0, 400).map(hex).join(' ');
prova('cambio di modello, byte 4 = 00, come l\'app', sx0 === '80 80 f0 ' + sxDi(230.536, 'APP') + ' 80 f7', sx0);
const sx2 = P.cambiaModello(0x3f, petrus, 2, 400).map(hex).join(' ');
prova('cambio di modello, byte 4 = 02, come l\'app', sx2 === '80 80 f0 ' + sxDi(231.494, 'APP') + ' 80 f7', sx2);
const dopo = P.leggiBlocco(alTempo(231.661, 'MINI').corpo);
prova('dopo il cambio il Mini ha i valori di fabbrica del Petrus Crunch',
  dopo && dopo.uid === 0x0700008a && dopo.valori.slice(0, 9).join(',') === '50,50,50,50,50,50,1,1,1', dopo && dopo.valori.join(','));

const testaApp = P.leggiTesta(alTempo(344.497, 'APP').corpo);
prova('testa mandata dall\'app: UK Plexi 50, volume 64', testaApp && testaApp.nome === 'UK Plexi 50' && testaApp.volume === 0x40);
testaApp.volume = 0x3a;
const sxT = P.scriviTesta(0x44, testaApp, 400).map(hex).join(' ');
prova('volume del tone come l\'app', sxT === '80 80 f0 ' + sxDi(344.543, 'APP') + ' 80 f7', sxT);

const salvataggio = alTempo(424.153, 'APP', 424.246);
const ordine = Array.from({ length: 14 }, (_, i) => i);
prova('salvataggio come l\'app (corpo)', salvataggio && hex(P.corpoSalva(0x20, 'Prova 1', ordine)) === hex(salvataggio.corpo),
  salvataggio && hex(salvataggio.corpo));
const pezziSalva = P.sysex(0x15, 2, 0x12, P.datiVeri(5, 2, P.corpoSalva(0x20, 'Prova 1', ordine))).map(hex);
prova('salvataggio come l\'app (due SysEx)', pezziSalva[0] === sxDi(424.153, 'APP') && pezziSalva[1] === sxDi(424.246, 'APP'));
const risposta = alTempo(424.342, 'MINI');
prova('risposta al salvataggio: 09/02', risposta && risposta.tipo === P.TIPO.SALVATO && risposta.gruppo === 2 &&
  risposta.corpo.join(' ') === '5 0 2 0 1 0 1 0', risposta && risposta.corpo.join(' '));

// 9. I nomi dei tone (cattura del 5 novembre: 4400 byte in pezzi da 185). In ognuno dei due collegamenti
// del log ne manca un pezzo diverso (ricerca-pulze-mini.md): si prendono i pezzi da tutti e due.
const pezziNomi = new Map();
for (const f of ['conversazione-1-interrotta.txt', 'conversazione.txt'])
  for (const r of fs.readFileSync(path.join(__dirname, '..', '..', 'captures', '2026-11-05-songlist', f), 'utf8').split(/\r?\n/)) {
    const m = r.match(/^\s*[\d.]+s\s+MINI\s+sysex\s+\d+\s+(.*)$/); if (!m) continue;
    const sx = m[1].trim().split(' ').map(h => parseInt(h, 16));
    if (sx[6] === 0 && sx[7] === 0x12 && (sx[8] | (sx[9] << 7)) === 4408) pezziNomi.set(sx[10] | (sx[11] << 7), sx);
  }
let nomi = null;
const ricNomi = P.Ricompositore(m => { if (m.comando === 0x12 && m.tipo === P.TIPO.NOMI) nomi = P.leggiNomi(m.corpo); });
for (const k of [...pezziNomi.keys()].sort((x, y) => x - y)) ricNomi(pezziNomi.get(k));
prova('nomi dei tone letti', nomi && nomi.nomi.length === 200, pezziNomi.size + ' pezzi');
prova('nomi: 0 Time After Clean, 1 Proggy Drive, 32 Prova 1',
  nomi && nomi.nomi[0] === 'Time After Clean' && nomi.nomi[1] === 'Proggy Drive' && nomi.nomi[32] === 'Prova 1',
  nomi && nomi.nomi.slice(0, 3).concat(nomi.nomi[32]).join(' / '));

// 10. Il salvataggio in un altro posto: variante 1 = byte 1, variante 2 = byte 2; senza posto, come prima.
prova('salva in un altro posto: byte 2 = destinazione', hex(P.corpoSalva(5, 'X', [], 32).slice(0, 4)) === '01 05 20 ff');
prova('salva sul posto', hex(P.corpoSalva(5, 'X', []).slice(0, 4)) === '01 05 05 ff');

// 11. Il salto a un tone (06/02) come l'app (cattura del 4 novembre, 94,2 s: num 10, lista intera, 32).
const salto = P.sysex(0x10, 2, 0x12, P.datiVeri(6, 2, P.corpoSalto(0xff, 0x20))).map(hex);
prova('salto a un tone come l\'app', salto[0] === sxDi(94.204, 'APP') && salto[1] === sxDi(94.309, 'APP'));
prova('salto: Songlist e posizione nei byte 0 e 1', hex(P.corpoSalto(0x0b, 1).slice(0, 3)) === '0b 01 02');

// 12. Le Songlist (cattura del 5 novembre, collegamento 5: 2840 byte).
const conv5 = fs.readFileSync(path.join(__dirname, '..', '..', 'captures', '2026-11-05-songlist', 'conversazione.txt'), 'utf8')
  .split(/\r?\n/).map(r => r.match(/^\s*([\d.]+)s\s+(APP|MINI)\s+sysex\s+\d+\s+(.*)$/)).filter(Boolean);
let sl = null;
const ricSl = P.Ricompositore(m => { if (m.comando === 0x12 && m.tipo === P.TIPO.SONGLIST && m.gruppo === 3) sl = P.leggiSonglist(m.corpo); });
for (const r of conv5) if (r[2] === 'MINI') ricSl(r[3].trim().split(' ').map(h => parseInt(h, 16)));
prova('Songlist lette', sl && sl.liste.length === 15, sl && sl.liste.length);
const prova1 = sl && sl.liste.find(l => l.nome === 'Songlist prova');
prova('«Songlist prova»: posizione 11, id 14, tone 110 112 115 124', prova1 && prova1.posizione === 11 && prova1.id === 14 &&
  prova1.toni.join(' ') === '110 112 115 124', prova1 && JSON.stringify(prova1));
prova('prima Songlist: Clean, primo tone 0', sl && sl.liste[0].nome === 'Clean' && sl.liste[0].toni[0] === 0);

// L'Auto CAB (cattura del 5 novembre sera, captures/2026-11-05-autocab): il Mini manda le impostazioni
// (7/1, 80 byte, byte 11 = 1); a 159,9 s l'app le rimanda coi primi 77 byte e il byte 11 a 0.
{
  const righe = fs.readFileSync(path.join(__dirname, '../../captures/2026-11-05-autocab/conversazione.txt'), 'utf8').split('\n');
  const sx = (chi, da, a) => righe.map(r => r.match(/^\s*([\d.]+)s\s+(APP|MINI)\s+sysex\s+\d+\s+(.*)$/))
    .filter(m => m && m[2] === chi && +m[1] >= da && +m[1] <= a).map(m => m[3].trim().split(' ').map(h => parseInt(h, 16)));
  let imp = null;
  const ric = P.Ricompositore(m => { if (m.comando === 0x12 && m.tipo === 7 && m.gruppo === 1) imp = P.leggiImpostazioni(m.corpo); });
  sx('MINI', 2.3, 2.5).forEach(ric);
  prova('impostazioni lette, Auto CAB acceso', imp && imp.autoCab === true && imp.corpo.length === 80, imp && imp.corpo.length);
  const app = sx('APP', 159.8, 160.0).filter(s => s[7] === 0x12);
  const nostri = P.sysex(0x2f, 1, 0x12, P.datiVeri(7, 1, (() => { const c = imp.corpo.slice(0, 77); c[11] = 0; return c; })()));
  prova('Auto CAB spento come l\'app (byte per byte)', JSON.stringify(nostri) === JSON.stringify(app), app.length + ' pezzi');
  const pacchetti = P.scriviImpostazioni(0x2f, { corpo: imp.corpo, autoCab: false }, 180);
  prova('scriviImpostazioni fa gli stessi SysEx', pacchetti.flat().filter(x => x < 0x80).join() === nostri.flat().join());
}

// Sound Clone (2/5) e IR utente (2/4), stessa cattura (4,7 e 5,2 s): la richiesta dell'app e le liste.
{
  const righe = fs.readFileSync(path.join(__dirname, '../../captures/2026-11-05-autocab/conversazione.txt'), 'utf8').split('\n');
  const sx = (chi, da, a) => righe.map(r => r.match(/^\s*([\d.]+)s\s+(APP|MINI)\s+sysex\s+\d+\s+(.*)$/))
    .filter(m => m && m[2] === chi && +m[1] >= da && +m[1] <= a).map(m => m[3].trim().split(' ').map(h => parseInt(h, 16)));
  const chiede = (da, a) => sx('APP', da, a).find(s => s[7] === 0x11);
  const app5 = chiede(4.74, 4.75), app4 = chiede(5.24, 5.25);
  prova('richiesta dei Sound Clone come l\'app', hex(P.sysex(0x1b, 5, 0x11, P.datiVeri(2, 5, []))[0]) === hex(app5), hex(app5));
  prova('richiesta degli IR utente come l\'app', hex(P.sysex(0x1c, 4, 0x11, P.datiVeri(2, 4, []))[0]) === hex(app4), hex(app4));
  const liste = {};
  const ric = P.Ricompositore(m => { if (m.comando === 0x12 && m.tipo === 2 && m.gruppo !== 0) liste[m.gruppo] = P.leggiListaUtente(m.corpo); });
  sx('MINI', 4.8, 5.5).forEach(ric);
  const cl = liste[5] || [], ir = liste[4] || [];
  prova('10 Sound Clone, il primo «Mesa Nam»', cl.length === 10 && cl[0].nome === 'Mesa Nam' && cl[0].uid === 0x0f000000 && !cl[0].vuoto,
    JSON.stringify(cl[0]));
  prova('Sound Clone 10', cl[9] && cl[9].nome === 'Sound Clone 10' && cl[9].uid === 0x0f000009 && cl[9].vuoto);
  prova('20 IR utente, UID 0x0A10000n', ir.length === 20 && ir.every((v, i) => v.uid === (0x0a100000 + i) && v.nome === 'User IR ' + (i + 1)));
  prova('gli UID delle liste sono nel catalogo', cl.concat(ir).every(v => C.modelli[v.uid]));
}

// La rinomina (cattura del 6 novembre, captures/2026-11-06-rinomina): Sound Clone 2 «Rect red» a 29,4 s e
// User IR 1 «Prova ir 2» a 47,8 s; i SysEx dell'app uguali ai nostri.
{
  const righe = fs.readFileSync(path.join(__dirname, '../../captures/2026-11-06-rinomina/conv-1.txt'), 'utf8').split('\n');
  const sxA = t => righe.map(r => r.match(/^\s*([\d.]+)s\s+APP\s+sysex\s+\d+\s+(.*)$/))
    .find(m => m && Math.abs(+m[1] - t) < 0.01)[2].trim().split(' ').map(h => parseInt(h, 16));
  const app5 = sxA(29.4), app4 = sxA(47.834);
  const nostro5 = P.sysex(app5[4], 5, 0x12, P.datiVeri(1, 5, P.corpoRinomina(1, 'Rect red')))[0];
  const nostro4 = P.sysex(app4[4], 4, 0x12, P.datiVeri(1, 4, P.corpoRinomina(0, 'Prova ir 2')))[0];
  prova('rinomina del Sound Clone come l\'app', hex(nostro5) === hex(app5), hex(app5));
  prova('rinomina dell\'IR come l\'app', hex(nostro4) === hex(app4), hex(app4));
  prova('nome tagliato a 15 caratteri', P.corpoRinomina(0, 'MES DRECF RD Gain2')[22] === 0x61 && P.corpoRinomina(0, 'MES DRECF RD Gain2')[23] === 0);
}

// Le impostazioni generali (cattura del 6 novembre, captures/2026-11-06-impostazioni/conv-last.txt): dal
// corpo che il Mini ha mandato collegandosi, cambiando una voce, si rifà il corpo che l'app ha scritto.
{
  const righe = fs.readFileSync(path.join(__dirname, '../../captures/2026-11-06-impostazioni/conv-last.txt'), 'utf8').split('\n');
  const msg = [];
  let t = 0, chi = '';
  const ric = P.Ricompositore(m => { if (m.corpo && m.comando === 0x12) msg.push({ t, chi, tipo: m.tipo, gruppo: m.gruppo, c: m.corpo, sx: null }); });
  for (const r of righe) {
    const m = r.match(/^\s*([\d.]+)s\s+(APP|MINI)\s+sysex\s+\d+\s+(.*)$/); if (!m) continue;
    t = +m[1]; chi = m[2];
    ric(m[3].trim().split(' ').map(h => parseInt(h, 16)));
  }
  const delMini = tipo => msg.find(m => m.chi === 'MINI' && m.tipo === tipo && m.gruppo === 1).c;
  const app = (tipo, da) => msg.find(m => m.chi === 'APP' && m.tipo === tipo && m.gruppo === 1 && m.t >= da);
  // lo stato appena prima (l'ultimo corpo visto, del Mini o dell'app): il Main Output era già cambiato
  const prima = (tipo, da) => msg.filter(m => m.tipo === tipo && m.gruppo === 1 && m.t < da).pop().c;
  const voce = n => P.VOCI_GENERALI.find(v => v.nome === n);
  const uguale = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const casi = [
    ['Input Gain', -1, 26.4], ['Theme Color', 1, 203.9], ['Auto Standby', 7, 210.7], ['Atmos Light Brightness', 50, 221],
    ['Output Meter Display', false, 190.6], ['Reference Pitch', 439, 177.3], ['Loopback', true, 128.4], ['Reamp Mode', true, 156.5],
  ];
  for (const [n, x, da] of casi) {
    const v = voce(n), a = app(v.tipo, da);
    const nostro = P.conGenerale(prima(v.tipo, da), v, x).slice(0, v.tipo === 7 ? 77 : undefined);
    prova(n + ' come l\'app', a && uguale(nostro, a.c), a && a.c.join(','));
  }
  prova('valori letti: Inst 66, Pitch 440, Rec Mode L Effect, Theme Blu, Standby 5 min',
    P.valoreGenerale(delMini(1), voce('Inst Volume')) === 66 && P.valoreGenerale(delMini(2), voce('Reference Pitch')) === 440 &&
    voce('Rec Mode (L)').scelte[P.valoreGenerale(delMini(3), voce('Rec Mode (L)'))] === 'Effect' &&
    voce('Theme Color').scelte[P.valoreGenerale(delMini(7), voce('Theme Color'))] === 'Blu' &&
    voce('Auto Standby').scelte[P.valoreGenerale(delMini(7), voce('Auto Standby'))] === '5 min');
  prova('Rec Level −13 dB letto con segno', P.valoreGenerale(app(3, 114.09).c, voce('Rec Level')) === -13);
  const eq = P.leggiEq(delMini(4));
  prova('Global EQ letto: spento, banda 1 a 100 Hz, Q 0,71', eq && !eq.acceso && eq.v[2] === 100 && Math.abs(eq.v[3] - 0.71) < 1e-6, eq && eq.v.slice(0, 5).join(','));
  prova('EQ acceso come l\'app', uguale(P.corpoEq(true, null), app(5, 248.5).c));
  prova('EQ banda 1 Freq 102 come l\'app', uguale(P.corpoEq(true, 2, 102), app(5, 280.15).c), app(5, 280.15).c.join(','));
  const sxApp = righe.map(r => r.match(/^\s*([\d.]+)s\s+APP\s+sysex\s+\d+\s+(.*)$/)).find(m => m && +m[1] > 203.8 && +m[1] < 203.93 && m[2].trim().split(' ').length > 100);   // il primo pezzo
  if (sxApp) {
    const a = sxApp[2].trim().split(' ').map(h => parseInt(h, 16));
    const nostri = P.scriviGenerale(a[4], 7, P.conGenerale(prima(7, 203.9), voce('Theme Color'), 1), 180).flat().filter(x => x < 0x80);
    prova('scriviGenerale (Theme Color) fa il SysEx dell\'app', nostri.slice(0, a.length).join() === a.join());
  } else prova('SysEx del Theme Color trovato', false);
}

// Songlist e tone (stessa cattura, 366-545 s): i corpi dell'app rifatti con corpoOperazione.
{
  const righe = fs.readFileSync(path.join(__dirname, '../../captures/2026-11-06-impostazioni/conv-last.txt'), 'utf8').split('\n');
  const msg = [];
  let t = 0;
  const ric = P.Ricompositore(m => { if (m.corpo && m.comando === 0x12 && m.gruppo === 2) msg.push({ t, tipo: m.tipo, c: m.corpo }); });
  for (const r of righe) {
    const m = r.match(/^\s*([\d.]+)s\s+APP\s+sysex\s+\d+\s+(.*)$/); if (!m) continue;
    t = +m[1];
    ric(m[2].trim().split(' ').map(h => parseInt(h, 16)));
  }
  const a = (tipo, da) => (msg.find(m => m.tipo === tipo && m.t >= da) || {}).c;
  const base = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 11, 12, 13];
  const uguale = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const casi = [
    ['crea Songlist', 366.8, P.OP.CREA_LISTA, { lista: 15, nomeLista: 'Prova sl', ordine: base.concat(15) }],
    ['aggiungi un tone', 383.6, P.OP.AGGIUNGI, { tone: 3, lista: 15, ordine: base.concat(15) }],
    ['rinomina Songlist', 471.6, P.OP.RINOMINA_LISTA, { lista: 15, nomeLista: 'Prova sl 2', ordine: base.concat(15) }],
    ['cancella Songlist', 479.6, P.OP.CANCELLA_LISTA, { lista: 13, ordine: base }],
    ['rinomina tone', 536.8, P.OP.RINOMINA_TONE, { tone: 133, nomeTone: 'Prova nome', ordine: base }],
  ];
  for (const [nome, da, op, opz] of casi) {
    const app = a(5, da), nostro = P.corpoOperazione(op, opz);
    prova(nome + ' come l\'app', app && uguale(nostro, app), app && app.slice(0, 40).join(','));
  }
  prova('cancella tone come l\'app', uguale(P.corpoCancellaTone([133]), a(8, 544)));
  {
    // la lista compatta del Mini (diagnosi del 13 novembre): voce k → posto ordine[k]
    const c = new Array(4400).fill(0);
    for (let i = 0; i < 200; i++) c[i] = 0xff;
    [[3, 'Acoustic Sim 1'], [131, 'Proggy Drive'], [138, 'Monk VintageHot'], [135, 'EVH Eruption']].forEach(([p, n], k) => {
      c[k] = p; for (let j = 0; j < n.length; j++) c[400 + 20 * k + j] = n.charCodeAt(j);
    });
    const l = P.leggiNomi(c);
    prova('nomi per posto vero', l.nomi[3] === 'Acoustic Sim 1' && l.nomi[138] === 'Monk VintageHot' && l.nomi[135] === 'EVH Eruption');
    prova('posti fuori dalla lista vuoti', l.nomi[0] === '' && l.nomi[1] === '' && l.nomi[136] === '');
  }
}

// Backup e settaggi (stessa cattura): il tone 0/0 del Mini diventa il .prst uguale a quello dell'app
// («Alchemy Bass», posto 89, in conversazione.txt); il 0/1 diventa il .glb esportato dall'app e il .glb
// importato torna i 288 byte che l'app ha mandato (con la batteria dal 6/1, come lei).
{
  const X = require('../src/pulze-prst.js');
  const cart = path.join(__dirname, '../../captures/2026-11-06-impostazioni');
  const leggiConv = f => {
    const out = [];
    let chi = '';
    const ric = P.Ricompositore(m => { if (m.corpo && m.tipo === 0 && m.gruppo <= 1) out.push({ chi, m }); });
    for (const r of fs.readFileSync(path.join(cart, f), 'utf8').split('\n')) {
      const m = r.match(/^\s*[\d.]+s\s+(APP|MINI)\s+sysex\s+\d+\s+(.*)$/); if (!m) continue;
      chi = m[1];
      ric(m[2].trim().split(' ').map(h => parseInt(h, 16)));
    }
    return out;
  };
  const dec = s => Buffer.from(s.trim(), 'base64').toString('utf8');
  const tutti = leggiConv('conversazione.txt');
  const toni = tutti.filter(x => x.chi === 'MINI' && x.m.comando === 0x12 && x.m.corpo.length === 532).map(x => x.m.corpo);
  prova('il backup legge 84 tone', toni.length === 84, toni.length);
  const richieste = tutti.filter(x => x.chi === 'APP' && x.m.comando === 0x11 && x.m.gruppo === 0 && x.m.corpo.length === 12);
  prova('richiesta del tone intero come l\'app', richieste.length && richieste.every(x =>
    JSON.stringify(x.m.corpo) === JSON.stringify(P.corpoChiediTone(x.m.corpo[8] | (x.m.corpo[9] << 8)))), richieste.length);
  const ab = toni.find(c => c[8] === 88);
  const { tone, opz } = X.daMini(ab);
  prova('tone del Mini → .prst uguale all\'app', dec(X.scrivi(tone, Object.assign({ versione: '2.1.3', autore: 'Mazz' }, opz))) ===
    dec(fs.readFileSync(path.join(cart, 'Alchemy Bass.prst'), 'utf8')));
  prova('ogni tone del backup si rilegge', toni.every(c => {
    const d = X.daMini(c);
    const r = X.aTone(X.scrivi(d.tone, d.opz));
    return r.nome === d.tone.nome && r.catena.join() === d.tone.catena.join() && r.volume === d.tone.volume;
  }));

  const ultimi = leggiConv('conv-last.txt');
  const g = (chi, cmd) => ultimi.find(x => x.chi === chi && x.m.comando === cmd && x.m.gruppo === 1 && x.m.corpo.length === 288).m.corpo;
  const glb = fs.readFileSync(path.join(cart, 'Global2026-11-06 13-54-02.glb'), 'utf8');
  prova('0/1 del Mini → .glb uguale all\'app', dec(X.glbDaMini(g('MINI', 0x12), { autore: 'Mazz' })) === dec(glb));
  prova('.glb importato = i 288 byte dell\'app', JSON.stringify(X.glbAlMini(glb, g('MINI', 0x12), [10, 0, 100, 0, 0, 50, 1, 0])) ===
    JSON.stringify(g('APP', 0x12)));
  let errore = '';
  try { X.leggiGlb(fs.readFileSync(path.join(cart, 'Alchemy Bass.prst'), 'utf8')); } catch (e) { errore = e.message; }
  prova('un .prst non passa per .glb', /fileType prst/.test(errore), errore);
  const z = Buffer.from(X.zip([{ nome: 'a.prst', testo: 'ciao' }]));
  prova('zip: firma e crc', z.readUInt32LE(0) === 0x04034b50 && z.readUInt32LE(14) === 0xee3a5171 && z.readUInt32LE(z.length - 22) === 0x06054b50);
}

// Sound Mode (cattura del 6 novembre sera, captures/2026-11-06-soundmode): l'app scrive il 7/1 col byte 13
// a 2, 4 … 20 (Enhanced … Xtra Bass) e poi 0 (Standard); ogni scrittura = la lettura con la voce cambiata.
{
  const righe = fs.readFileSync(path.join(__dirname, '../../captures/2026-11-06-soundmode/conversazione.txt'), 'utf8').split('\n');
  let letto = null;
  const scritti = [];
  const ric = P.Ricompositore(m => {
    if (!m.corpo || m.comando !== 0x12 || m.tipo !== 7 || m.gruppo !== 1) return;
    if (m.corpo.length === 80) letto = m.corpo; else scritti.push(m.corpo);
  });
  for (const r of righe) {
    const m = r.match(/^\s*[\d.]+s\s+(APP|MINI)\s+sysex\s+\d+\s+(.*)$/); if (!m) continue;
    ric(m[2].trim().split(' ').map(h => parseInt(h, 16)));
  }
  const v = P.VOCI_GENERALI.find(x => x.nome === 'Sound Mode');
  const attesi = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 0];
  prova('Sound Mode: 11 scritture', scritti.length === 11, scritti.length);
  prova('Sound Mode come l\'app', scritti.every((c, i) => JSON.stringify(c) === JSON.stringify(P.conGenerale(letto, v, attesi[i]).slice(0, 77))));
  prova('Sound Mode: 11 nomi', Object.keys(v.scelte).length === 11 && v.scelte[20] === 'Xtra Bass' && v.scelte[0] === 'Standard');
}

// La drum (6/1): nel registro del CC 61 il Mini dice ritmo 0, 120 bpm, volume 50, sync, prima play poi stop.
{
  const drum = messaggiDel('registro-cc.txt').filter(m => m.comando === 0x12 && m.tipo === 6 && m.gruppo === 1)
    .map(m => P.leggiDrum(m.corpo));
  prova('drum: messaggi 6/1 nel registro', drum.length >= 2, drum.length);
  const d = drum[0] || {};
  prova('drum: ritmo, bpm, volume, sync', d.ritmo === 0 && d.bpm === 120 && d.volume === 50 && d.sync === true, JSON.stringify(d));
  prova('drum: play e stop', drum.some(x => x.suona) && drum.some(x => !x.suona));
  prova('drum: CC del tempo', hex(P.cc(P.CC.DRUM_TEMPO_MSB, 200 >> 7)) === '80 80 b0 3e 01' && P.CC.DRUM_RITMO === 67);
}

console.log(ok + ' prove passate, ' + ko + ' fallite');
process.exit(ko ? 1 : 0);
