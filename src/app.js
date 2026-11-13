// app.js - La pagina. Tappa 1: si collega al Mini, legge il tone che suona (testa e sette blocchi) e
// lo mostra nell'ordine della catena, coi nomi del catalogo; ◀ ▶ cambiano tone (CC 26/27).
// Tappa 2: le manopole si muovono e i blocchi si accendono e spengono. Si scrive solo nel tone che
// suona, come fa l'app mentre si gira una manopola: niente viene salvato sul Mini.
(function () {
  const P = window.Pulze;
  const C = window.PulzeCatalogo;
  const $ = s => document.querySelector(s);
  // la lingua (src/pulze-lingua.js traduce lo schermo; qui serve solo per la guida e la spiegazione dell'AI)
  const LINGUA = (window.PulzeLingua && window.PulzeLingua.lingua) || 'it';

  const RITMO_MS = 70;               // una scrittura di blocco ogni 70 ms al massimo, come l'app
  const FERMO_MS = 900;               // dopo un tocco, il controllo non si fa rimettere dal Mini

  const stato = {
    testa: null,                      // dalla testa (1/0) o dal tone intero (6/2)
    blocchi: [null, null, null, null, null, null, null],   // per slot
    modificato: false,                // qualcosa è cambiato dalla pagina e non è salvato
    impostazioni: null,               // le impostazioni generali del Mini (7/1): l'Auto CAB
    nomiUtente: new Map(),            // uid -> { nome, vuoto } dei Sound Clone (2/5) e IR utente (2/4)
    generali: {},                     // tipo -> corpo delle impostazioni generali (gruppo 1)
    drum: null,                       // la drum dal 6/1: { ritmo, bpm, suona, volume, sync }
    eq: null,                         // il Global EQ letto (4/1): { acceso, v[19] }
  };
  let ble = null;
  let esempio = false;
  let rilettura = null;
  const carte = [];                   // per slot, i blocchi della catena: { el, firma, led, pos }
  let firmaCatena = '';

  /** Il nome di un modello: per Sound Clone e IR utente quello dato sul Mini, sennò il catalogo. */
  function nomeModello(uid) {
    const u = stato.nomiUtente.get(uid);
    if (u && u.nome) return u.nome;
    const m = C.modelli[uid];
    return m ? m.n : null;
  }

  // ---------------------------------------------------------------- i valori delle manopole

  /** Un numero con i decimali del suo passo (0.01 → due, 0.1 → uno), senza zeri inutili. */
  function cifre(v, p) {
    if (p && p < 0.1) return v.toFixed(2);
    return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  }
  const hz = (v, p) => (v >= 1000 ? cifre(v / 1000) + ' kHz' : cifre(v, p) + ' Hz');
  function conUnita(v, u, p) {
    if (u === 'Hz') return hz(v, p);
    if (u === 'st' || u === 'dB' || u === 'c') return (v > 0 ? '+' : '') + cifre(v, p) + ' ' + u;
    return cifre(v, p) + (u ? ' ' + u : '');
  }
  /** Il passo che dà il catalogo (in coda per 'c' e 'd'), se c'è. */
  const passoDi = k => (k[2] === 'd' ? k[7] : k[2] === 'c' ? k[6] : undefined);
  const logQuota = (v, a, b) => (Math.log(v) - Math.log(a)) / (Math.log(b) - Math.log(a));
  const daLog = (q, a, b) => Math.exp(Math.log(a) + q * (Math.log(b) - Math.log(a)));
  const stretto = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Il passo di un cursore: semitoni e cent interi, dB e intervalli piccoli a decimi. */
  function passo(min, max, u) {
    if (u === 'st' || u === 'c') return 1;
    if (u === 'dB' || u === '%') return 0.1;
    const r = max - min;
    return r <= 2 ? 0.01 : r <= 20 ? 0.1 : 1;
  }
  const aPasso = (v, p) => +(Math.round(v / p) * p).toFixed(p < 1 ? 2 : 0);

  /** Testo e quota (0-1, o null) di una manopola. */
  function valoreDi(k, valori) {
    const [, pos, tipo] = k;
    const v = valori[pos];
    if (tipo === 't') return { testo: v >= 0.5 ? 'On' : 'Off', acceso: v >= 0.5 };
    if (tipo === 'e') { const o = k[3][Math.round(v)]; return { testo: o != null ? o : cifre(v) }; }
    if (tipo === 'o') {
      const [, , , min, max, u, lato] = k;
      if ((lato === '<' && v < min) || (lato === '>' && v > max)) return { testo: 'Off', quota: null };
      return { testo: conUnita(v, u), quota: logQuota(v, min, max) };
    }
    if (tipo === 'd') {
      const [, , , min, max, u, posSync] = k;
      if (valori[posSync] >= 0.5) return { testo: C.divisioni[Math.round(v)] || cifre(v), quota: null, sync: true };
      return { testo: conUnita(v, u, passoDi(k)), quota: (v - min) / (max - min) };
    }
    const [, , , min, max, u] = k;
    return { testo: conUnita(v, u, passoDi(k)), quota: (v - min) / (max - min), centro: min < 0 };
  }

  // ---------------------------------------------------------------- il disegno
  //
  // La pagina ha tre parti, come l'editor del GP-200: la catena in basso (i sette blocchi con la loro
  // immagine, l'etichetta che accende e spegne e l'elenco dei modelli), il palco al centro (il blocco
  // scelto: immagine grande, manopole rotonde, elenco dei modelli con la ricerca) e l'elenco dei tone.

  const el = (tag, cls, testo) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (testo != null) e.textContent = testo;
    return e;
  };
  const IMMAGINI = window.PulzeImmagini || {};
  /** Le immagini hanno margini trasparenti diversi ai lati (l'U-Vibe: 2 px a sinistra, 33 a destra): si
   *  ritaglia la parte disegnata con object-view-box, così sta in centro al riquadro. Una volta per immagine. */
  const ritagli = new Map();
  function centraImmagine(img) {
    const fatto = () => {
      const r = ritagli.get(img.src);
      if (!r) return;
      img.style.objectViewBox = 'inset(' + r.su + 'px ' + r.dx + 'px ' + r.giu + 'px ' + r.sx + 'px)';
      img.dataset.proporzione = r.a;
    };
    if (ritagli.has(img.src)) { fatto(); return; }
    const misura = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h).data;
        let x0 = w, x1 = -1, y0 = h, y1 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (d[(y * w + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) return;
        const m = 4;                                  // un filo di margine attorno al disegno
        x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
        ritagli.set(img.src, { sx: x0, dx: w - 1 - x1, su: y0, giu: h - 1 - y1, a: (x1 - x0 + 1) / (y1 - y0 + 1) });
        fatto();
      } catch (e) { /* senza ritaglio: l'immagine intera */ }
    };
    if (img.complete && img.naturalWidth) misura(); else img.addEventListener('load', misura, { once: true });
  }

  /** L'immagine di un modello (tools/prepara-immagini.py), dal nome del catalogo. */
  function immagineDi(uid) {
    const m = C.modelli[uid];
    return (m && IMMAGINI[m.n]) || null;
  }

  const storia = { indietro: [], avanti: [], base: null, ultima: null };   // annulla / ripeti
  let confronto = null;             // { b: le modifiche } mentre si ascolta il tone salvato
  let applicando = false;           // annulla, ripeti o confronta in corso
  let scelto = 1;                     // lo slot che si vede sul palco: all'inizio l'ampli
  let palco = null;                   // { firma, righe } del blocco sul palco

  function disegnaTesta() {
    const t = stato.testa;
    $('#tone-nome').textContent = t ? t.nome || '(senza nome)' : '—';
    $('#tone-nome').title = t ? 'Posto ' + (t.numero + 1) : '';
    for (const [id, campo] of [['#tone-volume', 'volume'], ['#tone-tempo', 'tempo']]) {
      const i = $(id);
      i.disabled = !t;
      if (document.activeElement !== i) i.value = t ? t[campo] : '';
    }
    $('#tone-volume-v').textContent = t ? String(t.volume) : '—';
    $('#salva').disabled = !t || !ble || !ble.collegato() || Boolean(confronto) || applicando;
    $('#esporta').disabled = !t || stato.blocchi.some(b => !b);
    $('#importa').disabled = !t || stato.blocchi.some(b => !b) || importando;
    $('#crea').disabled = !t || stato.blocchi.some(b => !b) || importando;
    disegnaElenco();
    $('#modificato').hidden = !stato.modificato;
    $('#modificato').textContent = confronto ? 'ascolti il tone salvato' : 'modificato · non salvato';
    $('#modificato').classList.toggle('confronto', Boolean(confronto));
    $('#modificato').title = $('#modificato').textContent;
    disegnaStoria();
  }

  /** Ridisegna solo ciò che è cambiato: gli elementi restano, i valori si aggiornano sul posto. */
  function disegna() {
    disegnaTesta();
    const box = $('#catena');
    const t = stato.testa;
    $('.catena').hidden = !t;
    if (!t) { box.textContent = ''; carte.length = 0; firmaCatena = ''; disegnaPalco(); return; }
    for (let slot = 0; slot < 7; slot++) {
      const b = stato.blocchi[slot];
      const uid = b ? b.uid : t.uid[slot];
      const nu = stato.nomiUtente.get(uid);
      const firma = uid + '|' + (b ? 'letto' : '-') + '|' + nomeModello(uid) + '|' + (nu && nu.vuoto) +
        '|' + [...stato.nomiUtente.values()].map(v => (v.vuoto ? 0 : 1)).join('');
      if (!carte[slot] || carte[slot].firma !== firma) {
        const vecchia = carte[slot];
        const nuova = cartaBlocco(slot);          // la mette anche in carte[slot]
        nuova.firma = firma;
        if (vecchia && vecchia.el.parentNode) vecchia.el.replaceWith(nuova.el);
      } else aggiornaCarta(slot);
    }
    const vista = catenaVista();                  // con uno spostamento in coda, l'ordine che arriverà
    const ordine = vista.join();
    if (ordine !== firmaCatena || box.children.length !== 7) {
      firmaCatena = ordine;
      vista.forEach(slot => box.appendChild(carte[slot].el));
    }
    vista.forEach((slot, posizione) => { carte[slot].pos.textContent = String(posizione + 1); });
    disegnaPalco();
  }

  /** Quali tempi sono a divisione: se cambia il Sync, il palco si rifà (manopola ↔ elenco). */
  function syncDi(slot) {
    const b = stato.blocchi[slot];
    const m = b && C.modelli[b.uid];
    if (!m) return '';
    return m.k.filter(k => k[2] === 'd').map(k => (b.valori[k[6]] >= 0.5 ? 1 : 0)).join('');
  }

  function accesoDi(slot) {
    const b = stato.blocchi[slot];
    return b ? b.acceso : !!((stato.testa.accesi >> slot) & 1);
  }

  /** Mette un blocco sul palco. */
  function scegli(slot) {
    if (scelto === slot) return;
    scelto = slot;
    palco = null;
    $('#cerca-modello').value = '';
    disegna();
  }

  /** Un blocco della catena: etichetta (on/off), immagine (apre il blocco, si trascina), modello. */
  function cartaBlocco(slot) {
    const t = stato.testa;
    const b = stato.blocchi[slot];
    const uid = b ? b.uid : t.uid[slot];
    const carta = {};

    carta.el = el('div', 'anello');
    carta.led = el('button', 'chip', P.SLOT[slot]);
    carta.led.type = 'button';
    carta.led.disabled = !b;
    carta.led.addEventListener('click', () => accendi(slot));
    carta.el.appendChild(carta.led);

    const mini = el('div', 'miniatura');
    mini.tabIndex = 0;
    mini.setAttribute('role', 'button');
    mini.title = P.SLOT[slot];
    const src = immagineDi(uid);
    if (src) { const i = el('img'); i.src = src; i.alt = ''; i.draggable = false; centraImmagine(i); mini.appendChild(i); }
    else mini.appendChild(el('span', 'senza', P.SLOT[slot]));
    carta.pos = el('span', 'pos', '');
    mini.appendChild(carta.pos);
    mini.addEventListener('click', () => { if (!appenaTrascinato) scegli(slot); });
    mini.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scegli(slot); } });
    mini.addEventListener('pointerdown', e => iniziaTrascina(e, slot, mini));
    carta.el.appendChild(mini);

    if (b && C.moduli[slot]) carta.el.appendChild(sceltaModello(slot, uid));
    else carta.el.appendChild(el('span', 'mod', b ? nomeModello(uid) || 'Modello sconosciuto' : 'leggo…'));
    carte[slot] = carta;
    aggiornaCarta(slot);
    return carta;
  }

  /** I modelli che lo slot accetta (dal catalogo dell'app), divisi per famiglia: [[famiglia, [{ uid, nome, vuoto }]]]. */
  function vociModelli(slot, uid) {
    const gruppi = new Map();
    const lista = C.moduli[slot].slice();
    if (!lista.includes(uid)) lista.unshift(uid);
    for (const u of lista) {
      const m = C.modelli[u];
      const f = (m && m.f) || 'Altro';
      if (!gruppi.has(f)) gruppi.set(f, []);
      const nu = stato.nomiUtente.get(u);
      gruppi.get(f).push({ uid: u, nome: nomeModello(u) || 'Modello ' + (u >>> 24) + '/' + (u & 0xffff), vuoto: !!(nu && nu.vuoto) });
    }
    return [...gruppi];
  }

  /** L'elenco a tendina dei modelli, sotto l'immagine nella catena. */
  function sceltaModello(slot, uid) {
    const sel = el('select', 'mod');
    for (const [f, voci] of vociModelli(slot, uid)) {
      if (sel.children.length) sel.appendChild(el('hr'));      // la linea fra una categoria e l'altra
      const g = el('optgroup');
      g.label = f;
      // il posto del catalogo («Sound Clone 1») è sotto il titolo del palco; qui non ci starebbe
      for (const v of voci) { const o = el('option', '', v.nome + (v.vuoto ? ' (vuoto)' : '')); o.value = String(v.uid); g.appendChild(o); }
      sel.appendChild(g);
    }
    sel.value = String(uid);
    sel.addEventListener('change', () => cambiaModelloDi(slot, +sel.value));
    return sel;
  }

  function aggiornaCarta(slot) {
    const carta = carte[slot];
    const acceso = accesoDi(slot);
    carta.el.classList.toggle('spento', !acceso);
    carta.el.classList.toggle('scelto', slot === scelto);
    carta.led.classList.toggle('on', acceso);
    carta.led.title = P.SLOT[slot] + ' ' + (acceso ? 'on' : 'off');
  }

  // ---------------------------------------------------------------- il palco

  function disegnaPalco() {
    const t = stato.testa;
    $('#vuoto').hidden = !!t;
    $('#palco-corpo').hidden = !t;
    if (!t) { palco = null; return; }
    const slot = scelto;
    const b = stato.blocchi[slot];
    const uid = b ? b.uid : t.uid[slot];
    const firma = [slot, uid, b ? 'letto' : '-', b && syncDi(slot), nomeModello(uid), !!(ble && ble.collegato()),
      [...stato.nomiUtente.values()].map(v => (v.vuoto ? 0 : 1)).join(''), b && b.slot].join('|');
    if (!palco || palco.firma !== firma) costruisciPalco(firma);
    const acceso = accesoDi(slot);
    $('#palco').classList.toggle('spento', !acceso);
    const etichetta = $('#det-slot');
    etichetta.classList.toggle('on', acceso);
    etichetta.title = acceso ? 'On' : 'Off';
    for (const r of palco.righe) r.aggiorna();
  }

  function costruisciPalco(firma) {
    const t = stato.testa;
    const slot = scelto;
    const b = stato.blocchi[slot];
    const uid = b ? b.uid : t.uid[slot];
    const m = C.modelli[uid];
    palco = { firma, righe: [] };

    const foto = $('#foto');
    foto.textContent = '';
    const src = immagineDi(uid);
    if (src) {
      const i = el('img'); i.src = src; i.alt = nomeModello(uid) || '';
      i.addEventListener('load', () => { centraImmagine(i); adattaPalco(); });
      if (i.complete) centraImmagine(i);
      foto.appendChild(i);
    } else foto.appendChild(el('span', 'foto-vuota', P.SLOT[slot]));

    $('#det-slot').textContent = P.SLOT[slot];
    $('#det-slot').disabled = !b;
    $('#det-nome').textContent = nomeModello(uid) || 'Modello sconosciuto';
    // per Sound Clone e IR utente col nome dato sul Mini, sotto c'è il posto del catalogo
    const posto = m && nomeModello(uid) !== m.n ? m.n : null;
    // «Clean - Fender …» → l'ampli vero; le note dei Sound Clone («… User-loaded NAM …») no
    const vero = m && m.r && / - /.test(m.r) ? m.r.replace(/^.*? - /, '') : null;
    const sotto = $('#det-sotto');
    sotto.textContent = m ? [posto || m.f, vero].filter(Boolean).join(' · ')
      : 'categoria ' + (uid >>> 24) + ', numero ' + (uid & 0xffff);
    if (b && stato.nomiUtente.has(uid) && ble && ble.collegato()) {
      const r = el('button', 'pill rinomina', 'Rinomina…');
      r.type = 'button';
      
      r.addEventListener('click', () => rinominaUtente(uid));
      sotto.appendChild(r);
    }
    // la descrizione del catalogo (in inglese), se dice qualcosa di più del titolo
    $('#det-info').textContent = m && m.i && !/^Slot for/i.test(m.i) ? m.i : '';

    const lista = $('#manopole');
    lista.textContent = '';
    if (!b) lista.appendChild(el('li', 'attesa', 'leggo…'));
    else if (m) {
      for (const k of m.k) { const r = rigaManopola(slot, k); palco.righe.push(r); lista.appendChild(r.el); }
      if (!m.k.length) lista.appendChild(el('li', 'attesa', 'nessuna manopola'));
      if (slot === 1) { const r = rigaAutoCab(); palco.righe.push(r); lista.appendChild(r.el); }
    } else {
      b.valori.forEach((v, i) => {
        if (!v) return;
        const li = el('li', 'comando');
        li.appendChild(el('span', 'val', cifre(v)));
        li.appendChild(el('span', 'nome', 'valore ' + i));
        lista.appendChild(li);
      });
    }
    if (b && b.slot !== slot) lista.appendChild(el('li', 'avviso', 'Il Mini dice slot ' + b.slot));
    // tante manopole (Para EQ ne ha 15): più piccole, così stanno tutte senza scorrere
    lista.dataset.tante = lista.children.length > 10 ? '1' : '';
    elencoModelli();
    adattaPalco();
  }

  /** Il riquadro dell'immagine largo quanto serve all'immagine (un pedale alto e stretto lascia posto
   *  alle manopole, un ampli largo ne prende di più, fino a un terzo), poi le manopole in righe pari. */
  function adattaPalco() {
    const corpo = $('#palco-corpo');
    if (corpo.hidden) return;
    const r = corpo.getBoundingClientRect();
    if (!r.width) return;
    const img = $('#foto img');
    const a = img && img.dataset.proporzione ? +img.dataset.proporzione
      : img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : 0.7;
    const larga = Math.round(Math.max(140, Math.min(r.height * 0.9 * a + 32, r.width * 0.31)));
    corpo.style.setProperty('--foto', larga + 'px');
    // tante manopole (Para EQ ne ha 15), o un palco basso: più piccole, così stanno tutte senza scorrere
    const ul = $('#manopole');
    const det = $('.dettaglio');
    ul.classList.toggle('fitte', ul.dataset.tante === '1');
    bilanciaManopole();
    if (!ul.classList.contains('fitte') && det.scrollHeight > det.clientHeight + 1) {
      ul.classList.add('fitte');
      bilanciaManopole();
    }
  }

  /** Le manopole vanno a capo in righe pari: con cinque e posto per quattro, tre e due, non quattro e
   *  una sola sotto («Treble» da sola su una seconda riga). Cerca la larghezza più stretta che non
   *  aggiunge righe e la dà all'elenco. */
  function bilanciaManopole() {
    const ul = $('#manopole');
    ul.style.maxWidth = '';
    const voci = [...ul.children];
    if (voci.length < 3) return;
    const W = ul.clientWidth;
    const gap = parseFloat(getComputedStyle(ul).columnGap) || 0;
    const larghe = voci.map(li => li.getBoundingClientRect().width);
    const righe = w => {
      let n = 1, x = 0;
      for (const l of larghe) {
        if (x && x + gap + l > w + 0.5) { n++; x = l; } else x = x ? x + gap + l : l;
      }
      return n;
    };
    const quante = righe(W);
    if (quante < 2) return;
    let lo = Math.max(...larghe), hi = W;
    while (hi - lo > 1) { const m = (lo + hi) / 2; if (righe(m) > quante) lo = m; else hi = m; }
    ul.style.maxWidth = Math.ceil(hi + 1) + 'px';
  }

  /** L'elenco dei modelli a destra del palco, con la ricerca. */
  function elencoModelli() {
    const t = stato.testa;
    const ul = $('#lista-modelli');
    ul.textContent = '';
    if (!t || !C.moduli[scelto]) return;
    const slot = scelto;
    const b = stato.blocchi[slot];
    const uid = b ? b.uid : t.uid[slot];
    const cerca = $('#cerca-modello').value.trim().toLowerCase();
    let primo = null;
    for (const [f, voci] of vociModelli(slot, uid)) {
      const viste = voci.filter(v => !cerca || v.nome.toLowerCase().includes(cerca) || f.toLowerCase().includes(cerca));
      if (!viste.length) continue;
      ul.appendChild(el('li', 'famiglia', f));
      for (const v of viste) {
        const li = el('li');
        const bt = el('button', v.uid === uid ? 'sì' : '', v.nome);
        bt.type = 'button';
        bt.disabled = !b;
        if (v.vuoto) bt.appendChild(el('span', 'vuoto-utente', ' (vuoto)'));
        bt.addEventListener('click', () => cambiaModelloDi(slot, v.uid));
        li.appendChild(bt);
        ul.appendChild(li);
        if (v.uid === uid) primo = bt;
      }
    }
    if (!ul.children.length) ul.appendChild(el('li', 'attesa', 'Nessun modello.'));
    if (primo && !cerca) primo.scrollIntoView({ block: 'center' });
  }

  /** Una manopola rotonda (SVG): si trascina su e giù, la rotella fa un passo, le frecce anche.
   *  Lavora in «unità del controllo» (min…max a passi di passo); alCambio riceve il valore nuovo. */
  function girevole(min, max, passoC, centro, nome, alCambio) {
    const NS = 'http://www.w3.org/2000/svg';
    const L = 60, R = 24, c = L / 2;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', L); svg.setAttribute('height', L); svg.setAttribute('viewBox', '0 0 ' + L + ' ' + L);
    svg.setAttribute('class', 'girevole');
    svg.setAttribute('tabindex', '0');
    svg.setAttribute('role', 'slider');
    svg.setAttribute('aria-label', nome);
    const crea = (tag, attr) => { const e = document.createElementNS(NS, tag); for (const a in attr) e.setAttribute(a, attr[a]); svg.appendChild(e); return e; };
    const angolo = q => (-135 + 270 * q) * Math.PI / 180;
    const punto = (q, r) => [c + r * Math.sin(angolo(q)), c - r * Math.cos(angolo(q))];
    const arco = (q0, q1) => {
      const [x0, y0] = punto(q0, R), [x1, y1] = punto(q1, R);
      return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + R + ' ' + R + ' 0 ' + ((q1 - q0) * 270 > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
    };
    crea('path', { class: 'pista', d: arco(0, 1), fill: 'none', 'stroke-width': 4, 'stroke-linecap': 'round' });
    const riempi = crea('path', { class: 'riempi', fill: 'none', 'stroke-width': 4, 'stroke-linecap': 'round' });
    crea('circle', { class: 'corpo', cx: c, cy: c, r: R - 6 });
    const lancetta = crea('line', { class: 'lancetta', x1: c, y1: c, 'stroke-width': 3, 'stroke-linecap': 'round' });

    let u = min;
    let presa = null;                 // { y, u } mentre si trascina
    const tondo = v => stretto(+(Math.round((v - min) / passoC) * passoC + min).toFixed(4), min, max);
    function mostra() {
      const q = max > min ? (u - min) / (max - min) : 0;
      const q0 = centro ? 0.5 : 0;
      riempi.setAttribute('d', Math.abs(q - q0) > 0.004 ? arco(Math.min(q, q0), Math.max(q, q0)) : '');
      const [x, y] = punto(q, R - 10);
      lancetta.setAttribute('x2', x.toFixed(2)); lancetta.setAttribute('y2', y.toFixed(2));
      svg.setAttribute('aria-valuenow', u);
    }
    function vai(v) {
      const n = tondo(v);
      if (n === u) return;
      u = n; mostra(); alCambio(u);
    }
    const scatto = () => Math.max(1, Math.round((max - min) / 100 / passoC)) * passoC;   // un centesimo, a passi interi
    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      presa = { y: e.clientY, u };
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      svg.focus();
    });
    svg.addEventListener('pointermove', e => {
      if (!presa) return;
      const fine = e.shiftKey ? 0.2 : 1;    // con Maiusc più piano
      vai(presa.u + (presa.y - e.clientY) * (max - min) / 200 * fine);
    });
    const lascia = () => { presa = null; };
    svg.addEventListener('pointerup', lascia);
    svg.addEventListener('pointercancel', lascia);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      vai(u + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? passoC : scatto()));
    }, { passive: false });
    svg.addEventListener('keydown', e => {
      const passi = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (passi) { e.preventDefault(); vai(u + passi * scatto()); }
      else if (e.key === 'Home') { e.preventDefault(); vai(min); }
      else if (e.key === 'End') { e.preventDefault(); vai(max); }
    });
    mostra();
    return {
      el: svg,
      metti(v) { if (presa) return; u = stretto(v, min, max); mostra(); },
    };
  }

  /** Un comando del palco: manopola rotonda, selettore o interruttore, col nome e il valore.
   *  aggiorna() lo rimette ai valori dello stato. */
  function rigaManopola(slot, k) {
    const [nome, pos, tipo] = k;
    const valori = () => stato.blocchi[slot].valori;
    const modello = C.modelli[stato.blocchi[slot].uid];
    const fabbrica = modello && modello.z ? modello.z[pos] : undefined;
    const li = el('li', 'comando tipo-' + tipo);
    const etichetta = el('span', 'nome', nome);
    etichetta.title = nome;
    const val = el('span', 'val');
    let tocco = 0;
    const toccato = () => { tocco = Date.now(); };
    const fermo = () => Date.now() - tocco < FERMO_MS;
    let aggiornaControllo = () => {};

    if (tipo === 't') {
      li.classList.add('largo');
      const pill = el('button', 'pill');
      pill.type = 'button';
      pill.addEventListener('click', () => cambia(slot, { [pos]: valori()[pos] >= 0.5 ? 0 : 1 }));
      li.appendChild(pill);
      li.appendChild(etichetta);
      aggiornaControllo = () => {
        const v = valoreDi(k, valori());
        pill.textContent = v.testo;
        pill.classList.toggle('on', v.acceso);
      };
    } else if (tipo === 'e' || (tipo === 'd' && valori()[k[6]] >= 0.5)) {
      // un selettore, o un tempo a divisione col Sync acceso
      li.classList.add('largo');
      const voci = tipo === 'e' ? k[3] : C.divisioni;
      const chiavi = Object.keys(voci).map(Number).sort((a, b) => a - b);
      const corti = tipo === 'e' && chiavi.length <= 3 && chiavi.every(i => String(voci[i]).length <= 9);
      if (corti) {
        // poche voci brevi: i tasti uno accanto all'altro, come un deviatore
        const seg = el('div', 'segmenti');
        const tasti = chiavi.map(i => {
          const bt = el('button', '', voci[i]);
          bt.type = 'button';
          bt.addEventListener('click', () => { toccato(); cambia(slot, { [pos]: i }); });
          seg.appendChild(bt);
          return [i, bt];
        });
        li.appendChild(seg);
        aggiornaControllo = () => {
          const i = Math.round(valori()[pos]);
          for (const [j, bt] of tasti) bt.classList.toggle('on', j === i);
        };
      } else {
        const sel = el('select', 'scelta');
        sel.title = nome;
        chiavi.forEach(i => { const o = el('option', '', voci[i]); o.value = i; sel.appendChild(o); });
        sel.addEventListener('change', () => { toccato(); cambia(slot, { [pos]: +sel.value }); });
        li.appendChild(sel);
        aggiornaControllo = () => {
          const i = Math.round(valori()[pos]);
          if (!sel.querySelector('option[value="' + i + '"]')) {
            const o = el('option', '', String(i)); o.value = i; sel.appendChild(o);
          }
          if (!fermo()) sel.value = String(i);
        };
      }
      li.appendChild(etichetta);
    } else {
      let leggi, scrivi, g;
      if (tipo === 'o') {
        // in scala logaritmica, con «Off» a un capo: Low Cut sotto il minimo, High Cut sopra il massimo
        const [, , , min, max, , lato] = k;
        const off = lato === '<' ? 0 : 1000;
        leggi = v => ((lato === '<' && v < min) || (lato === '>' && v > max)) ? off
          : (lato === '<' ? 1 : 0) + Math.round(logQuota(stretto(v, min, max), min, max) * 999);
        scrivi = p => p === off ? (lato === '<' ? min - 1 : max + 1)
          : Math.round(daLog((p - (lato === '<' ? 1 : 0)) / 999, min, max));
        g = girevole(0, 1000, 1, false, nome, p => { toccato(); cambia(slot, { [pos]: scrivi(p) }); });
      } else {
        const [, , , min, max, u] = k;
        const p = passoDi(k) || passo(min, max, u);
        leggi = v => v;
        scrivi = v => aPasso(+v, p);
        g = girevole(min, max, p, tipo === 'c' && min < 0, nome, v => { toccato(); cambia(slot, { [pos]: scrivi(v) }); });
      }
      if (fabbrica != null) {
        g.el.addEventListener('dblclick', () => { tocco = 0; cambia(slot, { [pos]: fabbrica }); });
        g.el.setAttribute('aria-description', 'doppio clic: valore di fabbrica');
      }
      li.appendChild(g.el);
      li.appendChild(etichetta);
      li.appendChild(val);
      aggiornaControllo = () => { if (!fermo()) g.metti(leggi(valori()[pos])); };
    }

    if (tipo === 'd') {
      // il Sync del tempo: acceso = divisione del tap, spento = millisecondi o Hertz
      const [, , , min, max, u, posSync] = k;
      const pill = el('button', 'pill sync', 'Sync');
      pill.type = 'button';
      
      pill.addEventListener('click', () => {
        const ora = valori()[posSync] >= 0.5;
        const bpm = (stato.testa && stato.testa.tempo) || 120;
        // spegnendo: il tempo di un quarto al tempo del tone; accendendo: 1/4
        const libero = u === 'ms' ? stretto(Math.round(60000 / bpm), min, max) : stretto(+(bpm / 60).toFixed(2), min, max);
        cambia(slot, { [posSync]: ora ? 0 : 1, [pos]: ora ? libero : 4 });
      });
      li.appendChild(pill);
      const prima = aggiornaControllo;
      aggiornaControllo = () => { prima(); pill.classList.toggle('on', valori()[posSync] >= 0.5); };
    }

    function aggiorna() {
      val.textContent = valoreDi(k, valori()).testo;
      aggiornaControllo();
    }
    return { el: li, aggiorna };
  }

  /** L'Auto CAB: un'impostazione generale del Mini (7/1, byte 11), non del tone. Acceso, quando cambia
   *  l'ampli il Mini mette da solo il cabinet abbinato (cattura del 5 novembre sera). */
  function rigaAutoCab() {
    const li = el('li', 'comando largo tipo-t auto-cab');
    const pill = el('button', 'pill');
    pill.type = 'button';
    
    pill.addEventListener('click', () => stato.impostazioni && cambiaAutoCab(!stato.impostazioni.autoCab));
    li.appendChild(pill);
    li.appendChild(el('span', 'nome', 'Auto CAB'));
    return {
      el: li,
      aggiorna() {
        const imp = stato.impostazioni;
        pill.disabled = !imp || !ble || !ble.collegato();
        pill.textContent = !imp ? '—' : imp.autoCab ? 'On' : 'Off';
        pill.classList.toggle('on', !!(imp && imp.autoCab));
      },
    };
  }

  /** Scrive il 7/1 come l'app (i primi 77 byte letti, col byte 11 nuovo), poi lo rilegge. */
  async function cambiaAutoCab(on) {
    const imp = stato.impostazioni;
    if (!imp || !ble || !ble.collegato()) return;
    try {
      await ble.manda((num, max) => P.scriviImpostazioni(num, { corpo: imp.corpo, autoCab: on }, max));
      stato.impostazioni = await ble.chiediImpostazioni();
      disegna();
      if (stato.impostazioni.autoCab === on) {
        scriviStato('Auto CAB ' + (on ? 'acceso' : 'spento') + ' (vale per tutti i tone): il Mini conferma.', 'ok');
      } else {
        scriviStato('Il Mini ha tenuto l\'Auto CAB ' + (stato.impostazioni.autoCab ? 'acceso' : 'spento') + '.', 'errore');
        salvaRegistro('auto cab -> ' + on + ' non preso');
      }
    } catch (e) {
      scriviStato('Auto CAB non confermato: ' + e.message, 'errore');
      salvaRegistro('auto cab non confermato');
    }
  }

  /** Cosa succede, tutto negli avvisi in basso a destra (sotto il nome del tone non c'è più una riga:
   *  il nome sta in centro). Errori: rossi, restano finché non si chiudono. Conferme («ok»): verdi
   *  piccole, spariscono da sole. Il lavoro in corso e l'esempio: un avviso grigio solo, che si aggiorna
   *  (col cerchietto che gira se finisce con «…») e se ne va quando arriva l'esito o dopo un po'. */
  function scriviStato(testo, tipo) {
    if (tipo === 'errore' || tipo === 'ok') { togliLavoro(); avviso(testo, tipo); return; }
    lavoro(testo, tipo === 'esempio');
  }

  let lavoroEl = null;
  let lavoroTimer = null;
  function lavoro(testo, esempio) {
    if (!lavoroEl || !lavoroEl.isConnected || lavoroEl.classList.contains('via')) {
      lavoroEl = el('div', 'messaggio lavoro');
      lavoroEl.setAttribute('role', 'status');
      lavoroEl.appendChild(el('span', 'girella'));
      lavoroEl.appendChild(el('span', 'testo'));
      $('#avvisi').appendChild(lavoroEl);
      casaAvvisi();
    }
    const gira = !esempio && /(…|\.\.\.)\)?$/.test(testo);
    lavoroEl.classList.toggle('esempio', !!esempio);
    lavoroEl.classList.toggle('gira', gira);
    lavoroEl.querySelector('.testo').textContent = testo;
    clearTimeout(lavoroTimer);
    lavoroTimer = setTimeout(togliLavoro, gira ? 20000 : 4500);
  }
  function togliLavoro() {
    clearTimeout(lavoroTimer);
    if (!lavoroEl) return;
    const v = lavoroEl;
    lavoroEl = null;
    v.classList.add('via');
    setTimeout(() => {
      v.remove();
      const box = $('#avvisi');
      if (!box.children.length && box.matches(':popover-open')) box.hidePopover();
    }, 200);
  }

  /** Un avviso volante. Sta nel livello in cima (popover), così si vede anche sopra le finestre aperte. */
  function avviso(testo, tipo) {
    const box = $('#avvisi');
    // lo stesso errore due volte: non si impila, si fa notare quello che c'è
    for (const v of box.children) {
      if (v.dataset.testo === testo && !v.classList.contains('via')) {
        v.classList.remove('scossa'); void v.offsetWidth; v.classList.add('scossa');
        return;
      }
    }
    const v = el('div', 'messaggio ' + tipo);
    v.dataset.testo = testo;
    v.setAttribute('role', tipo === 'errore' ? 'alert' : 'status');
    v.appendChild(icona(tipo === 'errore' ? 'attenzione' : 'spunta', 'ico-msg'));
    v.appendChild(el('span', 'testo', testo));
    const togli = () => {
      if (v.classList.contains('via')) return;
      v.classList.add('via');
      setTimeout(() => { v.remove(); if (!box.children.length && box.matches(':popover-open')) box.hidePopover(); }, 200);
    };
    if (tipo === 'errore') {
      const x = el('button', 'chiudi-msg');
      x.type = 'button';
      x.title = 'Chiudi';
      x.setAttribute('aria-label', 'Chiudi');
      x.appendChild(icona('chiudi'));
      x.addEventListener('click', togli);
      v.appendChild(x);
      // al massimo quattro errori: il più vecchio se ne va
      const errori = [...box.querySelectorAll('.messaggio.errore:not(.via)')];
      if (errori.length >= 4) errori[0].querySelector('.chiudi-msg').click();
    } else {
      // le conferme restano il tempo di leggerle (di più se sono lunghe), e non spariscono sotto il mouse
      const durata = Math.min(9000, 2600 + testo.length * 45);
      let timer = setTimeout(togli, durata);
      v.addEventListener('mouseenter', () => clearTimeout(timer));
      v.addEventListener('mouseleave', () => { timer = setTimeout(togli, 1500); });
      // una conferma nuova manda via quelle di prima
      for (const vecchia of box.querySelectorAll('.messaggio.ok:not(.via)')) vecchia.classList.add('via'), setTimeout(() => vecchia.remove(), 200);
    }
    box.appendChild(v);
    casaAvvisi();
  }

  /** Con una finestra aperta tutto il resto della pagina è inerte: la ✕ degli avvisi non si potrebbe
   *  premere. Gli avvisi stanno quindi dentro l'ultima finestra aperta (o nella pagina), e ripresentati
   *  tornano sopra di lei. */
  function casaAvvisi() {
    const box = $('#avvisi');
    const modali = [...document.querySelectorAll('dialog[open]')].filter(d => d.matches(':modal'));
    const casa = modali.length ? modali[modali.length - 1] : document.body;
    if (box.parentElement !== casa) {
      if (box.matches(':popover-open')) box.hidePopover();
      casa.appendChild(box);
    }
    if (!box.children.length) { if (box.matches(':popover-open')) box.hidePopover(); return; }
    if (box.matches(':popover-open')) box.hidePopover();
    box.showPopover();
  }

  // ---------------------------------------------------------------- le scritture

  const daMandare = new Set();
  let ritmo = null;

  /** Cambia dei valori di un blocco (posizione → valore) e li manda al Mini al ritmo dell'app. */
  function cambia(slot, nuovi) {
    const b = stato.blocchi[slot];
    if (!b) return;
    registra('v' + slot + ':' + Object.keys(nuovi).join());
    for (const [p, v] of Object.entries(nuovi)) b.valori[+p] = v;
    segnaModificato();
    disegna();
    daMandare.add(slot);
    if (!ritmo) { mandaOra(); ritmo = setInterval(mandaOra, RITMO_MS); }
  }

  function mandaOra() {
    if (!daMandare.size) { clearInterval(ritmo); ritmo = null; return; }
    for (const slot of daMandare) {
      if (slot === 'testa') {
        // volume e tempo del tone: si rimanda la testa intera, come l'app
        const t = stato.testa;
        if (!ble || !ble.collegato() || !t) continue;
        const copia = { corpo: t.corpo, volume: t.volume, tempo: t.tempo, accesi: t.accesi,
          catena: t.catena.slice(), uid: t.uid.slice() };
        ble.manda((num, max) => P.scriviTesta(num, copia, max))
          .catch(e => scriviStato('Il Mini non ha preso volume o tempo: ' + e.message, 'errore'));
        continue;
      }
      const b = stato.blocchi[slot];
      if (!ble || !ble.collegato() || !b) continue;
      const copia = { corpo: b.corpo, uid: b.uid, acceso: b.acceso, valori: b.valori.slice() };
      ble.manda((num, max) => P.scriviBlocco(num, copia, max))
        .catch(e => scriviStato('Il Mini non ha preso la modifica di ' + P.SLOT[slot] + ': ' + e.message, 'errore'));
    }
    daMandare.clear();
  }

  /** Accende o spegne un blocco col CC del suo tipo (45-51: DYN, PRE, AMP, CAB, EQ/MOD, FX1, FX2), come il pedale; il Mini risponde col blocco
   *  (che passa da alMessaggio e rimette lo stato). Se non risponde, lo si rilegge. */
  function accendi(slot) {
    const b = stato.blocchi[slot];
    const t = stato.testa;
    if (!b || !t) return;
    registra('on' + Date.now());
    const nuovo = !b.acceso;
    const posizione = t.catena.indexOf(slot);
    b.acceso = nuovo;
    t.accesi = (t.accesi & ~(1 << slot)) | ((nuovo ? 1 : 0) << slot);
    segnaModificato();
    disegna();
    if (!ble || !ble.collegato()) return;
    const risposta = ble.aspetta(m => m.comando === 0x12 && m.tipo === P.TIPO.BLOCCO && m.gruppo === 0 &&
      m.corpo[2] === slot, 3000);
    ble.mandaCC(P.ccBlocco(slot), nuovo ? 127 : 0);
    risposta.catch(() => ble.chiediBlocco(posizione))
      .then(m => {
        const letto = P.leggiBlocco(m.corpo);
        if (letto && (letto.slot !== slot || letto.acceso !== nuovo)) {
          scriviStato('Attenzione: dopo l\'on/off di ' + P.SLOT[slot] + ' (posizione ' + (posizione + 1) + ') il Mini dice ' +
            P.SLOT[letto.slot] + ' ' + (letto.acceso ? 'acceso' : 'spento') + '.', 'errore');
          salvaRegistro('on/off ' + P.SLOT[slot] + ' pos ' + posizione + ' -> ' + nuovo);
        } else scriviStato(P.SLOT[slot] + ' ' + (nuovo ? 'acceso' : 'spento') + ': il Mini conferma.', 'ok');
      })
      .catch(e => {
        scriviStato('On/off di ' + P.SLOT[slot] + ' non confermato: ' + e.message, 'errore');
        salvaRegistro('on/off ' + P.SLOT[slot] + ' non confermato');
      });
  }

  /** Il registro Bluetooth in editor/registro-pagina.txt (lo scrive tools/serve.js), per capire cosa
   *  è successo. Solo con l'editor aperto dal PC (avvia-editor.cmd, localhost): pubblicato su GitHub Pages
   *  non c'è nessuno che lo riceva, e il traffico Bluetooth di chi lo usa non deve andare da nessuna parte. */
  /** Diagnosi dei posti: nomi (con i 400 byte d'ordine), testa e Songlist, negli appunti. */
  async function copiaDiagnosi() {
    const b = $('#backup-diagnosi');
    if (!ble || !ble.collegato()) { b.textContent = 'Mini non collegato'; return; }
    b.disabled = true; b.textContent = 'Leggo…';
    try {
      const n = await ble.chiediNomi();
      const testa = P.leggiTesta((await ble.chiediTesta()).corpo);
      const sl = (await ble.chiediSonglist()).corpo;
      // i tone letti uno per uno (0/0): numero → nome e ID scritti dentro il tone
      const veri = [];
      const posti = [0, 1, 2, 3, 4, 5];
      for (let i = 125; i <= 145; i++) posti.push(i);
      for (const p of posti) {
        b.textContent = 'Leggo il posto ' + (p + 1) + '…';
        ble.num = (ble.num + 1) & 0x7f || 1;
        const attesa = ble.aspetta(m => m.tipo === 0 && m.gruppo === 0 && m.corpo && m.corpo.length >= 532 && m.corpo[8] === p, 2500);
        ble._accoda(P.richiesta(ble.num, 0, 0, P.corpoChiediTone(p), ble.max));
        try {
          const c = (await attesa).corpo;
          veri.push(p + ':' + c[8] + ',' + c[9] + ':' + String.fromCharCode(...c.slice(12, 28).filter(x => x >= 32 && x < 127)));
        } catch (e) { veri.push(p + ':-'); }
      }
      const testo = JSON.stringify({ versione: 'diagnosi-2', quando: new Date().toISOString(), veri: veri.join(' | '),
        testa: { numero: testa.numero, nome: testa.nome },
        ordine: n.ordine.join(' '), altro: n.altro.join(' '),
        nomi: n.nomi.map((x, i) => (x ? i + ':' + x : null)).filter(Boolean),
        songlist: Array.from(sl).join(' ') });
      try { await navigator.clipboard.writeText(testo); } catch (e) {
        const t = el('textarea'); t.value = testo; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
      }
      b.textContent = 'Copiata: incollala nella chat';
    } catch (e) {
      b.textContent = 'Non riuscita: ' + e.message;
    } finally { b.disabled = false; setTimeout(() => { b.textContent = 'Copia diagnosi'; }, 4000); }
  }

  function salvaRegistro(perche) {
    if (!ble || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
    const testo = '=== ' + new Date().toISOString() + ' ' + perche + '\n' + ble.registro.join('\n') + '\n';
    fetch('registro', { method: 'POST', body: testo }).catch(() => {});
  }

  function segnaModificato() {
    stato.modificato = true;
    if (esempio) scriviStato('Esempio: le modifiche restano nella pagina, niente va al Mini.', 'esempio');
  }

  /** Volume o tempo del tone cambiati nella pagina. */
  function cambiaTestaDa(campo, valore, min, max) {
    const t = stato.testa;
    if (!t || !Number.isFinite(valore)) return;
    registra('t' + campo);
    t[campo] = Math.round(stretto(valore, min, max));
    segnaModificato();
    disegnaTesta();
    daMandare.add('testa');
    if (!ritmo) { mandaOra(); ritmo = setInterval(mandaOra, RITMO_MS); }
  }

  /** Cambia il modello di un blocco come l'app: il blocco col modello nuovo (byte 4 a 00, poi a 02),
   *  poi lo rilegge: il Mini ha messo i valori di fabbrica del modello. */
  async function cambiaModelloDi(slot, uid) {
    const b = stato.blocchi[slot];
    const t = stato.testa;
    if (!b || !t || b.uid === uid) return;
    registra('m' + Date.now());
    const posizione = t.catena.indexOf(slot);
    const nuovo = Object.assign({}, b, { uid, valori: b.valori.slice() });
    const nome = nomeModello(uid) || 'modello ' + uid;
    t.uid[slot] = uid;
    stato.blocchi[slot] = null;                   // «leggo…» finché il Mini non dà i valori nuovi
    segnaModificato();
    disegna();
    if (!ble || !ble.collegato()) {               // esempio: senza Mini non ci sono i valori nuovi
      stato.blocchi[slot] = Object.assign(nuovo, { valori: nuovo.valori.map(() => 0) });
      disegna();
      return;
    }
    try {
      scriviStato('Metto ' + nome + ' in ' + P.SLOT[slot] + '…');
      await ble.manda((num, max) => P.cambiaModello(num, nuovo, 0, max));
      await ble.manda((num, max) => P.cambiaModello(num, nuovo, 2, max));
      const m = await ble.chiediBlocco(posizione);
      const letto = P.leggiBlocco(m.corpo);
      if (letto && letto.uid === uid) {
        scriviStato(P.SLOT[slot] + ': ' + nome + ', coi valori di fabbrica.', 'ok');
        // con l'Auto CAB il Mini potrebbe aver cambiato anche il cabinet: la testa lo dice, e
        // cambiaTesta rilegge i blocchi che hanno un altro modello
        if (slot === 1 && stato.impostazioni && stato.impostazioni.autoCab) {
          await ble.chiediTesta();
          const posCab = stato.testa.catena.indexOf(3);
          if (posCab >= 0) await ble.chiediBlocco(posCab);   // il cabinet che il Mini ha scelto
          scriviStato(P.SLOT[slot] + ': ' + nome + ', coi valori di fabbrica; Auto CAB: ' +
            (nomeModello(stato.blocchi[3] && stato.blocchi[3].uid) || '?') + '.', 'ok');
        }
      } else {
        scriviStato('Attenzione: il Mini in ' + P.SLOT[slot] + ' dice ' + (nomeModello(letto && letto.uid) || '?') + '.', 'errore');
        salvaRegistro('cambio di modello ' + P.SLOT[slot] + ' -> ' + uid.toString(16));
      }
    } catch (e) {
      scriviStato('Cambio di modello non riuscito: ' + e.message, 'errore');
      salvaRegistro('cambio di modello non riuscito');
      ble.chiediBlocco(posizione).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- annulla, ripeti e confronta

  // Prima di ogni modifica fatta a mano (manopola, on/off, modello, catena, volume, tempo, import) si tiene com'era
  // il tone: Annulla torna indietro di un passo, Ripeti lo rifà. Tornare indietro rimanda al Mini solo quello che
  // cambia, con le stesse funzioni dei comandi a mano (cambia, accendi, cambiaModelloDi, spostaCatena).
  // Confronta: fa sentire il tone com'è salvato (storia.base, preso alla prima modifica) e poi di nuovo le modifiche.

  /** Il tone come lo vede la pagina, o null se un blocco non è ancora letto. */
  function istantanea() {
    const t = stato.testa;
    if (!t || stato.blocchi.some(b => !b)) return null;
    return { numero: t.numero, volume: t.volume, tempo: t.tempo, catena: t.catena.slice(),
      blocchi: stato.blocchi.map(b => ({ uid: b.uid, acceso: b.acceso, valori: b.valori.slice() })) };
  }

  const stessoTone = (a, b) => Boolean(a && b) && a.volume === b.volume && a.tempo === b.tempo &&
    a.catena.join() === b.catena.join() && a.blocchi.every((x, s) => x.uid === b.blocchi[s].uid &&
      x.acceso === b.blocchi[s].acceso && x.valori.every((v, i) => v === b.blocchi[s].valori[i]));

  function azzeraStoria() {
    storia.indietro.length = 0;
    storia.avanti.length = 0;
    storia.base = null;
    storia.ultima = null;
    confronto = null;
  }

  /** Com'era il tone, prima di una modifica a mano. La stessa manopola girata di seguito è un passo solo. */
  function registra(chiave) {
    if (applicando) return;
    if (confronto) {
      // si modifica mentre si ascolta il salvato: si lavora da lì, e le modifiche di prima restano un passo indietro
      storia.indietro.push(confronto.b);
      confronto = null;
    }
    const ora = Date.now(), u = storia.ultima;
    storia.ultima = { chiave, quando: ora };
    if (u && u.chiave === chiave && ora - u.quando < 800) return;
    const s = istantanea();
    if (!s) return;
    if (!storia.base && !stato.modificato) storia.base = s;     // il tone com'è salvato
    storia.indietro.push(s);
    if (storia.indietro.length > 100) storia.indietro.shift();
    storia.avanti.length = 0;
    disegnaStoria();
  }

  /** Porta il tone che suona a s, mandando al Mini solo le differenze. */
  async function applica(s, testo) {
    if (!stato.testa || stato.testa.numero !== s.numero) return;
    applicando = true;
    disegnaStoria();
    try {
      scriviStato(testo + '…');
      if (s.catena.join() !== stato.testa.catena.join()) {
        const mosso = s.catena.find((x, i) => x !== stato.testa.catena[i]);
        await spostaCatena(s.catena, mosso);
      }
      // l'ampli per primo: con l'Auto CAB cambia anche il cabinet, che si rimette dopo
      for (const slot of [1, 0, 2, 3, 4, 5, 6]) {
        const v = s.blocchi[slot];
        if (stato.blocchi[slot] && stato.blocchi[slot].uid !== v.uid) await cambiaModelloDi(slot, v.uid);
        const b = stato.blocchi[slot];
        if (!b) continue;
        const diversi = {};
        v.valori.forEach((x, i) => { if (x !== b.valori[i]) diversi[i] = x; });
        if (Object.keys(diversi).length) cambia(slot, diversi);
        if (b.acceso !== v.acceso) accendi(slot);
      }
      if (stato.testa.volume !== s.volume) cambiaTestaDa('volume', s.volume, 0, 100);
      if (stato.testa.tempo !== s.tempo) cambiaTestaDa('tempo', s.tempo, 40, 250);
      await new Promise(r => setTimeout(r, RITMO_MS * 3));      // che gli ultimi valori siano partiti
      scriviStato(testo + ': fatto.', 'ok');
    } catch (e) {
      scriviStato(testo + ' non riuscito: ' + e.message + '. Premi Rileggi.', 'errore');
    } finally {
      applicando = false;
      // modificato: sempre durante il confronto (le modifiche ci sono, da parte); se no, se è diverso dal salvato
      stato.modificato = Boolean(confronto) || !(storia.base && stessoTone(istantanea(), storia.base));
      disegna();
    }
  }

  async function annulla() {
    if (applicando || confronto || !storia.indietro.length) return;
    const ora = istantanea();
    if (!ora) return;
    storia.avanti.push(ora);
    storia.ultima = null;
    await applica(storia.indietro.pop(), 'Annullo');
  }

  async function ripeti() {
    if (applicando || confronto || !storia.avanti.length) return;
    const ora = istantanea();
    if (!ora) return;
    storia.indietro.push(ora);
    storia.ultima = null;
    await applica(storia.avanti.pop(), 'Ripeto');
  }

  /** A/B: il tone salvato e le modifiche, uno dopo l'altro. */
  async function confronta() {
    if (applicando) return;
    if (confronto) {
      const b = confronto.b;
      confronto = null;
      await applica(b, 'Torno alle modifiche');
      return;
    }
    if (!storia.base || !stato.modificato) return;
    const b = istantanea();
    if (!b) return;
    confronto = { b };
    storia.ultima = null;
    await applica(storia.base, 'Il tone salvato');
    if (confronto) scriviStato('Stai ascoltando il tone com\'è salvato. Ripremi A/B per tornare alle modifiche.', 'ok');
  }

  function disegnaStoria() {
    const libero = Boolean(stato.testa) && !applicando && !importando;
    $('#annulla').disabled = !libero || Boolean(confronto) || !storia.indietro.length;
    $('#ripeti').disabled = !libero || Boolean(confronto) || !storia.avanti.length;
    $('#confronta').disabled = !libero || !(confronto || (storia.base && stato.modificato));
    $('#confronta').classList.toggle('attivo', Boolean(confronto));
    $('#confronta').title = confronto ? 'Torna alle modifiche' : 'Confronta col tone salvato';
  }

  // ---------------------------------------------------------------- la catena trascinata

  let trascina = null;              // il trascinamento in corso nella catena
  let appenaTrascinato = false;     // il clic che chiude un trascinamento non apre il blocco
  let spostando = false;

  const puoiSpostare = () => !!stato.testa && !stato.blocchi.some(b => !b) && !spostando && !importando && !rilettura;
  // Uno spostamento lasciato mentre il Mini è occupato (rilegge i blocchi dopo lo spostamento di prima o un
  // cambio di tone): la pagina mostra già l'ordine nuovo e lo manda appena il Mini è libero.
  let spostaInCoda = null;
  const catenaVista = () => (spostaInCoda ? spostaInCoda.nuova : stato.testa.catena);

  function provaCoda() {
    if (!spostaInCoda || !puoiSpostare()) return;
    const q = spostaInCoda;
    spostaInCoda = null;
    spostaCatena(q.nuova, q.mosso);
  }

  /** Il trascinamento della catena, a mano col puntatore (niente drag del browser, che sugli spazi fra i
   *  blocchi mostra il divieto): il blocco segue il mouse, gli altri gli fanno posto scivolando. */
  function iniziaTrascina(e, slot, mini) {
    if (e.button !== 0 || trascina || !stato.testa) return;
    if (stato.blocchi.some(b => !b) || importando) {
      scriviStato('Aspetta un attimo: sto ancora leggendo i blocchi dal Mini.');
      return;
    }
    const ordine = catenaVista().slice();
    const da = ordine.indexOf(slot);
    trascina = { slot, mini, ordine, da, a: da, x0: e.clientX, y0: e.clientY, via: false, id: e.pointerId };
    try { mini.setPointerCapture(e.pointerId); } catch (x) { /* senza cattura va lo stesso finché si resta sopra */ }
    mini.addEventListener('pointermove', muoviTrascina);
    mini.addEventListener('pointerup', fineTrascina);
    mini.addEventListener('pointercancel', fineTrascina);
  }

  function muoviTrascina(e) {
    const t = trascina;
    if (!t || e.pointerId !== t.id) return;
    const dx = e.clientX - t.x0, dy = e.clientY - t.y0;
    if (!t.via) {
      if (Math.hypot(dx, dy) < 6) return;              // sotto i 6 pixel è ancora un clic
      t.via = true;
      // dove stanno i blocchi adesso: i centri e il passo da un posto all'altro
      t.centri = t.ordine.map(s => { const r = carte[s].el.getBoundingClientRect(); return r.left + r.width / 2; });
      t.passo = t.centri.length > 1 ? t.centri[1] - t.centri[0] : 0;
      $('#catena').classList.add('trascinando');
      carte[t.slot].el.classList.add('trascinato');
    }
    carte[t.slot].el.style.transform = 'translate(' + dx + 'px,' + dy * 0.35 + 'px) scale(1.06)';
    // il posto nuovo: il centro più vicino a dove sta il blocco
    const x = t.centri[t.da] + dx;
    let a = 0;
    t.centri.forEach((c, i) => { if (Math.abs(c - x) < Math.abs(t.centri[a] - x)) a = i; });
    if (a === t.a) return;
    t.a = a;
    t.ordine.forEach((s, i) => {
      if (s === t.slot) return;
      let sposta = 0;
      if (t.da < a && i > t.da && i <= a) sposta = -t.passo;
      if (t.da > a && i < t.da && i >= a) sposta = t.passo;
      carte[s].el.style.transform = sposta ? 'translateX(' + sposta + 'px)' : '';
    });
  }

  function fineTrascina(e) {
    const t = trascina;
    if (!t || e.pointerId !== t.id) return;
    t.mini.removeEventListener('pointermove', muoviTrascina);
    t.mini.removeEventListener('pointerup', fineTrascina);
    t.mini.removeEventListener('pointercancel', fineTrascina);
    try { if (t.mini.hasPointerCapture(t.id)) t.mini.releasePointerCapture(t.id); } catch (x) { /* già lasciata */ }
    if (!t.via) { trascina = null; return; }           // era un clic: lo gestisce il click
    appenaTrascinato = true;
    setTimeout(() => { appenaTrascinato = false; }, 0);
    const annullato = e.type === 'pointercancel';
    const carta = carte[t.slot].el;
    // il blocco va a posarsi al posto nuovo, poi la catena si ricompone in quell'ordine
    carta.classList.add('posa');
    carta.style.transform = annullato ? '' : 'translateX(' + (t.centri[t.a] - t.centri[t.da]) + 'px)';
    setTimeout(() => {
      trascina = null;
      $('#catena').classList.remove('trascinando');
      for (const c of carte) if (c) { c.el.classList.remove('trascinato', 'posa'); c.el.style.transform = ''; }
      if (annullato || t.a === t.da) return;
      const nuova = t.ordine.filter(s => s !== t.slot);
      nuova.splice(t.a, 0, t.slot);
      if (puoiSpostare()) { spostaInCoda = null; spostaCatena(nuova, t.slot); return; }
      spostaInCoda = { nuova, mosso: t.slot };
      scriviStato('Sposto ' + P.SLOT[t.slot] + ' appena il Mini ha finito di rileggere i blocchi…');
      disegna();
    }, 160);
  }

  /** Un altro ordine della catena: la testa rimandata coi byte 25-31 nuovi (provato col Mini il 5 novembre
   *  con l'import di «Catena nuova»), poi riletta, poi i sette blocchi riletti (ora stanno in altre
   *  posizioni). Nella pagina l'ordine cambia subito, e coi corpi già alla posizione nuova: così una
   *  manopola girata intanto va al blocco giusto. */
  async function spostaCatena(nuova, mosso) {
    const t = stato.testa;
    if (!t || nuova.join() === t.catena.join()) return;
    registra('c' + Date.now());
    const prima = t.catena.slice();
    const metti = catena => {
      t.catena = catena.slice();
      catena.forEach((s, pos) => {
        const b = stato.blocchi[s];
        if (b) { b.posizione = pos; b.corpo = b.corpo.slice(); b.corpo[0] = pos; }
      });
    };
    metti(nuova);
    segnaModificato();
    disegna();
    if (!ble || !ble.collegato()) return;
    spostando = true;
    try {
      scriviStato('Sposto ' + P.SLOT[mosso] + ' in posizione ' + (nuova.indexOf(mosso) + 1) + '…');
      const testa = { corpo: t.corpo, volume: t.volume, tempo: t.tempo, accesi: t.accesi,
        catena: nuova.slice(), uid: t.uid.slice() };
      await ble.manda((num, max) => P.scriviTesta(num, testa, max));
      await ble.chiediTesta();                      // passa da alMessaggio: stato.testa è quella del Mini
      const presa = stato.testa.catena.join() === nuova.join();
      if (!presa) metti(stato.testa.catena);        // i corpi tornano alle posizioni che dice il Mini
      for (let pos = 0; pos < 7; pos++) {
        scriviStato('Rileggo il blocco ' + (pos + 1) + ' di 7…');
        await ble.chiediBlocco(pos);
      }
      const sbagliati = stato.testa.catena.filter((s, pos) => !stato.blocchi[s] || stato.blocchi[s].posizione !== pos);
      if (!presa) {
        scriviStato('Il Mini ha tenuto l\'ordine di prima: ' + stato.testa.catena.map(s => P.SLOT[s]).join(' → ') + '.', 'errore');
        salvaRegistro('catena ' + prima.join() + ' -> ' + nuova.join() + ' non presa');
      } else if (sbagliati.length) {
        scriviStato('Catena cambiata, ma i blocchi riletti non tornano: ' + sbagliati.map(s => P.SLOT[s]).join(', ') + '. Premi Rileggi.', 'errore');
        salvaRegistro('catena ' + prima.join() + ' -> ' + nuova.join() + ', blocchi fuori posto');
      } else {
        scriviStato(P.SLOT[mosso] + ' in posizione ' + (nuova.indexOf(mosso) + 1) + ': il Mini conferma. Non è salvato.', 'ok');
      }
    } catch (e) {
      scriviStato('Spostamento non confermato: ' + e.message + '. Premi Rileggi.', 'errore');
      salvaRegistro('spostamento della catena non confermato');
    } finally {
      spostando = false;
      disegna();
      provaCoda();
    }
  }

  // ---------------------------------------------------------------- il salvataggio

  let ordineSonglist = null;        // i primi 40 byte della risposta 00/03

  let nomiTone = null;              // i 200 nomi, riletti a ogni apertura del salvataggio
  const postoNome = i => (i + 1) + ' · ' + (nomiTone && nomiTone[i] ? nomiTone[i] : '(vuoto)');

  async function apriSalva() {
    const t = stato.testa;
    if (!t || !ble || !ble.collegato()) return;
    $('#salva-nome').value = nomeProposto || t.nome;
    $('#salva-errore').textContent = '';
    const sel = $('#salva-posto');
    sel.disabled = true;
    aggiornaSalva();
    $('#dialogo-salva').showModal();
    try {
      nomiTone = (await ble.chiediNomi()).nomi;
      sel.textContent = '';
      nomiTone.forEach((_, i) => { const o = el('option', '', postoNome(i)); o.value = i; sel.appendChild(o); });
      sel.value = String(t.numero);
      sel.disabled = false;
    } catch (e) {
      sel.textContent = '';
      const o = el('option', '', postoNome(t.numero)); o.value = t.numero; sel.appendChild(o);
      $('#salva-errore').textContent = 'Non ho letto i nomi dei tone: si salva solo sul posto.';
    }
    aggiornaSalva();
  }

  /** La finestra dice cosa succede: sovrascrivere il tone che suona, o metterlo in un altro posto. */
  function aggiornaSalva() {
    const t = stato.testa;
    const dest = $('#salva-posto').disabled ? t.numero : +$('#salva-posto').value;
    if (dest === t.numero) {
      $('#salva-conferma').textContent = 'Sovrascrivi';
    } else {
      const vuoto = !(nomiTone && nomiTone[dest]);
      $('#salva-conferma').textContent = vuoto ? 'Salva' : 'Sovrascrivi';
    }
    $('#salva-conferma').disabled = false;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Salva il tone che suona nel posto scelto (byte 2 del 5/2 = la destinazione, provato il 5 novembre),
   *  poi rilegge i nomi e la testa per controllare. */
  async function salvaOra() {
    const t = stato.testa;
    const dest = $('#salva-posto').disabled ? t.numero : +$('#salva-posto').value;
    const nome = $('#salva-nome').value.trim();
    if (!/^[\x20-\x7e]{1,16}$/.test(nome)) {
      $('#salva-errore').textContent = 'Da 1 a 16 caratteri, senza accenti.';
      return;
    }
    $('#dialogo-salva').close();
    try {
      await leggiOrdine();
      if (dest !== t.numero && nomiTone && nomiTone[dest]) {
        scriviStato('Copia di sicurezza di «' + nomiTone[dest] + '»…');
        await sicurezzaTone([dest], 'prima di salvare «' + nome + '» sopra «' + nomiTone[dest] + '» (posto ' + (dest + 1) + ')');
      }
      scriviStato('Salvo «' + nome + '» nel posto ' + (dest + 1) + '…');
      // che le ultime manopole siano partite e il Mini abbia finito di rispondere alla lettura per la copia
      await new Promise(r => setTimeout(r, Math.max(RITMO_MS * 2, 1000)));
      const r = await ble.salva(t.numero, nome, ordineSonglist, dest);
      const nomi = (await ble.chiediNomi()).nomi;
      nomiTone = nomi;
      disegnaElenco();
      salvaRegistro('salvataggio di «' + nome + '» da ' + t.numero + ' a ' + dest + ', risposta ' + r.corpo.join(' ') +
        ', nome nel posto: «' + nomi[dest] + '»');
      if (nomi[dest] !== nome) {
        scriviStato('Il Mini ha risposto, ma nel posto ' + (dest + 1) + ' c\'è «' + nomi[dest] + '».', 'errore');
        return;
      }
      if (dest === t.numero) { stato.modificato = false; confronto = null; storia.base = istantanea(); }
      nomeProposto = null;
      scriviStato('Salvato sul Mini: «' + nome + '», posto ' + (dest + 1) + '.', 'ok');
      // il Mini potrebbe essere passato al tone nuovo: la testa lo dice, e se è un altro si rileggono i blocchi
      const nuova = P.leggiTesta((await ble.chiediTesta()).corpo);
      if (nuova && nuova.numero !== t.numero) rileggiBlocchi();
      if (nuova && nuova.numero === dest) { stato.modificato = false; confronto = null; storia.base = istantanea(); }
      disegnaTesta();
    } catch (e) {
      scriviStato('Salvataggio non confermato: ' + e.message, 'errore');
      salvaRegistro('salvataggio non confermato');
    }
  }

  async function leggiOrdine() {
    if (ordineSonglist) return;
    scriviStato('Leggo l\'ordine delle Songlist…');
    ordineSonglist = (await ble.chiediSonglist()).corpo.slice(0, 40);
  }

  // ---------------------------------------------------------------- l'export .prst

  /** Scarica il tone che suona (come lo vede la pagina, modifiche comprese) come .prst. */
  function esporta() {
    const t = stato.testa;
    if (!t || stato.blocchi.some(b => !b)) return;
    const testo = window.PulzePrst.scrivi({
      nome: t.nome, volume: t.volume, tempo: t.tempo, catena: t.catena,
      blocchi: stato.blocchi.map(b => ({ uid: b.uid, acceso: b.acceso, valori: b.valori })),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([testo], { type: 'application/octet-stream' }));
    a.download = (t.nome || 'tone').replace(/[\\/:*?"<>|]/g, '_') + '.prst';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    scriviStato('Esportato «' + a.download + '» (nella cartella Download).', 'ok');
  }

  // ---------------------------------------------------------------- backup ed export/import dei settaggi

  /** Scarica dei byte (o un testo) col nome dato, nella cartella Download. */
  function scarica(dati, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([dati], { type: 'application/octet-stream' }));
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  const due = n => String(n).padStart(2, '0');
  /** «2026-11-07 10-15-03», come nel nome dei .glb dell'app. */
  const quando = (d = new Date()) => d.getFullYear() + '-' + due(d.getMonth() + 1) + '-' + due(d.getDate()) +
    ' ' + due(d.getHours()) + '-' + due(d.getMinutes()) + '-' + due(d.getSeconds());
  const nomeFile = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim();

  let backupInCorso = null;         // { fermo } mentre il backup legge i tone

  function scriviBackup(testo, tipo) {
    const p = $('#backup-stato');
    p.textContent = testo;
    p.className = 'nota' + (tipo ? ' ' + tipo : '');
  }

  function apriBackup() {
    if (!ble || !ble.collegato()) return;
    if (!backupInCorso) scriviBackup('');
    $('#dialogo-backup').showModal();
    elencoSicurezza();
    if (dropbox && dropbox.autorizzato()) elencoDropbox();
  }

  /** Tutti i tone (un .prst ciascuno, come «Export All Tones» dell'app), i settaggi (.glb) e le Songlist in uno
   *  .zip: nella cartella Download, o su Dropbox con suDropbox === true. */
  async function backupCompleto(suDropbox) {
    suDropbox = suDropbox === true;           // dal clic arriva l'evento
    if (backupInCorso || !ble || !ble.collegato()) return;
    if (suDropbox && !(dropbox && dropbox.autorizzato())) return;
    const corsa = backupInCorso = { fermo: false };
    const bottoni = ['#backup-tutto', '#backup-esporta', '#backup-importa', '#backup-sl-esporta', '#backup-sl-importa',
      '#db-su', '#db-settaggi', '#db-songlist', '#db-scarica', '#backup-tone', '#db-tone'];
    bottoni.forEach(b => { $(b).disabled = true; });
    $('#backup-ferma').hidden = false;
    try {
      scriviBackup('Leggo i nomi dei tone…');
      nomiTone = (await ble.chiediNomi()).nomi;
      const posti = nomiTone.map((n, i) => (n ? i : -1)).filter(i => i >= 0);
      const file = [];
      const aggiungi = (n, c) => {
        const { tone, opz } = window.PulzePrst.daMini(c);
        file.push({
          posto: n,
          nome: String(n + 1).padStart(3, '0') + ' ' + (nomeFile(tone.nome) || 'tone') + '.prst',
          testo: window.PulzePrst.scrivi(tone, Object.assign({ versione: '2.1.3' }, opz)),
        });
      };
      let saltati = [];
      for (let k = 0; k < posti.length; k++) {
        if (corsa.fermo) throw new Error('fermato');
        const n = posti[k];
        scriviBackup('Leggo il tone ' + (k + 1) + ' di ' + posti.length + ': «' + nomiTone[n] + '»…');
        const c = await ble.chiediToneIntero(n);
        if (c) aggiungi(n, c); else saltati.push(n);
      }
      // quelli saltati si richiedono alla fine, dopo una pausa: di solito il Mini era solo occupato
      for (let giro = 0; giro < 2 && saltati.length; giro++) {
        await new Promise(r => setTimeout(r, 2000));
        const ancora = [];
        for (let k = 0; k < saltati.length; k++) {
          if (corsa.fermo) throw new Error('fermato');
          const n = saltati[k];
          scriviBackup('Riprovo i tone saltati: ' + (k + 1) + ' di ' + saltati.length + ', «' + nomiTone[n] + '»…');
          const c = await ble.chiediToneIntero(n);
          if (c) aggiungi(n, c); else ancora.push(n);
        }
        saltati = ancora;
      }
      file.sort((a, b) => a.posto - b.posto);
      const mancanti = saltati.map(n => n + 1);
      if (corsa.fermo) throw new Error('fermato');
      scriviBackup('Leggo i settaggi…');
      const ora = new Date();
      file.push({ nome: 'Global' + quando(ora) + '.glb', testo: window.PulzePrst.glbDaMini(await ble.chiediSettaggi()) });
      scriviBackup('Leggo le Songlist…');
      const sl = P.leggiSonglist((await ble.chiediSonglist()).corpo);
      file.push({ nome: 'Songlist' + quando(ora) + '.json', testo: JSON.stringify(songlistPerFile(sl, nomiTone), null, 2) });
      let nome = 'Pulze Mini backup ' + quando(ora) + '.zip', dove = 'nella cartella Download';
      const dati = window.PulzePrst.zip(file, ora);
      if (corsa.fermo) throw new Error('fermato');
      if (suDropbox) {
        scriviBackup('Mando il backup su Dropbox…');
        nome = (await dropbox.carica(nome, dati)).name || nome;
        dove = 'su Dropbox';
      } else scarica(dati, nome);
      try { localStorage.setItem(ULTIMO_BACKUP, String(Date.now())); } catch (e) { /* niente */ }
      disegnaUltimoBackup();
      scriviBackup('Fatto: «' + nome + '» ' + dove + ', ' + (file.length - 2) + ' tone, i settaggi e ' + sl.liste.length + ' Songlist.' +
        (mancanti.length ? ' Non letti (il Mini non ha risposto): ' + mancanti.join(', ') + '.' : ''), mancanti.length ? 'errore' : 'ok');
      if (suDropbox) elencoDropbox(nome);
    } catch (e) {
      scriviBackup(e.message === 'fermato' ? 'Backup fermato: non è stato salvato niente.' : 'Backup non riuscito: ' + e.message + '.', 'errore');
    } finally {
      backupInCorso = null;
      bottoni.forEach(b => { $(b).disabled = false; });
      $('#backup-ferma').hidden = true;
    }
  }

  async function esportaSettaggi() {
    if (!ble || !ble.collegato()) return;
    try {
      scriviBackup('Leggo i settaggi…');
      const nome = 'Global' + quando() + '.glb';
      scarica(window.PulzePrst.glbDaMini(await ble.chiediSettaggi()), nome);
      scriviBackup('Esportati in «' + nome + '» (nella cartella Download).', 'ok');
    } catch (e) {
      scriviBackup('Esportazione non riuscita: ' + e.message + '.', 'errore');
    }
  }

  async function importaSettaggi(f) {
    if (!f || !ble || !ble.collegato()) return;
    try {
      const testo = await f.text();
      window.PulzePrst.leggiGlb(testo);           // prima di toccare il Mini: è un .glb buono?
      if (!confirm('Metto sul Mini i settaggi di «' + f.name + '»? Quelli di adesso vengono sostituiti ' +
        '(conviene prima «Esporta settaggi»).')) { scriviBackup('Importazione annullata.'); return; }
      scriviBackup('Leggo i settaggi di adesso…');
      const attuale = await ble.chiediSettaggi();
      await copiaSicurezza('settaggi', 'prima di importare «' + f.name + '»', 'Global' + quando() + '.glb', window.PulzePrst.glbDaMini(attuale));
      const batteria = (await ble.chiedi(6, 1, [], m => m.tipo === 6 && m.gruppo === 1 && m.comando === 0x12)).corpo;
      const nuovo = window.PulzePrst.glbAlMini(testo, attuale, batteria);
      scriviBackup('Mando i settaggi…');
      await ble.manda((num, max) => P.scriviSettaggi(num, nuovo, max));
      const letto = await ble.chiediSettaggi();
      const diversi = nuovo.map((x, i) => (x === letto[i] || (i >= 96 && i < 104) ? -1 : i)).filter(i => i >= 0);
      await leggiGenerali();
      disegna();
      scriviBackup(!diversi.length ? 'Settaggi di «' + f.name + '» messi sul Mini (riletti: uguali).'
        : 'Settaggi mandati, ma riletti non sono del tutto uguali (byte ' + diversi.join(', ') + '): controlla dalle Impostazioni.',
        diversi.length ? 'errore' : 'ok');
    } catch (e) {
      scriviBackup('Importazione non riuscita: ' + e.message + '.', 'errore');
    }
  }

  // ---------------------------------------------------------------- le copie di sicurezza

  // Prima di un lavoro che sovrascrive qualcosa sul Mini (importare settaggi o Songlist, ripristinare preset,
  // salvare o copiare su un posto pieno, cancellare un tone) la pagina tiene una copia di com'era, da sola, nel
  // browser (IndexedDB): la finestra Backup le elenca e le rimette con gli stessi comandi del backup. Le ultime 40.
  // Una copia non riuscita non ferma il lavoro: lo dice e basta.
  const SICUREZZA_MAX = 40;
  let dbSicurezza = null;

  function apriSicurezza() {
    if (dbSicurezza) return dbSicurezza;
    dbSicurezza = new Promise((ok, no) => {
      const r = indexedDB.open('pulzemazz-sicurezza', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('copie', { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    dbSicurezza.catch(() => { dbSicurezza = null; });
    return dbSicurezza;
  }

  async function negozioSicurezza(modo) {
    return (await apriSicurezza()).transaction('copie', modo).objectStore('copie');
  }
  const richiesta = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

  /** Tiene una copia: tipo 'settaggi' | 'songlist' | 'tone', perché (a parole), nome del file, dati (testo o byte). */
  async function copiaSicurezza(tipo, perche, nome, dati) {
    try {
      await richiesta((await negozioSicurezza('readwrite')).add({ quando: Date.now(), tipo, perche, nome, dati }));
      const chiavi = await richiesta((await negozioSicurezza('readonly')).getAllKeys());
      if (chiavi.length > SICUREZZA_MAX) {
        const st = await negozioSicurezza('readwrite');
        for (const k of chiavi.slice(0, chiavi.length - SICUREZZA_MAX)) st.delete(k);
      }
      if ($('#dialogo-backup').open) elencoSicurezza();
      return true;
    } catch (e) {
      scriviStato('Copia di sicurezza non riuscita (' + (e && e.message) + '): il lavoro va avanti lo stesso.', 'errore');
      return false;
    }
  }

  /** Un tone letto dal Mini (0/0) come file «NNN Nome.prst», come nel backup completo. */
  function fileTone(n, c) {
    const { tone, opz } = window.PulzePrst.daMini(c);
    return { nome: String(n + 1).padStart(3, '0') + ' ' + (nomeFile(tone.nome) || 'tone') + '.prst',
      testo: window.PulzePrst.scrivi(tone, Object.assign({ versione: '2.1.3' }, opz)) };
  }

  /** Copia dei tone nei posti dati (quelli pieni), in uno .zip che «Ripristina preset» sa rimettere.
   *  letti: { posto: corpo 0/0 } già in mano, per non rileggerli. */
  async function sicurezzaTone(posti, perche, letti) {
    const file = [];
    try {
      for (const n of [...new Set(posti)]) {
        if (!nomiTone || !nomiTone[n]) continue;
        const c = (letti && letti[n]) || await ble.chiediToneIntero(n);
        if (c) file.push(fileTone(n, c));
      }
    } catch (e) {
      scriviStato('Copia di sicurezza non riuscita (' + e.message + '): il lavoro va avanti lo stesso.', 'errore');
      return;
    }
    if (!file.length) return;
    const ora = new Date();
    await copiaSicurezza('tone', perche, 'Copia di sicurezza ' + quando(ora) + '.zip', window.PulzePrst.zip(file, ora));
  }

  const quandoUmano = ms => {
    const d = new Date(ms), oggi = new Date();
    const ieri = new Date(oggi); ieri.setDate(oggi.getDate() - 1);
    const ora = due(d.getHours()) + ':' + due(d.getMinutes());
    if (d.toDateString() === oggi.toDateString()) return 'oggi ' + ora;
    if (d.toDateString() === ieri.toDateString()) return 'ieri ' + ora;
    return d.getDate() + '/' + (d.getMonth() + 1) + ' ' + ora;
  };

  async function elencoSicurezza() {
    const ol = $('#sic-elenco');
    let copie = [];
    try { copie = await richiesta((await negozioSicurezza('readonly')).getAll()); } catch (e) { /* senza IndexedDB: vuoto */ }
    copie.reverse();
    $('#sic-quante').textContent = copie.length ? String(copie.length) : '';
    ol.textContent = '';
    if (!copie.length) { ol.appendChild(el('li', 'sic-vuoto', 'Ancora nessuna: si fanno da sole prima dei lavori che sovrascrivono qualcosa.')); return; }
    const TIPI = { settaggi: 'Settaggi', songlist: 'Songlist', tone: 'Preset' };
    for (const c of copie) {
      const li = el('li');
      li.appendChild(el('span', 'sic-quando', quandoUmano(c.quando)));
      li.appendChild(el('span', 'sic-tipo', TIPI[c.tipo] || c.tipo));
      li.appendChild(el('span', 'sic-perche', c.perche));
      const rimetti = el('button', '', 'Ripristina');
      rimetti.type = 'button';
      rimetti.addEventListener('click', () => rimettiSicurezza(c));
      const giu = el('button', 'lieve', 'Scarica');
      giu.type = 'button';
      giu.title = 'Nella cartella Download';
      giu.addEventListener('click', () => { scarica(c.dati, c.nome); scriviBackup('«' + c.nome + '» nella cartella Download.', 'ok'); });
      li.appendChild(rimetti);
      li.appendChild(giu);
      ol.appendChild(li);
    }
  }

  /** Rimette una copia con gli stessi comandi del backup (che prima ne fanno un'altra di com'è adesso). */
  async function rimettiSicurezza(c) {
    if (backupInCorso || ripristino || !ble || !ble.collegato()) return;
    const dati = typeof c.dati === 'string' ? new TextEncoder().encode(c.dati) : c.dati;
    if (c.tipo === 'tone') { await apriRipristino(dati.buffer.slice(dati.byteOffset, dati.byteOffset + dati.byteLength), c.nome); return; }
    scriviBackup('');
    if (c.tipo === 'settaggi') await importaSettaggi(new File([dati], c.nome));
    if (c.tipo === 'songlist') await importaSonglist(new File([dati], c.nome));
  }

  // L'ultimo backup completo (sul PC o su Dropbox), scritto nel menu ☰: dopo due settimane in ambra.
  const ULTIMO_BACKUP = 'pulzemazz.ultimoBackup';
  function disegnaUltimoBackup() {
    let ms = 0;
    try { ms = +localStorage.getItem(ULTIMO_BACKUP) || 0; } catch (e) { /* niente */ }
    const s = $('#ultimo-backup');
    const giorni = ms ? Math.floor((Date.now() - ms) / 86400000) : null;
    s.textContent = !ms ? 'mai fatto un backup' : giorni === 0 ? 'ultimo backup: oggi' : giorni === 1 ? 'ultimo backup: ieri'
      : 'ultimo backup: ' + giorni + ' giorni fa';
    s.classList.toggle('vecchio', !ms || giorni >= 14);
  }

  // ---------------------------------------------------------------- i backup su Dropbox
  // Il trasporto è src/pulze-dropbox.js (lo stesso dello Spark). Chiave, refresh token e verifier stanno in
  // localStorage: l'editor si apre sempre da http://localhost:8100, quindi restano.

  const DB = { chiave: 'pulzemazz.dropbox.chiave', refresh: 'pulzemazz.dropbox.refresh', verifier: 'pulzemazz.dropbox.verifier' };
  const memoDb = k => { try { return localStorage.getItem(k) || null; } catch (e) { return null; } };
  const memoDbScrivi = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* niente */ } };
  let dropbox = null;

  async function preparaDropbox() {
    dropbox = new window.PulzeDropbox.Client({
      appKey: memoDb(DB.chiave) || '', refreshToken: memoDb(DB.refresh),
      salvaRefresh: v => memoDbScrivi(DB.refresh, v),
    });
    $('#db-chiave').value = dropbox.appKey;
    disegnaDropbox();
    // un'autorizzazione lasciata a metà si riprende (stesso verifier), non si ricomincia
    const sospeso = memoDb(DB.verifier);
    if (sospeso && !dropbox.autorizzato() && dropbox.appKey) {
      $('#db-link').href = window.PulzeDropbox.urlAutorizza(dropbox.appKey, await window.PulzeDropbox.sfida(sospeso));
      $('#db-passo-due').hidden = false;
    }
  }

  function disegnaDropbox() {
    const si = Boolean(dropbox && dropbox.autorizzato());
    $('#db-collegato').hidden = !si;
    $('#db-da-collegare').hidden = si;
  }

  /** Riempie l'elenco dei backup lassù, dal più nuovo; `scegli` è il nome da mettere selezionato. */
  async function elencoDropbox(scegli) {
    const sel = $('#db-elenco');
    sel.innerHTML = '<option value="">leggo Dropbox…</option>';
    try {
      const voci = await dropbox.elenco();
      sel.innerHTML = '';
      if (!voci.length) sel.innerHTML = '<option value="">(nessun backup su Dropbox)</option>';
      for (const v of voci) {
        const o = document.createElement('option');
        o.value = v.nome;
        o.textContent = v.nome.replace(/\.zip$/i, '') + ' — ' + Math.max(1, Math.round(v.byte / 1024)) + ' KB';
        sel.appendChild(o);
      }
      if (scegli) sel.value = scegli;
    } catch (e) {
      sel.innerHTML = '<option value="">(Dropbox non letto)</option>';
      scriviBackup('Non riesco a leggere Dropbox: ' + e.message + '.', 'errore');
    }
  }

  async function collegaDropbox() {
    const chiave = $('#db-chiave').value.trim();
    if (!chiave) { scriviBackup('Serve l\'app key della tua app Dropbox.', 'errore'); return; }
    if (chiave !== memoDb(DB.chiave)) memoDbScrivi(DB.verifier, null);      // chiave nuova: si ricomincia
    memoDbScrivi(DB.chiave, chiave);
    dropbox.appKey = chiave;
    // il verifier si riusa finché l'autorizzazione non riesce: rigenerarlo renderebbe inutile il codice già copiato
    let verifier = memoDb(DB.verifier);
    if (!verifier) { verifier = window.PulzeDropbox.nuovoVerifier(); memoDbScrivi(DB.verifier, verifier); }
    const url = window.PulzeDropbox.urlAutorizza(chiave, await window.PulzeDropbox.sfida(verifier));
    $('#db-link').href = url;
    $('#db-passo-due').hidden = false;
    const finestra = window.open(url, '_blank', 'noopener');
    scriviBackup(finestra === null ? 'Il browser ha bloccato la finestra: premi «apri Dropbox».'
      : 'Su Dropbox premi «Consenti», copia il codice e incollalo qui.');
    $('#db-codice').focus();
  }

  async function finisciDropbox() {
    const codice = $('#db-codice').value.trim();
    if (!codice) { scriviBackup('Incolla il codice che ti ha dato Dropbox.', 'errore'); return; }
    const verifier = memoDb(DB.verifier);
    if (!verifier) { scriviBackup('Ricomincia da «Collega».', 'errore'); return; }
    try {
      scriviBackup('Collego Dropbox…');
      await dropbox.completaAutorizzazione(verifier, codice);
      memoDbScrivi(DB.verifier, null);
      $('#db-codice').value = '';
      $('#db-passo-due').hidden = true;
      disegnaDropbox();
      scriviBackup('Dropbox collegato.', 'ok');
      elencoDropbox();
    } catch (e) {
      scriviBackup('Dropbox non ha accettato il codice' + (/non vale più/.test(e.message) ? '' : ' (' + e.message + ')') + '. Un codice vale una volta sola: ' +
        'premi «apri Dropbox», «Consenti» e incolla quello nuovo.', 'errore');
    }
  }

  /** Il backup scelto nell'elenco, scaricato: { nome, buf } o null. */
  async function backupScelto() {
    const nome = $('#db-elenco').value;
    if (!nome) { scriviBackup('Su Dropbox non c\'è ancora un backup: fai prima «Backup su Dropbox».', 'errore'); return null; }
    scriviBackup('Prendo «' + nome + '» da Dropbox…');
    try {
      return { nome, buf: await dropbox.scarica(nome) };
    } catch (e) {
      scriviBackup('Non riesco a prenderlo: ' + e.message + '.', 'errore');
      return null;
    }
  }

  async function settaggiDaDropbox() {
    if (backupInCorso) return;
    const b = await backupScelto();
    if (!b) return;
    const glb = (await leggiZip(b.buf)).find(x => /\.glb$/i.test(x.nome));
    if (!glb) { scriviBackup('In «' + b.nome + '» non ci sono i settaggi.', 'errore'); return; }
    scriviBackup('');
    await importaSettaggi(new File([glb.dati], glb.nome));
  }

  async function songlistDaDropbox() {
    if (backupInCorso) return;
    const b = await backupScelto();
    if (!b) return;
    scriviBackup('');
    await importaSonglist(new File([b.buf], b.nome));
  }

  async function scaricaDaDropbox() {
    const b = await backupScelto();
    if (!b) return;
    scarica(new Uint8Array(b.buf), b.nome);
    scriviBackup('«' + b.nome + '» scaricato nella cartella Download.', 'ok');
  }

  async function scollegaDropbox() {
    if (!confirm('Scollego Dropbox? I backup lassù restano dove sono.')) return;
    const revocato = await dropbox.scollega();
    disegnaDropbox();
    scriviBackup(revocato ? 'Dropbox scollegato.' : 'Dropbox scollegato qui (lassù non ho potuto revocarlo: si toglie da dropbox.com, app collegate).', 'ok');
  }

  // ---------------------------------------------------------------- l'import .prst

  const AUTO_CAB = 0x0A000000;      // il segnaposto «auto cab» dei file di Reniori, non un modello
  let daImportare = null;           // il preset letto, in attesa di conferma
  let nomeProposto = null;          // il nome del file importato, proposto nella finestra di salvataggio
  let importando = false;

  /** Il nome come lo vuole il Mini: da 1 a 16 caratteri ASCII. */
  function nomeMini(n) {
    const s = String(n || '').normalize('NFD').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 16).trim();
    return s || 'Importato';
  }
  const catenaValida = c => Array.isArray(c) && c.length === 7 && c.slice().sort().join() === '0,1,2,3,4,5,6';
  const valoriValidi = v => Array.isArray(v) && v.length === 15 && v.every(Number.isFinite);

  /** Per slot, cosa fa l'import: { uid } = il modello del file coi suoi valori; { tieni } = resta il
   *  modello del tone, e perché. acceso: se l'on/off del file vale anche lì. */
  function pianoSlot(p, s) {
    const fb = p.blocchi[s];
    if (fb.tieni) return { tieni: fb.tieni };
    const m = C.modelli[fb.uid];
    if (fb.uid === AUTO_CAB) return { tieni: 'il file non dice il cabinet («auto cab»)', acceso: true };
    if (!m) return { tieni: 'modello sconosciuto (' + (fb.uid >>> 24) + '/' + (fb.uid & 0xffff) + ')' };
    if (C.moduli[s] && !C.moduli[s].includes(fb.uid)) return { tieni: m.n + ' non va in ' + P.SLOT[s] };
    if (!valoriValidi(fb.valori)) return { tieni: 'valori di ' + m.n + ' illeggibili' };
    return { uid: fb.uid, acceso: true };
  }

  function scegliFile() {
    const i = $('#importa-file');
    i.value = '';
    i.click();
  }

  async function fileScelto() {
    const f = $('#importa-file').files[0];
    if (!f) return;
    try {
      daImportare = window.PulzePrst.aTone(await f.text());
    } catch (e) {
      scriviStato('«' + f.name + '» non si legge: ' + e.message + '.', 'errore');
      return;
    }
    mostraAnteprima(daImportare, f.name);
  }

  /** La finestra con cosa c'è nel file e cosa cambia nel tone che suona. */
  function mostraAnteprima(p, nomeFile) {
    const t = stato.testa;
    $('#importa-titolo').textContent = (p.spiegazione != null ? 'Prova «' : 'Importa «') + (p.nome || nomeFile) + '»';
    const lista = $('#importa-blocchi');
    lista.textContent = '';
    const catena = catenaValida(p.catena) ? p.catena : t.catena;
    catena.forEach((s, posizione) => {
      const pl = pianoSlot(p, s);
      const fb = p.blocchi[s];
      const li = el('li', fb.acceso ? '' : 'spento');
      li.appendChild(el('span', 'n', String(posizione + 1)));
      li.appendChild(el('span', 'slot', P.SLOT[s]));
      const nome = (pl.uid != null ? nomeModello(pl.uid) : nomeModello(t.uid[s])) || '?';
      li.appendChild(el('span', 'modello', nome));
      li.appendChild(el('span', 'acceso', fb.acceso ? 'acceso' : 'spento'));
      if (pl.tieni) li.appendChild(el('span', 'nota-slot', 'resta quello del tone: ' + pl.tieni));
      lista.appendChild(li);
    });
    const note = [];
    if (p.spiegazione) note.push(p.spiegazione);
    if (p.avvisi && p.avvisi.length) note.push('Attenzione: ' + p.avvisi.join('; ') + '.');
    note.push('Volume ' + p.volume + ', tempo ' + p.tempo + ' bpm.');
    if (p.dispositivo && p.dispositivo !== 'AP-10') note.push('Il file è per «' + p.dispositivo + '», non per il Pulze Mini (AP-10).');
    // una frase per pezzo, così ognuna si traduce da sola (src/pulze-lingua.js)
    const box = $('#importa-note');
    box.textContent = '';
    note.forEach((n, i) => box.appendChild(el('span', '', (i ? ' ' : '') + n)));
    $('#dialogo-importa').showModal();
  }

  /** Il cuore dell'import: mette il preset p nel tone che suona (catena, volume, tempo, modelli, valori,
   *  on/off), rilegge i sette blocchi e restituisce le differenze col file. dire(testo) = l'avanzamento. */
  async function mettiNelTone(p, piano, catenaFile, volume, tempo, dire) {
    const t = stato.testa;
    const avvisi = [];
    // 1. volume, tempo e catena: la testa rimandata, poi riletta per vedere cosa ha preso il Mini
    dire('Importo: volume, tempo e catena…');
    const catenaPrima = t.catena.slice();
    const testa = { corpo: t.corpo, volume, tempo, accesi: t.accesi,
      catena: catenaFile || catenaPrima, uid: t.uid.slice() };
    await ble.manda((num, max) => P.scriviTesta(num, testa, max));
    await ble.chiediTesta();                      // passa da alMessaggio: stato.testa è quella nuova
    const catenaDopo = stato.testa.catena;
    if (catenaFile && catenaDopo.join() !== catenaFile.join()) avvisi.push('il Mini ha tenuto l\'ordine della catena');
    if (catenaDopo.join() !== catenaPrima.join()) {
      // i blocchi stanno in altre posizioni: i corpi letti (byte 0 = posizione) non valgono più
      for (let pos = 0; pos < 7; pos++) {
        dire('Importo: la catena è cambiata, rileggo il blocco ' + (pos + 1) + ' di 7…');
        await ble.chiediBlocco(pos);
      }
    }

    // 2. slot per slot, nell'ordine della catena
    for (const s of stato.testa.catena.slice()) {
      const pl = piano[s];
      const fb = p.blocchi[s];
      const pos = stato.testa.catena.indexOf(s);
      // riletto sempre: con l'Auto CAB acceso, un ampli nuovo fa cambiare il cabinet al Mini
      let b = P.leggiBlocco((await ble.chiediBlocco(pos)).corpo);
      if (pl.uid != null) {
        const nome = nomeModello(pl.uid);
        if (b.uid !== pl.uid) {
          dire('Importo: ' + nome + ' in ' + P.SLOT[s] + '…');
          const nuovo = Object.assign({}, b, { uid: pl.uid, valori: b.valori.slice() });
          await ble.manda((num, max) => P.cambiaModello(num, nuovo, 0, max));
          await ble.manda((num, max) => P.cambiaModello(num, nuovo, 2, max));
          b = P.leggiBlocco((await ble.chiediBlocco(pos)).corpo);
          if (b.uid !== pl.uid) {
            avvisi.push(P.SLOT[s] + ': il Mini non ha preso ' + nome);
            continue;
          }
        }
        dire('Importo: i valori di ' + nome + '…');
        // da «Crea preset…»: solo manopole e Sync, sopra i valori che ha il Mini (dopo un cambio di
        // modello sono quelli di fabbrica); le altre posizioni del blocco restano sue
        if (fb.sopra) {
          fb.valori = b.valori.slice();
          for (const [q, v] of Object.entries(fb.sopra)) fb.valori[+q] = v;
        }
        const scritto = { corpo: b.corpo, uid: b.uid, acceso: b.acceso, valori: fb.valori.slice() };
        await ble.manda((num, max) => P.scriviBlocco(num, scritto, max));
        stato.blocchi[s] = Object.assign({}, b, { valori: fb.valori.slice() });
        disegna();
      }
      if (pl.acceso && b.acceso !== fb.acceso) {
        dire('Importo: ' + P.SLOT[s] + ' ' + (fb.acceso ? 'acceso' : 'spento') + '…');
        const risposta = ble.aspetta(m => m.comando === 0x12 && m.tipo === P.TIPO.BLOCCO && m.gruppo === 0 &&
          m.corpo[2] === s, 3000);
        ble.mandaCC(P.ccBlocco(s), fb.acceso ? 127 : 0);
        await risposta.catch(() => ble.chiediBlocco(pos));
      }
    }

    // 3. il controllo: i sette blocchi riletti, confrontati col file
    for (let pos = 0; pos < 7; pos++) {
      dire('Importo: controllo il blocco ' + (pos + 1) + ' di 7…');
      await ble.chiediBlocco(pos);
    }
    // Le manopole diverse dal file in un blocco riletto. Solo le posizioni che sono manopole (e i Sync):
    // nelle altre il Mini tiene i suoi valori (provato il 5 novembre: CloudDiezel). Una manopola che il Mini
    // ha solo arrotondato al suo passo (461 ms → 460) non è diversa; quelle diverse davvero si dicono per
    // nome coi due valori, «FX1: Time 460 ms (file: 480 ms)» (prima: «1 valore diverso dal file»).
    const manopoleDiverse = (uid, fb, b) => {
      const diversi = [];
      for (const k of C.modelli[uid].k) {
        const [nome, pos, tipo] = k;
        const vf = fb.valori[pos], vm = b.valori[pos];
        let tolleranza = 1e-4 * Math.max(1, Math.abs(vf));
        if (tipo === 'c' || tipo === 'd') {
          const [, , , min, max, u] = k;
          tolleranza = Math.max(tolleranza, (passoDi(k) || passo(min, max, u)) * 0.51);
        } else if (tipo === 'o') tolleranza = Math.max(tolleranza, Math.abs(vf) * 0.006);
        const diverso = Math.abs(Math.fround(vf) - vm) > tolleranza ||
          (tipo === 'd' && (fb.valori[k[6]] >= 0.5) !== (b.valori[k[6]] >= 0.5));
        if (diverso) diversi.push({ k, testo: nome + ' ' + valoreDi(k, b.valori).testo + ' (file: ' + valoreDi(k, fb.valori).testo + ')' });
      }
      return diversi;
    };
    for (let s = 0; s < 7; s++) {
      const pl = piano[s], fb = p.blocchi[s];
      let b = stato.blocchi[s];
      if (!b) { avvisi.push(P.SLOT[s] + ' non riletto'); continue; }
      if (pl.uid != null && b.uid !== pl.uid) avvisi.push(P.SLOT[s] + ': il Mini dice ' + (nomeModello(b.uid) || '?'));
      else if (pl.uid != null) {
        let diversi = manopoleDiverse(pl.uid, fb, b);
        if (diversi.length) {
          // Un secondo tentativo: il blocco riscritto con le manopole del file, poi riletto. Il 9 novembre,
          // da Crea preset AI sul sito, il Time di un Digi Dly è rimasto a 500 ms (fabbrica) invece di 560,
          // con tutte le altre manopole giuste; rifatto a mano e da un .prst uguale, invece, va: la causa
          // non si è vista (online non c'è il registro), quindi si riprova e si controlla di nuovo.
          salvaRegistro('import: ' + P.SLOT[s] + ' diverso al primo giro: ' + diversi.map(d => d.testo).join(', '));
          const pos = stato.testa.catena.indexOf(s);
          const valori = b.valori.slice();
          for (const { k } of diversi) { valori[k[1]] = fb.valori[k[1]]; if (k[2] === 'd') valori[k[6]] = fb.valori[k[6]]; }
          dire('Importo: riscrivo ' + P.SLOT[s] + '…');
          await ble.manda((num, max) => P.scriviBlocco(num, { corpo: b.corpo, uid: b.uid, acceso: b.acceso, valori }, max));
          await new Promise(r => setTimeout(r, RITMO_MS * 2));
          b = P.leggiBlocco((await ble.chiediBlocco(pos)).corpo);
          diversi = manopoleDiverse(pl.uid, fb, b);
          salvaRegistro('import: ' + P.SLOT[s] + ' al secondo giro: ' + (diversi.length ? diversi.map(d => d.testo).join(', ') : 'uguale'));
        }
        if (diversi.length) avvisi.push(P.SLOT[s] + ': ' + diversi.map(d => d.testo).join(', '));
      }
      if (pl.acceso && b.acceso !== fb.acceso) avvisi.push(P.SLOT[s] + ' ' + (b.acceso ? 'acceso' : 'spento') + ', nel file no');
    }
    const tDopo = stato.testa;
    if (tDopo.volume !== volume || tDopo.tempo !== tempo) avvisi.push('volume ' + tDopo.volume + ', tempo ' + tDopo.tempo);
    return avvisi;
  }

  /** Mette il preset nel tone che suona: catena, volume e tempo con la testa; per slot il cambio di
   *  modello (se serve), il blocco coi valori del file e l'on/off col CC del tipo (45-51); poi rilegge
   *  tutto e confronta col file. */
  async function importa() {
    const p = daImportare;
    $('#dialogo-importa').close();
    const t = stato.testa;
    if (!p || !t) return;
    registra('i' + Date.now());
    const piano = p.blocchi.map((_, s) => pianoSlot(p, s));
    const catenaFile = catenaValida(p.catena) ? p.catena.slice() : null;
    const volume = Math.round(stretto(+p.volume || 0, 0, 100));
    const tempo = Math.round(stretto(+p.tempo || 120, 40, 250));
    nomeProposto = nomeMini(p.nome);
    if (!ble || !ble.collegato()) { importaQui(p, piano, catenaFile, volume, tempo); return; }

    importando = true;
    disegnaTesta();
    try {
      const avvisi = await mettiNelTone(p, piano, catenaFile, volume, tempo, scriviStato);
      segnaModificato();
      const tenuti = piano.filter(pl => pl.tieni).length;
      if (avvisi.length) {
        scriviStato('Importato «' + p.nome + '», ma: ' + avvisi.join('; ') + '. Niente è salvato.', 'errore');
        salvaRegistro('import di «' + p.nome + '»: ' + avvisi.join('; '));
      } else {
        scriviStato('Importato «' + p.nome + '» nel tone che suona' +
          (tenuti ? ' (' + tenuti + (tenuti === 1 ? ' blocco tenuto' : ' blocchi tenuti') + ' dal tone)' : '') +
          '. Per tenerlo: Salva… (propone «' + nomeProposto + '»).', 'ok');
      }
    } catch (e) {
      scriviStato('Import interrotto: ' + e.message + '. Il tone è a metà: Rileggi per vedere com\'è.', 'errore');
      salvaRegistro('import interrotto: ' + e.message);
    } finally {
      importando = false;
      disegna();
    }
  }

  /** Senza Mini (l'esempio): il preset va solo nella pagina. */
  function importaQui(p, piano, catenaFile, volume, tempo) {
    const t = stato.testa;
    t.volume = volume; t.tempo = tempo;
    if (catenaFile) t.catena = catenaFile;
    piano.forEach((pl, s) => {
      const fb = p.blocchi[s];
      const b = stato.blocchi[s];
      if (!b) return;
      if (pl.uid != null) { b.uid = pl.uid; b.valori = fb.valori.slice(); t.uid[s] = pl.uid; }
      if (pl.acceso) b.acceso = fb.acceso;
      t.accesi = (t.accesi & ~(1 << s)) | ((b.acceso ? 1 : 0) << s);
    });
    segnaModificato();
    disegna();
    scriviStato('Esempio: «' + p.nome + '» importato nella pagina, niente va al Mini.', 'esempio');
  }

  // ---------------------------------------------------------------- «Crea preset AI», copia e incolla

  // Come in SparklingTones: niente API né chiavi. La pagina prepara la domanda intera (istruzioni,
  // catalogo, descrizione) e la copia negli appunti; l'utente la incolla nella chat che usa e
  // incolla qui la risposta, che pulze-ricetta.js fa diventare un tone. Il tone passa poi
  // dall'anteprima e dall'import come un file .prst.
  const R = window.PulzeRicetta;

  function apriCrea() {
    // le chiavi API della versione di prima non servono più: via dal browser
    for (const k of ['openai.chiave', 'openai.modello', 'claude.chiave', 'claude.modello', 'ai']) {
      try { localStorage.removeItem('pulzemax.' + k); } catch (e) { /* niente */ }
    }
    $('#crea-parti').disabled = !stato.testa || stato.blocchi.some(b => !b);
    $('#crea-errore').textContent = '';
    $('#crea-risposta').value = '';
    $('#dialogo-crea').showModal();
    $('#crea-testo').focus();
  }

  /** La domanda intera da incollare nella chat. */
  function domandaAI() {
    const testo = $('#crea-testo').value.trim();
    const parti = $('#crea-parti').checked && !$('#crea-parti').disabled;
    let richiesta = 'Request: ' + testo;
    if (parti) richiesta = 'Current preset on the device:\n' + R.descriviTone(C, {
      nome: stato.testa.nome, volume: stato.testa.volume, tempo: stato.testa.tempo, catena: stato.testa.catena,
      blocchi: stato.blocchi }, nomeModello) + '\n\n' + richiesta;
    return R.istruzioni(C, { utente: stato.nomiUtente, parti, lingua: LINGUA }) + '\n\n' + richiesta;
  }

  async function copiaDomanda() {
    const errore = m => { $('#crea-errore').textContent = m; };
    if (!$('#crea-testo').value.trim()) { errore('Scrivi che suono vuoi.'); $('#crea-testo').focus(); return; }
    const domanda = domandaAI();
    try {
      await navigator.clipboard.writeText(domanda);
    } catch (e) {
      // senza permesso per gli appunti: la vecchia strada, da un campo nascosto
      const t = el('textarea'); t.value = domanda; document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove();
      if (!ok) { errore('Non riesco a copiare negli appunti.'); return; }
    }
    errore('');
    const b = $('#crea-copia'), prima = b.textContent;
    b.textContent = 'Copiata: incollala nella chat';
    setTimeout(() => { b.textContent = prima; }, 2500);
    $('#crea-risposta').focus();
  }

  /** Il JSON dentro la risposta (anche se l'AI ci mette del testo o un blocco di codice intorno). */
  function soloJson(t) {
    const i = t.indexOf('{'), j = t.lastIndexOf('}');
    return i >= 0 && j > i ? t.slice(i, j + 1) : t;
  }

  /** La risposta incollata diventa un tone e apre l'anteprima. */
  function creaPreset() {
    const errore = m => { $('#crea-errore').textContent = m; };
    const contenuto = $('#crea-risposta').value.trim();
    if (!contenuto) { errore('Incolla prima la risposta della chat.'); $('#crea-risposta').focus(); return; }
    if (!/\{[\s\S]*\}/.test(contenuto)) { errore('Nella risposta non c\'è il preset: copiala intera, o chiedi alla chat di rispondere solo col JSON.'); return; }
    try {
      salvaRegistro('crea preset (copia e incolla): «' + $('#crea-testo').value.trim() + '» → ' + contenuto);
      const tone = R.aTone(soloJson(contenuto), C, { utente: stato.nomiUtente, tone: { blocchi: stato.blocchi } });
      $('#dialogo-crea').close();
      daImportare = tone;
      mostraAnteprima(tone, tone.nome);
    } catch (e) {
      errore('La risposta non si legge: ' + e.message);
    }
  }

  // ---------------------------------------------------------------- l'elenco dei tone e le Songlist

  let songlist = null;              // da leggiSonglist: le Songlist nell'ordine dell'app
  let elencoCaricato = false;

  /** Legge Songlist e nomi (come l'app appena collegata) e mostra l'elenco. */
  async function caricaElenco() {
    if (!ble || !ble.collegato()) return;
    $('#elenco').hidden = false;
    try {
      const m = await ble.chiediSonglist();
      songlist = P.leggiSonglist(m.corpo);
      ordineSonglist = m.corpo.slice(0, 40);
      nomiTone = (await ble.chiediNomi()).nomi;
      elencoCaricato = true;
      const sel = $('#elenco-lista');
      const prima = sel.value;
      sel.textContent = '';
      const tutti = el('option', '', 'Tutti i tone'); tutti.value = String(P.LISTA_INTERA); sel.appendChild(tutti);
      for (const l of songlist.liste) {
        const o = el('option', '', l.nome + ' (' + l.toni.length + ')');
        o.value = String(l.posizione);
        sel.appendChild(o);
      }
      sel.value = [...sel.options].some(o => o.value === prima) ? prima : String(P.LISTA_INTERA);
      disegnaElenco();
    } catch (e) {
      $('#elenco-tone').textContent = '';
      $('#elenco-tone').appendChild(el('li', 'attesa', 'Elenco non letto: ' + e.message));
    }
  }

  // ---------------------------------------------------------------- Songlist e tone

  const nomeValido = s => String(s || '').normalize('NFD').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 16);

  /** Manda un'operazione su Songlist o tone (5/2 o 8/2), poi rilegge Songlist e nomi e ridisegna. */
  async function operazioneElenco(testo, crea, attendi9) {
    if (!ble || !ble.collegato()) return false;
    try {
      scriviStato(testo + '…');
      const risposta = attendi9 ? ble.aspetta(m => m.comando === 0x12 && m.tipo === P.TIPO.SALVATO && m.gruppo === 2, 6000) : null;
      await ble.manda(crea);
      if (risposta) await risposta;
      await caricaElenco();
      disegnaSonglist();
      return true;
    } catch (e) {
      scriviStato(testo + ': non riuscito (' + e.message + ').', 'errore');
      return false;
    }
  }

  const ordineAttuale = () => (songlist ? songlist.ordine.filter(x => x !== 0xff) : []);

  async function rinominaTone(tone) {
    const prima = (nomiTone && nomiTone[tone]) || '';
    const nome = nomeValido(prompt('Nuovo nome per «' + prima + '» (al massimo 16 caratteri, senza accenti):', prima));
    if (!nome || nome === prima) return;
    if (await operazioneElenco('Rinomino «' + prima + '»',
      (num, max) => P.operazione(num, P.OP.RINOMINA_TONE, { tone, nomeTone: nome, ordine: ordineAttuale() }, max))) {
      scriviStato('Tone rinominato: «' + nome + '».', 'ok');
      if (stato.testa && stato.testa.numero === tone && ble) await ble.chiediTesta();
    }
  }

  async function cancellaTone(tone) {
    const nome = (nomiTone && nomiTone[tone]) || String(tone + 1);
    if (stato.testa && stato.testa.numero === tone) {
      scriviStato('«' + nome + '» sta suonando: passa a un altro tone prima di cancellarlo.', 'errore');
      return;
    }
    if (!confirm('Cancello il tone «' + nome + '» (posto ' + (tone + 1) + ') dal Mini? Ne resta una copia di sicurezza in Backup….')) return;
    scriviStato('Copia di sicurezza di «' + nome + '»…');
    await sicurezzaTone([tone], 'prima di cancellare «' + nome + '» (posto ' + (tone + 1) + ')');
    // due tentativi: dopo la lettura per la copia il Mini può rispondere «fatto» senza cancellare
    for (let giro = 0; giro < 2; giro++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!await operazioneElenco('Cancello «' + nome + '»', (num, max) => P.cancellaTone(num, [tone], max), true)) return;
      if (!nomiTone[tone]) {
        scriviStato('Tone «' + nome + '» cancellato: il posto ' + (tone + 1) + ' è vuoto.', 'ok');
        salvaRegistro('cancellato «' + nome + '» (posto ' + (tone + 1) + ') al tentativo ' + (giro + 1));
        return;
      }
    }
    salvaRegistro('cancellazione di «' + nome + '» (posto ' + (tone + 1) + '): il Mini risponde ma il tone resta');
    scriviStato('Il Mini ha risposto, ma «' + nomiTone[tone] + '» è ancora nel posto ' + (tone + 1) + '.', 'errore');
  }

  // ---------------------------------------------------------------- il menu sul tone (elenco a destra)

  // Tasto destro (o ⋯) su un tone: Suona, Rinomina, Copia in un altro posto, Scambia con…, Cancella.
  // Il Mini sa solo salvare «il tone che suona» in un posto (5/2 con la destinazione), quindi:
  // copia = salta al tone e salvalo nel posto nuovo; scambio = tre copie passando da un posto vuoto, che poi si
  // cancella. Alla fine si torna al tone che suonava.
  let menuTone = null;              // il numero del tone col menu aperto
  let lavoroTone = false;

  function apriMenuTone(e, numero) {
    e.preventDefault();
    if (!ble || !ble.collegato() || lavoroTone) return;
    menuTone = numero;
    const m = $('#menu-tone');
    $('#mt-titolo').textContent = (numero + 1) + ' · ' + ((nomiTone && nomiTone[numero]) || '(vuoto)');
    const suona = stato.testa && stato.testa.numero === numero;
    $('#mt-suona').disabled = suona;
    $('#mt-cancella').disabled = suona;
    $('#mt-cancella').title = suona ? 'Sta suonando: passa a un altro tone per cancellarlo' : '';
    m.showPopover();
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(e.clientX, window.innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(e.clientY, window.innerHeight - r.height - 8) + 'px';
  }

  /** Salta al tone n e aspetta che il Mini lo dica (06/02); se suona già, niente. */
  async function suonaEAspetta(n) {
    if (stato.testa && stato.testa.numero === n) return;
    const r = ble.aspetta(m => m.comando === 0x12 && m.tipo === P.TIPO.TONE && m.gruppo === 2 && m.corpo[64] === n, 5000);
    await ble.manda((num, max) => P.salta(num, P.LISTA_INTERA, n, max));
    await r;
    await new Promise(res => setTimeout(res, 250));
  }

  /** Il tone che sta al posto da, salvato al posto a col nome dato; controllato coi nomi riletti. */
  async function copiaPosto(da, a, nome) {
    await suonaEAspetta(da);
    await leggiOrdine();
    await ble.salva(da, nome, ordineSonglist, a);
    nomiTone = (await ble.chiediNomi()).nomi;
    if (nomiTone[a] !== nome) throw new Error('nel posto ' + (a + 1) + ' il Mini dice «' + (nomiTone[a] || 'vuoto') + '»');
  }

  /** Le Songlist che usano il posto n (per avvisare prima di uno scambio). */
  const songlistCon = n => (songlist ? songlist.liste.filter(l => l.toni.includes(n)).map(l => l.nome) : []);

  /** La finestra per Copia e Scambia: modo 'copia' (posto e nome) o 'scambia' (l'altro tone). */
  function apriDialogoTone(modo, numero) {
    const nome = (nomiTone && nomiTone[numero]) || '';
    const sel = $('#dt-posto');
    sel.textContent = '';
    nomiTone.forEach((n, i) => {
      if (i === numero || (modo === 'scambia' && !n)) return;
      const o = el('option', '', postoNome(i));
      o.value = i;
      sel.appendChild(o);
    });
    if (modo === 'copia') {
      const vuoto = nomiTone.findIndex((n, i) => !n && i > numero);
      const primo = vuoto >= 0 ? vuoto : nomiTone.findIndex(n => !n);
      if (primo >= 0) sel.value = String(primo);
    }
    $('#dt-titolo').textContent = (modo === 'copia' ? 'Copia «' : 'Scambia «') + nome + '»';
    $('#dt-etichetta').textContent = modo === 'copia' ? 'Nel posto' : 'Con';
    $('#dt-riga-nome').hidden = modo !== 'copia';
    $('#dt-nome').value = nome;
    $('#dt-errore').textContent = '';
    $('#dt-conferma').textContent = modo === 'copia' ? 'Copia' : 'Scambia';
    $('#dialogo-tone').dataset.modo = modo;
    $('#dialogo-tone').dataset.numero = numero;
    aggiornaDialogoTone();
    $('#dialogo-tone').showModal();
  }

  /** La riga sotto dice cosa succede: un posto pieno viene sovrascritto, le Songlist seguono i posti. */
  function aggiornaDialogoTone() {
    const d = $('#dialogo-tone'), modo = d.dataset.modo, n = +d.dataset.numero, a = +$('#dt-posto').value;
    let nota = '';
    if (modo === 'copia') {
      nota = nomiTone[a] ? 'Il posto ' + (a + 1) + ' ha già «' + nomiTone[a] + '»: viene sovrascritto.' : 'Il posto ' + (a + 1) + ' è vuoto.';
    } else {
      const sl = [...new Set(songlistCon(n).concat(songlistCon(a)))];
      nota = 'I due tone si scambiano di posto' + (sl.length ? '. Le Songlist usano i posti: in ' + sl.join(', ') +
        ' al loro posto suonerà l\'altro tone.' : '.');
    }
    if (stato.modificato) nota += modo === 'copia' && stato.testa.numero === n
      ? ' La copia prende anche le modifiche non salvate.'
      : ' Le modifiche non salvate di «' + stato.testa.nome + '» si perdono.';
    $('#dt-nota').textContent = nota;
  }

  async function confermaDialogoTone() {
    const d = $('#dialogo-tone'), modo = d.dataset.modo, n = +d.dataset.numero, a = +$('#dt-posto').value;
    if (modo === 'copia') {
      const nome = $('#dt-nome').value;
      if (!/^[\x20-\x7e]{1,16}$/.test(nome) || !nome.trim()) { $('#dt-errore').textContent = 'Da 1 a 16 caratteri, senza accenti.'; return; }
      d.close();
      await lavoraTone('Copio «' + nomiTone[n] + '» nel posto ' + (a + 1), async dire => {
        if (nomiTone[a]) {
          dire('copia di sicurezza di «' + nomiTone[a] + '»');
          await sicurezzaTone([a], 'prima di copiare «' + nomiTone[n] + '» sopra «' + nomiTone[a] + '» (posto ' + (a + 1) + ')');
        }
        await copiaPosto(n, a, nome);
        return 'Copiato: «' + nome + '» nel posto ' + (a + 1) + '.';
      });
    } else {
      d.close();
      const nomeN = nomiTone[n], nomeA = nomiTone[a];
      await lavoraTone('Scambio «' + nomeN + '» e «' + nomeA + '»', async dire => {
        // un posto vuoto di appoggio, dal fondo
        let tmp = -1;
        for (let i = nomiTone.length - 1; i >= 0; i--) if (!nomiTone[i] && i !== n && i !== a) { tmp = i; break; }
        if (tmp < 0) throw new Error('serve un posto vuoto di appoggio, e sono tutti pieni');
        dire('copia di sicurezza dei due tone');
        await sicurezzaTone([n, a], 'prima di scambiare «' + nomeN + '» e «' + nomeA + '»');
        dire('1 di 4: «' + nomeN + '» nel posto di appoggio ' + (tmp + 1));
        await copiaPosto(n, tmp, nomeN);
        dire('2 di 4: «' + nomeA + '» nel posto ' + (n + 1));
        await copiaPosto(a, n, nomeA);
        dire('3 di 4: «' + nomeN + '» nel posto ' + (a + 1));
        await copiaPosto(tmp, a, nomeN);
        dire('4 di 4: libero il posto di appoggio');
        await suonaEAspetta(a);                   // il posto di appoggio non deve suonare per cancellarlo
        const risposta = ble.aspetta(m => m.comando === 0x12 && m.tipo === P.TIPO.SALVATO && m.gruppo === 2, 6000);
        await ble.manda((num, max) => P.cancellaTone(num, [tmp], max));
        await risposta;
        nomiTone = (await ble.chiediNomi()).nomi;
        if (nomiTone[n] !== nomeA || nomiTone[a] !== nomeN) throw new Error('riletti: posto ' + (n + 1) + ' «' + nomiTone[n] +
          '», posto ' + (a + 1) + ' «' + nomiTone[a] + '»');
        return 'Scambiati: «' + nomeA + '» ora è nel posto ' + (n + 1) + ', «' + nomeN + '» nel posto ' + (a + 1) +
          (nomiTone[tmp] ? '. Attenzione: il posto di appoggio ' + (tmp + 1) + ' non si è liberato.' : '.');
      });
    }
  }

  /** Un lavoro sui posti: le modifiche si perdono (lo dice la finestra), alla fine si torna al tone di partenza. */
  async function lavoraTone(testo, fa) {
    if (!ble || !ble.collegato() || lavoroTone || !stato.testa) return;
    lavoroTone = true;
    importando = true;
    disegnaTesta();
    const partenza = stato.testa.numero;
    stato.modificato = false;
    azzeraStoria();
    let fine = null, errore = null;
    try {
      scriviStato(testo + '…');
      fine = await fa(s => scriviStato(testo + ': ' + s + '…'));
    } catch (e) {
      errore = e;
    }
    try {
      if (nomiTone && nomiTone[partenza]) await suonaEAspetta(partenza);
      await caricaElenco();
    } catch (e) { /* l'elenco si rilegge col prossimo ⟳ */ }
    lavoroTone = false;
    importando = false;
    disegna();
    disegnaSonglist();
    if (errore) {
      scriviStato(testo + ': non riuscito (' + errore.message + ').', 'errore');
      salvaRegistro(testo + ' non riuscito: ' + errore.message);
    } else scriviStato(fine, 'ok');
  }

  function sceltaMenuTone(azione) {
    const n = menuTone;
    $('#menu-tone').hidePopover();
    if (n == null || !nomiTone) return;
    if (azione === 'suona') vaiA(P.LISTA_INTERA, n, n);
    if (azione === 'rinomina') rinominaTone(n);
    if (azione === 'copia') apriDialogoTone('copia', n);
    if (azione === 'scambia') apriDialogoTone('scambia', n);
    if (azione === 'cancella') cancellaTone(n);
  }

  // ---------------------------------------------------------------- la schermata delle Songlist
  // A sinistra tutti i preset, a destra un blocco per Songlist. Col mouse: un preset trascinato su un blocco
  // ci finisce in coda; un blocco trascinato per la testa cambia posto fra le Songlist; un tone trascinato
  // dentro il suo blocco cambia posto (su un altro blocco: ci si aggiunge). Tutto resta nella pagina (la
  // bozza) finché non si preme «Salva sul Mini»: allora applicaListe porta il Mini alla bozza in una volta.

  let appenaAggiunto = null;        // { chiave, n }: la riga nuova da far lampeggiare
  let listaInLavoro = null;         // -1 mentre si salva sul Mini
  let bozza = null;                 // le Songlist cambiate nella pagina: [{ id?, chiave, nome, toni }]
  let chiaviNuove = 0;

  const listeDelMini = () => songlist.liste.map(l => ({ id: l.id, chiave: 'i' + l.id, nome: l.nome, toni: l.toni.slice() }));
  const vistaListe = () => bozza || listeDelMini();
  const bozzaCambiata = () => !!bozza && (bozza.length !== songlist.liste.length ||
    bozza.some((v, i) => v.id !== songlist.liste[i].id || v.nome !== songlist.liste[i].nome || v.toni.join() !== songlist.liste[i].toni.join()));

  /** Una modifica alla bozza (fa ritorna false = niente da fare); se torna uguale al Mini la bozza sparisce. */
  function modificaBozza(fa) {
    if (listaInLavoro != null) return;
    const b = bozza || listeDelMini();
    if (fa(b) === false) return;
    bozza = b;
    if (!bozzaCambiata()) bozza = null;
    disegnaSonglist();
  }

  async function apriSonglist() {
    if (!ble || !ble.collegato()) return;
    if (!elencoCaricato) await caricaElenco();
    if (!elencoCaricato) return;
    $('#sl-cerca').value = '';
    $('#dialogo-songlist').showModal();
    disegnaSonglist();
  }

  const tastino = (nomeIcona, titolo, fa, cls) => {
    const b = el('button', 'mini-tasto' + (cls ? ' ' + cls : ''));
    b.appendChild(icona(nomeIcona));
    b.type = 'button'; b.title = titolo;
    b.setAttribute('aria-label', titolo);
    b.addEventListener('pointerdown', e => e.stopPropagation());
    b.addEventListener('click', e => { e.stopPropagation(); fa(); });
    return b;
  };

  function disegnaSonglist() {
    const d = $('#dialogo-songlist');
    if (!d || !d.open || !songlist) return;
    const suona = stato.testa ? stato.testa.numero : -1;
    const cambiata = bozzaCambiata();
    $('#sl-modificato').hidden = !cambiata;
    $('#sl-salva').disabled = !cambiata || listaInLavoro != null;
    $('#sl-annulla').disabled = !cambiata || listaInLavoro != null;
    $('#sl-nuova').disabled = listaInLavoro != null;

    // i preset
    const filtro = $('#sl-cerca').value.trim().toLowerCase();
    const ol = $('#sl-preset');
    const scorri = ol.scrollTop;
    ol.textContent = '';
    (nomiTone || []).forEach((nome, numero) => {
      if (!nome) return;
      if (filtro && !nome.toLowerCase().includes(filtro) && String(numero + 1) !== filtro) return;
      const li = el('li', numero === suona ? 'suona' : '');
      li.appendChild(el('span', 'n', String(numero + 1)));
      li.appendChild(el('span', 'nome', nome));
      li.appendChild(tastino('matita', 'Rinomina', () => rinominaTone(numero)));
      li.appendChild(tastino('chiudi', 'Cancella', () => cancellaTone(numero), 'via'));
      li.addEventListener('pointerdown', e => trascinaSl(e, numero + 1, nome, li, sottoBlocco, b => {
        if (b) aggiungiInBozza(+b.dataset.lista, numero);
      }));
      li.addEventListener('dblclick', () => vaiA(P.LISTA_INTERA, numero, numero));
      ol.appendChild(li);
    });
    ol.scrollTop = scorri;

    // i blocchi delle Songlist (quelli della bozza, se c'è)
    const box = $('#sl-blocchi');
    const scorriB = box.scrollTop;
    box.textContent = '';
    const delMini = new Map(songlist.liste.map(l => [l.id, l]));
    vistaListe().forEach((l, i) => {
      const m = l.id != null ? delMini.get(l.id) : null;
      const toccata = !!bozza && (!m || m.nome !== l.nome || m.toni.join() !== l.toni.join());
      const b = el('section', 'sl-blocco' + (l.toni.length >= 50 ? ' pieno' : '') + (listaInLavoro != null ? ' lavora' : '') +
        (toccata ? ' toccata' : ''));
      b.dataset.lista = i;
      const testa = el('div', 'sl-testa');
      testa.appendChild(el('span', 'sl-nome', l.nome));
      testa.appendChild(el('span', 'sl-conta', l.toni.length + '/50'));
      testa.appendChild(tastino('matita', 'Rinomina', () => rinominaInBozza(i)));
      testa.appendChild(tastino('chiudi', 'Cancella', () => cancellaInBozza(i), 'via'));
      testa.addEventListener('pointerdown', e => trascinaBlocco(e, i, b));
      b.appendChild(testa);
      if (!l.toni.length) b.appendChild(el('div', 'sl-vuota', '+'));
      else {
        const ul = el('ol', 'sl-toni');
        // la Songlist com'è sul Mini, allo stesso posto: il clic la fa suonare dentro la Songlist
        const comeSulMini = m && songlist.liste.indexOf(m) === i && !toccata;
        l.toni.forEach((numero, pos) => {
          const nuovo = appenaAggiunto && appenaAggiunto.chiave === l.chiave && appenaAggiunto.n === pos;
          const li = el('li', (numero === suona ? 'suona' : '') + (nuovo ? ' nuovo' : ''));
          const nome = (nomiTone && nomiTone[numero]) || '(vuoto)';
          li.dataset.pos = pos;
          li.appendChild(el('span', 'n', String(pos + 1)));
          li.appendChild(el('span', 'nome', nome));
          li.appendChild(tastino('chiudi', 'Togli dalla Songlist', () => modificaBozza(v => { v[i].toni.splice(pos, 1); }), 'via'));
          // dentro il suo blocco: su una riga = cambia posto; su un altro blocco = ci si aggiunge
          li.addEventListener('pointerdown', e => trascinaSl(e, pos + 1, nome, li,
            ev => sottoRiga(ev, b) || sottoBlocco(ev),
            t => {
              if (!t) return;
              if (t.classList.contains('sl-blocco')) { if (t !== b) aggiungiInBozza(+t.dataset.lista, numero); }
              else if (+t.dataset.pos !== pos) modificaBozza(v => { const x = v[i].toni.splice(pos, 1)[0]; v[i].toni.splice(+t.dataset.pos, 0, x); });
            },
            () => (comeSulMini ? vaiA(i, pos, numero) : vaiA(P.LISTA_INTERA, numero, numero))));
          ul.appendChild(li);
          if (nuovo) requestAnimationFrame(() => li.scrollIntoView({ block: 'nearest' }));
        });
        b.appendChild(ul);
      }
      box.appendChild(b);
    });
    box.scrollTop = scorriB;
    appenaAggiunto = null;
  }

  // ---- le modifiche alla bozza (niente va al Mini)

  function aggiungiInBozza(i, tone) {
    modificaBozza(v => {
      const l = v[i];
      if (!l) return false;
      if (l.toni.length >= 50) { scriviStato('«' + l.nome + '» ha già 50 tone: è il massimo.', 'errore'); return false; }
      l.toni.push(tone);
      appenaAggiunto = { chiave: l.chiave, n: l.toni.length - 1 };
    });
  }

  function spostaListaInBozza(da, a) {
    modificaBozza(v => {
      if (da === a) return false;
      const [x] = v.splice(da, 1);
      v.splice(a, 0, x);
    });
  }

  function rinominaInBozza(i) {
    const l = vistaListe()[i];
    const nome = nomeValido(prompt('Nuovo nome per «' + l.nome + '»:', l.nome));
    if (!nome || nome === l.nome) return;
    modificaBozza(v => { v[i].nome = nome; });
  }

  function cancellaInBozza(i) {
    modificaBozza(v => { v.splice(i, 1); });
  }

  function nuovaInBozza() {
    if (vistaListe().length >= 40) { scriviStato('Ci sono già 40 Songlist: è il massimo.', 'errore'); return; }
    const nome = nomeValido(prompt('Nome della Songlist nuova (al massimo 16 caratteri, senza accenti):', ''));
    if (!nome) return;
    modificaBozza(v => { v.push({ chiave: 'n' + (++chiaviNuove), nome, toni: [] }); });
    requestAnimationFrame(() => { const b = $('#sl-blocchi'); b.scrollTop = b.scrollHeight; });
  }

  function annullaBozza() {
    bozza = null;
    disegnaSonglist();
  }

  /** «Salva sul Mini»: la bozza va sul Mini in una volta; se qualcosa non torna la bozza resta, per riprovare. */
  async function salvaBozza() {
    if (!bozzaCambiata()) return;
    const volute = bozza.map(v => ({ id: v.id, nome: v.nome, toni: v.toni.slice() }));
    const ok = await cambiaListe(-1, 'Salvo le Songlist sul Mini', v => { v.length = 0; v.push(...volute); },
      'Songlist salvate sul Mini (rilette: uguali).');
    if (ok) bozza = null;
    disegnaSonglist();
  }

  /** Chiudendo con modifiche non salvate: restano nella bozza, ma lo si chiede. */
  function chiudiSonglist() {
    if (bozzaCambiata() && listaInLavoro == null &&
      !confirm('Le modifiche alle Songlist non sono sul Mini. Chiudo lo stesso? (restano qui finché non chiudi la pagina)')) return;
    $('#dialogo-songlist').close();
  }

  /** Un blocco preso per la testa: una sua copia segue il mouse, al suo posto resta un riquadro tratteggiato
   *  che si sposta nella griglia mentre gli altri blocchi scivolano (FLIP); lasciando, la bozza cambia ordine. */
  function trascinaBlocco(e, i, b) {
    if (e.button !== 0 || listaInLavoro != null) return;
    const d = $('#dialogo-songlist'), box = $('#sl-blocchi');
    const x0 = e.clientX, y0 = e.clientY;
    let copia = null, dx = 0, dy = 0, ultimoScambio = 0;
    const muovi = ev => {
      if (!copia) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        const r = b.getBoundingClientRect();
        dx = x0 - r.left; dy = y0 - r.top;
        copia = b.cloneNode(true);
        copia.classList.add('blocco-volante');
        copia.style.width = r.width + 'px';
        copia.style.height = r.height + 'px';
        d.appendChild(copia);
        b.classList.add('segnaposto');
        d.classList.add('trascina');
      }
      ev.preventDefault();
      copia.style.transform = 'translate(' + (ev.clientX - dx) + 'px,' + (ev.clientY - dy) + 'px) rotate(1.5deg)';
      // vicino ai bordi l'elenco dei blocchi scorre da solo
      const rb = box.getBoundingClientRect();
      if (ev.clientY < rb.top + 40) box.scrollTop -= 12;
      else if (ev.clientY > rb.bottom - 40) box.scrollTop += 12;
      // un altro blocco sotto il mouse: il segnaposto va al suo posto (non più di uno scambio ogni 200 ms,
      // così i blocchi che stanno scivolando non rimbalzano)
      const sotto = document.elementFromPoint(ev.clientX, ev.clientY);
      const t = sotto && sotto.closest('#sl-blocchi .sl-blocco');
      if (!t || t === b || performance.now() - ultimoScambio < 200) return;
      ultimoScambio = performance.now();
      const figli = [...box.children];
      const prima = new Map(figli.map(x => [x, x.getBoundingClientRect()]));
      box.insertBefore(b, figli.indexOf(b) < figli.indexOf(t) ? t.nextSibling : t);
      for (const x of figli) {
        if (x === b) continue;
        const r0 = prima.get(x), r1 = x.getBoundingClientRect();
        if (r0.left === r1.left && r0.top === r1.top) continue;
        x.style.transition = 'none';
        x.style.transform = 'translate(' + (r0.left - r1.left) + 'px,' + (r0.top - r1.top) + 'px)';
        requestAnimationFrame(() => { x.style.transition = 'transform 0.18s ease'; x.style.transform = ''; });
      }
    };
    const fine = () => {
      document.removeEventListener('pointermove', muovi);
      document.removeEventListener('pointerup', fine);
      document.removeEventListener('pointercancel', fine);
      if (!copia) return;
      // la copia «atterra» sul segnaposto, poi si ridisegna con l'ordine nuovo
      const r = b.getBoundingClientRect();
      copia.style.transition = 'transform 0.15s ease';
      copia.style.transform = 'translate(' + r.left + 'px,' + r.top + 'px)';
      const a = [...box.children].indexOf(b);
      setTimeout(() => {
        copia.remove();
        d.classList.remove('trascina');
        b.classList.remove('segnaposto');
        if (a !== i) spostaListaInBozza(i, a);
        else disegnaSonglist();
      }, 150);
    };
    document.addEventListener('pointermove', muovi);
    document.addEventListener('pointerup', fine);
    document.addEventListener('pointercancel', fine);
  }

  /** Il blocco sotto il puntatore. */
  function sottoBlocco(ev) {
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    return t && t.closest('#sl-blocchi .sl-blocco');
  }
  /** La riga del blocco b sotto il puntatore (o sotto il bordo del suo elenco: prima o ultima riga). */
  function sottoRiga(ev, b) {
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!t || t.closest('.sl-blocco') !== b) return null;
    const riga = t.closest('.sl-toni li');
    if (riga) return riga;
    const righe = b.querySelectorAll('.sl-toni li');
    if (!righe.length || !t.closest('.sl-toni')) return null;
    return righe[righe.length - 1];
  }

  /** Il trascinamento col mouse: dopo qualche pixel parte un'etichetta che segue il puntatore e il bersaglio
   *  (trova) si illumina; lasciando, lascia(bersaglio). Senza movimento è un clic (clic, se c'è). */
  function trascinaSl(e, numero, nome, origine, trova, lascia, clic) {
    if (e.button !== 0 || listaInLavoro != null) return;
    const d = $('#dialogo-songlist');
    const x0 = e.clientX, y0 = e.clientY;
    let fantasma = null, sopra = null;
    const segna = t => {
      if (t === sopra) return;
      if (sopra) sopra.classList.remove('sopra');
      sopra = t;
      if (sopra) sopra.classList.add('sopra');
    };
    const muovi = ev => {
      if (!fantasma) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        fantasma = el('div', 'fantasma');
        if (numero !== '') fantasma.appendChild(el('span', 'n', String(numero)));
        fantasma.appendChild(el('span', '', nome));
        d.appendChild(fantasma);
        d.classList.add('trascina');
        origine.classList.add('preso');
      }
      ev.preventDefault();
      fantasma.style.transform = 'translate(' + (ev.clientX + 12) + 'px,' + (ev.clientY + 8) + 'px)';
      const t = trova(ev);
      segna(t === origine ? null : t);
    };
    const fine = ev => {
      document.removeEventListener('pointermove', muovi);
      document.removeEventListener('pointerup', fine);
      document.removeEventListener('pointercancel', fine);
      if (!fantasma) { if (clic && ev.type === 'pointerup') clic(); return; }
      fantasma.remove();
      d.classList.remove('trascina');
      origine.classList.remove('preso');
      segna(null);
      const t = ev.type === 'pointerup' ? trova(ev) : null;
      lascia(t === origine ? null : t);
    };
    document.addEventListener('pointermove', muovi);
    document.addEventListener('pointerup', fine);
    document.addEventListener('pointercancel', fine);
  }

  /** Lavoro su una o più Songlist (id, o -1 = tutte): blocchi grigi intanto, poi rilettura e ridisegno. */
  async function lavoraListe(id, testo, fa) {
    if (!ble || !ble.collegato() || listaInLavoro != null) return false;
    listaInLavoro = id;
    disegnaSonglist();
    try {
      scriviStato(testo + '…');
      await fa();
      return true;
    } catch (e) {
      scriviStato(testo + ': non riuscito (' + e.message + ').', 'errore');
      return false;
    } finally {
      await caricaElenco().catch(() => {});
      listaInLavoro = null;
      disegnaSonglist();
    }
  }

  const opLista = (op, opz) => ble.manda((num, max) => P.operazione(num, op, opz, max));
  const copiaListe = () => songlist.liste.map(l => ({ id: l.id, nome: l.nome, toni: l.toni.slice() }));
  const listaUguale = (a, b) => a.nome === b.nome && a.toni.join() === b.toni.join();
  const RIORDINO = 'pulzemazz.songlist.riordino';    // 'no' se il Mini non prende l'ordine con «rinomina»

  /** Porta le Songlist del Mini a «volute» ([{ id?, nome, toni }] nell'ordine voluto).
   *  Cosa fa il Mini (registro dell'8 novembre, tre «togli» andati male): «crea» (19) mette la Songlist in
   *  fondo col primo id libero, qualunque ordine gli si mandi; «aggiungi» (4) vuole al byte 3 la POSIZIONE
   *  della Songlist nell'ordine del Mini, non l'id (con l'id i tone sono finiti in un'altra Songlist);
   *  «cancella» (17) toglie quella che manca nell'ordine mandato. Quindi: via quelle che non servono, rifatte
   *  in fondo quelle cambiate, poi l'ordine: una «rinomina» (16) con l'ordine voluto (se il Mini lo prende) o,
   *  se no, rifatte in fondo una dopo l'altra tutte quelle dalla prima fuori posto in giù. */
  async function applicaListe(volute, avanza) {
    const ora = copiaListe();
    const ordineDi = () => ora.map(l => l.id);
    const cancella = async l => {
      const i = ora.indexOf(l);
      ora.splice(i, 1);
      await opLista(P.OP.CANCELLA_LISTA, { lista: ora.length ? ora[Math.max(0, i - 1)].id : 0xff, ordine: ordineDi() });
    };
    const crea = async v => {
      let id = 0;
      while (ora.some(l => l.id === id)) id++;
      const nuova = { id, nome: v.nome, toni: [] };
      ora.push(nuova);
      await opLista(P.OP.CREA_LISTA, { lista: id, nomeLista: v.nome, ordine: ordineDi() });
      const pos = ora.length - 1;
      for (const tone of v.toni) {
        await opLista(P.OP.AGGIUNGI, { tone, lista: pos, ordine: ordineDi() });
        nuova.toni.push(tone);
        if (avanza) avanza();
      }
      v.id = id;
    };
    const rifai = async v => {
      const l = v.id != null ? ora.find(x => x.id === v.id) : null;
      if (l) await cancella(l);
      await crea(v);
    };
    // 1. via quelle che non ci sono fra le volute
    for (const l of ora.slice()) if (!volute.some(v => v.id === l.id)) await cancella(l);
    // 2. rifatte (in fondo) quelle nuove o cambiate
    for (const v of volute) {
      const l = v.id != null ? ora.find(x => x.id === v.id) : null;
      if (l && l.toni.join() === v.toni.join() && l.nome !== v.nome) {
        // cambia solo il nome: «rinomina» (16), byte 3 = la posizione
        await opLista(P.OP.RINOMINA_LISTA, { lista: ora.indexOf(l), nomeLista: v.nome, ordine: ordineDi() });
        l.nome = v.nome;
      } else if (!l || !listaUguale(l, v)) await rifai(v);
    }
    // 3. l'ordine
    const voluto = () => volute.map(v => v.id).join();
    if (ordineDi().join() === voluto()) return;
    let prova = null;
    try { prova = localStorage.getItem(RIORDINO); } catch (e) { /* senza memoria si prova */ }
    // la Songlist da «rinominare» col suo nome: una che ha id = posizione, così va bene comunque il Mini legga
    // il byte 3; se non ce n'è nessuna non si rischia e si rifanno le Songlist
    const k = ora.findIndex((l, i) => l.id === i);
    if (prova !== 'no' && k >= 0) {
      await opLista(P.OP.RINOMINA_LISTA, { lista: k, nomeLista: ora[k].nome, ordine: volute.map(v => v.id) });
      await caricaElenco();
      const preso = ordineAttuale().join() === voluto();
      try { localStorage.setItem(RIORDINO, preso ? 'si' : 'no'); } catch (e) { /* niente */ }
      if (preso) return;
      ora.length = 0;
      ora.push(...copiaListe());
    }
    const primo = volute.findIndex((v, i) => !ora[i] || ora[i].id !== v.id);
    for (let i = Math.max(0, primo); i < volute.length; i++) await rifai(volute[i]);
  }

  /** Il lavoro intero: le volute (dalle attuali con modifica), una copia di prima nel browser, l'avanzamento
   *  nella riga in alto, poi il controllo con quello che il Mini rilegge. */
  async function cambiaListe(id, testo, modifica, fatto) {
    if (!songlist) return false;
    const volute = copiaListe();
    if (modifica(volute) === false) return false;
    try { localStorage.setItem('pulzemazz.songlist.prima', JSON.stringify(songlistPerFile(songlist, nomiTone))); } catch (e) { /* niente */ }
    await copiaSicurezza('songlist', 'prima di: ' + testo.charAt(0).toLowerCase() + testo.slice(1), 'Songlist' + quando() + '.json',
      JSON.stringify(songlistPerFile(songlist, nomiTone), null, 2));
    const totale = volute.reduce((n, v) => n + v.toni.length, 0);
    let fatti = 0;
    const ok = await lavoraListe(id, testo, () => applicaListe(volute, () => {
      fatti++;
      if (fatti % 5 === 0) scriviStato(testo + '… (' + fatti + ' tone rimessi)');
    }));
    if (!ok) return false;
    const lette = songlist.liste.map(l => l.nome + ':' + l.toni.join());
    const attese = volute.map(v => v.nome + ':' + v.toni.join());
    if (lette.join('|') === attese.join('|')) { scriviStato(fatto, 'ok'); return true; }
    scriviStato('Attenzione: le Songlist sul Mini non sono come dovevano.', 'errore');
    salvaRegistro('songlist: attese ' + attese.join('|') + ' — lette ' + lette.join('|'));
    return false;
  }

  // ---------------------------------------------------------------- le Songlist nel backup
  // Un file JSON nostro (il .glb dell'app non le ha): per ogni Songlist, nell'ordine, il nome e i tone col
  // loro posto e il nome che avevano. Rimettendolo, le Songlist del Mini diventano quelle del file.

  function songlistPerFile(sl, nomi) {
    return {
      formato: 'MazzRig - Songlist', versione: 1, data: new Date().toISOString(),
      liste: sl.liste.map(l => ({ nome: l.nome, toni: l.toni.map(n => ({ posto: n + 1, nome: (nomi && nomi[n]) || '' })) })),
    };
  }

  async function esportaSonglist() {
    if (!ble || !ble.collegato()) return;
    try {
      scriviBackup('Leggo le Songlist…');
      const sl = P.leggiSonglist((await ble.chiediSonglist()).corpo);
      nomiTone = (await ble.chiediNomi()).nomi;
      const nome = 'Songlist' + quando() + '.json';
      scarica(JSON.stringify(songlistPerFile(sl, nomiTone), null, 2), nome);
      scriviBackup('Esportate ' + sl.liste.length + ' Songlist in «' + nome + '» (nella cartella Download).', 'ok');
    } catch (e) {
      scriviBackup('Esportazione non riuscita: ' + e.message + '.', 'errore');
    }
  }

  /** I file di uno .zip (anche compresso, col DecompressionStream del browser). */
  async function leggiZip(buf) {
    const d = new DataView(buf), out = [];
    let p = 0;
    while (p + 30 <= buf.byteLength && d.getUint32(p, true) === 0x04034b50) {
      const metodo = d.getUint16(p + 8, true), lung = d.getUint32(p + 18, true);
      const ln = d.getUint16(p + 26, true), le = d.getUint16(p + 28, true);
      const nome = new TextDecoder().decode(new Uint8Array(buf, p + 30, ln));
      let dati = new Uint8Array(buf, p + 30 + ln + le, lung);
      if (metodo === 8) dati = new Uint8Array(await new Response(new Blob([dati]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      out.push({ nome, dati });
      p += 30 + ln + le + lung;
    }
    return out;
  }

  async function importaSonglist(f) {
    if (!f || !ble || !ble.collegato()) return;
    let dati;
    try {
      let testo;
      if (/\.zip$/i.test(f.name)) {
        const voce = (await leggiZip(await f.arrayBuffer())).find(x => /songlist[^/]*\.json$/i.test(x.nome));
        if (!voce) throw new Error('nello .zip non ci sono le Songlist (backup fatto prima che ci fossero)');
        testo = new TextDecoder().decode(voce.dati);
      } else testo = await f.text();
      dati = JSON.parse(testo);
      if (!dati || !Array.isArray(dati.liste)) throw new Error('non è un file di Songlist');
    } catch (e) {
      scriviBackup('File non letto: ' + e.message + '.', 'errore');
      return;
    }
    try {
      nomiTone = (await ble.chiediNomi()).nomi;
      songlist = P.leggiSonglist((await ble.chiediSonglist()).corpo);
    } catch (e) {
      scriviBackup('Non riesco a leggere il Mini: ' + e.message + '.', 'errore');
      return;
    }
    // i tone si rimettono per posto; se nel posto ora c'è un altro nome (o niente) lo si dice prima
    const diversi = [], vuoti = [];
    const volute = dati.liste.slice(0, 40).map(l => ({
      nome: nomeValido(l.nome) || 'Songlist',
      toni: (l.toni || []).slice(0, 50).filter(t => {
        const n = (+t.posto || 0) - 1;
        if (n < 0 || n >= 200) return false;
        if (!nomiTone[n]) { vuoti.push(t); return false; }
        if (t.nome && nomiTone[n] !== t.nome) diversi.push(t);
        return true;
      }).map(t => +t.posto - 1),
    }));
    // quelle già uguali sul Mini restano come sono (meno lavoro)
    const libere = copiaListe();
    for (const v of volute) {
      const i = libere.findIndex(l => listaUguale(l, v));
      if (i >= 0) { v.id = libere[i].id; libere.splice(i, 1); }
    }
    let domanda = 'Metto sul Mini le ' + volute.length + ' Songlist del file al posto delle ' + songlist.liste.length + ' che ci sono?';
    if (diversi.length) domanda += '\n\n' + diversi.length + ' tone nel file hanno un nome diverso da quello che ora è in quel posto (es. posto ' +
      diversi[0].posto + ': «' + diversi[0].nome + '», ora «' + nomiTone[diversi[0].posto - 1] + '»): metto quello che c\'è ora.';
    if (vuoti.length) domanda += '\n\n' + vuoti.length + ' posti ora sono vuoti: quei tone li salto.';
    if (!confirm(domanda)) return;
    bozza = null;
    $('#dialogo-backup').close();
    const ok = await cambiaListe(-1, 'Rimetto le Songlist', v => { v.length = 0; v.push(...volute); },
      'Songlist rimesse dal file: ' + volute.length + ', rilette dal Mini e uguali.');
    if (!ok) return;
  }

  // ---------------------------------------------------------------- rimettere i tone da un backup

  // Dallo .zip del backup completo (sul PC o su Dropbox): i .prst «001 Nome.prst» tornano nel loro posto.
  // Il Mini non ha un comando per scrivere un tone in un posto: per ognuno si fa quello che si fa a mano,
  // l'import nel tone che suona (mettiNelTone) e il salvataggio nel posto (ble.salva, 5/2 con la destinazione),
  // poi si rilegge il posto (0/0) e lo si confronta col file. All'aprire, ogni tone del backup è confrontato
  // con quello che c'è ora sul Mini: spuntati solo quelli diversi o coi posti vuoti.
  let ripristino = null;            // { voci, fermo, lavoro } con la finestra aperta

  /** Le posizioni del blocco che sono manopole (e i Sync): le sole che l'import scrive davvero. */
  function posizioniManopole(uid) {
    const usate = new Set();
    for (const k of C.modelli[uid].k) { usate.add(k[1]); if (k[2] === 'd') usate.add(k[6]); }
    return usate;
  }

  /** Il nome da rimettere: quello del backup così com'è (anche con lo spazio in fondo, «bohemian »: viene
   *  dal Mini), ripulito solo se il Mini non lo prenderebbe. */
  const nomeRipristino = n => (/^[ -~]{1,16}$/.test(n) ? n : nomeMini(n));

  /** Cosa c'è di diverso fra il tone del file (aTone) e quello del Mini (corpo 0/0): [] = uguali. */
  function differenzeTone(f, c) {
    const m = window.PulzePrst.daMini(c).tone;
    const d = [];
    if (nomeRipristino(f.nome) !== m.nome) d.push('nome «' + m.nome + '»');
    if (Math.round(+f.volume || 0) !== m.volume) d.push('volume');
    if (Math.round(+f.tempo || 0) !== m.tempo) d.push('tempo');
    if (catenaValida(f.catena) && f.catena.join() !== Array.from(m.catena).join()) d.push('catena');
    for (let s = 0; s < 7; s++) {
      const pl = pianoSlot(f, s), fb = f.blocchi[s], mb = m.blocchi[s];
      if (pl.uid == null) continue;                 // quello che l'import non rimette non conta
      if (fb.uid !== mb.uid) { d.push(P.SLOT[s]); continue; }
      if (fb.acceso !== mb.acceso) { d.push(P.SLOT[s] + ' on/off'); continue; }
      const usate = posizioniManopole(fb.uid);
      if (fb.valori.some((v, i) => usate.has(i) && Math.abs(Math.fround(v) - mb.valori[i]) > 1e-4 * Math.max(1, Math.abs(v))))
        d.push(P.SLOT[s] + ' manopole');
    }
    return d;
  }

  function scriviRipristino(testo, tipo) {
    const p = $('#rip-stato');
    p.textContent = testo;
    p.className = 'nota' + (tipo ? ' ' + tipo : '');
  }

  /** Una riga dell'elenco: il colore dice lo stato, la scritta com'è sul Mini. */
  function disegnaVoceRipristino(v) {
    v.li.className = v.stato ? 'r-' + v.stato : '';
    v.esito.textContent = v.testo || '';
  }

  /** Apre la finestra coi tone di uno .zip (buf), poi li confronta col Mini. */
  async function apriRipristino(buf, nomeZip) {
    if (!ble || !ble.collegato() || backupInCorso || ripristino) return;
    let voci;
    try {
      voci = (await leggiZip(buf)).map(x => {
        const m = /(?:^|\/)(\d{3}) [^/]*\.prst$/i.exec(x.nome);
        if (!m || +m[1] < 1 || +m[1] > 200) return null;
        try { return { posto: +m[1] - 1, tone: window.PulzePrst.aTone(new TextDecoder().decode(x.dati)) }; } catch (e) { return null; }
      }).filter(Boolean).sort((a, b) => a.posto - b.posto);
    } catch (e) {
      scriviBackup('«' + nomeZip + '» non si legge: ' + e.message + '.', 'errore');
      return;
    }
    if (!voci.length) { scriviBackup('In «' + nomeZip + '» non ci sono tone (i .prst del backup completo).', 'errore'); return; }
    $('#dialogo-backup').close();
    const corsa = ripristino = { voci, fermo: false, lavoro: true };
    $('#rip-origine').textContent = voci.length + ' tone in «' + nomeZip.replace(/^.*[\\/]/, '') + '».';
    const ol = $('#rip-elenco');
    ol.textContent = '';
    for (const v of voci) {
      v.li = el('li');
      const lab = el('label');
      v.spunta = el('input');
      v.spunta.type = 'checkbox';
      v.spunta.addEventListener('change', contaRipristino);
      lab.appendChild(v.spunta);
      lab.appendChild(el('span', 'rip-posto', String(v.posto + 1).padStart(3, '0')));
      lab.appendChild(el('span', 'rip-nome', v.tone.nome || '(senza nome)'));
      v.esito = el('span', 'rip-esito');
      lab.appendChild(v.esito);
      v.li.appendChild(lab);
      ol.appendChild(v.li);
      v.stato = 'attesa'; v.testo = 'da confrontare';
      disegnaVoceRipristino(v);
    }
    scriviRipristino('');
    bottoniRipristino();
    $('#dialogo-ripristino').showModal();
    try {
      scriviRipristino('Leggo i nomi dei tone sul Mini…');
      nomiTone = (await ble.chiediNomi()).nomi;
      for (let k = 0; k < voci.length; k++) {
        if (corsa.fermo) break;
        const v = voci[k];
        scriviRipristino('Confronto col Mini: ' + (k + 1) + ' di ' + voci.length + '…');
        if (!nomiTone[v.posto]) {
          v.stato = 'vuoto'; v.testo = 'posto vuoto'; v.spunta.checked = true;
        } else {
          const c = await ble.chiediToneIntero(v.posto);
          v.attuale = c;
          const d = c ? differenzeTone(v.tone, c) : ['non letto, ora «' + nomiTone[v.posto] + '»'];
          v.stato = d.length ? 'diverso' : 'uguale';
          v.testo = d.length ? 'diverso: ' + d.join(', ') : 'uguale';
          v.spunta.checked = d.length > 0;
        }
        disegnaVoceRipristino(v);
        contaRipristino();
      }
      const diversi = voci.filter(v => v.stato === 'diverso' || v.stato === 'vuoto').length;
      scriviRipristino(corsa.fermo ? 'Confronto fermato: quelli non confrontati non sono spuntati.'
        : diversi ? diversi + (diversi === 1 ? ' tone è diverso' : ' tone sono diversi') + ' da quelli sul Mini (spuntati); gli altri sono uguali.'
          : 'Tutti i tone del backup sono uguali a quelli sul Mini: non c\'è niente da rimettere.', diversi || corsa.fermo ? '' : 'ok');
    } catch (e) {
      scriviRipristino('Non riesco a leggere il Mini: ' + e.message + '.', 'errore');
    } finally {
      corsa.lavoro = false;
      corsa.fermo = false;
      bottoniRipristino();
    }
  }

  function contaRipristino() {
    if (!ripristino) return;
    const n = ripristino.voci.filter(v => v.spunta.checked).length;
    $('#rip-via').textContent = n ? 'Rimetti ' + n + ' tone' : 'Rimetti';
    $('#rip-via').disabled = !n || ripristino.lavoro;
  }

  function bottoniRipristino() {
    const r = ripristino, lavoro = Boolean(r && r.lavoro);
    $('#rip-ferma').hidden = !lavoro;
    ['#rip-tutti', '#rip-nessuno', '#rip-diversi'].forEach(b => { $(b).disabled = lavoro; });
    if (r) r.voci.forEach(v => { v.spunta.disabled = lavoro; });
    contaRipristino();
  }

  function spuntaRipristino(quali) {
    if (!ripristino || ripristino.lavoro) return;
    for (const v of ripristino.voci) v.spunta.checked = quali(v);
    contaRipristino();
  }

  /** Rimette i tone spuntati, uno alla volta, nel loro posto; alla fine torna al tone di partenza. */
  async function rimettiTone() {
    const r = ripristino;
    if (!r || r.lavoro || !ble || !ble.collegato() || !stato.testa) return;
    const scelte = r.voci.filter(v => v.spunta.checked);
    if (!scelte.length) return;
    const sovrascritti = scelte.filter(v => nomiTone && nomiTone[v.posto]).length;
    let domanda = 'Rimetto sul Mini ' + scelte.length + ' tone del backup, ognuno nel suo posto?';
    if (sovrascritti) domanda += '\n\n' + sovrascritti + (sovrascritti === 1 ? ' posto ha' : ' posti hanno') +
      ' già un tone: viene sostituito da quello del backup.';
    domanda += '\n\nIl tone che suona fa da appoggio: le sue modifiche non salvate si perdono. Ci vogliono alcuni secondi per tone.';
    if (!confirm(domanda)) return;
    azzeraStoria();
    r.lavoro = true;
    r.fermo = false;
    bottoniRipristino();
    if (sovrascritti) {
      scriviRipristino('Copia di sicurezza dei preset che vengono sostituiti…');
      const letti = {};
      for (const v of scelte) if (v.attuale) letti[v.posto] = v.attuale;
      await sicurezzaTone(scelte.map(v => v.posto), 'prima di ripristinare ' + scelte.length + ' preset', letti);
    }
    importando = true;
    disegnaTesta();
    const partenza = stato.testa.numero;
    let fatti = 0, conDifferenze = 0, falliti = 0;
    try {
      await leggiOrdine();
      for (let k = 0; k < scelte.length; k++) {
        if (r.fermo || !ble.collegato()) break;
        const v = scelte[k], p = v.tone, nome = nomeRipristino(p.nome);
        const inizio = 'Tone ' + (k + 1) + ' di ' + scelte.length + ', «' + nome + '» nel posto ' + (v.posto + 1);
        v.li.scrollIntoView({ block: 'nearest' });
        v.stato = 'lavoro'; v.testo = 'lo rimetto…';
        disegnaVoceRipristino(v);
        try {
          const piano = p.blocchi.map((_, s) => pianoSlot(p, s));
          const catenaFile = catenaValida(p.catena) ? p.catena.slice() : null;
          const volume = Math.round(stretto(+p.volume || 0, 0, 100));
          const tempo = Math.round(stretto(+p.tempo || 120, 40, 250));
          await mettiNelTone(p, piano, catenaFile, volume, tempo,
            s => scriviRipristino(inizio + ': ' + String(s).replace(/^Importo: /, '')));
          scriviRipristino(inizio + ': salvo…');
          await new Promise(res => setTimeout(res, RITMO_MS * 2));   // che gli ultimi valori siano partiti
          await ble.salva(stato.testa.numero, nome, ordineSonglist, v.posto);
          stato.modificato = false;
          await ble.chiediTesta();                  // il Mini può essere passato al posto salvato
          scriviRipristino(inizio + ': controllo…');
          const c = await ble.chiediToneIntero(v.posto);
          const d = c ? differenzeTone(p, c) : ['non riletto'];
          if (d.length) { conDifferenze++; v.stato = 'avviso'; v.testo = 'rimesso, ma diverso: ' + d.join(', '); }
          else { fatti++; v.stato = 'fatto'; v.testo = 'rimesso (riletto: uguale)'; }
          v.spunta.checked = false;
          salvaRegistro('ripristino di «' + nome + '» nel posto ' + v.posto + (d.length ? ': ' + d.join(', ') : ': uguale'));
        } catch (e) {
          falliti++;
          v.stato = 'errore'; v.testo = 'non riuscito: ' + e.message;
          salvaRegistro('ripristino di «' + nome + '» nel posto ' + v.posto + ' non riuscito: ' + e.message);
        }
        disegnaVoceRipristino(v);
      }
      // si torna al tone di partenza com'è salvato: l'appoggio si butta
      scriviRipristino('Torno al tone di partenza…');
      nomiTone = (await ble.chiediNomi()).nomi;
      disegnaElenco();
      if (nomiTone[partenza]) await ble.manda((num, max) => P.salta(num, P.LISTA_INTERA, partenza, max));
      const fermato = r.fermo ? ' Fermato: gli altri non sono stati toccati.' : '';
      scriviRipristino('Rimessi ' + fatti + ' tone (riletti: uguali)' + (conDifferenze ? ', ' + conDifferenze + ' con differenze' : '') +
        (falliti ? ', ' + falliti + ' non riusciti' : '') + '.' + fermato, conDifferenze || falliti ? 'errore' : 'ok');
    } catch (e) {
      scriviRipristino('Ripristino interrotto: ' + e.message + '.', 'errore');
    } finally {
      importando = false;
      r.lavoro = false;
      r.fermo = false;
      bottoniRipristino();
      disegna();
    }
  }

  function chiudiRipristino() {
    if (ripristino && ripristino.lavoro) {
      if (confirm('Fermo? Il tone in corso finisce, gli altri restano come sono.')) ripristino.fermo = true;
      return;
    }
    ripristino = null;
    $('#dialogo-ripristino').close();
  }

  async function toneDaDropbox() {
    if (backupInCorso || ripristino) return;
    const b = await backupScelto();
    if (!b) return;
    scriviBackup('');
    await apriRipristino(b.buf, b.nome);
  }

  /** Le voci dell'elenco scelto: [posizione da mandare, numero del tone]. */
  function vociElenco() {
    const lista = +$('#elenco-lista').value;
    if (lista === P.LISTA_INTERA) {
      return (nomiTone || []).map((n, i) => (n ? [i, i] : null)).filter(Boolean);
    }
    const l = songlist && songlist.liste[lista];
    return l ? l.toni.map((numero, pos) => [pos, numero]) : [];
  }

  function disegnaElenco() {
    if (!elencoCaricato) return;
    const ol = $('#elenco-tone');
    ol.textContent = '';
    const suona = stato.testa ? stato.testa.numero : -1;
    const intera = +$('#elenco-lista').value === P.LISTA_INTERA;
    // il cerca: per nome (anche un pezzo) o per numero
    const q = $('#elenco-cerca').value.trim().toLowerCase();
    // in «Tutti i tone», un segno sui tone che stanno in una Songlist (il titolo dice in quali)
    const inListe = new Map();
    if (intera && songlist) {
      for (const l of songlist.liste) for (const n of new Set(l.toni)) {
        if (!inListe.has(n)) inListe.set(n, []);
        inListe.get(n).push(l.nome);
      }
    }
    let trovati = 0;
    for (const [pos, numero] of vociElenco()) {
      const n = String((intera ? numero : pos) + 1);
      if (q && !(((nomiTone && nomiTone[numero]) || '').toLowerCase().includes(q) || n === q)) continue;
      trovati++;
      const li = el('li');
      const b = el('button', numero === suona ? 'suona' : '');
      b.type = 'button';
      b.appendChild(el('span', 'n', n));
      b.appendChild(el('span', 'nome', (nomiTone && nomiTone[numero]) || '(vuoto)'));
      if (inListe.has(numero)) {
        const segno = el('span', 'in-lista');
        segno.appendChild(icona('lista'));
        const liste = inListe.get(numero);
        segno.title = (liste.length === 1 ? 'Nella Songlist ' : 'Nelle Songlist ') + liste.map(n => '«' + n + '»').join(', ');
        b.appendChild(segno);
      }
      b.addEventListener('click', () => vaiA(+$('#elenco-lista').value, pos, numero));
      b.addEventListener('contextmenu', e => apriMenuTone(e, numero));
      li.appendChild(b);
      const piu = el('button', 'piu');
      piu.appendChild(icona('altro', 'puntini'));
      piu.type = 'button';
      piu.title = 'Rinomina, copia, scambia, cancella';
      piu.setAttribute('aria-label', 'Azioni sul tone');
      piu.addEventListener('click', e => apriMenuTone(e, numero));
      li.appendChild(piu);
      ol.appendChild(li);
    }
    if (q && !trovati) ol.appendChild(el('li', 'nessuno', 'Nessun tone con «' + $('#elenco-cerca').value.trim() + '».'));
    const attivo = ol.querySelector('.suona');
    if (attivo) attivo.scrollIntoView({ block: 'nearest' });
    disegnaSonglist();
  }

  /** Fa suonare un tone col salto dell'app (06/02); il Mini risponde col tone intero, e alMessaggio
   *  rilegge i blocchi. */
  function vaiA(lista, pos, numero) {
    if (!ble || !ble.collegato()) return;
    if (stato.modificato && !confirm('Le modifiche di «' + stato.testa.nome + '» non sono salvate e si perdono. Cambio tone?')) return;
    scriviStato('Vado a «' + ((nomiTone && nomiTone[numero]) || numero + 1) + '»…');
    ble.manda((num, max) => P.salta(num, lista, pos, max))
      .catch(e => scriviStato('Il Mini non ha preso il cambio di tone: ' + e.message, 'errore'));
  }

  // ---------------------------------------------------------------- i messaggi del Mini

  /** Ogni messaggio intero del Mini passa di qui: risposte alle richieste e cambi fatti sul Mini. */
  function alMessaggio(m) {
    if (m.comando !== 0x12) return;
    if (m.tipo === 6 && m.gruppo === 1) {
      const d = P.leggiDrum(m.corpo);
      if (d) { stato.drum = d; disegnaDrum(); }
    } else if (m.tipo === P.TIPO.TESTA && m.gruppo === 0) {
      const t = P.leggiTesta(m.corpo);
      if (t) cambiaTesta(t);
    } else if (m.tipo === P.TIPO.TONE && m.gruppo === 2) {
      const t = P.leggiTone(m.corpo);
      if (t) { cambiaTesta(t); if (ble) rileggiBlocchi(); }
    } else if (m.tipo === P.TIPO.BLOCCO && m.gruppo === 0) {
      const b = P.leggiBlocco(m.corpo);
      if (b && b.slot < 7) {
        stato.blocchi[b.slot] = b;
        if (stato.testa) {
          stato.testa.accesi = (stato.testa.accesi & ~(1 << b.slot)) | ((b.acceso ? 1 : 0) << b.slot);
          stato.testa.uid[b.slot] = b.uid;
        }
        disegna();
      }
    }
  }

  function cambiaTesta(t) {
    const prima = stato.testa;
    stato.testa = t;
    // Un altro tone: i blocchi letti non valgono più, anche se il modello è lo stesso.
    // (Il numero basta: dopo un salvataggio col nome nuovo il tone è lo stesso.)
    if (!prima || prima.numero !== t.numero) {
      spostaInCoda = null;                          // uno spostamento in coda era per il tone di prima
      azzeraStoria();                               // annulla e confronta valgono per un tone solo
      stato.blocchi = stato.blocchi.map(() => null);
      stato.modificato = false;
      nomeProposto = null;
    } else {
      const letti = stato.blocchi.filter(Boolean).length;
      stato.blocchi = stato.blocchi.map((b, s) => (b && b.uid === t.uid[s] ? b : null));
      // la testa dice un altro modello per un blocco letto: lo si rilegge (non resta su «leggo…»)
      if (stato.blocchi.filter(Boolean).length < letti && ble && ble.collegato()) rileggiBlocchi();
    }
    disegna();
  }

  /** Legge i sette blocchi, nell'ordine della catena. Se il tone cambia a metà, ricomincia. */
  function rileggiBlocchi() {
    if (rilettura) { rilettura.ancora = true; return; }
    rilettura = { ancora: false };
    (async () => {
      do {
        rilettura.ancora = false;
        for (let pos = 0; pos < 7 && !rilettura.ancora; pos++) {
          scriviStato('Leggo il blocco ' + (pos + 1) + ' di 7…');
          await ble.chiediBlocco(pos);
        }
      } while (rilettura.ancora);
    })().then(() => {
      scriviStato('Collegato a ' + ble.dispositivo.name + '. Il tone è aggiornato.', 'ok');
      if (!elencoCaricato) caricaElenco();
    })
      .catch(e => scriviStato('Lettura interrotta: ' + e.message, 'errore'))
      .finally(() => { rilettura = null; provaCoda(); });
  }

  /** I nomi di Sound Clone e IR utente, come l'app appena collegata (2/5 e 2/4). Se non arrivano,
   *  restano quelli del catalogo. */
  async function leggiNomiUtente() {
    const nomi = new Map();
    for (const g of [P.LISTA_UTENTE.CLONE, P.LISTA_UTENTE.IR]) {
      try {
        for (const v of await ble.chiediListaUtente(g)) nomi.set(v.uid, { nome: v.nome, vuoto: v.vuoto });
      } catch (e) { /* senza nomi si va avanti */ }
    }
    stato.nomiUtente = nomi;
    if (stato.testa) disegna();
  }

  /** Rinomina un Sound Clone o un IR utente come l'app (1/5 o 1/4), poi rilegge le liste. */
  async function rinominaUtente(uid) {
    if (!ble || !ble.collegato()) return;
    const gruppo = (uid >>> 24) === 0x0f ? P.LISTA_UTENTE.CLONE : P.LISTA_UTENTE.IR;
    const posto = uid & 0xffff;
    const prima = nomeModello(uid) || '';
    const scritto = window.prompt('Nuovo nome per «' + prima + '» (al massimo 15 caratteri, senza accenti):', prima);
    if (scritto == null) return;
    const nome = scritto.normalize('NFD').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 15);
    if (!nome) { scriviStato('Nome vuoto: non cambio niente.', 'errore'); return; }
    if (nome === prima) return;
    try {
      scriviStato('Rinomino «' + prima + '» in «' + nome + '»…');
      await ble.manda((num, max) => P.rinomina(num, gruppo, posto, nome, max));
      await leggiNomiUtente();
      const ora = nomeModello(uid);
      if (ora === nome) scriviStato('Rinominato: «' + nome + '». Il Mini conferma.', 'ok');
      else {
        scriviStato('Attenzione: il Mini dice ancora «' + ora + '».', 'errore');
        salvaRegistro('rinomina ' + uid.toString(16) + ' -> ' + nome);
      }
    } catch (e) {
      scriviStato('Rinomina non riuscita: ' + e.message, 'errore');
    }
  }

  // ---------------------------------------------------------------- le impostazioni generali

  /** Manda al Mini il valore più recente di una voce, non più di uno ogni RITMO_MS: mentre un invio è in
   *  corso, i gesti dopo si accumulano e parte solo l'ultimo. */
  const invii = new Map();
  function mandaPresto(chiave, crea) {
    let i = invii.get(chiave);
    if (!i) { i = { crea: null, corre: false }; invii.set(chiave, i); }
    i.crea = crea;
    if (i.corre) return;
    i.corre = true;
    (async () => {
      while (i.crea) {
        const c = i.crea; i.crea = null;
        try { await ble.manda(c); } catch (e) { scriviStato('Impostazione non mandata: ' + e.message, 'errore'); }
        await new Promise(r => setTimeout(r, RITMO_MS));
      }
      i.corre = false;
    })();
  }

  /** Legge dal Mini le impostazioni generali (1/1, 2/1, 3/1, 7/1, 10/1) e il Global EQ (4/1). */
  async function leggiGenerali() {
    for (const tipo of P.TIPI_GENERALI) {
      const m = await ble.chiedi(tipo, 1, [], m => m.tipo === tipo && m.gruppo === 1 && m.comando === 0x12);
      stato.generali[tipo] = m.corpo.slice();
    }
    if (stato.generali[7]) stato.impostazioni = P.leggiImpostazioni(stato.generali[7]);
    const e = await ble.chiedi(4, 1, [], m => m.tipo === 4 && m.gruppo === 1 && m.comando === 0x12);
    stato.eq = P.leggiEq(e.corpo);
  }

  const hzTesto = v => (v >= 1000 ? (Math.round(v / 10) / 100) + ' kHz' : Math.round(v) + ' Hz');

  // ---------------------------------------------------------------- la schermata Impostazioni
  // Come le Device Settings dell'app (screenshot dell'utente, 8 novembre): a sinistra un riquadro per voce
  // (Sound Mode, Audio, USB Audio, Tuner, Display, Global EQ), a destra la pagina della voce scelta.
  // Ogni gesto va subito sul Mini (mandaPresto: uno ogni RITMO_MS, l'ultimo vince).

  let impVoce = 'audio';
  let eqScheda = 1;                 // 0 Low Cut, 1-4 le bande, 5 High Cut

  async function apriImpostazioni() {
    if (!ble || !ble.collegato()) return;
    $('#imp-stato').textContent = '';
    $('#imp-menu').textContent = '';
    $('#imp-pagina').textContent = '';
    $('#dialogo-impostazioni').showModal();
    try {
      await leggiGenerali();
      disegnaImpostazioni();
    } catch (e) {
      $('#imp-stato').textContent = 'Lettura non riuscita: ' + e.message;
    }
  }

  /** Una voce di P.VOCI_GENERALI: il valore letto e la funzione che lo cambia sul Mini. */
  function voce(nome) {
    const v = P.VOCI_GENERALI.find(x => x.nome === nome);
    if (!v || !stato.generali[v.tipo]) return null;
    return {
      v,
      val: P.valoreGenerale(stato.generali[v.tipo], v),
      cambia: x => {
        stato.generali[v.tipo] = P.conGenerale(stato.generali[v.tipo], v, x);
        if (v.tipo === 7) { stato.impostazioni = P.leggiImpostazioni(stato.generali[7]); disegna(); }
        const corpo = stato.generali[v.tipo];
        mandaPresto('g' + v.tipo, (num, max) => P.scriviGenerale(num, v.tipo, corpo, max));
      },
    };
  }

  // le icone (tratto, 24×24)
  const ICONE = {
    onda: 'M2 12h3l2.5-6 3 13 3-16 3 13 2-4H22',
    barre: 'M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4',
    usb: 'M8 3h5v6H8zM10.5 9v8.5a3 3 0 0 0 6 0V9a3 3 0 0 1 3-3',
    diapason: 'M8 3v7a4 4 0 0 0 8 0V3M12 14v7',
    schermo: 'M3 6h18v12H3zM6.5 10.5l3-3',
    eq: 'M6 3v18M12 3v18M18 3v18M3.5 8h5M9.5 15h5M15.5 10h5',
    jack: 'M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5zM12 7.5a4.5 4.5 0 1 0 .01 0M12 9.5v3',
    chitarra: 'M18 3l3 3-2 1-5.5 5.5M13.5 12.5c1 1.5.5 4-1.5 5.5-2.5 2-6 2-7.5.5S3 13.5 5 11c1.5-2 4-2.5 5.5-1.5zM8 14l2 2',
    bt: 'M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13',
    altoparlante: 'M4 9h4l5-4v14l-5-4H4zM16.5 9a4 4 0 0 1 0 6',
    rec: 'M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    cuffie: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',
    accendi: 'M12 3v8M7 6.5a7 7 0 1 0 10 0',
    // quelle dei tasti (al posto dei caratteri ◀ ▶ ‹ › ⟳ ✕ ⋯ ✎ ■ ▾ di prima), stesso tratto
    ricarica: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15',
    play: 'M8 5.5v13l10.5-6.5z',
    stop: 'M7 7h10v10H7z',
    sinistra: 'M14.5 6l-6 6 6 6',
    destra: 'M9.5 6l6 6-6 6',
    giu: 'M6 9.5l6 6 6-6',
    chiudi: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
    altro: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
    matita: 'M14.5 5.5l4 4L8.5 19.5h-4v-4zM12.5 7.5l4 4',
    piu: 'M12 5v14M5 12h14',
    attenzione: 'M12 3.8l9 15.7H3zM12 10v4.3M12 17h.01',
    spunta: 'M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M8 12.3l2.7 2.7L16 9.5',
    lista: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
    bluetooth: 'M7 7.5l10 9-5 4.5V3l5 4.5-10 9',
    salva: 'M5 4h11.5L19 6.5V20H5zM8.5 4v4.5h6V4M8 20v-6h8v6',
    apri: 'M4 19V6.5A1.5 1.5 0 0 1 5.5 5H10l2 2h6.5A1.5 1.5 0 0 1 20 8.5V19zM12 10.5v6M9.3 13.2L12 10.5l2.7 2.7',
    scarica: 'M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15M12 4v11M7.5 10.5L12 15l4.5-4.5',
    scintille: 'M10 3.5l1.8 5.2 5.2 1.8-5.2 1.8L10 17.5l-1.8-5.2L3 10.5l5.2-1.8zM18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
    chiave: 'M8.5 15.5m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M11.5 12.5L20 4M16.5 7.5l2.5 2.5M14.5 9.5l2 2',
    domanda: 'M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M9.6 9.6a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2-2.5 3.7M12 16.9h.01',
    menu: 'M4 7h16M4 12h16M4 17h16',
    mondo: 'M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z',
  };

  // ---------------------------------------------------------------- la guida
  //
  // Il testo sta in guida.html (una <section id="g-…"> per voce, col suo <h2>): si carica la prima volta che
  // si apre la finestra. Il menu ☰ la apre dall'inizio, i tasti «?» (data-guida) alla loro sezione.

  let guidaPronta = null;
  function caricaGuida() {
    if (!guidaPronta) {
      guidaPronta = (async () => {
        const r = await fetch(LINGUA === 'en' ? 'guida.en.html' : 'guida.html', { cache: 'no-cache' });
        if (!r.ok) throw new Error('risposta ' + r.status);
        const art = $('#guida-testo');
        art.innerHTML = await r.text();            // è un file nostro, accanto alla pagina
        for (const t of art.querySelectorAll('[data-icona]')) t.prepend(icona(t.dataset.icona, t.dataset.iconaCls));
        const indice = $('#guida-indice');
        indice.textContent = '';
        for (const s of art.querySelectorAll('section[id]')) {
          const a = el('a', '', s.querySelector('h2').textContent);
          a.href = '#' + s.id;
          a.dataset.sezione = s.id;
          indice.appendChild(a);
        }
        art.addEventListener('scroll', segnaIndice, { passive: true });
      })().catch(e => { guidaPronta = null; throw e; });
    }
    return guidaPronta;
  }

  async function apriGuida(sezione) {
    const d = $('#dialogo-guida');
    if (!d.open) d.showModal();
    try { await caricaGuida(); } catch (e) {
      $('#guida-testo').textContent = 'Non riesco a caricare la guida (' + e.message + ').';
      return;
    }
    vaiInGuida(sezione || 'g-inizio', 'instant');
  }

  /** Porta la guida a una sezione (o a un titolo dentro) e lo fa lampeggiare un attimo. */
  function vaiInGuida(id, modo) {
    const art = $('#guida-testo');
    const dest = art.querySelector('#' + CSS.escape(id));
    if (!dest) return;
    art.scrollTo({ top: id === 'g-inizio' ? 0 : dest.offsetTop - 10, behavior: modo || 'smooth' });
    const titolo = dest.matches('section') ? dest.querySelector('h2') : dest;
    titolo.classList.remove('lampeggia'); void titolo.offsetWidth; titolo.classList.add('lampeggia');
    segnaIndice();
  }

  /** Nell'indice, in blu la sezione che si sta leggendo. */
  function segnaIndice() {
    const art = $('#guida-testo');
    let qui = null;
    for (const s of art.querySelectorAll('section[id]')) if (s.offsetTop <= art.scrollTop + 60) qui = s.id;
    for (const a of $('#guida-indice').children) a.classList.toggle('qui', a.dataset.sezione === qui);
  }
  function icona(nome, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    if (!ICONE[nome]) console.warn('icona mancante: ' + nome);
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONE[nome] || '');
    s.appendChild(p);
    return s;
  }

  const VOCI_MENU = [
    ['sound', 'Sound Mode', 'onda'], ['audio', 'Audio', 'barre'], ['usb', 'USB Audio', 'usb'],
    ['tuner', 'Tuner', 'diapason'], ['display', 'Display', 'schermo'], ['eq', 'Global EQ', 'eq'],
  ];

  function disegnaImpostazioni() {
    disegnaMenuImp();
    disegnaPaginaImp();
  }

  /** L'interruttore tondo dell'app: un ovale con il pallino. */
  function interruttore(acceso) {
    const s = el('span', 'interr' + (acceso ? ' on' : ''));
    s.appendChild(el('span', 'pallino'));
    return s;
  }

  function disegnaMenuImp() {
    const nav = $('#imp-menu');
    nav.textContent = '';
    for (const [chi, nome, ic] of VOCI_MENU) {
      const b = el('button', 'imp-voce imp-' + chi + (impVoce === chi ? ' attiva' : ''));
      b.type = 'button';
      const tondo = el('span', 'imp-tondo');
      tondo.appendChild(icona(ic));
      b.appendChild(tondo);
      const t = el('span', 'imp-testi');
      t.appendChild(el('span', 'imp-nome', nome));
      if (chi === 'sound') {
        const s = voce('Sound Mode');
        t.appendChild(el('b', '', s ? (s.v.scelte[s.val] || 'valore ' + s.val) : '—'));
      }
      if (chi === 'eq' && stato.eq) {
        const r = el('span', 'imp-riga-eq');
        r.appendChild(el('b', '', stato.eq.acceso ? 'On' : 'Off'));
        const i = interruttore(stato.eq.acceso);
        i.addEventListener('click', e => { e.stopPropagation(); eqAcceso(!stato.eq.acceso); });
        r.appendChild(i);
        t.appendChild(r);
        b.classList.toggle('acceso', stato.eq.acceso);
      }
      b.appendChild(t);
      b.addEventListener('click', () => { impVoce = chi; disegnaImpostazioni(); });
      nav.appendChild(b);
    }
  }

  // ---- la manopola grande dell'app: anello che si riempie, icona o scritta al centro, valore sotto
  function arco(cx, cy, r, a0, a1) {
    const rad = a => a * Math.PI / 180;
    const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + r * Math.sin(rad(a0));
    const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + 'A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' +
      x1.toFixed(2) + ' ' + y1.toFixed(2);
  }

  /** o: { nome, min, max, val, passo, log, testo(v), cambia(v), colore, icona, scritta, lato } */
  function manopolaGrande(o) {
    const lato = o.lato || 132;
    const box = el('div', 'mg');
    if (o.colore) box.style.setProperty('--colore', o.colore);
    if (o.nome) box.appendChild(el('span', 'mg-nome', o.nome));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'mg-anello');
    svg.style.width = svg.style.height = lato + 'px';
    const path = cls => { const p = document.createElementNS(ns, 'path'); p.setAttribute('class', cls); svg.appendChild(p); return p; };
    const pista = path('mg-pista');
    pista.setAttribute('d', arco(50, 50, 43, 135, 405));
    const riempi = path('mg-riempi');
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', 50); c.setAttribute('cy', 50); c.setAttribute('r', 33); c.setAttribute('class', 'mg-corpo');
    svg.appendChild(c);
    const centro = el('div', 'mg-centro');
    if (o.icona) centro.appendChild(icona(o.icona));
    else centro.appendChild(el('span', 'mg-scritta', o.scritta || ''));
    const tondo = el('div', 'mg-tondo');
    tondo.style.width = tondo.style.height = lato + 'px';
    tondo.appendChild(svg);
    tondo.appendChild(centro);
    box.appendChild(tondo);
    const valore = el('span', 'mg-valore');
    box.appendChild(valore);

    const daQuota = q => (o.log ? daLog(q, o.min, o.max) : o.min + q * (o.max - o.min));
    const aQuota = v => (o.log ? logQuota(stretto(v, o.min, o.max), o.min, o.max) : (stretto(v, o.min, o.max) - o.min) / (o.max - o.min));
    const tondoV = v => (o.arrotonda ? o.arrotonda(v) : Math.round(v / (o.passo || 1)) * (o.passo || 1));
    let v = o.val;
    let q = aQuota(v);
    const mostra = () => {
      const a = 135 + 270 * stretto(q, 0, 1);
      riempi.setAttribute('d', q > 0.002 ? arco(50, 50, 43, 135, a) : '');
      valore.textContent = o.testo ? o.testo(v) : String(v);
    };
    const imposta = nq => {
      q = stretto(nq, 0, 1);
      const nv = tondoV(daQuota(q));
      if (nv !== v) { v = nv; o.cambia(v); }
      mostra();
    };
    tondo.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      tondo.setPointerCapture(e.pointerId);
      let y = e.clientY;
      const muovi = ev => { const dy = y - ev.clientY; y = ev.clientY; imposta(q + dy / (ev.shiftKey ? 900 : 220)); };
      const fine = () => { tondo.removeEventListener('pointermove', muovi); tondo.removeEventListener('pointerup', fine); };
      tondo.addEventListener('pointermove', muovi);
      tondo.addEventListener('pointerup', fine);
    });
    tondo.addEventListener('wheel', e => {
      e.preventDefault();
      const su = e.deltaY < 0 ? 1 : -1;
      if (o.log) imposta(q + su * 0.01);
      else { const nv = tondoV(stretto(v + su * (o.passo || 1), o.min, o.max)); q = aQuota(nv); if (nv !== v) { v = nv; o.cambia(v); } mostra(); }
    }, { passive: false });
    mostra();
    box.aggiorna = nv => { v = nv; q = aQuota(nv); mostra(); };
    return box;
  }

  // ---- i riquadri: on/off (tutto il riquadro è il tasto) e scelta (con la tendina)
  function cartaSi(nome, acceso, cambia) {
    const b = el('button', 'imp-carta si' + (acceso ? ' on' : ''));
    b.type = 'button';
    const t = el('span', 'imp-testi');
    t.appendChild(el('span', 'imp-nome', nome));
    const st = el('b', '', acceso ? 'On' : 'Off');
    t.appendChild(st);
    b.appendChild(t);
    const i = interruttore(acceso);
    b.appendChild(i);
    b.addEventListener('click', () => {
      const ora = !b.classList.contains('on');
      b.classList.toggle('on', ora); i.classList.toggle('on', ora); st.textContent = ora ? 'On' : 'Off';
      cambia(ora);
    });
    return b;
  }

  function cartaScelta(nome, x) {
    const d = el('label', 'imp-carta');
    const t = el('span', 'imp-testi');
    t.appendChild(el('span', 'imp-nome', nome));
    const s = el('select', 'imp-scelta');
    const chiavi = Object.keys(x.v.scelte).map(Number);
    if (!chiavi.includes(x.val)) chiavi.push(x.val);
    for (const k of chiavi) { const op = el('option', '', x.v.scelte[k] || 'valore ' + k); op.value = String(k); s.appendChild(op); }
    s.value = String(x.val);
    s.addEventListener('change', () => x.cambia(+s.value));
    t.appendChild(s);
    d.appendChild(t);
    return d;
  }

  /** Una manopola grande per una voce di VOCI_GENERALI. */
  function manopolaVoce(nome, extra) {
    extra = Object.assign({ lato: 150 }, extra);
    const x = voce(nome);
    if (!x) return el('div');
    const u = x.v.unita;
    return manopolaGrande(Object.assign({
      nome, min: x.v.min, max: x.v.max, val: stretto(x.val, x.v.min, x.v.max), passo: 1, cambia: x.cambia,
      testo: n => (u === 'dB' && n > 0 ? '+' : '') + n + (u ? ' ' + u : ''),
    }, extra));
  }

  function disegnaPaginaImp() {
    const p = $('#imp-pagina');
    p.textContent = '';
    p.className = 'pag-' + impVoce;
    const titolo = el('div', 'imp-titolo');
    titolo.appendChild(el('h3', '', VOCI_MENU.find(m => m[0] === impVoce)[1]));
    p.appendChild(titolo);

    if (impVoce === 'sound') {
      const x = voce('Sound Mode');
      const g = el('div', 'imp-griglia scelte');
      if (x) for (const k of Object.keys(x.v.scelte).map(Number)) {
        const b = el('button', 'imp-carta modo' + (k === x.val ? ' on' : ''), x.v.scelte[k]);
        b.type = 'button';
        b.addEventListener('click', () => { x.cambia(k); disegnaImpostazioni(); });
        g.appendChild(b);
      }
      p.appendChild(g);
    } else if (impVoce === 'audio') {
      const g = el('div', 'imp-manopole');
      g.appendChild(manopolaVoce('Input Gain', { icona: 'jack', colore: '#e3c896' }));
      g.appendChild(manopolaVoce('Inst Volume', { icona: 'chitarra', colore: '#e3c896' }));
      g.appendChild(manopolaVoce('BT Volume', { icona: 'bt', colore: '#2f7fe8' }));
      g.appendChild(manopolaVoce('Main Output', { icona: 'altoparlante', colore: '#f2f4f7' }));
      p.appendChild(g);
    } else if (impVoce === 'usb') {
      const g = el('div', 'imp-manopole');
      const db = n => (n <= -60 ? 'Mute' : (n > 0 ? '+' : '') + n + ' dB');
      g.appendChild(manopolaVoce('Rec Level', { icona: 'rec', colore: '#e3c896', testo: db }));
      g.appendChild(manopolaVoce('Monitor Level', { icona: 'cuffie', colore: '#e3c896', testo: db }));
      p.appendChild(g);
      const c = el('div', 'imp-griglia carte');
      for (const n of ['Loopback', 'Rec Mode (L)', 'Rec Mode (R)', 'Record BT Audio', 'Record Drum', 'Reamp Mode']) {
        const x = voce(n);
        if (!x) continue;
        c.appendChild(x.v.come === 'si' ? cartaSi(n, x.val, x.cambia) : cartaScelta(n, x));
      }
      p.appendChild(c);
    } else if (impVoce === 'tuner') {
      const g = el('div', 'imp-manopole');
      g.appendChild(manopolaVoce('Reference Pitch', { icona: 'diapason', colore: '#e3c896', lato: 170, testo: n => n + ' Hz' }));
      p.appendChild(g);
    } else if (impVoce === 'display') {
      const c = el('div', 'imp-griglia carte');
      const m = voce('Output Meter Display');
      if (m) c.appendChild(cartaSi('Output Meter Display', m.val, m.cambia));
      for (const n of ['Auto Standby', 'Atmos Light Brightness']) { const x = voce(n); if (x) c.appendChild(cartaScelta(n, x)); }
      p.appendChild(c);
      const col = voce('Theme Color');
      if (col) {
        const tinte = ['#f9d48c', '#ff3448', '#ffa232', '#51ff7c', '#55e6ff', '#2f7ff8', '#7a3cff', '#f04bdc', '#ffc3ae'];
        const testa = el('div', 'imp-tema-cima');
        testa.appendChild(el('span', 'imp-nome', 'Theme Color'));
        const nomeCol = el('b', '', col.v.scelte[col.val] || '');
        testa.appendChild(nomeCol);
        p.appendChild(testa);
        const r = el('div', 'imp-tinte');
        tinte.forEach((t, k) => {
          const b = el('button', 'tinta' + (k === col.val ? ' on' : ''));
          b.type = 'button'; b.style.background = t; b.title = col.v.scelte[k] || '';
          b.addEventListener('click', () => {
            col.cambia(k); col.val = k; nomeCol.textContent = col.v.scelte[k] || '';
            r.querySelectorAll('.tinta').forEach((x, i) => x.classList.toggle('on', i === k));
          });
          r.appendChild(b);
        });
        p.appendChild(r);
      }
    } else if (impVoce === 'eq') {
      paginaEq(p, titolo);
    }
  }

  // ---- il Global EQ: la curva, i punti da trascinare, le schede delle bande, le manopole, il volume

  function eqAcceso(on) {
    if (!stato.eq) return;
    stato.eq.acceso = on;
    mandaPresto('eq-on', (num, max) => P.scriviEq(num, on, null, 0, max));
    disegnaImpostazioni();
  }

  function mandaEq(indice, valore) {
    const eq = stato.eq;
    eq.v[indice] = valore;
    mandaPresto('eq' + indice, (num, max) => P.scriviEq(num, eq.acceso, indice, valore, max));
  }

  /** La risposta in dB alla frequenza f: biquad RBJ (passa-alto e passa-basso a 12 dB/ottava, campane). */
  function rispostaEq(v, f) {
    const fs = 48000;
    const w = 2 * Math.PI * f / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const bq = (b0, b1, b2, a0, a1, a2) => {
      const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
      return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
    };
    const filtro = (tipo, f0, Q, g) => {
      const w0 = 2 * Math.PI * Math.min(f0, 23000) / fs, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
      if (tipo === 'campana') { const A = Math.pow(10, g / 40); return bq(1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A); }
      if (tipo === 'alto') return bq((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
      return bq((1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al);
    };
    let db = 0;
    if (v[0] >= 20 && v[0] <= 20000) db += filtro('alto', v[0], 0.707);
    if (v[17] >= 20 && v[17] <= 20000) db += filtro('basso', v[17], 0.707);
    for (let b = 0; b < 4; b++)
      if (v[1 + 4 * b] >= 0.5 && Math.abs(v[4 + 4 * b]) > 0.01) db += filtro('campana', stretto(v[2 + 4 * b], 20, 20000), Math.max(0.1, v[3 + 4 * b]), v[4 + 4 * b]);
    return db;
  }

  const SCHEDE_EQ = ['Low Cut', 'Band 1', 'Band 2', 'Band 3', 'Band 4', 'High Cut'];
  const kHz = v => (v >= 1000 ? (v / 1000) + 'k' : String(Math.round(v)));

  function paginaEq(p, titolo) {
    const eq = stato.eq;
    if (!eq) return;
    const on = el('button', 'imp-eq-on');
    on.type = 'button';
    on.appendChild(el('b', '', eq.acceso ? 'On' : 'Off'));
    on.appendChild(interruttore(eq.acceso));
    on.addEventListener('click', () => eqAcceso(!eq.acceso));
    titolo.appendChild(on);

    const grafico = el('div', 'eq-grafico' + (eq.acceso ? '' : ' spento'));
    p.appendChild(grafico);
    const schede = el('div', 'eq-schede');
    SCHEDE_EQ.forEach((n, i) => {
      const b = el('button', 'eq-scheda' + (i === eqScheda ? ' on' : ''), n);
      b.type = 'button';
      b.addEventListener('click', () => { eqScheda = i; disegnaPaginaImp(); });
      schede.appendChild(b);
    });
    p.appendChild(schede);
    const comandi = el('div', 'eq-comandi');
    p.appendChild(comandi);
    const vol = el('div', 'eq-volume');
    vol.appendChild(el('span', 'imp-nome', 'Volume'));
    const r = el('input');
    r.type = 'range'; r.min = 0; r.max = 100; r.step = 1; r.value = Math.round(stretto(eq.v[18], 0, 100));
    const rv = el('b', '', r.value);
    const riempi = () => r.style.setProperty('--q', r.value + '%');
    r.addEventListener('input', () => { rv.textContent = r.value; riempi(); mandaEq(18, +r.value); });
    riempi();
    vol.appendChild(r); vol.appendChild(rv);
    p.appendChild(vol);

    const disegnaComandi = () => {
      comandi.textContent = '';
      if (eqScheda === 0 || eqScheda === 5) {
        const indice = eqScheda === 0 ? 0 : 17, off = eqScheda === 0 ? 19 : 20001;
        // un capo della manopola è «Off»: per il Low Cut tutto a sinistra, per l'High Cut tutto a destra
        const v = eq.v[indice];
        const offQ = eqScheda === 0 ? 0 : 1;
        const m = manopolaGrande({
          nome: '', scritta: eqScheda === 0 ? 'LO CUT' : 'HI CUT', min: 0, max: 1000, passo: 1, lato: 120,
          val: v === off || v < 20 || v > 20000 ? offQ * 1000 : Math.round(1000 * logQuota(v, 20, 20000)),
          testo: n => (n === offQ * 1000 ? 'Off' : hzTesto(daLog(n / 1000, 20, 20000))),
          cambia: n => {
            const hz = n === offQ * 1000 ? off : Math.round(daLog(n / 1000, 20, 20000));
            mandaEq(indice, hz); grafico.ridisegna();
          },
        });
        comandi.appendChild(m);
        return;
      }
      const b = eqScheda - 1;
      const accesa = eq.v[1 + 4 * b] >= 0.5;
      const acc = el('button', 'eq-banda-on' + (accesa ? ' on' : ''));
      acc.type = 'button';
      acc.appendChild(icona('accendi'));
      acc.appendChild(el('b', '', accesa ? 'ON' : 'OFF'));
      acc.addEventListener('click', () => { mandaEq(1 + 4 * b, accesa ? 0 : 1); disegnaComandi(); grafico.ridisegna(); });
      comandi.appendChild(acc);
      comandi.appendChild(manopolaGrande({
        scritta: 'GAIN', min: -20, max: 20, passo: 0.5, lato: 120, val: stretto(eq.v[4 + 4 * b], -20, 20),
        testo: n => (n > 0 ? '+' : '') + n + ' dB', cambia: n => { mandaEq(4 + 4 * b, n); grafico.ridisegna(); },
      }));
      comandi.appendChild(manopolaGrande({
        scritta: 'FREQ', min: 20, max: 20000, log: true, lato: 120, val: stretto(eq.v[2 + 4 * b], 20, 20000),
        arrotonda: x => (x >= 1000 ? Math.round(x / 10) * 10 : Math.round(x)),
        testo: hzTesto, cambia: n => { mandaEq(2 + 4 * b, n); grafico.ridisegna(); },
      }));
      comandi.appendChild(manopolaGrande({
        scritta: 'Q', min: 0.1, max: 10, passo: 0.01, lato: 120, val: stretto(eq.v[3 + 4 * b], 0.1, 10),
        arrotonda: x => Math.round(x * 100) / 100,
        testo: n => n.toFixed(2), cambia: n => { mandaEq(3 + 4 * b, n); grafico.ridisegna(); },
      }));
    };
    disegnaComandi();
    grafico.ridisegna = () => disegnaGraficoEq(grafico, eq, () => disegnaComandi());
    requestAnimationFrame(() => grafico.ridisegna());
  }

  /** La griglia (20 Hz-20 kHz in log, ±25 dB), la curva e i punti delle bande: un punto si trascina
   *  (frequenza e guadagno), la rotella cambia il Q. */
  function disegnaGraficoEq(box, eq, cambiato) {
    const L = Math.max(200, box.clientWidth), A = Math.max(120, box.clientHeight);
    const sx = 40, dx = 12, sy = 10, gy = 24;            // margini: scritte dei dB a sinistra, delle frequenze sotto
    const W = L - sx - dx, H = A - sy - gy;
    const X = f => sx + W * logQuota(stretto(f, 20, 20000), 20, 20000);
    const Y = db => sy + H * (25 - stretto(db, -25, 25)) / 50;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', L); svg.setAttribute('height', A);
    const add = (tag, attr, testo) => {
      const e = document.createElementNS(ns, tag);
      for (const k in attr) e.setAttribute(k, attr[k]);
      if (testo != null) e.textContent = testo;
      svg.appendChild(e);
      return e;
    };
    add('rect', { x: sx, y: sy, width: W, height: H, rx: 10, class: 'eq-fondo' });
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) add('line', { x1: X(f), x2: X(f), y1: sy, y2: sy + H, class: 'eq-riga' });
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000])
      add('text', { x: X(f), y: A - 6, class: 'eq-scritta', 'text-anchor': f === 20 ? 'start' : f === 20000 ? 'end' : 'middle' }, kHz(f));
    for (let db = -20; db <= 20; db += 5) {
      add('line', { x1: sx, x2: sx + W, y1: Y(db), y2: Y(db), class: 'eq-riga' + (db === 0 ? ' zero' : '') });
      add('text', { x: sx - 8, y: Y(db) + 4, class: 'eq-scritta', 'text-anchor': 'end' }, String(db));
    }
    const v = eq.v;
    let d = '';
    for (let i = 0; i <= 240; i++) {
      const f = daLog(i / 240, 20, 20000);
      d += (i ? 'L' : 'M') + X(f).toFixed(1) + ' ' + Y(rispostaEq(v, f)).toFixed(1);
    }
    add('path', { d: d + 'L' + (sx + W) + ' ' + Y(0) + 'L' + sx + ' ' + Y(0) + 'Z', class: 'eq-area' });
    add('path', { d, class: 'eq-curva' });

    // i punti: L (Low Cut), 1-4 le bande, H (High Cut)
    const punti = [];
    const lc = v[0] >= 20 && v[0] <= 20000, hc = v[17] >= 20 && v[17] <= 20000;
    punti.push({ scheda: 0, x: lc ? X(v[0]) : sx, y: Y(0), t: 'L', spento: !lc });
    for (let b = 0; b < 4; b++) punti.push({ scheda: b + 1, x: X(v[2 + 4 * b]), y: Y(v[4 + 4 * b]), t: String(b + 1), spento: v[1 + 4 * b] < 0.5 });
    punti.push({ scheda: 5, x: hc ? X(v[17]) : sx + W, y: Y(0), t: 'H', spento: !hc });
    for (const pt of punti) {
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'eq-punto' + (pt.scheda === eqScheda ? ' scelto' : '') + (pt.spento ? ' spento' : ''));
      g.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ')');
      const c = document.createElementNS(ns, 'circle'); c.setAttribute('r', 11); g.appendChild(c);
      const t = document.createElementNS(ns, 'text'); t.setAttribute('y', 4); t.setAttribute('text-anchor', 'middle'); t.textContent = pt.t; g.appendChild(t);
      svg.appendChild(g);
      g.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (eqScheda !== pt.scheda) { eqScheda = pt.scheda; box.closest('#imp-pagina').querySelectorAll('.eq-scheda').forEach((s, i) => s.classList.toggle('on', i === eqScheda)); }
        const r = box.getBoundingClientRect();
        const muovi = ev => {
          const f = daLog(stretto((ev.clientX - r.left - sx) / W, 0, 1), 20, 20000);
          const hz = f >= 1000 ? Math.round(f / 10) * 10 : Math.round(f);
          if (pt.scheda === 0) mandaEq(0, (ev.clientX - r.left - sx) < 4 ? 19 : hz);
          else if (pt.scheda === 5) mandaEq(17, (ev.clientX - r.left) > sx + W - 4 ? 20001 : hz);
          else {
            const b = pt.scheda - 1;
            const db = Math.round(2 * (25 - 50 * (ev.clientY - r.top - sy) / H)) / 2;
            mandaEq(2 + 4 * b, hz);
            mandaEq(4 + 4 * b, stretto(db, -20, 20));
          }
          disegnaGraficoEq(box, eq, cambiato);
          cambiato();
        };
        const fine = () => { document.removeEventListener('pointermove', muovi); document.removeEventListener('pointerup', fine); };
        document.addEventListener('pointermove', muovi);
        document.addEventListener('pointerup', fine);
        cambiato();
        disegnaGraficoEq(box, eq, cambiato);
      });
      if (pt.scheda >= 1 && pt.scheda <= 4) g.addEventListener('wheel', e => {
        e.preventDefault();
        const b = pt.scheda - 1;
        const qn = stretto(Math.round((v[3 + 4 * b] * (e.deltaY < 0 ? 1.1 : 1 / 1.1)) * 100) / 100, 0.1, 10);
        mandaEq(3 + 4 * b, qn);
        eqScheda = pt.scheda;
        disegnaGraficoEq(box, eq, cambiato);
        cambiato();
      }, { passive: false });
    }
    box.textContent = '';
    box.appendChild(svg);
  }

  async function leggiTutto() {
    scriviStato('Leggo il tone…');
    await ble.chiediTesta();
    try { stato.impostazioni = await ble.chiediImpostazioni(); } catch (e) { stato.impostazioni = null; }
    try { await ble.chiedi(6, 1, [], m => m.tipo === 6 && m.gruppo === 1 && m.comando === 0x12); } catch (e) { /* la drum resta da leggere */ }
    await leggiNomiUtente();
    rileggiBlocchi();
  }

  // ---------------------------------------------------------------- la drum

  // I ritmi del Mini nell'ordine dell'app (schermate della Pulze Editor, 7 novembre): 100, come i valori del CC 67.
  const numerati = (nome, n) => Array.from({ length: n }, (_, i) => nome + ' ' + (i + 1));
  const GENERI_DRUM = [
    ['8-Beat', numerati('8-Beat', 10)],
    ['16-Beat', numerati('16-Beat', 10)],
    ['4-Beat', numerati('4-Beat', 10)],
    ['Rock', ['Roots', 'Classic Rock', 'Pop Rock', 'Slow Rock', 'Rock Shuffle', 'Rock Ballad', 'Punk', 'New Wave',
      'Hard Rock', 'Modern Metal']],
    ['Funk', ['Funk', 'Funk Rock', 'Electro Funk', 'Soul', 'R&B']],
    ['Jazz', ['Jazz', 'Big Band', 'Fusion', 'Swing', 'Dixieland']],
    ['Blues', ['Blues', 'Country', 'Folk', 'Rockabilly', 'Bluegrass']],
    ['Latin', ['Bossa nova', 'Rumba', 'Samba', 'Cha Cha', 'Tango', 'Reggae', 'Beguine', 'Latin Pop', 'Latin Rock',
      'Latin Dance']],
    ['Electronic', ['Hip Hop', 'Trip Hop', 'Techno', 'Break Beat', "Drum n' Bass"]],
    ['World', ['Waltz', 'Polka', 'March', '6/8 March', 'Army March', 'Mazurka', 'Musette', 'Ska', 'New Age', 'World']],
    ['Various Beat', ['3/4 Beat1', '3/4 Beat2', '6/8 Beat1', '6/8 Beat2', '5/4 Beat', '6/4 Beat', '7/4 Beat', '9/8 Beat',
      '10/8 Beat', '11/8 Beat']],
    ['Metronome', ['1/4', '2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '6/8', '7/8', '9/8'].map(m => 'Metronome ' + m)],
  ];
  const RITMI = GENERI_DRUM.reduce((n, g) => n + g[1].length, 0);   // 100: CC 67 0-99
  let drumVolumeTimer = null;

  /** La barra della drum come dice il Mini (6/1); attiva solo col Mini collegato. */
  function disegnaDrum() {
    const su = !!(ble && ble.collegato() && !esempio);
    const d = stato.drum;
    for (const id of ['#drum-play', '#drum-prima', '#drum-ritmo', '#drum-dopo', '#drum-bpm', '#drum-tap', '#drum-sync', '#drum-volume'])
      $(id).disabled = !su;
    const play = $('#drum-play');
    const suona = !!(su && d && d.suona);
    if (play.dataset.icona !== (suona ? 'stop' : 'play')) {
      play.dataset.icona = suona ? 'stop' : 'play';
      play.textContent = '';
      play.appendChild(icona(play.dataset.icona, 'pieno'));
    }
    play.classList.toggle('suona', suona);
    $('#jam-apri').classList.toggle('suona', suona);
    play.setAttribute('aria-label', suona ? 'Stop' : 'Play');
    $('#drum-sync').classList.toggle('acceso', !!(d && d.sync));
    if (!d) { $('#drum-volume-v').textContent = '—'; return; }
    const sel = $('#drum-ritmo');
    if (document.activeElement !== sel) sel.value = String(Math.min(d.ritmo, RITMI - 1));
    const bpm = $('#drum-bpm');
    if (document.activeElement !== bpm) bpm.value = String(d.bpm);
    const vol = $('#drum-volume');
    if (!drumVolumeTimer) vol.value = String(d.volume);
    $('#drum-volume-v').textContent = String(drumVolumeTimer ? +vol.value : d.volume);
  }

  /** Cambia la drum nella pagina subito (il Mini conferma col 6/1, a volte un secondo dopo). */
  function drumLocale(campi) {
    stato.drum = Object.assign({ ritmo: 0, bpm: 120, suona: false, volume: 50, sync: true }, stato.drum, campi);
    disegnaDrum();
  }

  function drumPlay() {
    if (!ble || !ble.collegato()) return;
    const d = stato.drum;
    if (d && d.suona) { ble.mandaCC(P.CC.DRUM_PLAY, 0); drumLocale({ suona: false }); return; }
    const ritmo = +$('#drum-ritmo').value || 0;
    ble.mandaCC(P.CC.DRUM_PLAY, 127);
    // il ritmo il Mini lo prende mentre suona: lo si rimanda appena partita
    setTimeout(() => { if (ble && ble.collegato()) ble.mandaCC(P.CC.DRUM_RITMO, ritmo); }, 300);
    drumLocale({ suona: true, ritmo });
  }

  function drumRitmo(ritmo) {
    ritmo = Math.max(0, Math.min(RITMI - 1, ritmo));
    if (ble && ble.collegato()) ble.mandaCC(P.CC.DRUM_RITMO, ritmo);
    drumLocale({ ritmo });
  }

  function drumBpm(v) {
    const bpm = Math.max(40, Math.min(300, Math.round(v) || 120));
    if (ble && ble.collegato()) { ble.mandaCC(P.CC.DRUM_TEMPO_MSB, bpm >> 7); ble.mandaCC(P.CC.DRUM_TEMPO_LSB, bpm & 0x7f); }
    drumLocale({ bpm });
  }

  /** Il volume mentre si trascina: al Mini il più recente, non più di uno ogni RITMO_MS. */
  function drumVolume() {
    $('#drum-volume-v').textContent = $('#drum-volume').value;
    if (drumVolumeTimer) return;
    let mandato = null;
    const manda = () => {
      const v = +$('#drum-volume').value;
      if (v === mandato) { clearInterval(drumVolumeTimer); drumVolumeTimer = null; drumLocale({ volume: v }); return; }
      mandato = v;
      if (ble && ble.collegato()) ble.mandaCC(P.CC.DRUM_VOLUME, v);
    };
    manda();
    drumVolumeTimer = setInterval(manda, RITMO_MS);
  }

  // ---------------------------------------------------------------- i pulsanti

  async function collega() {
    if (!window.PulzeBle.supportato()) {
      scriviStato('Questo browser non ha il Bluetooth per le pagine web: apri la pagina con Chrome o Edge.', 'errore');
      return;
    }
    if (ble && ble.collegato()) {
      // la drum che suona non resta accesa: il 4 novembre, così, il collegamento dopo non andava
      if (stato.drum && stato.drum.suona) { ble.mandaCC(P.CC.DRUM_PLAY, 0); await new Promise(r => setTimeout(r, 400)); }
      ble.scollega();
      return;
    }
    esempio = false;
    ble = new window.PulzeBle({ alMessaggio, alloStato });
    try {
      await ble.collega();
      await leggiTutto();
    } catch (e) {
      if (e && e.name === 'NotFoundError') scriviStato('Nessun dispositivo scelto.');
      else scriviStato('Non riesco a collegarmi: ' + (e && e.message) +
        '. Il Mini accetta un collegamento alla volta: chiudi l\'app sul telefono e riprova.', 'errore');
      if (ble) ble.scollega();
      // finestra del browser chiusa senza scegliere: il Mini non è mai stato collegato, nessuno lo dice
      if (!(ble && ble.collegato())) alloStato('pronto');
    }
  }

  function alloStato(s, nome) {
    const b = $('#collega');
    const tasti = ['#rileggi', '#tone-prima', '#tone-dopo', '#songlist', '#impostazioni', '#backup'];
    if (s === 'scelta') scriviStato('Scegli il Pulze Mini nella finestra del browser.');
    if (s === 'collego') scriviStato('Mi collego a ' + (nome || 'Pulze') + '…');
    const grande = $('#collega-grande');
    const libero = s === 'scollegato' || s === 'pronto';
    grande.disabled = !libero;
    $('#collega-grande-testo').textContent = libero ? 'Collega il Pulze Mini'
      : s === 'collegato' ? 'Leggo il tone…' : 'Mi collego…';
    $('#benvenuto-nota').hidden = s === 'collegato';
    if (s === 'collegato') {
      $('#collega-testo').textContent = 'Scollega'; b.classList.add('attivo');
      for (const t of tasti) $(t).disabled = false;
      disegnaDrum();
    }
    if (s === 'scollegato') {
      $('#collega-testo').textContent = 'Collega'; b.classList.remove('attivo');
      for (const t of tasti) $(t).disabled = true;
      $('#salva').disabled = true;
      stato.drum = null;
      disegnaDrum();
      scriviStato('Scollegato.');
    }
  }

  function mostraEsempio() {
    esempio = true;
    const lettore = P.Lettore(P.Ricompositore(alMessaggio));
    for (const r of window.PulzeEsempio || []) lettore(r.split(' ').map(h => parseInt(h, 16)));
    scriviStato('Esempio: «To Rachael», registrato dal Mini il 4 novembre. Niente è collegato.', 'esempio');
  }

  document.addEventListener('DOMContentLoaded', () => {
    for (const t of document.querySelectorAll('[data-icona]')) t.prepend(icona(t.dataset.icona, t.dataset.iconaCls));
    // la ✕ in cima alle finestre fa come il loro Annulla / Chiudi
    for (const x of document.querySelectorAll('[data-chiudi]')) x.addEventListener('click', () => $(x.dataset.chiudi).click());
    $('#collega-grande').addEventListener('click', collega);
    // la guida: dal menu dall'inizio, dai «?» alla loro sezione; i link dentro portano alle altre
    for (const b of document.querySelectorAll('button.aiuto')) {
      b.prepend(icona('domanda'));
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); apriGuida(b.dataset.guida); });
    }
    $('#guida').addEventListener('click', () => apriGuida());
    // la lingua: la voce del menu dice l'altra; cambiando, la pagina si ricarica
    $('#lingua-testo').textContent = LINGUA === 'en' ? 'Italiano' : 'English';
    // la bandierina disegnata (le emoji delle bandiere su Windows sono due lettere)
    $('#lingua-bandiera').innerHTML = LINGUA === 'en'
      ? '<svg class="bandiera" viewBox="0 0 3 2" preserveAspectRatio="none"><rect width="1" height="2" fill="#009246"/>' +
        '<rect x="1" width="1" height="2" fill="#f1f2f1"/><rect x="2" width="1" height="2" fill="#ce2b37"/></svg>'
      : '<svg class="bandiera" viewBox="0 0 60 30" preserveAspectRatio="none"><clipPath id="bandiera-uk">' +
        '<path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath><rect width="60" height="30" fill="#012169"/>' +
        '<path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/>' +
        '<path d="M0,0L60,30M60,0L0,30" clip-path="url(#bandiera-uk)" stroke="#c8102e" stroke-width="4"/>' +
        '<path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6"/></svg>';
    $('#lingua').addEventListener('click', () => {
      if (ble && ble.collegato() &&
        !confirm('La pagina si ricarica e il Mini si scollega: le modifiche non salvate si perdono. Cambio lingua?')) return;
      if (window.PulzeLingua) window.PulzeLingua.scegli(LINGUA === 'en' ? 'it' : 'en');
    });
    $('#guida-chiudi').addEventListener('click', () => $('#dialogo-guida').close());
    $('#dialogo-guida').addEventListener('click', e => {
      const a = e.target.closest('a[href^="#g-"]');
      if (!a) return;
      e.preventDefault();
      vaiInGuida(a.getAttribute('href').slice(1));
    });
    new ResizeObserver(() => adattaPalco()).observe($('#palco'));
    // una finestra che si apre o si chiude: gli avvisi rimasti la seguono
    const seguiFinestre = e => { if (e.target.tagName === 'DIALOG') setTimeout(casaAvvisi, 0); };
    document.addEventListener('toggle', seguiFinestre, true);
    document.addEventListener('close', seguiFinestre, true);
    // schermi stretti (sotto i 1280 px): la Jam non ci sta nella barra, diventa un tasto col suo pannello
    const schermoStretto = matchMedia('(max-width: 1279px)');
    const drum = $('#drum');
    const jam = $('#jam-apri');
    const piegaJam = () => {
      if (schermoStretto.matches) { drum.setAttribute('popover', ''); jam.hidden = false; return; }
      if (drum.matches(':popover-open')) drum.hidePopover();
      drum.removeAttribute('popover');
      jam.hidden = true;
    };
    schermoStretto.addEventListener('change', piegaJam);
    piegaJam();
    drum.addEventListener('beforetoggle', e => {
      if (e.newState !== 'open') return;
      const r = jam.getBoundingClientRect();
      drum.style.top = (r.bottom + 6) + 'px';
      drum.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    });
    $('#collega').addEventListener('click', collega);
    const sfoglia = cc => () => {
      if (!ble || !ble.collegato()) return;
      scriviStato('Cambio tone…');
      ble.mandaCC(cc, 127);          // il Mini risponde col tone intero: alMessaggio rilegge i blocchi
    };
    $('#tone-volume').addEventListener('input', e => cambiaTestaDa('volume', +e.target.value, 0, 100));
    $('#tone-tempo').addEventListener('change', e => cambiaTestaDa('tempo', +e.target.value, 40, 250));
    const ritmi = $('#drum-ritmo');
    let n = 0;
    for (const [genere, nomi] of GENERI_DRUM) {
      const gruppo = document.createElement('optgroup');
      gruppo.label = genere;
      for (const nome of nomi) gruppo.appendChild(new Option(nome, String(n++)));
      ritmi.appendChild(gruppo);
    }
    $('#drum-play').addEventListener('click', drumPlay);
    ritmi.addEventListener('change', e => drumRitmo(+e.target.value));
    $('#drum-prima').addEventListener('click', () => drumRitmo((stato.drum ? stato.drum.ritmo : +ritmi.value) - 1));
    $('#drum-dopo').addEventListener('click', () => drumRitmo((stato.drum ? stato.drum.ritmo : +ritmi.value) + 1));
    $('#drum-bpm').addEventListener('change', e => drumBpm(+e.target.value));
    $('#drum-tap').addEventListener('click', () => ble && ble.collegato() && ble.mandaCC(P.CC.DRUM_TAP, 127));
    $('#drum-sync').addEventListener('click', () => {
      if (!ble || !ble.collegato()) return;
      const sync = !(stato.drum && stato.drum.sync);
      ble.mandaCC(P.CC.DRUM_SYNC, sync ? 127 : 0);
      drumLocale({ sync });
    });
    $('#drum-volume').addEventListener('input', drumVolume);
    $('#det-slot').addEventListener('click', () => accendi(scelto));
    $('#cerca-modello').addEventListener('input', elencoModelli);
    $('#salva').addEventListener('click', apriSalva);
    $('#salva-annulla').addEventListener('click', () => $('#dialogo-salva').close());
    $('#salva-posto').addEventListener('change', aggiornaSalva);
    $('#elenco-lista').addEventListener('change', disegnaElenco);
    $('#annulla').addEventListener('click', annulla);
    $('#ripeti').addEventListener('click', ripeti);
    $('#confronta').addEventListener('click', confronta);
    for (const b of document.querySelectorAll('#menu-tone [data-azione]')) b.addEventListener('click', () => sceltaMenuTone(b.dataset.azione));
    $('#dt-posto').addEventListener('change', aggiornaDialogoTone);
    $('#dt-annulla').addEventListener('click', () => $('#dialogo-tone').close());
    $('#dt-conferma').addEventListener('click', confermaDialogoTone);
    $('#elenco-cerca').addEventListener('input', disegnaElenco);
    $('#elenco-cerca').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; disegnaElenco(); } });
    // il menu ☰: si apre sotto il suo tasto, allineato a destra; una voce scelta lo chiude
    const tendina = $('#menu-tendina');
    tendina.addEventListener('beforetoggle', e => {
      if (e.newState !== 'open') return;
      disegnaUltimoBackup();
      const r = $('#menu').getBoundingClientRect();
      tendina.style.top = (r.bottom + 6) + 'px';
      tendina.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    });
    tendina.addEventListener('click', e => { if (e.target.closest('button')) tendina.hidePopover(); });
    // il caffè: la pagina di Buy Me a Coffee in una scheda nuova (questa resta, col Mini collegato)
    $('#caffe').addEventListener('click', () => window.open('https://buymeacoffee.com/mazzgear', '_blank', 'noopener'));
    $('#crediti').addEventListener('click', () => $('#dialogo-crediti').showModal());
    $('#crediti-x').addEventListener('click', () => $('#dialogo-crediti').close());
    $('#backup-x').addEventListener('click', () => $('#backup-chiudi').click());
    $('#esporta').addEventListener('click', esporta);
    $('#importa').addEventListener('click', scegliFile);
    $('#importa-file').addEventListener('change', fileScelto);
    $('#importa-annulla').addEventListener('click', () => $('#dialogo-importa').close());
    $('#importa-conferma').addEventListener('click', importa);
    $('#crea').addEventListener('click', apriCrea);
    $('#crea-conferma').addEventListener('click', creaPreset);
    $('#crea-annulla').addEventListener('click', () => $('#dialogo-crea').close());
    $('#crea-copia').addEventListener('click', copiaDomanda);
    $('#backup-diagnosi').addEventListener('click', copiaDiagnosi);
    $('#crea-testo').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) copiaDomanda(); });
    $('#salva-conferma').addEventListener('click', salvaOra);
    $('#tone-prima').addEventListener('click', sfoglia(P.CC.TONE_PRIMA));
    $('#tone-dopo').addEventListener('click', sfoglia(P.CC.TONE_DOPO));
    $('#impostazioni').addEventListener('click', apriImpostazioni);
    $('#backup').addEventListener('click', apriBackup);
    $('#backup-chiudi').addEventListener('click', () => { if (backupInCorso) backupInCorso.fermo = true; $('#dialogo-backup').close(); });
    $('#backup-ferma').addEventListener('click', () => { if (backupInCorso) backupInCorso.fermo = true; });
    $('#backup-tutto').addEventListener('click', backupCompleto);
    $('#backup-esporta').addEventListener('click', esportaSettaggi);
    $('#backup-importa').addEventListener('click', () => $('#backup-file').click());
    $('#backup-sl-esporta').addEventListener('click', esportaSonglist);
    $('#backup-sl-importa').addEventListener('click', () => $('#backup-sl-file').click());
    $('#backup-sl-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; importaSonglist(f); });
    $('#backup-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; importaSettaggi(f); });
    $('#db-su').addEventListener('click', () => backupCompleto(true));
    $('#db-collega').addEventListener('click', collegaDropbox);
    $('#db-fatto').addEventListener('click', finisciDropbox);
    $('#db-settaggi').addEventListener('click', settaggiDaDropbox);
    $('#db-songlist').addEventListener('click', songlistDaDropbox);
    $('#db-tone').addEventListener('click', toneDaDropbox);
    $('#backup-tone').addEventListener('click', () => $('#backup-tone-file').click());
    $('#backup-tone-file').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if (f) apriRipristino(await f.arrayBuffer(), f.name);
    });
    $('#rip-via').addEventListener('click', rimettiTone);
    $('#rip-chiudi').addEventListener('click', chiudiRipristino);
    $('#rip-ferma').addEventListener('click', () => { if (ripristino) ripristino.fermo = true; });
    $('#dialogo-ripristino').addEventListener('cancel', e => { e.preventDefault(); chiudiRipristino(); });
    $('#rip-tutti').addEventListener('click', () => spuntaRipristino(() => true));
    $('#rip-nessuno').addEventListener('click', () => spuntaRipristino(() => false));
    $('#rip-diversi').addEventListener('click', () => spuntaRipristino(v => v.stato === 'diverso' || v.stato === 'vuoto'));
    $('#db-scarica').addEventListener('click', scaricaDaDropbox);
    $('#db-via').addEventListener('click', scollegaDropbox);
    preparaDropbox();
    $('#songlist').addEventListener('click', apriSonglist);
    $('#sl-chiudi').addEventListener('click', chiudiSonglist);
    $('#dialogo-songlist').addEventListener('cancel', e => { e.preventDefault(); chiudiSonglist(); });
    $('#sl-nuova').addEventListener('click', nuovaInBozza);
    $('#sl-salva').addEventListener('click', salvaBozza);
    $('#sl-annulla').addEventListener('click', annullaBozza);
    $('#sl-cerca').addEventListener('input', disegnaSonglist);
    $('#imp-chiudi').addEventListener('click', () => $('#dialogo-impostazioni').close());
    $('#rileggi').addEventListener('click', () => ble && ble.collegato() && leggiTutto().catch(e => scriviStato(e.message, 'errore')));
    const carica = (src, poi) => {
      const s = document.createElement('script');
      s.src = src; s.onload = poi;
      document.body.appendChild(s);
    };
    if (location.hash === '#esempio') carica('test/esempio.js', mostraEsempio);
    else if (location.hash === '#finto') {
      // il Mini finto di test/mini-finto.js al posto del Bluetooth: Collega si collega a lui
      carica('test/esempio.js', () => carica('test/mini-finto.js', () => {
        window.installaMiniFinto();
        window.provaMessaggio = scriviStato;          // per provare gli avvisi dalla console
        scriviStato('Mini finto pronto: premi Collega.', 'esempio');
      }));
    } else if (!window.PulzeBle.supportato()) {
      scriviStato('Questo browser non ha il Bluetooth per le pagine web: apri la pagina con Chrome o Edge.', 'errore');
    }
    window.pulzeDebug = () => ble && ble.registro.join('\n');
    // Quello che serve alla vista Live (src/pulze-live.js), che sta in un file suo.
    window.MazzRigApp = {
      get testa() { return stato.testa; },
      get blocchi() { return stato.blocchi; },
      get songlist() { return songlist; },
      get nomiTone() { return nomiTone; },
      collegato: () => !!(ble && ble.collegato()),
      nomeMini: () => (ble && ble.dispositivo ? ble.dispositivo.name : ''),
      accesoDi: slot => (stato.testa ? accesoDi(slot) : false),
      immagineDi, nomeModello, scriviStato, apriGuida, icona,
      /** On/off dal Live: suonare, non lavoro da salvare (cambiando tone non si chiede niente). */
      accendiLive(slot) {
        const prima = stato.modificato;
        accendi(slot);
        stato.modificato = prima;
        disegnaTesta();
      },
      /** Suona un tone dal Live, senza la domanda sulle modifiche. */
      suona(lista, pos, numero) {
        const prima = stato.modificato;
        stato.modificato = false;
        if (!ble || !ble.collegato()) { stato.modificato = prima; return Promise.resolve(); }
        return ble.manda((num, max) => P.salta(num, lista, pos, max))
          .catch(e => { stato.modificato = prima; scriviStato('Il Mini non ha preso il cambio di tone: ' + e.message, 'errore'); });
      },
    };
  });
})();
