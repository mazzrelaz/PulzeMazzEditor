// ricetta.test.js - Prova pulze-ricetta.js: il catalogo per l'AI e la risposta trasformata in tone.
// Uso: node test/ricetta.test.js          (dalla cartella editor)
const C = require('../src/pulze-catalogo.js');
const R = require('../src/pulze-ricetta.js');
const X = require('../src/pulze-prst.js');

let ok = 0, ko = 0;
function prova(nome, cond, dettaglio) {
  if (cond) ok++; else { ko++; console.log('NO  ' + nome + (dettaglio ? ' — ' + dettaglio : '')); }
}
const uidDi = n => +Object.keys(C.modelli).find(u => C.modelli[u].n === n);

// il messaggio di sistema
const utente = new Map([[uidDi('Sound Clone 1'), { nome: 'Mesa Nam', vuoto: false }], [uidDi('Sound Clone 2'), { nome: 'Sound Clone 2', vuoto: true }]]);
const sis = R.istruzioni(C, { utente });
prova('il catalogo ha Marshell 45 con la sua origine', /Marshell 45 \| AMP \| Drive \| Based on Marshall JTM 45 amp/.test(sis));
prova('Sound Clone caricato col nome dell\'utente', /Sound Clone 1 \| AMP .*"Mesa Nam"/.test(sis));
prova('Sound Clone vuoto e IR vuoti fuori', !/Sound Clone 2 \|/.test(sis) && !/User IR 1 \|/.test(sis));
prova('Low Cut con Off e fabbrica 80', /Low Cut 20\.\.2000Hz\|Off =80/.test(sis));
prova('tempo con divisione', /or division/.test(sis));
console.log('  messaggio di sistema: ' + sis.length + ' caratteri');

// la ricetta d'esempio del README di Reniori, con un delay a tempo e un cabinet con Off
const ricetta = {
  name: 'Crunch Rhythm è lungo troppo',
  volume: 55, bpm: 100,
  chain: ['DYN', 'PRE', 'AMP', 'CAB', 'EQ/MOD', 'FX1', 'FX2'],
  blocks: {
    PRE: { model: 'TS Drv', on: false, knobs: { Gain: 30, Tone: 55, Volume: 70 } },
    AMP: { model: 'Marshell 45', on: true, knobs: { Volume: 55, Presence: 52, Output: 55, Bass: 50, Middle: 55, Treble: 54 } },
    DYN: { model: 'Gate 2', on: true, knobs: { Threshold: 37, Attack: 15, Release: 60 } },
    CAB: { model: 'Stone 2x12', on: true, knobs: { 'Low Cut': 100, 'High Cut': 'Off' } },
    'EQ/MOD': { model: 'Chorus', on: false, knobs: { Depth: 40, 'Rate/Div': '1/4' } },
    FX1: { model: 'Mesa Nam', on: true, knobs: {} },
    FX2: { model: 'Plate', on: true, knobs: { Mix: 14, 'Pre Dly': 25, Decay: 45, Frullatore: 3 } },
  },
  explanation: 'Prova.',
};
const t = R.aTone(JSON.stringify(ricetta), C, { utente });
prova('nome a 16 caratteri ASCII', t.nome === 'Crunch Rhythm e', JSON.stringify(t.nome));
prova('volume e tempo', t.volume === 55 && t.tempo === 100);
prova('catena', t.catena.join() === '2,0,1,3,4,5,6');
const amp = t.blocchi[1];
prova('AMP Marshell 45', amp.uid === uidDi('Marshell 45') && amp.acceso);
prova('AMP manopole', amp.valori.slice(0, 6).join() === '55,52,55,50,55,54', amp.valori.join());
prova('PRE spento', !t.blocchi[0].acceso && t.blocchi[0].uid === uidDi('TS Drv'));
const cab = t.blocchi[3];
prova('CAB Low Cut 100, High Cut Off = 20001', cab.valori[5] === 100 && cab.valori[6] === 20001, cab.valori.join());
prova('CAB volume di fabbrica 50', cab.valori[1] === 50);
const ch = t.blocchi[4];
prova('Chorus a 1/4: divisione 4 e Sync 1', ch.valori[1] === 4 && ch.valori[2] === 1, ch.valori.join());
prova('FX1 dal nome dell\'utente? no: Sound Clone non va in FX1', t.blocchi[5].tieni && t.avvisi.some(a => /FX1/.test(a)));
prova('manopola sconosciuta segnalata', t.avvisi.some(a => /Frullatore/.test(a)));
prova('accesi', t.accesi === ((1 << 1) | (1 << 2) | (1 << 3) | (1 << 6)), t.accesi);
prova('spiegazione', t.spiegazione === 'Prova.');

// il Sound Clone col nome dell'utente, nell'AMP
const t2 = R.aTone({ blocks: { AMP: { model: 'mesa nam', on: 'On', knobs: { Gain: 40 } } } }, C, { utente });
prova('Sound Clone dal nome dell\'utente', t2.blocchi[1].uid === uidDi('Sound Clone 1') && t2.blocchi[1].valori[0] === 40);
prova('slot mancanti tenuti', t2.blocchi.filter(b => b.tieni).length === 6);

// un numero fuori dai limiti e un selettore per etichetta
const tremolo = Object.values(C.modelli).find(m => m.k.some(k => k[2] === 'e'));
const ke = tremolo.k.find(k => k[2] === 'e');
const etichetta = Object.values(ke[3])[1];
prova('selettore per etichetta', R.codifica(C, ke, etichetta)[ke[1]] === +Object.keys(ke[3])[1]);
prova('numero stretto ai limiti', R.codifica(C, ['Mix', 0, 'c', 0, 100, '', 1], 150)[0] === 100);
prova('delay in ms: Sync 0', JSON.stringify(R.codifica(C, ['Time', 0, 'd', 20, 4000, 'ms', 4, 1], '350ms')) === '{"0":350,"4":0}');

// il tone creato si scrive come .prst e si rilegge uguale
const testo = X.scrivi(t, {});
const riletto = X.aTone(testo);
prova('.prst scritto e riletto', riletto.blocchi[1].uid === amp.uid && riletto.blocchi[3].valori[6] === 20001);

// il tone che suona come ricetta, e di nuovo in tone: uguale
const d = R.descriviTone(C, t);
const t3 = R.aTone(d, C, { utente });
prova('descrivi e rileggi: stessi modelli', t3.blocchi.every((b, s) => s === 5 || b.uid === t.blocchi[s].uid));
prova('descrivi e rileggi: stessi valori AMP e CAB', t3.blocchi[1].valori.join() === amp.valori.join() && t3.blocchi[3].valori.join() === cab.valori.join());

console.log(ok + ' prove passate, ' + ko + ' fallite');
process.exit(ko ? 1 : 0);
