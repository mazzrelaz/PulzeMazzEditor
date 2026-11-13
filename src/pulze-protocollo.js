// pulze-protocollo.js - Il protocollo della Pulze Editor col Pulze Mini, senza Bluetooth: costruisce i
// messaggi, ricompone quelli del Mini dai pacchetti BLE MIDI e li legge. Puro, si prova da Node.
// Tutto da ricerca-pulze-mini.md («Il protocollo della Pulze Editor») e dalle catture del 4 e del
// 5 novembre 2026.
//
// La busta: f0 21 25 41 50 <num> 00 <gruppo> <comando> <lung lo> <lung hi> <dati a nibble> f7
//   comando 11 = chiedi, 12 = dati, 14 = conferma. lung (7 + 7 bit) = byte veri senza lo 00 di testa.
//   Sopra gli 81 byte veri il messaggio si spezza: nei pezzi dopo il primo, al posto dello 00 di
//   testa (due nibble a 0) c'è lo scostamento (7 + 7 bit).
// I dati veri D: 00, tipo (16 bit LE), gruppo (16 bit LE), lunghezza del corpo (16 bit LE), 00 00, corpo.
//
// Gli slot (ordine interno, come in Reniori): 0 PRE, 1 AMP, 2 DYN, 3 CAB, 4 EQ/MOD, 5 FX1, 6 FX2.
// Un blocco si chiede per POSIZIONE nella catena; il Mini risponde con posizione, acceso e slot.
(function (g) {
  const SLOT = ['PRE', 'AMP', 'DYN', 'CAB', 'EQ/MOD', 'FX1', 'FX2'];
  const SERVIZIO_MIDI = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
  const CARATT_MIDI = '7772e5db-3868-4112-a1a9-f2669d106bf3';

  /** I dati veri: testa di nove byte e corpo. */
  function datiVeri(tipo, gruppo, corpo) {
    corpo = corpo || [];
    return [0, tipo & 0xff, tipo >> 8, gruppo & 0xff, gruppo >> 8,
      corpo.length & 0xff, corpo.length >> 8, 0, 0, ...corpo];
  }

  /** I SysEx (senza f0 e f7) di un messaggio: uno ogni 81 byte veri. */
  function sysex(num, gruppo, comando, D) {
    const lung = D.length - 1, fuori = [];
    for (let da = 0; da < lung; da += 81) {
      const sx = [0x21, 0x25, 0x41, 0x50, num & 0x7f, 0x00, gruppo & 0x7f, comando, lung & 0x7f, lung >> 7];
      if (da === 0) sx.push(D[0] >> 4, D[0] & 0x0f); else sx.push(da & 0x7f, da >> 7);
      const fine = Math.min(lung, da + 81);
      for (let i = da + 1; i <= fine; i++) sx.push(D[i] >> 4, D[i] & 0x0f);
      fuori.push(sx);
    }
    return fuori;
  }

  /** Un SysEx nei pacchetti BLE MIDI (intestazione, timestamp, f0 … timestamp, f7), tagliati a max
   *  byte: i pacchetti di continuazione hanno davanti la sola intestazione. */
  function pacchetti(sx, max) {
    max = max || 180;
    const fuori = [];
    let p = [0x80, 0x80, 0xf0];
    for (const b of sx) {
      if (p.length >= max) { fuori.push(p); p = [0x80]; }
      p.push(b);
    }
    if (p.length + 2 > max) { fuori.push(p); p = [0x80]; }
    p.push(0x80, 0xf7);
    fuori.push(p);
    return fuori;
  }

  /** Una richiesta (comando 11) pronta da scrivere: un array di pacchetti BLE MIDI. */
  function richiesta(num, tipo, gruppo, corpo, max) {
    return sysex(num, gruppo, 0x11, datiVeri(tipo, gruppo, corpo)).flatMap(s => pacchetti(s, max));
  }

  /** La conferma (14) ai dati del Mini, come la manda l'app: la lunghezza due volte. */
  function conferma(gruppo, lo, hi, max) {
    return pacchetti([0x21, 0x25, 0x41, 0x50, 0x00, 0x00, gruppo, 0x14, lo, hi, lo, hi], max);
  }

  /** Legge i pacchetti BLE MIDI in arrivo e ne tira fuori i SysEx interi (senza f0 e f7).
   *  Un byte col bit alto è un timestamp; quello dopo, se ha il bit alto, è uno stato. */
  function Lettore(alSysex) {
    let dentro = null;
    return function (p) {
      for (let i = 1; i < p.length; i++) {
        const x = p[i];
        if (!(x & 0x80)) { if (dentro) dentro.push(x); continue; }
        const s = p[i + 1];
        if (s === undefined) break;
        if (!(s & 0x80)) continue;                     // timestamp e poi dati (stato in corso)
        i++;
        if (s === 0xf0) dentro = [];
        else if (s === 0xf7) { if (dentro) alSysex(dentro); dentro = null; }
        else dentro = null;                            // un altro messaggio MIDI: non ci serve
      }
    };
  }

  /** Ricompone i messaggi Hotone dai SysEx: tiene i pezzi finché i byte veri sono tutti. */
  function Ricompositore(alMessaggio) {
    const inCorso = new Map();
    return function (sx) {
      if (sx.length < 12 || sx[0] !== 0x21 || sx[1] !== 0x25 || sx[2] !== 0x41 || sx[3] !== 0x50) return;
      const m = { num: sx[4], gruppo: sx[6], comando: sx[7], lo: sx[8], hi: sx[9], lung: sx[8] | (sx[9] << 7) };
      // 11 (chiedi) e 12 (dati) portano dati veri a nibble; la 14 ha solo la lunghezza ripetuta
      if (m.comando !== 0x12 && m.comando !== 0x11) { alMessaggio(m); return; }
      const chiave = m.comando + ':' + m.gruppo + ':' + m.lung;
      const da = sx[10] | (sx[11] << 7);
      let r = inCorso.get(chiave);
      if (da === 0 || !r) { r = { D: new Array(m.lung + 1).fill(0), avuti: 0 }; inCorso.set(chiave, r); }
      for (let i = 12, k = da + 1; i + 1 < sx.length && k <= m.lung; i += 2, k++) {
        r.D[k] = (sx[i] << 4) | sx[i + 1];
        r.avuti++;
      }
      if (r.avuti >= m.lung) {
        inCorso.delete(chiave);
        m.D = r.D;
        m.tipo = r.D[1] | (r.D[2] << 8);
        m.corpo = r.D.slice(9);
        alMessaggio(m);
      }
    };
  }

  const float = (b, o) => new DataView(Uint8Array.from(b.slice(o, o + 4)).buffer).getFloat32(0, true);
  const uid = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const testo = b => { let s = ''; for (const x of b) { if (!x) break; s += String.fromCharCode(x); } return s; };

  /** La testa del tone (tipo 1, gruppo 0; corpo da 60 byte), uguale ai byte 73-132 del tone intero. */
  function leggiTesta(c) {
    if (c.length < 60) return null;
    return {
      corpo: c.slice(0, 60),
      numero: c[0], volume: c[1], tempo: c[2],
      // byte 3: ignoto (0 in 117 tone, 1 in «DP Blues Lead»). NON è l'Auto CAB: quello sta nelle
      // impostazioni generali (7/1, byte 11). Resta com'è nel corpo rimandato.
      nome: testo(c.slice(4, 24)),
      accesi: c[24],                                  // bit i = slot i
      catena: c.slice(25, 32),                        // la catena: lo slot in ogni posizione
      uid: Array.from({ length: 7 }, (_, s) => uid(c, 32 + 4 * s)),   // per slot
    };
  }

  /** Il tone intero (tipo 6, gruppo 2): Songlist, posizione e la testa. */
  function leggiTone(c) {
    if (c.length < 124) return null;
    const t = leggiTesta(c.slice(64, 124));
    t.songlist = c[0]; t.posizione = c[1];
    return t;
  }

  /** Un blocco (tipo 2, gruppo 0; corpo da 72 byte): posizione, acceso, slot, modello, 15 valori. */
  function leggiBlocco(c) {
    if (c.length < 72) return null;
    const valori = [];
    for (let o = 12; o + 4 <= 72; o += 4) valori.push(float(c, o));
    return { posizione: c[0], acceso: !!c[1], slot: c[2], uid: uid(c, 8), valori, corpo: c.slice(0, 72) };
  }

  /** Il corpo da rimandare per un blocco: quello letto, con acceso e i 15 valori di adesso. I byte
   *  che non capiamo (3-7, 10) restano come li ha mandati il Mini. */
  function corpoBlocco(b, byte4) {
    const c = b.corpo.slice(0, 72);
    c[1] = b.acceso ? 1 : 0;
    if (byte4 != null) c[4] = byte4;                  // lo stato della scelta del modello (00 / 02)
    if (b.uid != null) for (let k = 0; k < 4; k++) c[8 + k] = (b.uid >>> (8 * k)) & 0xff;   // senza uid: quello letto
    const dv = new DataView(new ArrayBuffer(4));
    b.valori.forEach((v, i) => {
      dv.setFloat32(0, v, true);
      for (let k = 0; k < 4; k++) c[12 + 4 * i + k] = dv.getUint8(k);
    });
    return c;
  }

  /** La testa da rimandare col volume e il tempo nuovi (l'app la rimanda così mentre giri il volume,
   *  cattura del 4 novembre, 344-370 s); il resto com'era. */
  function corpoTesta(t) {
    const c = t.corpo.slice(0, 60);
    c[1] = t.volume & 0xff;
    c[2] = t.tempo & 0xff;
    // blocchi accesi, catena e modelli come sono ADESSO (dopo un cambio di modello la testa letta
    // all'inizio direbbe il modello vecchio)
    if (t.accesi != null) c[24] = t.accesi & 0xff;
    if (t.catena) t.catena.forEach((s, i) => { c[25 + i] = s; });
    if (t.uid) t.uid.forEach((u, s) => { for (let k = 0; k < 4; k++) c[32 + 4 * s + k] = (u >>> (8 * k)) & 0xff; });
    return c;
  }

  /** Il salvataggio (tipo 5, gruppo 2; corpo da 88 byte), com'era nella cattura del 4 novembre a 424 s,
   *  quando «Prova 1» ha preso il posto 32 (dov'era «UK Plexi 50»): 01, numero, numero, ff, 00×4, nome
   *  (20), «0» (una seconda stringa da 20), l'ordine delle Songlist (40, dalla risposta 00/03). Il Mini
   *  risponde con 09/02 (05 00 02 00 01 00 01 00). Cosa siano 01, ff e «0» non si sa: si rifanno uguali. */
  function corpoSalva(numero, nome, ordine, dest) {
    const c = new Array(88).fill(0);
    // byte 1 = il tone che suona, byte 2 = DOVE si salva (provato col Mini il 5 novembre: con 2 = 132
    // «Acoustic Sim 1» è finito nel posto 133, che era vuoto)
    c[0] = 1; c[1] = numero; c[2] = dest == null ? numero : dest; c[3] = 0xff;
    const n = String(nome).slice(0, 16);
    for (let i = 0; i < n.length; i++) c[8 + i] = n.charCodeAt(i) & 0x7f;
    c[28] = 0x30;
    for (let i = 0; i < 40; i++) c[48 + i] = ordine[i] == null ? 0xff : ordine[i];
    return c;
  }

  /** I nomi dei tone (tipo 3, gruppo 0; 4400 byte): 200 d'ordine, 200 ?, poi 200 nomi da 20 byte
   *  (il posto N = il tone N della lista intera). */
  function leggiNomi(c) {
    if (c.length < 4400) return null;
    // Il Mini tiene una LISTA compatta: alla voce k il posto ordine[k] (ff = fine) e il nome k. I posti fuori
    // dalla lista sono vuoti anche se dentro c'è ancora un tone (cancellare toglie dalla lista e basta).
    // Diagnosi del 13 novembre: ordine «3 4 5 … 129 131 132 136 138 138 138 133 135 135», nomi allineati
    // alle voci, e i tone letti uno per uno (0/0) coincidono col posto. Una voce può ripetere un posto.
    const ordine = c.slice(0, 200), elenco = Array.from({ length: 200 }, (_, i) => testo(c.slice(400 + 20 * i, 420 + 20 * i)));
    const nomi = new Array(200).fill('');
    for (let k = 0; k < 200; k++) if (ordine[k] < 200 && elenco[k]) nomi[ordine[k]] = elenco[k];
    return { ordine, altro: c.slice(200, 400), elenco, nomi };
  }

  /** Le Songlist (tipo 0, gruppo 3; 2840 byte): 40 byte d'ordine (gli id nell'ordine dell'app, ff =
   *  vuoto), poi 40 Songlist da 70 byte: nome (20) e 50 numeri di tone (ff = vuoto). Torna le Songlist
   *  nell'ordine dell'app: la posizione in quest'elenco è il byte 9 del salto (06/02). */
  function leggiSonglist(c) {
    if (c.length < 40 + 40 * 70) return null;
    const liste = [];
    for (let i = 0; i < 40; i++) {
      const id = c[i];
      if (id >= 40) continue;
      const r = c.slice(40 + 70 * id, 40 + 70 * (id + 1));
      liste.push({ posizione: liste.length, id, nome: testo(r.slice(0, 20)), toni: r.slice(20, 70).filter(x => x !== 0xff) });
    }
    return { ordine: c.slice(0, 40), liste };
  }

  // Il salto a un tone (06/02, 124 byte) è quello che l'app ha mandato nella cattura del 4 novembre a
  // 94,2 s (stesso modello del pedale, PZ_MODELLO_0602): byte 0 = Songlist (posizione nell'ordine
  // dell'app, ff = lista intera), byte 1 = posizione nella Songlist (o numero del tone con ff). Il
  // resto è il tone che suonava allora: il Mini lo ignora e risponde col tone scelto (verificato).
  const MODELLO_SALTO = 'ff2002000000f04100004842000048420000000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000113261004d637a20426c75657300000000000000000000006f02000103040506' +
    '00000003040000071b0000004700000a350000012100000b1200000c';
  function corpoSalto(lista, posizione) {
    const c = [];
    for (let i = 0; i < MODELLO_SALTO.length; i += 2) c.push(parseInt(MODELLO_SALTO.slice(i, i + 2), 16));
    c[0] = lista & 0xff;
    c[1] = posizione & 0xff;
    return c;
  }

  /** Dati (comando 12) pronti da scrivere: come quando l'app gira una manopola (tipo 2, gruppo 0, il
   *  blocco intero) o accende un blocco (tipo 7, gruppo 2). Il Mini risponde solo con la conferma 14. */
  function dati(num, tipo, gruppo, corpo, max) {
    return sysex(num, gruppo, 0x12, datiVeri(tipo, gruppo, corpo)).flatMap(s => pacchetti(s, max));
  }

  /** Le liste dei modelli dell'utente (cattura del 5 novembre sera, 4,7 e 5,2 s): tipo 2 gruppo 5 = i
   *  10 Sound Clone (240 byte), tipo 2 gruppo 4 = i 20 IR utente (480 byte). Voci da 24 byte: l'UID
   *  (4, LE: 0x0F00000n, 0x0A10000n), un byte (0 solo in «Mesa Nam», l'unico NAM caricato: forse
   *  1 = posto vuoto, da verificare), il nome (19). */
  function leggiListaUtente(c) {
    const voci = [];
    for (let o = 0; o + 24 <= c.length; o += 24) {
      voci.push({ uid: uid(c, o), vuoto: c[o + 4] === 1, nome: testo(c.slice(o + 5, o + 24)) });
    }
    return voci;
  }

  /** Rinomina un Sound Clone o un IR utente (cattura del 6 novembre, captures/2026-11-06-rinomina): dati
   *  tipo 1, gruppo 5 (Sound Clone) o 4 (IR), corpo da 24 byte: posto (0-9 / 0-19), 0, 1, 0, 0×4, nome
   *  (16 byte, al massimo 15 caratteri e lo 0). Il Mini risponde solo con la conferma 14; l'app non
   *  rilegge la lista. Il byte 2 vale 1 in tutte e quattro le rinomine viste: si rifà uguale. */
  function corpoRinomina(posto, nome) {
    const c = new Array(24).fill(0);
    c[0] = posto & 0xff; c[2] = 1;
    const n = String(nome).slice(0, 15);
    for (let i = 0; i < n.length; i++) c[8 + i] = n.charCodeAt(i) & 0x7f;
    return c;
  }

  // ---- Le impostazioni generali (cattura del 6 novembre, captures/2026-11-06-impostazioni, e il .glb
  // esportato dall'app coi nomi dei campi). Tutte nel gruppo 1: il Mini le manda a chi le chiede (11) e
  // l'app le riscrive (12) col corpo intero, cambiato solo il valore. Il 7/1 si riscrive coi primi 77 byte.
  // Limiti dal manuale del Pulze grande (firmware 1.0.6) e dalle schermate del Mini.
  const COLORI = ['Oro', 'Rosso', 'Arancio', 'Verde', 'Azzurro', 'Blu', 'Viola', 'Magenta', 'Rosa'];
  const SOUND_MODE = {};
  ['Standard', 'Enhanced', 'Hi-Res', 'Rock', 'Classical', 'Concert', 'Electronic', 'Female', 'Folk', 'Vocal', 'Xtra Bass']
    .forEach((n, i) => { SOUND_MODE[2 * i] = n; });
  const STANDBY = { 1: '10 s', 2: '30 s', 3: '1 min', 4: '5 min', 5: '10 min', 6: '20 min', 7: '30 min', 8: '40 min', 9: '50 min', 10: '60 min' };
  /** Le voci: tipo (gruppo 1), byte nel corpo, come si legge (u8, s8 con segno, u16 LE, si/no, scelta). */
  const VOCI_GENERALI = [
    { sezione: 'Audio', nome: 'Input Gain', tipo: 1, byte: 0, come: 's8', min: -20, max: 20, unita: 'dB' },
    { sezione: 'Audio', nome: 'Inst Volume', tipo: 1, byte: 1, come: 'u8', min: 0, max: 100 },
    { sezione: 'Audio', nome: 'BT Volume', tipo: 1, byte: 3, come: 'u8', min: 0, max: 100 },
    { sezione: 'Audio', nome: 'Main Output', tipo: 7, byte: 15, come: 'u8', min: 0, max: 100 },
    // Sound Mode (cattura del 6 novembre sera, captures/2026-11-06-soundmode): byte 13 del 7/1, valori pari
    { sezione: 'Audio', nome: 'Sound Mode', tipo: 7, byte: 13, come: 'scelta', scelte: SOUND_MODE },
    { sezione: 'USB Audio', nome: 'Rec Level', tipo: 3, byte: 1, come: 's8', min: -60, max: 20, unita: 'dB' },
    { sezione: 'USB Audio', nome: 'Monitor Level', tipo: 3, byte: 2, come: 's8', min: -60, max: 20, unita: 'dB' },
    { sezione: 'USB Audio', nome: 'Loopback', tipo: 3, byte: 0, come: 'si' },
    { sezione: 'USB Audio', nome: 'Rec Mode (L)', tipo: 3, byte: 5, come: 'scelta', scelte: { 0: 'Dry', 1: 'Effect' } },
    { sezione: 'USB Audio', nome: 'Rec Mode (R)', tipo: 3, byte: 6, come: 'scelta', scelte: { 0: 'Dry', 1: 'Effect' } },
    { sezione: 'USB Audio', nome: 'Record BT Audio', tipo: 3, byte: 8, come: 'si' },
    { sezione: 'USB Audio', nome: 'Record Drum', tipo: 3, byte: 4, come: 'si' },
    { sezione: 'USB Audio', nome: 'Reamp Mode', tipo: 3, byte: 7, come: 'si' },
    { sezione: 'Tuner', nome: 'Reference Pitch', tipo: 2, byte: 2, come: 'u16', min: 415, max: 475, unita: 'Hz' },
    { sezione: 'Display', nome: 'Output Meter Display', tipo: 10, byte: 6, come: 'si' },
    { sezione: 'Display', nome: 'Theme Color', tipo: 7, byte: 14, come: 'scelta', scelte: Object.assign({}, COLORI) },
    { sezione: 'Display', nome: 'Auto Standby', tipo: 7, byte: 76, come: 'scelta', scelte: STANDBY },
    // 30 = Smooth (letto), 50 = l'altra scelta provata dall'utente (Normal?); Off e Bright da verificare
    { sezione: 'Display', nome: 'Atmos Light Brightness', tipo: 10, byte: 5, come: 'scelta', scelte: { 0: 'Off', 30: 'Smooth', 50: 'Normal', 100: 'Bright' } },
  ];
  const TIPI_GENERALI = [1, 2, 3, 7, 10];

  function valoreGenerale(c, v) {
    if (!c || c.length <= v.byte + (v.come === 'u16' ? 1 : 0)) return null;
    const b = c[v.byte];
    if (v.come === 's8') return b > 127 ? b - 256 : b;
    if (v.come === 'u16') return b | (c[v.byte + 1] << 8);
    if (v.come === 'si') return !!b;
    return b;
  }
  /** Il corpo con la voce cambiata (una copia). */
  function conGenerale(c, v, x) {
    const n = c.slice();
    if (v.come === 'u16') { n[v.byte] = x & 0xff; n[v.byte + 1] = (x >> 8) & 0xff; }
    else if (v.come === 'si') n[v.byte] = x ? 1 : 0;
    else n[v.byte] = x & 0xff;
    return n;
  }

  // Il Global EQ: il 4/1 (80 byte) = acceso (byte 0) e dal byte 4 i 19 float del globalEQ del .glb:
  // [0] Low Cut (19 = Off), per banda b (0-3) [1+4b] 1,0 (?), [2+4b] Freq, [3+4b] Q, [4+4b] Gain,
  // [17] High Cut (20001 = Off), [18] volume d'uscita. Si scrive col 5/1 (8 byte): acceso, indice
  // (255 = nessuno: solo acceso/spento), 0, 0, il valore float32; dopo ogni gesto l'app rilegge il 4/1.
  function leggiEq(c) {
    if (!c || c.length < 80) return null;
    return { acceso: !!c[0], v: Array.from({ length: 19 }, (_, i) => float(c, 4 + 4 * i)) };
  }
  function corpoEq(acceso, indice, valore) {
    const c = [acceso ? 1 : 0, indice == null ? 255 : indice, 0, 0, 0, 0, 0, 0];
    if (indice != null) {
      const dv = new DataView(new ArrayBuffer(4));
      dv.setFloat32(0, valore, true);
      for (let k = 0; k < 4; k++) c[4 + k] = dv.getUint8(k);
    }
    return c;
  }

  // ---- Songlist e tone (cattura del 6 novembre, captures/2026-11-06-impostazioni, 366-545 s). Sono tutte
  // il 5/2 da 88 byte del salvataggio, con un altro byte 0: [0] operazione, [1] e [2] tone, [3] id della
  // Songlist (ff = nessuna), [8-27] nome del tone, [28-47] nome della Songlist (nelle due stringhe «0» quando
  // non servono), [48-87] l'ordine delle Songlist com'è DOPO l'operazione. Il Mini risponde solo con la 14.
  //   19 crea Songlist ([3] = l'id nuovo, in coda all'ordine)   4 aggiungi un tone ([2] = il tone)
  //   16 rinomina Songlist   17 cancella Songlist (l'ordine senza di lei; [3] = 13 nella cattura: forse la
  //   Songlist che l'app mostra dopo, cioè quella prima nell'ordine)   0 rinomina tone ([1] = [2] = il tone)
  const OP = { RINOMINA_TONE: 0, SALVA: 1, AGGIUNGI: 4, RINOMINA_LISTA: 16, CANCELLA_LISTA: 17, CREA_LISTA: 19 };
  function corpoOperazione(op, { tone = 0, lista = 0xff, nomeTone = '0', nomeLista = '0', ordine = [] }) {
    const c = new Array(88).fill(0);
    c[0] = op; c[1] = op === OP.RINOMINA_TONE ? tone : 0; c[2] = tone; c[3] = lista;
    const scrivi = (da, s, n) => { s = String(s).slice(0, n); for (let i = 0; i < s.length; i++) c[da + i] = s.charCodeAt(i) & 0x7f; };
    scrivi(8, nomeTone, 16);
    scrivi(28, nomeLista, 16);
    for (let i = 0; i < 40; i++) c[48 + i] = ordine[i] == null ? 0xff : ordine[i];
    return c;
  }
  /** Cancella dei tone (8/2, 204 byte): [1] = 13 nella cattura (rifatto uguale), [4…] i tone, ff in fondo.
   *  Il Mini risponde 09/02 (8 0 2 0 0 0 1 0) e il posto resta vuoto. */
  function corpoCancellaTone(toni) {
    const c = new Array(204).fill(0xff);
    c[0] = 0; c[1] = 13; c[2] = 0; c[3] = 0;
    toni.slice(0, 200).forEach((t, i) => { c[4 + i] = t & 0xff; });
    return c;
  }

  const P = {
    SLOT, SERVIZIO_MIDI, CARATT_MIDI, leggiListaUtente, corpoRinomina, OP, corpoOperazione, corpoCancellaTone,
    operazione: (num, op, opz, max) => dati(num, 5, 2, corpoOperazione(op, opz), max),
    cancellaTone: (num, toni, max) => dati(num, 8, 2, corpoCancellaTone(toni), max),
    VOCI_GENERALI, TIPI_GENERALI, valoreGenerale, conGenerale, leggiEq, corpoEq,
    scriviGenerale: (num, tipo, corpo, max) => dati(num, tipo, 1, tipo === 7 ? corpo.slice(0, 77) : corpo, max),
    scriviEq: (num, acceso, indice, valore, max) => dati(num, 5, 1, corpoEq(acceso, indice, valore), max),
    rinomina: (num, gruppo, posto, nome, max) => dati(num, 1, gruppo, corpoRinomina(posto, nome), max),
    LISTA_UTENTE: { CLONE: 5, IR: 4 },                // il gruppo; il tipo è 2
    // Backup (cattura del 6 novembre, «Export All Tones»): l'app chiede 0/0 con 12 byte, il numero del tone
    // al byte 8, e il Mini risponde col tone intero (532 byte, vedi PulzePrst.daMini); ai posti vuoti tace.
    corpoChiediTone: n => [0, 0, 0, 0, 0, 0, 0, 0, n & 0xff, (n >> 8) & 0xff, 0, 0],
    // Tutti i settaggi in un colpo (0/1, 288 byte): si chiedono con corpo vuoto e si rimandano interi.
    scriviSettaggi: (num, corpo, max) => dati(num, 0, 1, corpo, max),
    datiVeri, sysex, pacchetti, richiesta, conferma, Lettore, Ricompositore,
    leggiTesta, leggiTone, leggiBlocco, corpoBlocco, corpoTesta, corpoSalva, dati,
    scriviBlocco: (num, b, max) => dati(num, 2, 0, corpoBlocco(b), max),
    // Cambio di modello come l'app (cattura del 4 novembre, 230,5 e 231,5 s): il blocco col modello
    // nuovo e i valori vecchi, una volta col byte 4 a 00 e una a 02 (03 quando l'app apre la scelta); poi l'app lo rilegge e il Mini ha
    // già messo i valori di fabbrica del modello nuovo.
    cambiaModello: (num, b, byte4, max) => dati(num, 2, 0, corpoBlocco(b, byte4), max),
    scriviTesta: (num, t, max) => dati(num, 1, 0, corpoTesta(t), max),
    salva: (num, numero, nome, ordine, max, dest) => dati(num, 5, 2, corpoSalva(numero, nome, ordine, dest), max),
    chiediSonglist: (num, max) => richiesta(num, 0, 3, [], max),
    leggiNomi, leggiSonglist, corpoSalto,
    LISTA_INTERA: 0xff,
    salta: (num, lista, posizione, max) => dati(num, 6, 2, corpoSalto(lista, posizione), max),
    // on/off come l'app (cattura del 4 novembre, 197 s): corpo <posizione> <acceso> 00 00
    accendiBlocco: (num, posizione, acceso, max) => dati(num, 7, 2, [posizione, acceso ? 1 : 0, 0, 0], max),
    TIPO: { SONGLIST: 0, TESTA: 1, BLOCCO: 2, NOMI: 3, SALVA: 5, TONE: 6, SALVATO: 9 },
    // Un Control Change sul canale 1, come dal PC: 26 / 27 = tone precedente / successivo (127),
    // e nella Songlist scorrono la Songlist; il Mini risponde col tone intero.
    cc: (numero, valore) => [0x80, 0x80, 0xb0, numero & 0x7f, valore & 0x7f],
    // 45-51 = blocco on/off (127/0): il Mini risponde col blocco (02/00) e il suo stato. È la strada
    // del pedale, provata con la chitarra; il 07/02 dell'app dalla pagina non ha fatto niente.
    // Vanno per TIPO, non per posizione nella catena (registro del 5 novembre, catena spostata: il CC 49
    // ha acceso EQ/MOD in posizione 2, il 48 il CAB in posizione 6): 45 DYN, 46 PRE, 47 AMP, 48 CAB,
    // 49 EQ/MOD, 50 FX1, 51 FX2.
    CC: { TONE_PRIMA: 26, TONE_DOPO: 27, BLOCCO: 45,
      // La drum (scansione del 4 novembre): 61 play (127) / stop (0), 62 + 63 tempo (MSB poi LSB,
      // 40-300), 64 tap, 65 sync (127/0), 66 volume 0-100, 67 ritmo 0-99 (guardato sul Mini: va mentre
      // suona). Il Mini risponde col 6/1 (leggiDrum).
      DRUM_PLAY: 61, DRUM_TEMPO_MSB: 62, DRUM_TEMPO_LSB: 63, DRUM_TAP: 64, DRUM_SYNC: 65,
      DRUM_VOLUME: 66, DRUM_RITMO: 67 },
    // Lo stato della drum (tipo 6, gruppo 1, 8 byte; registri del 4 novembre e campi drum* del .glb):
    // 0-1 ritmo, 2-3 bpm (little endian), 4 suona, 5 volume, 6 sync, 7 riservato.
    chiediDrum: (num, max) => richiesta(num, 6, 1, [], max),
    leggiDrum: c => (c && c.length >= 7 ? { ritmo: c[0] | (c[1] << 8), bpm: c[2] | (c[3] << 8), suona: !!c[4],
      volume: c[5], sync: !!c[6] } : null),
    ccBlocco: slot => 45 + [2, 0, 1, 3, 4, 5, 6].indexOf(slot),
    chiediTesta: (num, max) => richiesta(num, 1, 0, [], max),
    chiediBlocco: (num, posizione, max) => richiesta(num, 2, 0, [posizione, 0, 0], max),
    // Le impostazioni generali del Mini (tipo 7, gruppo 1; il Mini ne manda 80 byte). Byte 11 = Auto CAB
    // (cattura del 5 novembre sera: all'inizio 1; a 160 s l'app scrive il 7/1 col byte 11 a 0, ed è
    // quando l'utente l'ha spento; prima, con 1, a ogni cambio di ampli il Mini aveva cambiato da solo il
    // cabinet: da Jazz 2x12 a Dreadnought 2, senza che l'app mandasse il CAB). Gli altri byte non si sa.
    chiediImpostazioni: (num, max) => richiesta(num, 7, 1, [], max),
    leggiImpostazioni: c => (c.length >= 77 ? { corpo: c.slice(), autoCab: !!c[11] } : null),
    // l'app rimanda i primi 77 byte, uguali a quelli letti tranne quello cambiato
    scriviImpostazioni: (num, imp, max) => {
      const c = imp.corpo.slice(0, 77);
      if (imp.autoCab != null) c[11] = imp.autoCab ? 1 : 0;
      return dati(num, 7, 1, c, max);
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = P; else g.Pulze = P;
})(this);
