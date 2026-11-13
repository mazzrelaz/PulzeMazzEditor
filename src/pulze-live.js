// pulze-live.js - La vista Live e la pedaliera MIDI (13 novembre 2026), portata da SparklingTones
// (spark/src/pc/12-live.js) con la stessa grafica. Due cose cambiano col Pulze:
//  - Preset: al posto dei banchi ci sono le Songlist (e «Tutti i tone»), divise in pagine da 8.
//    Il numero sul riquadro è la posizione nella Songlist. Finita l'ultima pagina, si passa alla
//    Songlist dopo.
//  - Stomp: la catena del Mini è flessibile, quindi i riquadri escono dal tone che suona, nell'ordine
//    della sua catena. Ampli e cabinet restano fuori (come sullo Spark). Gli switch si legano per TIPO
//    di blocco (PRE, DYN, EQ/MOD, FX1, FX2): il piede trova sempre lo stesso effetto, dovunque stia.
// Lo stato del Mini lo dà app.js (window.MazzRigApp). I testi sono in italiano: pulze-lingua.js li
// traduce quando finiscono sullo schermo.
(function () {
  'use strict';
  const P = window.Pulze;
  const A = () => window.MazzRigApp;
  const $ = s => document.querySelector(s);

  const BLE_MIDI_SERVIZIO = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
  const BLE_MIDI_DATI = '7772e5db-3868-4112-a1a9-f2669d106bf3';
  const PER_PAGINA = 8;
  /** Gli slot che vanno nello Stomp: tutti tranne AMP e CAB. */
  const STOMP = P.SLOT.map((n, slot) => ({ slot, nome: n })).filter(b => b.nome !== 'AMP' && b.nome !== 'CAB');
  const GESTI = [
    { id: null, nome: 'Nessuna azione' },
    { id: 'tone+', nome: 'Tone successivo' },
    { id: 'tone-', nome: 'Tone precedente' },
    { id: 'pagina+', nome: 'Pagina successiva' },
    { id: 'pagina-', nome: 'Pagina precedente' },
    { id: 'stomp', nome: 'Passa da Preset a Stomp e ritorno' },
  ];
  const DURATE = [1000, 1500, 2000, 3000];
  const MEMO_PED = 'pulzemazz.pedaliera', MEMO_LISTA = 'pulzemazz.liveLista';

  let schermo = null;
  const live = { vista: 'live', lista: 0, pagina: 0, meta: 0, stomp: false, impara: false, firma: '', scelto: null };
  let pedaliera = { switch: [], durata: 2000 };
  const midi = { usb: null, ble: null, bleNome: '', premuti: new Map() };

  try {
    const p = JSON.parse(localStorage.getItem(MEMO_PED) || 'null');
    if (p && Array.isArray(p.switch)) pedaliera = { switch: p.switch, durata: DURATE.includes(p.durata) ? p.durata : 2000 };
    pedaliera.switch.forEach(s => { if (s.preset && s.preset[0] === 'm') s.preset = 'p' + s.preset.slice(1); if (s.preset === 'g:meta') s.preset = null; if (s.lungo === 'meta') s.lungo = null; });
    live.lista = +localStorage.getItem(MEMO_LISTA) || 0;
  } catch (e) { /* senza memoria si parte da capo */ }
  const salvaPedaliera = () => { try { localStorage.setItem(MEMO_PED, JSON.stringify(pedaliera)); } catch (e) { /* niente */ } };

  function el(tag, cls, testo) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (testo !== undefined) e.textContent = testo;
    return e;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  /** Un tasto «?» che apre la guida alla sua sezione, con l'icona come gli altri. */
  function aiuto(b, sezione) {
    b.prepend(A().icona('domanda'));
    b.addEventListener('click', e => { e.stopPropagation(); A().apriGuida(sezione); });
    return b;
  }
  const stato = (t, tipo) => A() && A().scriviStato(t, tipo);

  /* ---------------------------------------------------------------- le Songlist e le pagine */

  /** Gli elenchi del Live: «Tutti i tone», poi le Songlist. Una voce è [posizione, numero del tone]. */
  function elenchi() {
    const a = A(), nomi = a.nomiTone || [];
    const tutti = { nome: 'Tutti i tone', lista: P.LISTA_INTERA, voci: nomi.map((n, i) => (n ? [i, i] : null)).filter(Boolean) };
    const liste = a.songlist ? a.songlist.liste.map(l => ({ nome: l.nome, lista: l.posizione, voci: l.toni.map((n, p) => [p, n]) })) : [];
    return [tutti, ...liste];
  }
  function elencoLive() {
    const tutti = elenchi();
    if (live.lista >= tutti.length) live.lista = 0;
    const e = tutti[live.lista];
    e.pagine = Math.max(1, Math.ceil(e.voci.length / PER_PAGINA));
    if (live.pagina >= e.pagine) live.pagina = e.pagine - 1;
    return e;
  }
  /** Gli 8 posti della pagina mostrata (null dove la pagina finisce). */
  function postiPagina(e) {
    return Array.from({ length: PER_PAGINA }, (_, i) => e.voci[live.pagina * PER_PAGINA + i] || null);
  }
  function cambiaLista(passo) {
    const n = elenchi().length;
    live.lista = (live.lista + passo + n) % n;
    live.pagina = 0; live.meta = 0;
    try { localStorage.setItem(MEMO_LISTA, String(live.lista)); } catch (e) { /* niente */ }
    disegna();
  }
  /** Pagina dopo o prima; oltre l'ultima (o prima della prima) si passa alla Songlist vicina. */
  function cambiaPagina(passo) {
    const e = elencoLive();
    const p = live.pagina + passo;
    if (p >= 0 && p < e.pagine) { live.pagina = p; live.meta = 0; disegna(); return; }
    cambiaLista(passo);
    if (passo < 0) { live.pagina = elencoLive().pagine - 1; disegna(); }
  }

  function postoAttivo(e, posti) {
    if (live.scelto && live.scelto.lista === live.lista && live.scelto.pagina === live.pagina) return live.scelto.i;
    const t = A().testa;
    if (!t) return -1;
    return posti.findIndex(v => v && v[1] === t.numero);
  }

  function suonaPosto(i) {
    const e = elencoLive();
    const v = postiPagina(e)[i];
    if (!v) return;
    live.meta = Math.floor(i / 4);
    const scelto = live.scelto = { lista: live.lista, pagina: live.pagina, i };
    const fatto = A().suona(e.lista, v[0], v[1]);
    disegna();
    Promise.resolve(fatto).finally(() => {
      setTimeout(() => { if (live.scelto === scelto) { live.scelto = null; live.firma = ''; if (schermo) disegna(); } }, 800);
    });
  }

  function cambiaStomp(slot) {
    const a = A(), t = a.testa;
    if (!t) { stato('Prima fai suonare un tone.', 'errore'); return; }
    if (!a.blocchi[slot]) return;                       // il blocco non è ancora stato letto
    a.accendiLive(slot);
    disegna();
  }

  /* ---------------------------------------------------------------- la schermata */

  function apri() {
    if (schermo) return;
    schermo = el('div', 'schermo live');
    schermo.innerHTML = `
      <div class="sch-cima">
        <img class="logo" src="img/logo.png" alt="MazzRig">
        <h2 class="lv-titolo">Live</h2>
        <span data-f="casa-schede"></span>
        <div class="lv-schede"><button type="button" data-f="v-live">Live</button><button type="button" data-f="v-ped">Pedaliera</button></div>
        <span class="spazio"></span>
        <span class="lv-midi" data-f="midi"></span>
        <button type="button" data-f="chiudi" title="Chiudi">✕</button>
      </div>
      <div class="lv-corpo" data-f="corpo"></div>`;
    document.body.appendChild(schermo);
    const q = f => schermo.querySelector(`[data-f="${f}"]`);
    q('chiudi').addEventListener('click', chiudi);
    q('v-live').addEventListener('click', () => { live.vista = 'live'; live.impara = false; disegna(); });
    q('v-ped').addEventListener('click', () => { live.vista = 'pedaliera'; disegna(); });
    live.firma = '';
    disegna();
  }
  function chiudi() {
    if (schermo) { schermo.remove(); schermo = null; }
    live.impara = false;
  }

  function firma() {
    const a = A(), t = a.testa;
    const accesi = t ? P.SLOT.map((_, s) => (a.accesoDi(s) ? 1 : 0)).join('') : '';
    const blocchi = a.blocchi.map(b => (b ? b.uid : '-')).join(',');
    const liste = a.songlist ? a.songlist.liste.map(l => l.nome + ':' + l.toni.join('.')).join(';') : '';
    return [live.vista, live.lista, live.pagina, live.meta, live.stomp, live.impara, t && t.numero, t && t.nome, t && t.catena && t.catena.join(),
      accesi, blocchi, liste, (a.nomiTone || []).join('|'), a.collegato(), !!midi.usb, midi.bleNome, JSON.stringify(pedaliera)].join('#');
  }
  setInterval(() => { if (schermo && firma() !== live.firma) disegna(); }, 300);

  function disegna() {
    if (!schermo) return;
    live.firma = firma();
    const q = f => schermo.querySelector(`[data-f="${f}"]`);
    q('v-live').classList.toggle('sì', live.vista === 'live');
    q('v-ped').classList.toggle('sì', live.vista === 'pedaliera');
    const fonti = [midi.usb ? 'MIDI USB' : '', midi.bleNome].filter(Boolean);
    q('midi').innerHTML = fonti.length ? `<span class="lampada accesa"></span>${esc(fonti.join(' · '))}` : '';
    const corpo = q('corpo');
    const schede = schermo.querySelector('.lv-schede');
    q('casa-schede').after(schede);
    corpo.textContent = '';
    if (live.vista === 'live') disegnaPalco(corpo); else disegnaPedaliera(corpo);
    const testa = corpo.querySelector('.lv-testa');
    if (testa) testa.querySelector('.lv-banco').after(schede);
    schermo.querySelector('.lv-titolo').style.visibility = live.vista === 'live' ? '' : 'hidden';
    const pedali = corpo.querySelector('.lv-pedali');
    if (pedali) pedali.prepend(schede);
  }

  function etichetteSwitch(prova) {
    const nomi = pedaliera.switch.filter(prova).map(s => s.nome);
    return nomi.length ? `<span class="lv-tag">${esc(nomi.join(' '))}</span>` : '';
  }
  /** Il posto della pagina (0-7) che uno switch comanda in Preset, o -1. */
  function postoDiSwitch(s) {
    if (!s.preset || s.preset.startsWith('g:')) return -1;
    return +s.preset.slice(1) - 1;
  }

  function disegnaPalco(corpo) {
    const a = A(), t = a.testa;
    if (!a.collegato() && !t) {
      corpo.appendChild(el('p', 'lv-msg', 'Collega il Pulze Mini per suonare dal Live.'));
    }
    const e = elencoLive();
    const posti = postiPagina(e);
    const attivo = postoAttivo(e, posti);
    const intera = e.lista === P.LISTA_INTERA;
    const testa = el('div', 'lv-testa');
    const pagine = e.pagine > 1 ? ` <small class="lv-pagina">${live.pagina + 1}/${e.pagine}</small>` : '';
    testa.innerHTML = `
      <div class="lv-banco"><button type="button" data-a="prima" title="Pagina precedente">◀</button><b>${esc(e.nome)}${pagine}</b><button type="button" data-a="dopo" title="Pagina successiva">▶</button></div>
      <div class="lv-modo"><button type="button" data-a="preset" class="${live.stomp ? '' : 'sì'}">Preset</button><button type="button" data-a="stomp" class="${live.stomp ? 'sì' : ''}">Stomp</button></div>
      <button type="button" class="aiuto" data-a="guida" title="Guida: Live" aria-label="Guida: Live"></button>
      <div class="lv-suona"><small>${live.stomp ? 'Stomp su' : 'Suona'}</small><span>${t ? esc(t.nome || '(senza nome)') : '—'}</span></div>`;
    testa.querySelector('[data-a="prima"]').addEventListener('click', () => cambiaPagina(-1));
    testa.querySelector('[data-a="dopo"]').addEventListener('click', () => cambiaPagina(1));
    const b = testa.querySelector('.lv-banco b');
    b.title = 'Cambia Songlist';
    b.style.cursor = 'pointer';
    b.addEventListener('click', ev => sceltaLista(ev.currentTarget));
    testa.querySelector('[data-a="preset"]').addEventListener('click', () => { live.stomp = false; disegna(); });
    aiuto(testa.querySelector('[data-a="guida"]'), 'g-live');
    testa.querySelector('[data-a="stomp"]').addEventListener('click', () => { live.stomp = true; disegna(); });
    corpo.appendChild(testa);

    const griglia = el('div', 'lv-griglia' + (live.stomp ? ' stomp' : ''));
    if (!live.stomp) {
      const nomi = a.nomiTone || [];
      posti.forEach((v, i) => {
        const b = el('button');
        b.type = 'button';
        b.className = `lv-posto ${i < 4 ? 'meta-a' : 'meta-b'}${i === attivo ? ' sì' : ''}${v ? '' : ' vuoto'}`;
        const nome = v ? nomi[v[1]] || '(vuoto)' : '—';
        const num = v ? String((intera ? v[1] : v[0]) + 1) : '';
        b.innerHTML = `${etichetteSwitch(s => postoDiSwitch(s) === i)}<span class="lv-num">${num}</span>
          <span class="lv-led"></span><span class="lv-nome">${esc(nome)}</span><span class="lv-sw"></span>`;
        b.addEventListener('click', () => suonaPosto(i));
        griglia.appendChild(b);
      });
    } else {
      // i blocchi nell'ordine della catena del tone che suona
      const ordine = t && t.catena ? t.catena : STOMP.map(s => s.slot);
      const blocchi = ordine.map(slot => STOMP.find(s => s.slot === slot)).filter(Boolean);
      for (const s of blocchi) {
        const blocco = a.blocchi[s.slot];
        const uid = blocco ? blocco.uid : t ? t.uid[s.slot] : null;
        const acceso = t ? a.accesoDi(s.slot) : false;
        const img = uid != null ? a.immagineDi(uid) : null;
        const nome = uid != null ? a.nomeModello(uid) || '—' : '—';
        const b = el('button');
        b.type = 'button';
        b.className = `lv-posto blocco${acceso ? ' sì' : ''}${t ? '' : ' vuoto'}`;
        b.innerHTML = `${etichetteSwitch(x => x.stomp === s.nome)}<span class="lv-num">${esc(s.nome)}</span>
          ${img ? `<img class="lv-foto" src="${esc(img)}" alt="">` : '<span class="lv-foto"></span>'}
          <span class="lv-led"></span><span class="lv-nome">${esc(nome)}</span>
          <span class="lv-stato">${t ? (blocco ? (acceso ? 'acceso' : 'spento') : 'leggo…') : ''}</span><span class="lv-sw"></span>`;
        b.addEventListener('click', () => cambiaStomp(s.slot));
        griglia.appendChild(b);
      }
    }
    corpo.appendChild(griglia);
  }

  /** La tendina delle Songlist, sotto il nome. */
  function sceltaLista(ancora) {
    const vecchia = document.querySelector('.lv-tendina');
    if (vecchia) { vecchia.remove(); return; }
    const t = el('div', 'lv-tendina');
    elenchi().forEach((e, i) => {
      const b = el('button', i === live.lista ? 'sì' : '', e.nome + ' (' + e.voci.length + ')');
      b.type = 'button';
      b.addEventListener('click', () => { t.remove(); live.lista = i; cambiaLista(0); });
      t.appendChild(b);
    });
    const r = ancora.getBoundingClientRect();
    t.style.left = r.left + 'px'; t.style.top = (r.bottom + 8) + 'px'; t.style.minWidth = r.width + 'px';
    schermo.appendChild(t);
    setTimeout(() => addEventListener('pointerdown', function via(ev) {
      if (!t.contains(ev.target)) { t.remove(); removeEventListener('pointerdown', via, true); }
    }, true));
  }

  /* ---------------------------------------------------------------- la pedaliera */

  const nomeGesto = v => (GESTI.find(g => g.id === v) || GESTI[0]).nome;
  const nomePreset = v => !v ? 'Nessuna azione' : v.startsWith('g:') ? nomeGesto(v.slice(2)) : 'Suona il riquadro ' + v.slice(1);
  const nomeStomp = v => (!v ? 'Nessuna azione' : v.startsWith('g:') ? nomeGesto(v.slice(2)) : 'Accendi/spegni ' + v);
  function descriviMessaggio(chiave) {
    const [tipo, canale, numero] = chiave.split(':');
    return (tipo === 'cc' ? 'CC ' : 'PC ') + numero + ' · canale ' + (+canale + 1);
  }
  function scelta(valore, nome, voci, quando) {
    const s = el('select', 'lv-scegli' + (valore ? '' : ' vuoto'));
    voci.forEach((v, i) => { const o = el('option', '', nome(v)); o.value = String(i); s.appendChild(o); });
    s.value = String(Math.max(0, voci.indexOf(valore)));
    s.addEventListener('change', () => quando(voci[+s.value]));
    return s;
  }

  function disegnaPedaliera(corpo) {
    const box = el('div', 'lv-ped');
    box.innerHTML = `
      <div class="lv-pedali"><div class="lv-blocco">
        <button type="button" data-a="ble" class="${midi.ble ? 'sì' : ''}">${midi.ble ? 'Stacca ' + esc(midi.bleNome) : 'Collega un pedale Bluetooth'}</button>
        <button type="button" data-a="usb" class="${midi.usb ? 'sì' : ''}">${midi.usb ? 'MIDI USB attivo' : 'Usa i pedali USB'}</button>
      </div></div>
      <h3>Switch</h3>`;
    box.querySelector('[data-a="ble"]').addEventListener('click', () => (midi.ble ? staccaBle() : collegaBle()));
    box.querySelector('[data-a="usb"]').addEventListener('click', attivaUsb);

    const tab = el('table', 'lv-tabella');
    tab.innerHTML = '<thead><tr><th>Switch</th><th>Messaggio</th><th>Premuto, in Preset</th><th>Premuto, in Stomp</th><th>Tenuto premuto</th><th></th></tr></thead>';
    const tb = el('tbody');
    const gestiTocco = GESTI.filter(g => g.id).map(g => 'g:' + g.id);
    const voci = {
      preset: [null, ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => 'p' + n), ...gestiTocco],
      stomp: [null, ...STOMP.map(s => s.nome), ...gestiTocco],
      lungo: GESTI.map(g => g.id),
    };
    pedaliera.switch.forEach((s, k) => {
      const riga = el('tr');
      riga.innerHTML = `<td><button type="button" class="lv-nome-sw" title="Rinomina">${esc(s.nome)}</button></td><td class="lv-msg">${descriviMessaggio(s.chiave)}</td><td></td><td></td><td></td><td></td>`;
      const celle = riga.querySelectorAll('td');
      const cambia = (campo, v) => { s[campo] = v; salvaPedaliera(); live.firma = ''; disegna(); };
      celle[2].appendChild(scelta(s.preset, nomePreset, voci.preset, v => cambia('preset', v)));
      celle[3].appendChild(scelta(s.stomp, nomeStomp, voci.stomp, v => cambia('stomp', v)));
      celle[4].appendChild(scelta(s.lungo, nomeGesto, voci.lungo, v => cambia('lungo', v)));
      const togli = el('button', '', 'Togli');
      togli.type = 'button';
      togli.addEventListener('click', () => { pedaliera.switch.splice(k, 1); salvaPedaliera(); disegna(); });
      celle[5].appendChild(togli);
      celle[0].firstChild.addEventListener('click', () => {
        const n = prompt('Nome dello switch', s.nome);
        if (n && n.trim()) cambia('nome', n.trim().slice(0, 6));
      });
      tb.appendChild(riga);
    });
    if (!pedaliera.switch.length) tb.innerHTML = '<tr><td colspan="6" class="lv-msg">Nessuno switch.</td></tr>';
    tab.appendChild(tb);
    box.appendChild(tab);

    const piede = el('div', 'lv-piede');
    const blocco = el('div', 'lv-blocco');
    const impara = el('button', 'lv-impara' + (live.impara ? ' attesa' : ''), live.impara ? 'Premi uno switch del pedale…' : '＋ Impara uno switch');
    impara.type = 'button';
    impara.addEventListener('click', () => {
      if (!midi.usb && !midi.ble) { alert('Collega prima un pedale Bluetooth o attiva i pedali USB.'); return; }
      live.impara = !live.impara; disegna();
    });
    blocco.appendChild(impara);
    piede.appendChild(blocco);
    piede.appendChild(el('span', 'lv-durata-et', 'Pressione lunga'));
    const g = el('button', 'aiuto');
    g.type = 'button'; g.title = 'Guida: pedaliera'; g.setAttribute('aria-label', g.title);
    piede.appendChild(aiuto(g, 'g-live-pedaliera'));
    const bd = el('div', 'lv-blocco');
    bd.appendChild(scelta(pedaliera.durata, v => 'dopo ' + String(v / 1000).replace('.', ',') + ' s', DURATE,
      v => { pedaliera.durata = v; salvaPedaliera(); disegna(); }));
    piede.appendChild(bd);
    box.appendChild(piede);
    corpo.appendChild(box);
  }

  /* ---------------------------------------------------------------- il MIDI in arrivo */

  function arrivoMidi(st, d1, d2) {
    const tipo = st & 0xf0, canale = st & 0x0f;
    if (tipo !== 0xb0 && tipo !== 0xc0) return;
    const chiave = (tipo === 0xb0 ? 'cc' : 'pc') + ':' + canale + ':' + d1;
    const premuto = tipo === 0xc0 || d2 >= 64;

    if (live.impara && premuto) {
      live.impara = false;
      if (!pedaliera.switch.some(s => s.chiave === chiave)) {
        const n = pedaliera.switch.length;
        pedaliera.switch.push({ nome: String.fromCharCode(65 + (n % 26)), chiave, preset: n < 8 ? 'p' + (n + 1) : null, stomp: STOMP[n] ? STOMP[n].nome : null, lungo: null });
        salvaPedaliera();
      } else stato('Questo switch c\'è già.');
      disegna();
      return;
    }
    const s = pedaliera.switch.find(x => x.chiave === chiave);
    if (!s || !schermo) return;
    if (tipo === 0xc0) { tocco(s); return; }

    if (premuto) {
      if (midi.premuti.has(chiave)) return;
      if (!s.lungo) { midi.premuti.set(chiave, { fatto: true }); tocco(s); return; }
      const p = { fatto: false };
      p.timer = setTimeout(() => { p.fatto = true; gesto(s.lungo); }, pedaliera.durata);
      midi.premuti.set(chiave, p);
    } else {
      const p = midi.premuti.get(chiave);
      midi.premuti.delete(chiave);
      if (p && !p.fatto) { clearTimeout(p.timer); tocco(s); }
    }
  }

  function tocco(s) {
    if (live.vista !== 'live') return;
    const azione = live.stomp ? s.stomp : s.preset;
    if (azione && azione.startsWith('g:')) { gesto(azione.slice(2)); return; }
    if (live.stomp) {
      if (!s.stomp) return;
      const b = STOMP.find(x => x.nome === s.stomp);
      if (b) cambiaStomp(b.slot);                     // per tipo: lo stesso effetto dovunque stia nella catena
    } else { const i = postoDiSwitch(s); if (i >= 0) suonaPosto(i); }
  }

  function gesto(g) {
    if (g === 'stomp') live.stomp = !live.stomp;
    else if (g === 'tone+' || g === 'tone-') { toneVicino(g === 'tone+' ? 1 : -1); return; }
    else if (g === 'pagina+') { cambiaPagina(1); return; }
    else if (g === 'pagina-') { cambiaPagina(-1); return; }
    disegna();
  }

  /** Il tone dopo o prima di quello che suona, nella Songlist mostrata (le pagine seguono). */
  function toneVicino(passo) {
    const e = elencoLive(), t = A().testa;
    if (!e.voci.length) return;
    let i = t ? e.voci.findIndex(v => v[1] === t.numero) : -1;
    i = i < 0 ? 0 : (i + passo + e.voci.length) % e.voci.length;
    live.pagina = Math.floor(i / PER_PAGINA);
    suonaPosto(i % PER_PAGINA);
  }

  async function attivaUsb() {
    if (midi.usb) return;
    if (!navigator.requestMIDIAccess) { alert('Questo browser non ha il MIDI.'); return; }
    try {
      midi.usb = await navigator.requestMIDIAccess();
      const aggancia = () => midi.usb.inputs.forEach(i => { i.onmidimessage = e => { const d = e.data; arrivoMidi(d[0], d[1], d[2]); }; });
      aggancia();
      midi.usb.onstatechange = aggancia;
      stato('Pedali USB in ascolto.', 'ok');
    } catch (err) {
      midi.usb = null;
      stato('MIDI USB non disponibile: ' + err.message, 'errore');
    }
    disegna();
  }

  /** Un pacchetto BLE MIDI: testa, poi per ogni messaggio un byte di tempo e lo status (o running status). */
  function leggiBleMidi(p) {
    let i = 1, st = 0;
    while (i < p.length) {
      if (p[i] & 0x80) {
        i++;
        if (i < p.length && p[i] & 0x80) st = p[i++];
      }
      if (!st || i >= p.length) break;
      const lunghi = (st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0 ? 1 : 2;
      const d1 = p[i], d2 = lunghi === 2 ? p[i + 1] : 0;
      i += lunghi;
      if (st < 0xf0) arrivoMidi(st, d1, d2);
    }
  }

  async function collegaBle() {
    if (!navigator.bluetooth) { alert('Questo browser non ha il Bluetooth.'); return; }
    try {
      const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVIZIO] }] });
      const gatt = await dev.gatt.connect();
      const ch = await (await gatt.getPrimaryService(BLE_MIDI_SERVIZIO)).getCharacteristic(BLE_MIDI_DATI);
      ch.addEventListener('characteristicvaluechanged', e => leggiBleMidi(new Uint8Array(e.target.value.buffer)));
      await ch.startNotifications();
      dev.addEventListener('gattserverdisconnected', () => {
        if (midi.ble !== dev) return;
        midi.ble = null; midi.bleNome = '';
        stato('Il pedale Bluetooth si è staccato.', 'errore');
        disegna();
      });
      midi.ble = dev; midi.bleNome = dev.name || 'pedale';
      stato('«' + midi.bleNome + '» collegato.', 'ok');
    } catch (err) {
      if (err && err.name !== 'NotFoundError') stato('Pedale non collegato: ' + err.message, 'errore');
    }
    disegna();
  }
  function staccaBle() {
    const dev = midi.ble;
    midi.ble = null; midi.bleNome = '';
    if (dev && dev.gatt.connected) dev.gatt.disconnect();
    disegna();
  }

  addEventListener('keydown', e => {
    if (e.key === 'Escape' && schermo && !document.querySelector('.lv-tendina')) chiudi();
  });
  const bottone = $('#apri-live');
  if (bottone) bottone.addEventListener('click', apri);
  window.MazzRigLive = { apri, chiudi };
})();
