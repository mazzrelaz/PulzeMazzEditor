// pulze-prst.js - I file .prst della Pulze Editor (export e import dei preset), senza Bluetooth.
// Il formato da Reniori (pulze-tone-generator, MIT; README «The real .prst format» e writer.py):
// base64 di un JSON di testa seguito subito da un JSON di corpo.
//   testa: {"presetVersion":"2.0.1","fileType":"prst","deviceType":"AP-10","presetLenght":"<lunghezza
//           del corpo>","author":""}   (sì, «Lenght»: è dell'app)
//   corpo: magic 23205, crc16 65535 (non usato), ID, newType, name (codificato come urllib.quote),
//          volume, bpm, algoRunEn (bit i = slot i), algoSlot (la catena: lo slot in ogni posizione),
//          algoUID (per slot), algoParaVal (7 × 15 valori, slot dopo slot), quickKnobModule/Param,
//          size 536, version 1, reserve (20 zeri).
// È la stessa forma dei dati del Mini: catena, UID, accesi e i 15 valori di ogni blocco. I numeri sono
// scritti come li scrive Python (20.0, 61.79999923706055): rifatti, i file di Reniori tornano uguali.
(function (g) {
  const SLOT = 7, VALORI = 15;
  const RAPIDE_MODULO = [5, 6, 255, 255, 255, 255, 255, 255, 255, 255];
  const RAPIDE_PARAM = [0, 0, 255, 255, 255, 255, 255, 255, 255, 255];

  // ---------------------------------------------------------------- base64 e UTF-8 (anche senza Buffer)

  const daBase64 = s => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8')
    : new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))));
  const aBase64 = s => {
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
    let bin = '';
    for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
    return btoa(bin);
  };

  /** urllib.parse.quote di Python: tutto codificato tranne lettere, cifre, _ . - ~ e /. */
  function quote(s) {
    let fuori = '';
    for (const b of new TextEncoder().encode(s)) {
      const c = String.fromCharCode(b);
      fuori += /[A-Za-z0-9_.\-~/]/.test(c) ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    return fuori;
  }
  function unquote(s) {
    try { return decodeURIComponent(String(s)); } catch (e) { return String(s); }
  }

  /** Un numero come lo scrive json.dumps di Python per un float: 20.0, 61.79999923706055, 1e-05. */
  function numeroPy(v) {
    if (Number.isInteger(v) && Math.abs(v) < 1e16) return v.toFixed(1);
    return String(v).replace(/e([+-])(\d)$/, 'e$10$2').replace('e+', 'e+');
  }

  // ---------------------------------------------------------------- lettura

  /** Il testo di un .prst → { testa, corpo } (gli oggetti JSON). Errore se non è un .prst. */
  function leggi(testo) {
    const t = daBase64(String(testo).trim());
    let prof = 0, fine = -1;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '{') prof++;
      else if (t[i] === '}' && --prof === 0) { fine = i; break; }
    }
    if (fine < 0) throw new Error('non è un file .prst');
    const testa = JSON.parse(t.slice(0, fine + 1));
    const corpo = JSON.parse(t.slice(fine + 1));
    if (testa.fileType !== 'prst') throw new Error('non è un preset (fileType ' + testa.fileType + ')');
    if (!Array.isArray(corpo.algoUID) || corpo.algoUID.length !== SLOT ||
        !Array.isArray(corpo.algoParaVal) || corpo.algoParaVal.length !== SLOT * VALORI ||
        !Array.isArray(corpo.algoSlot) || corpo.algoSlot.length !== SLOT)
      throw new Error('preset incompleto');
    return { testa, corpo };
  }

  /** Il preset nella forma della pagina: nome, volume, tempo, catena, e per slot uid, acceso, valori. */
  function aTone(testo) {
    const { testa, corpo } = leggi(testo);
    return {
      nome: unquote(corpo.name),
      volume: corpo.volume, tempo: corpo.bpm,
      catena: corpo.algoSlot.slice(),
      accesi: corpo.algoRunEn,
      blocchi: Array.from({ length: SLOT }, (_, s) => ({
        slot: s, uid: corpo.algoUID[s] >>> 0, acceso: !!((corpo.algoRunEn >> s) & 1),
        valori: corpo.algoParaVal.slice(s * VALORI, (s + 1) * VALORI),
      })),
      dispositivo: testa.deviceType,
      grezzo: { testa, corpo },
    };
  }

  // ---------------------------------------------------------------- scrittura

  /** Un tone nella forma della pagina → il testo del .prst. tone.blocchi: per slot { uid, acceso, valori }. */
  function scrivi(tone, opz) {
    opz = opz || {};
    const accesi = tone.blocchi.reduce((m, b, s) => m | ((b.acceso ? 1 : 0) << s), 0);
    const valori = [];
    for (const b of tone.blocchi) for (let i = 0; i < VALORI; i++) valori.push(+b.valori[i] || 0);   // dal Mini sono già float32
    const lista = a => '[' + a.join(',') + ']';
    const corpo = '{"magic":23205,"crc16":65535,"ID":' + (opz.id != null ? opz.id : 1) + ',"newType":0,' +
      '"name":' + JSON.stringify(quote(tone.nome)) + ',"volume":' + Math.round(tone.volume) +
      ',"bpm":' + Math.round(tone.tempo) + ',"algoRunEn":' + accesi + ',"algoSlot":' + lista(tone.catena) +
      ',"algoUID":' + lista(tone.blocchi.map(b => b.uid >>> 0)) + ',"algoParaVal":' + lista(valori.map(numeroPy)) +
      ',"quickKnobModule":' + lista(opz.rapideModulo || RAPIDE_MODULO) +
      ',"quickKnobParam":' + lista(opz.rapideParam || RAPIDE_PARAM) +
      ',"size":536,"version":1,"reserve":' + lista(new Array(20).fill(0)) + '}';
    const testa = '{"presetVersion":"' + (opz.versione || '2.0.1') + '","fileType":"prst","deviceType":"AP-10","presetLenght":"' +
      corpo.length + '","author":' + JSON.stringify(opz.autore || '') + '}';
    return aBase64(testa + corpo);
  }

  // ---------------------------------------------------------------- il tone come lo manda il Mini (0/0)
  // 532 byte, gli stessi campi del .prst in binario (cattura del 6 novembre, «Export All Tones»):
  //   0 magic a5 5a, 2 crc ff ff, 4 size 536, 6 version 1, 8 ID (u16), 10 bpm (u16), 12 nome (16),
  //   32 algoRunEn (u32), 36 algoSlot (7), 43 volume, 44 algoUID (7 × u32), 72 algoParaVal (105 float32),
  //   492 quickKnobModule (10), 502 quickKnobParam (10), 512 reserve (20).

  const vista = c => new DataView(Uint8Array.from(c).buffer);

  /** Il corpo 0/0 del Mini → { tone, opz } da dare a scrivi (il file è uguale a quello dell'app). */
  function daMini(c) {
    if (!c || c.length < 532 || c[0] !== 0xa5 || c[1] !== 0x5a) throw new Error('tone non valido');
    const d = vista(c);
    let nome = '';
    for (let i = 12; i < 28 && c[i]; i++) nome += String.fromCharCode(c[i]);
    const catena = c.slice(36, 43), accesi = d.getUint32(32, true);
    const tone = {
      nome, tempo: d.getUint16(10, true), volume: c[43], catena,
      blocchi: Array.from({ length: SLOT }, (_, s) => ({
        uid: d.getUint32(44 + 4 * s, true), acceso: !!((accesi >> s) & 1),
        valori: Array.from({ length: VALORI }, (_, k) => d.getFloat32(72 + 4 * (s * VALORI + k), true)),
      })),
    };
    return { tone, opz: { id: d.getUint16(8, true), rapideModulo: c.slice(492, 502), rapideParam: c.slice(502, 512) } };
  }

  // ---------------------------------------------------------------- i settaggi generali (.glb e 0/1)
  // Il 0/1 sono 288 byte con tutte le impostazioni; il .glb ha gli stessi campi in JSON, in quest'ordine.
  // [nome, byte, come]: come = u8, s8, u16, u32, f32 (con quanti), lista (quanti byte); null = non trovato
  // nei 288 (si scrive 0 nel file e non si tocca importando).
  const CAMPI_GLB = [
    ['inputGain', 0, 's8'], ['instVol', 1, 'u8'], ['auxlnVol', 2, 'u8'], ['blueToothVol', 3, 'u8'],
    ['tunerOutput', 4, 'u8'], ['tunerDisplay', 5, 'u8'], ['tunerPitch', 6, 'u16'],
    ['usbLoopBack', 8, 'u8'], ['usbRecLevel', 9, 's8'], ['usbMonitorLevel', 10, 's8'], ['usbRecAuxin', 11, 'u8'],
    ['usbRecDrum', 12, 'u8'], ['usbRecMode', 13, 'lista', 2], ['usbReampSwitch', 15, 'u8'], ['usbRecBT', 16, 'u8'],
    ['spacePlus', 17, 'u8'], ['dousing', null], ['globalEQEn', 19, 'u8'], ['globalEQ', 20, 'f32', 19],
    ['drumID', 96, 'u16'], ['drumBpm', 98, 'u16'], ['drumState', 100, 'u8'], ['drumVol', 101, 'u8'],
    ['drumSync', 102, 'u8'], ['drumReserve', 103, 'lista', 1], ['firmwareVersion', 104, 'u32'],
    ['cabFollowAMP', 108, 'u16'], ['verGlobal', 110, 'u16'], ['verPreset', 112, 'u16'], ['verSongList', 114, 'u16'],
    ['homeSet', null], ['personalizedLocation', 116, 'lista', 150], ['midiChannel', 266, 'lista', 8],
    ['midiInSource', 274, 'u8'], ['midiClkSource', 275, 'u8'], ['midiClkOut', 276, 'u8'], ['midiReserve', 277, 'lista', 3],
    ['ambientLightBrightness', 285, 'u8'], ['ambientLightStep', null], ['ambientLightRgb', null],
    ['reserve', 286, 'lista', 2],
  ];
  // Importando, l'app non rimette dal file batteria (la prende dal 6/1 del Mini), firmware e versioni.
  const NON_IMPORTARE = new Set(['drumID', 'drumBpm', 'drumState', 'drumVol', 'drumSync', 'drumReserve',
    'firmwareVersion', 'verGlobal', 'verPreset', 'verSongList', 'reserve']);

  function leggiCampo(d, c, [, b, come, n]) {
    if (b == null) return 0;
    if (come === 'u8') return c[b];
    if (come === 's8') return d.getInt8(b);
    if (come === 'u16') return d.getUint16(b, true);
    if (come === 'u32') return d.getUint32(b, true);
    if (come === 'f32') return Array.from({ length: n }, (_, k) => d.getFloat32(b + 4 * k, true));
    return c.slice(b, b + n);
  }

  /** I 288 byte del 0/1 → il testo del .glb, come lo scrive l'app (stessi campi, ordine e numeri). */
  function glbDaMini(c, opz) {
    opz = opz || {};
    if (!c || c.length < 288) throw new Error('settaggi incompleti');
    const d = vista(c);
    const parti = CAMPI_GLB.map(f => {
      const v = leggiCampo(d, c, f);
      const testo = f[2] === 'f32' ? '[' + v.map(numeroPy).join(',') + ']' : Array.isArray(v) ? '[' + v.join(',') + ']' : String(v);
      return JSON.stringify(f[0]) + ':' + testo;
    });
    const corpo = '{' + parti.join(',') + '}';
    const testa = '{"presetVersion":"2.1.3","fileType":"glb","deviceType":"AP-5","presetLenght":"' + corpo.length +
      '","author":' + JSON.stringify(opz.autore || '') + '}';
    return aBase64(testa + corpo);
  }

  /** Il testo di un .glb → { testa, corpo }. Errore se non è un file di settaggi. */
  function leggiGlb(testo) {
    let t;
    try { t = daBase64(String(testo).trim()); } catch (e) { throw new Error('non è un file .glb'); }
    const fine = t.indexOf('}');
    if (fine < 0) throw new Error('non è un file .glb');
    let testa, corpo;
    try { testa = JSON.parse(t.slice(0, fine + 1)); corpo = JSON.parse(t.slice(fine + 1)); }
    catch (e) { throw new Error('non è un file .glb'); }
    if (testa.fileType !== 'glb') throw new Error('non sono settaggi (fileType ' + testa.fileType + ')');
    if (!Array.isArray(corpo.globalEQ) || corpo.globalEQ.length !== 19) throw new Error('settaggi incompleti');
    return { testa, corpo };
  }

  /** Il .glb sopra i 288 byte che il Mini ha adesso (attuale); batteria = il 6/1 (8 byte) come fa l'app.
   *  Dà i 288 byte da rimandare col 0/1. I campi che mancano nel file restano come sono. */
  function glbAlMini(testo, attuale, batteria) {
    const { corpo } = leggiGlb(testo);
    if (!attuale || attuale.length < 288) throw new Error('settaggi del Mini incompleti');
    const c = Uint8Array.from(attuale.slice(0, 288));
    const d = new DataView(c.buffer);
    for (const [nome, b, come, n] of CAMPI_GLB) {
      if (b == null || NON_IMPORTARE.has(nome) || corpo[nome] == null) continue;
      const v = corpo[nome];
      if (come === 'u8') c[b] = v & 0xff;
      else if (come === 's8') d.setInt8(b, Math.max(-128, Math.min(127, Math.round(v))));
      else if (come === 'u16') d.setUint16(b, v & 0xffff, true);
      else if (come === 'u32') d.setUint32(b, v >>> 0, true);
      else if (come === 'f32') { for (let k = 0; k < n; k++) if (typeof v[k] === 'number') d.setFloat32(b + 4 * k, v[k], true); }
      else if (Array.isArray(v)) for (let k = 0; k < n && k < v.length; k++) c[b + k] = v[k] & 0xff;
    }
    if (batteria && batteria.length >= 8) for (let k = 0; k < 8; k++) c[96 + k] = batteria[k];
    return Array.from(c);
  }

  // ---------------------------------------------------------------- uno zip senza compressione

  let tabellaCrc = null;
  function crc32(b) {
    if (!tabellaCrc) {
      tabellaCrc = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let x = n; for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; tabellaCrc[n] = x; }
    }
    let x = 0xffffffff;
    for (let i = 0; i < b.length; i++) x = tabellaCrc[(x ^ b[i]) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  }

  /** file: [{ nome, testo }] → i byte di uno .zip (metodo «store», nomi UTF-8). */
  function zip(file, data) {
    data = data || new Date();
    const ora = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1);
    const giorno = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
    const pezzi = [], centrale = [];
    let pos = 0;
    const testata = (firma, n) => { const b = new Uint8Array(n); const d = new DataView(b.buffer); d.setUint32(0, firma, true); return [b, d]; };
    for (const f of file) {
      const nome = new TextEncoder().encode(f.nome), dati = new TextEncoder().encode(f.testo), crc = crc32(dati);
      const [l, dl] = testata(0x04034b50, 30);
      dl.setUint16(4, 20, true); dl.setUint16(6, 0x800, true); dl.setUint16(10, ora, true); dl.setUint16(12, giorno, true);
      dl.setUint32(14, crc, true); dl.setUint32(18, dati.length, true); dl.setUint32(22, dati.length, true);
      dl.setUint16(26, nome.length, true);
      const [z, dz] = testata(0x02014b50, 46);
      dz.setUint16(4, 20, true); dz.setUint16(6, 20, true); dz.setUint16(8, 0x800, true); dz.setUint16(12, ora, true);
      dz.setUint16(14, giorno, true); dz.setUint32(16, crc, true); dz.setUint32(20, dati.length, true);
      dz.setUint32(24, dati.length, true); dz.setUint16(28, nome.length, true); dz.setUint32(42, pos, true);
      pezzi.push(l, nome, dati); centrale.push(z, nome);
      pos += 30 + nome.length + dati.length;
    }
    const lungCentrale = centrale.reduce((s, b) => s + b.length, 0);
    const [e, de] = testata(0x06054b50, 22);
    de.setUint16(8, file.length, true); de.setUint16(10, file.length, true);
    de.setUint32(12, lungCentrale, true); de.setUint32(16, pos, true);
    const tutti = pezzi.concat(centrale, [e]);
    const fuori = new Uint8Array(tutti.reduce((s, b) => s + b.length, 0));
    let k = 0;
    for (const b of tutti) { fuori.set(b, k); k += b.length; }
    return fuori;
  }

  const X = { leggi, aTone, scrivi, quote, numeroPy, daMini, glbDaMini, leggiGlb, glbAlMini, zip, crc32, CAMPI_GLB };
  if (typeof module !== 'undefined' && module.exports) module.exports = X; else g.PulzePrst = X;
})(this);
