// mini-finto.js - Un Pulze Mini finto per provare la pagina senza il Mini (index.html#finto): prende il
// posto di navigator.bluetooth e risponde come il Mini vero, coi dati di «To Rachael» (test/esempio.js).
// Fa: testa (1/0), blocchi (2/0) chiesti per posizione, conferme 14, scrittura di un blocco, CC 26/27
// (rimanda il tone) e CC 45-51 (on/off per tipo di blocco, come il Mini vero; risponde col blocco). Il 07/02 lo conferma e
// basta, come ha fatto il Mini vero dalla pagina il 5 novembre.
(function () {
  const P = window.Pulze;
  const parse = r => r.split(' ').map(h => parseInt(h, 16));

  window.installaMiniFinto = function () {
    let tone = null;
    const blocchi = [];                                  // per posizione: il corpo da 72 byte
    const lett = P.Lettore(P.Ricompositore(m => {
      if (m.comando !== 0x12) return;
      if (m.tipo === P.TIPO.TONE) tone = m.corpo.slice();
      if (m.tipo === P.TIPO.BLOCCO) blocchi[m.corpo[0]] = m.corpo.slice();
    }));
    for (const r of window.PulzeEsempio) lett(parse(r));
    const registro = window.miniFintoRegistro = [];
    window.miniFintoBlocchi = blocchi;
    // le impostazioni generali (7/1) come le ha mandate il Mini vero il 5 novembre, Auto CAB spento
    const impostazioni = window.miniFintoImpostazioni = [2, 1, 1, 1, 0, 1, 1, 1, 0, 255, 0, 0, 0, 0, 5, 88]
      .concat(new Array(60).fill(0), [4, 0, 0, 0]);
    // le impostazioni generali come le ha mandate il Mini vero il 6 novembre (cattura delle impostazioni)
    const eq = [0, 0, 0, 0];
    [19, 1, 100, 0.71, 0, 1, 500, 0.71, 0, 1, 2000, 0.71, 0, 1, 5000, 0.71, 0, 20001, 50].forEach(v => {
      const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, v, true);
      for (let k = 0; k < 4; k++) eq.push(dv.getUint8(k));
    });
    const generali = window.miniFintoGenerali = {
      1: [0, 66, 100, 99], 2: [0, 0, 184, 1], 3: [0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0],
      4: eq, 10: [0, 0, 0, 0, 0, 30, 1, 0], 6: [10, 0, 100, 0, 0, 50, 1, 0],
    };
    // tutti i settaggi (0/1, 288 byte) come li ha mandati il Mini vero il 6 novembre
    const settaggi = window.miniFintoSettaggi = Array.from(atob('ADVkZAAAuAEAAAABAQEBAAEABAEAAJhBAACAPwCA1EP2KFw/' +
      'AAAAAAAAgD8AAPpDj8I1PwAAAAAAAIA/AADIRI/CNT8AAAAAAACAPwBAnEWPwjU/AAAAAABCnEYAAEhCAAAAAAAAAAACAQEBAQABAAEAAQAAAAoA' +
      'KgAEAW4BAAIOASoABAFuAQMAEgIqAAQBbgH/AAAAAAAAAAAA/wAAAAAAAAAAAP8AAAAAAAAAAAD/AAAAAAAAAAAA/wAAAAAAAAAAAP8AAAAAAAAA' +
      'AAD/AAAAAAAAAAAA/wAAAAAAAAAAAP8AAAAAAAAAAAD/AAAAAAAAAAAA/wAAAAAAAAAAAP8AAAAAAAAAAAAAAAAAAAAAAAIEAAAAAAAAAAAAHgUk'),
    c => c.charCodeAt(0));
    /** Il tone intero (0/0, 532 byte) al posto n: nome dai nomi, blocchi da quelli del tone d'esempio. */
    // i tone salvati dalla pagina (posto -> 532 byte): da lì in poi il finto li ricorda come sono
    const salvati = window.miniFintoSalvati = {};
    /** Il tone che suona, coi suoi blocchi e la sua testa, come 0/0 al posto n. */
    const istantanea = (n, nome) => {
      const c = toneIntero(n, true);
      for (let k = 0; k < 16; k++) c[12 + k] = k < nome.length ? nome.charCodeAt(k) : 0;
      c[10] = tone[64 + 2]; c[11] = 0; c[43] = tone[64 + 1];
      c[32] = tone[64 + 24];
      for (let i = 0; i < 7; i++) c[36 + i] = tone[64 + 25 + i];
      return c;
    };
    const toneIntero = (n, nuovo) => {
      if (!nuovo && salvati[n]) { const c = salvati[n].slice(); c[8] = n & 0xff; c[9] = n >> 8; return c; }
      const c = new Array(532).fill(0);
      const nome = nomi[n] || '';
      [0xa5, 0x5a, 0xff, 0xff, 0x18, 0x02, 1, 0, n & 0xff, n >> 8, 120, 0].forEach((x, i) => { c[i] = x; });
      for (let k = 0; k < 16 && k < nome.length; k++) c[12 + k] = nome.charCodeAt(k);
      c[32] = 0x7f; c[43] = 50 + (n % 50);
      for (let s = 0; s < 7; s++) {
        c[36 + s] = s;
        const b = blocchi.find(x => x[2] === s);
        for (let k = 0; k < 4; k++) c[44 + 4 * s + k] = b[8 + k];
        for (let k = 0; k < 60; k++) c[72 + 60 * s + k] = b[12 + k];
      }
      [5, 6, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0].forEach((x, i) => { c[492 + i] = x; });
      return c;
    };
    const nomiUtente = window.miniFintoNomiUtente = {
      5: Array.from({ length: 10 }, (_, i) => (i === 0 ? 'Mesa Nam' : 'Sound Clone ' + (i + 1))),
      4: Array.from({ length: 20 }, (_, i) => 'User IR ' + (i + 1)),
    };
    const nomi = window.miniFintoNomi = Array.from({ length: 200 }, (_, i) => (i < 125 ? 'Tone ' + (i + 1) : ''));
    nomi[32] = 'Prova 1';
    nomi[tone[64]] = String.fromCharCode(...tone.slice(68, 88)).replace(/\0.*$/, '');
    // tre Songlist finte, mostrate nell'ordine 2, 0, 1: «Lista C» ha To Rachael (119) per secondo
    const songlist = new Array(40 + 40 * 70).fill(0xff);
    [2, 0, 1].forEach((id, i) => { songlist[i] = id; });
    ['Lista A', 'Lista B', 'Lista C'].forEach((n, id) => {
      const r = 40 + 70 * id;
      for (let k = 0; k < 20; k++) songlist[r + k] = k < n.length ? n.charCodeAt(k) : 0;
      [[1, 2, 3], [10, 20], [5, 119, 32]][id].forEach((t, k) => { songlist[r + 20 + k] = t; });
    });
    for (let id = 3; id < 40; id++) for (let k = 0; k < 20; k++) songlist[40 + 70 * id + k] = 0;

    let notifica = null;
    const manda = pacchetti => pacchetti.forEach((p, i) => setTimeout(() => {
      const dv = new DataView(Uint8Array.from(p).buffer);
      if (notifica) notifica({ target: { value: dv } });
    }, 20 + 10 * i));
    const rispondi = (tipo, gruppo, corpo) =>
      manda(P.sysex(0, gruppo, 0x12, P.datiVeri(tipo, gruppo, corpo)).flatMap(s => P.pacchetti(s, 180)));
    const conferma = (num, gruppo, lo, hi) =>
      manda(P.pacchetti([0x21, 0x25, 0x41, 0x50, num, 0, gruppo, 0x14, lo, hi, lo, hi], 180));
    const testa = () => tone.slice(64, 124);

    const arrivo = P.Lettore(P.Ricompositore(m => {
      if (m.comando === 0x14) return;                    // le conferme della pagina ai nostri dati
      conferma(m.num, m.gruppo, m.lo, m.hi);
      if (m.comando === 0x11) {
        registro.push('chiede ' + m.tipo + '/' + m.gruppo + ' ' + m.corpo.join(','));
        if (m.tipo === 1 && m.gruppo === 0) rispondi(1, 0, testa());
        if (m.tipo === 2 && m.gruppo === 0) rispondi(2, 0, blocchi[m.corpo[0]]);
        if (m.tipo === 3 && m.gruppo === 0) {            // i nomi: 200 d'ordine, 200 ?, 200 × 20
          // come il Mini vero: lista compatta, alla voce k il posto (byte k) e il nome; ff in fondo
          const c = new Array(4400).fill(0);
          for (let i = 0; i < 200; i++) c[i] = 0xff;
          let k = 0;
          nomi.forEach((n, i) => {
            if (!n) return;
            c[k] = i;
            for (let j = 0; j < n.length; j++) c[400 + 20 * k + j] = n.charCodeAt(j);
            k++;
          });
          rispondi(3, 0, c);
        }
        if (m.tipo === 0 && m.gruppo === 3) rispondi(0, 3, songlist);   // 40 d'ordine e 40 da 70 byte
        if (m.tipo === 7 && m.gruppo === 1) rispondi(7, 1, impostazioni);  // 80 byte, 11 = Auto CAB
        if (m.gruppo === 1 && generali[m.tipo]) rispondi(m.tipo, 1, generali[m.tipo]);
        if (m.tipo === 0 && m.gruppo === 1) rispondi(0, 1, settaggi);
        if (m.tipo === 0 && m.gruppo === 0 && m.corpo.length === 12) {   // il tone intero; ai vuoti tace
          const n = m.corpo[8] | (m.corpo[9] << 8);
          if (nomi[n]) setTimeout(() => rispondi(0, 0, toneIntero(n)), 30);
        }
        if (m.tipo === 2 && (m.gruppo === 5 || m.gruppo === 4)) {   // Sound Clone (10) e IR utente (20)
          const c = [];
          const n = m.gruppo === 5 ? 10 : 20;
          for (let i = 0; i < n; i++) {
            const nome = nomiUtente[m.gruppo][i];
            const u = (m.gruppo === 5 ? 0x0f000000 : 0x0a100000) + i;
            const v = [u & 0xff, (u >> 8) & 0xff, (u >> 16) & 0xff, u >>> 24, m.gruppo === 5 && i === 0 ? 0 : 1];
            if (nome !== (m.gruppo === 5 ? 'Sound Clone ' : 'User IR ') + (i + 1)) v[4] = 0;
            for (let k = 0; k < 19; k++) v.push(k < nome.length ? nome.charCodeAt(k) : 0);
            c.push(...v);
          }
          rispondi(2, m.gruppo, c);
        }
      } else if (m.comando === 0x12) {
        registro.push('scrive ' + m.tipo + '/' + m.gruppo + ' ' + m.corpo.slice(0, 5).join(','));
        if (m.tipo === 2 && m.gruppo === 0) {
          const c = m.corpo.slice(), b = blocchi[c[0]];
          const uid = a => a[8] | (a[9] << 8) | (a[10] << 16) | (a[11] << 24);
          if (uid(c) !== uid(b)) {                       // un modello nuovo: valori «di fabbrica»
            for (let i = 12; i < 72; i++) c[i] = 0;
            for (let k = 0; k < 4; k++) tone[64 + 32 + 4 * c[2] + k] = c[8 + k];
            // un ampli nuovo con l'Auto CAB acceso: il Mini cambia da solo il cabinet (nel finto:
            // sempre Match 2x12, 0x0A000010; quello vero ha il suo abbinamento)
            if (c[2] === 1 && impostazioni[11]) {
              const cab = blocchi.find(x => x[2] === 3);
              const nuovo = [0x10, 0x00, 0x00, 0x0a];
              for (let k = 0; k < 4; k++) { cab[8 + k] = nuovo[k]; tone[64 + 32 + 12 + k] = nuovo[k]; }
              for (let i = 12; i < 72; i++) cab[i] = 0;
            }
          }
          c[4] = 0;
          blocchi[c[0]] = c;
        }
        if (m.tipo === 7 && m.gruppo === 1) m.corpo.forEach((x, i) => { impostazioni[i] = x; });   // 77 byte
        if (m.tipo === 0 && m.gruppo === 1) m.corpo.forEach((x, i) => { settaggi[i] = x; });       // 288 byte
        if (m.gruppo === 1 && generali[m.tipo] && m.tipo !== 4) m.corpo.forEach((x, i) => { generali[m.tipo][i] = x; });
        if (m.tipo === 5 && m.gruppo === 1) {             // Global EQ: acceso, indice, 0, 0, float32
          generali[4][0] = m.corpo[0];
          if (m.corpo[1] !== 255) for (let k = 0; k < 4; k++) generali[4][4 + 4 * m.corpo[1] + k] = m.corpo[4 + k];
        }
        if (m.tipo === 1 && (m.gruppo === 5 || m.gruppo === 4)) {   // rinomina: posto, 0, 1, 0, 0×4, nome 16
          nomiUtente[m.gruppo][m.corpo[0]] = String.fromCharCode(...m.corpo.slice(8, 24)).replace(/\0.*$/, '');
        }
        if (m.tipo === 1 && m.gruppo === 0) {
          // la testa: volume, tempo e il resto. Se la catena è un'altra, i blocchi cambiano posizione
          // (nel Mini vero: da scoprire; con miniFintoCatenaFissa il finto la ignora)
          const prima = tone.slice(64 + 25, 64 + 32);
          for (let i = 0; i < 60; i++) tone[64 + i] = m.corpo[i];
          if (window.miniFintoCatenaFissa) prima.forEach((s, i) => { tone[64 + 25 + i] = s; });
          const dopo = tone.slice(64 + 25, 64 + 32);
          if (dopo.join() !== prima.join()) {
            const perSlot = [];
            for (const b of blocchi) perSlot[b[2]] = b;
            dopo.forEach((s, pos) => { blocchi[pos] = perSlot[s].slice(); blocchi[pos][0] = pos; });
          }
        }
        if (m.tipo === 6 && m.gruppo === 2) {            // il salto: nel finto cambiano solo numero e nome
          const lista = m.corpo[0], pos = m.corpo[1];
          let numero = pos;
          if (lista !== 0xff) {
            const id = songlist[lista];
            numero = songlist[40 + 70 * id + 20 + pos];
          }
          tone[0] = lista; tone[1] = pos; tone[64] = numero;
          const n = nomi[numero] || '';
          for (let k = 0; k < 20; k++) tone[68 + k] = k < n.length ? n.charCodeAt(k) : 0;
          setTimeout(() => rispondi(6, 2, tone), 200);
        }
        if (m.tipo === 5 && m.gruppo === 2 && m.corpo[0] !== 1) {   // Songlist e tone (5/2, altre operazioni)
          const c = m.corpo, testo = (da) => String.fromCharCode(...c.slice(da, da + 20)).replace(/\0.*$/, '');
          const riga = id => 40 + 70 * id;
          // come il Mini vero (registro dell'8 novembre): «crea» va in fondo col primo id libero e non guarda
          // l'ordine; «aggiungi» e «rinomina» hanno al byte 3 la POSIZIONE nell'ordine; «cancella» toglie quella
          // che manca nell'ordine mandato. Se «rinomina» prenda anche l'ordine non si sa: window.miniFintoRiordina.
          const ordine = () => songlist.slice(0, 40).filter(x => x !== 0xff);
          const metti = o => { for (let i = 0; i < 40; i++) songlist[i] = o[i] == null ? 0xff : o[i]; };
          if (c[0] === 19) {
            const o = ordine();
            let id = 0; while (o.includes(id)) id++;
            const r = riga(id);
            for (let k = 0; k < 70; k++) songlist[r + k] = k < 20 ? 0 : 0xff;
            const n = testo(28); for (let k = 0; k < n.length; k++) songlist[r + k] = n.charCodeAt(k);
            metti(o.concat(id));
          }
          if (c[0] === 16) {
            const id = ordine()[c[3]];
            if (id != null) { const r = riga(id); const n = testo(28); for (let k = 0; k < 20; k++) songlist[r + k] = k < n.length ? n.charCodeAt(k) : 0; }
            if (window.miniFintoRiordina !== false) metti(c.slice(48, 88).filter(x => x !== 0xff));
          }
          if (c[0] === 4) {
            const id = ordine()[c[3]];
            if (id != null) { const r = riga(id) + 20; let k = 0; while (k < 50 && songlist[r + k] !== 0xff) k++; if (k < 50) songlist[r + k] = c[2]; }
          }
          if (c[0] === 17) metti(c.slice(48, 88).filter(x => x !== 0xff));
          if (c[0] === 0) nomi[c[1]] = testo(8);
        }
        if (m.tipo === 8 && m.gruppo === 2) {             // cancella tone: [4…] i numeri, ff in fondo
          for (let i = 4; i < m.corpo.length && m.corpo[i] !== 0xff; i++) { nomi[m.corpo[i]] = ''; delete salvati[m.corpo[i]]; }
          rispondi(9, 2, [8, 0, 2, 0, 0, 0, 1, 0]);
        }
        if (m.tipo === 5 && m.gruppo === 2 && m.corpo[0] === 1) {
          // il salvataggio; nel finto il byte 2 è la destinazione (nel Mini vero: da scoprire)
          const nome = String.fromCharCode(...m.corpo.slice(8, 28)).replace(/\0.*$/, '');
          const dest = m.corpo[window.miniFintoByteDest || 2], numero = tone[64];   // 1 o 2, per provare
          nomi[dest] = nome;
          salvati[dest] = istantanea(dest, nome);
          if (dest === numero) for (let i = 0; i < 20; i++) tone[64 + 4 + i] = m.corpo[8 + i];
          setTimeout(() => rispondi(9, 2, [5, 0, 2, 0, 1, 0, 1, 0]), 400);
        }
      }
    }));

    let drumMsb = 0;
    function scritto(p) {
      if (p[2] === 0xb0) {                               // un CC
        const cc = p[3], v = p[4];
        registro.push('CC ' + cc + ' ' + v);
        if (cc >= 45 && cc <= 51) {
          const slot = [2, 0, 1, 3, 4, 5, 6][cc - 45], b = blocchi.find(x => x[2] === slot);
          b[1] = v >= 64 ? 1 : 0;
          tone[64 + 24] = (tone[64 + 24] & ~(1 << b[2])) | (b[1] << b[2]);
          setTimeout(() => rispondi(2, 0, b), 300);      // il Mini vero ci mette fino a un secondo
        }
        if (cc === 26 || cc === 27) setTimeout(() => rispondi(6, 2, tone), 200);
        if (cc >= 61 && cc <= 67 && cc !== 62) {         // la drum (6/1): il ritmo lo prende solo mentre suona
          const d = generali[6];
          if (cc === 61) d[4] = v >= 64 ? 1 : 0;
          if (cc === 63) { const bpm = Math.max(40, Math.min(300, (drumMsb << 7) | v)); d[2] = bpm & 0xff; d[3] = bpm >> 8; }
          if (cc === 65) d[6] = v >= 64 ? 1 : 0;
          if (cc === 66) d[5] = Math.min(100, v);
          if (cc === 67) { if (!d[4]) return; d[0] = Math.min(99, v); }
          setTimeout(() => rispondi(6, 1, d), 300);
        }
        if (cc === 62) drumMsb = v;
        return;
      }
      arrivo(p);
    }

    const caratt = {
      addEventListener: (tipo, f) => { if (tipo === 'characteristicvaluechanged') notifica = f; },
      startNotifications: async () => caratt,
      writeValueWithoutResponse: async p => scritto(Array.from(p)),
    };
    const dispositivo = {
      name: 'Pulze Mini finto',
      addEventListener: () => {},
      gatt: {
        connected: false,
        connect: async () => { dispositivo.gatt.connected = true; return dispositivo.gatt; },
        disconnect: () => { dispositivo.gatt.connected = false; },
        getPrimaryService: async () => ({ getCharacteristic: async () => caratt }),
      },
    };
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true, value: { requestDevice: async () => dispositivo },
    });
  };
})();
