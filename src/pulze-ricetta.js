// pulze-ricetta.js - «Crea preset…»: un'AI compone il tone da una descrizione a parole, come fa lo skill
// di Reniori (pulze-tone-generator, MIT: .claude/skills/pulze-tone-generator/SKILL.md e writer.py).
// Qui solo la parte pura, provata da Node (test/ricetta.test.js):
//   istruzioni(C, opz)        il messaggio di sistema: regole, forma della risposta e il catalogo intero
//   descriviTone(C, tone)     il tone che suona scritto come una ricetta (per «parti da questo»)
//   aTone(ricetta, C, opz)    la risposta dell'AI → il tone nella forma dell'import .prst
// La chiamata a OpenAI sta in app.js.
(function (g) {
  const SLOT = ['PRE', 'AMP', 'DYN', 'CAB', 'EQ/MOD', 'FX1', 'FX2'];
  const CATENA_COMUNE = [2, 0, 1, 3, 4, 5, 6];          // DYN, PRE, AMP, CAB, EQ/MOD, FX1, FX2

  const norm = s => String(s == null ? '' : s).normalize('NFD').toLowerCase().replace(/[^a-z0-9/+]/g, '');
  const cifra = v => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));

  /** Le etichette di un selettore, in ordine di valore. */
  const voci = k => Object.keys(k[3]).map(Number).sort((a, b) => a - b).map(v => [v, k[3][v]]);

  /** Una manopola come la legge l'AI: «Mix 0..100 =25», «Low Cut 20..2000Hz|Off =80». */
  function manopolaTesto(C, k, z) {
    const [nome, pos, tipo] = k;
    const f = z[pos];
    if (tipo === 't') return nome + ' On|Off =' + (f >= 0.5 ? 'On' : 'Off');
    if (tipo === 'e') {
      const l = voci(k);
      const d = k[3][Math.round(f)];
      return nome + ' {' + l.map(x => x[1]).join('|') + '}' + (d != null ? ' =' + d : '');
    }
    if (tipo === 'o') {
      const [, , , min, max, u, lato] = k;
      const off = (lato === '<' && f < min) || (lato === '>' && f > max);
      return nome + ' ' + cifra(min) + '..' + cifra(max) + u + '|Off =' + (off ? 'Off' : cifra(f));
    }
    if (tipo === 'd') {
      const [, , , min, max, u, posSync] = k;
      const sync = z[posSync] >= 0.5;
      return nome + ' ' + cifra(min) + '..' + cifra(max) + u + ' or division' +
        ' =' + (sync ? C.divisioni[Math.round(f)] : cifra(f));
    }
    const [, , , min, max, u] = k;
    return nome + ' ' + cifra(min) + '..' + cifra(max) + (u || '') + (f != null ? ' =' + cifra(f) : '');
  }

  /** Un Sound Clone col cabinet dentro: «FR», «full rig», «cab» nel nome (MazzRig aggiunge « FR»
   *  da solo quando il .nam lo dice nei metadata). */
  function fullRig(nome) {
    return /(^|[^a-z0-9])(fr|full ?rig|fullrig|cab|amp ?[+] ?cab|w ?cab)([^a-z0-9]|$)/i.test(String(nome || ''));
  }

  /** Il catalogo come testo: un modello per riga, con gli slot dove va. Sound Clone e IR utente solo se
   *  caricati sul Mini (opz.utente: uid → { nome, vuoto }), col nome dato dall'utente. */
  function catalogoTesto(C, utente) {
    const slotDi = {};
    for (const [s, l] of Object.entries(C.moduli)) for (const u of l) (slotDi[u] = slotDi[u] || []).push(SLOT[s]);
    const righe = [];
    for (const [u, m] of Object.entries(C.modelli)) {
      const uid = +u;
      let nome = m.n;
      let info = m.i || m.r || '';
      if (m.f === 'Sound Clone' || m.f === 'User IR') {
        const x = utente && utente.get(uid);
        if (!x || x.vuoto) continue;
        info = m.f === 'Sound Clone'
          ? 'user NAM capture named "' + x.nome + '", ' + (fullRig(x.nome)
            ? 'FULL RIG (amp and cabinet captured: set CAB "on": false)'
            : 'amp only (keep a CAB on)')
          : 'user impulse response named "' + x.nome + '" (a cabinet)';
      }
      if (!slotDi[uid]) continue;
      righe.push(nome + ' | ' + slotDi[uid].join(',') + ' | ' + m.f + ' | ' + info + ' | ' +
        m.k.map(k => manopolaTesto(C, k, m.z || {})).join('; '));
    }
    return righe.join('\n');
  }

  // ---------------------------------------------------------------- la chitarra dell'utente
  // Il layout si scrive dal ponte al manico, una lettera per posizione: S single coil, H humbucker,
  // M mini humbucker, P P-90, «-» posizione vuota («--H» = un humbucker solo al manico). Due lettere
  // sono ponte e manico, una il solo ponte. Come in SparklingTones (18 novembre 2026).
  const TIPI_PICKUP = { S: 'single coil', H: 'humbucker', M: 'mini humbucker', P: 'P-90' };
  const layoutBuono = l => /^[SHMP-]{1,3}$/.test(l) && /[SHMP]/.test(l);
  const haHumbucker = l => /[HM]/.test(l);
  /** Le posizioni dal manico con un pickup vero (non «-»). */
  const postiVeri = l => l.split('').reverse().map((c, i) => (c === '-' ? -1 : i)).filter(i => i >= 0);

  /** «La mia chitarra» (chitarra = { layout, split }): il preset si regola perché la chitarra dell'utente
   *  si avvicini al suono chiesto anche se l'artista ne usa un'altra (Santana con una Strat). */
  function chitarraTesto(chitarra, lingua) {
    const mia = chitarra && layoutBuono(chitarra.layout || '') ? chitarra.layout : '';
    if (!mia) return [];
    const posti = mia.length === 3 ? ['bridge', 'middle', 'neck'] : mia.length === 2 ? ['bridge', 'neck'] : ['bridge'];
    const pezzi = mia.split('').map((c, i) => posti[i] + ': ' + (c === '-' ? 'none' : TIPI_PICKUP[c])).join(', ');
    const split = !haHumbucker(mia) ? []
      : chitarra.split !== false ? ['  Its humbuckers can be coil-split: use "split" when a single-coil sound helps.']
      : ['  Its humbuckers CANNOT be coil-split: "split" must be false; get any single-coil brightness from the chain.'];
    return [
      '- The player’s guitar: ' + mia + ' (' + pezzi + ').',
      ...split,
      '  This is the guitar that will be plugged in, and the target sound may come from a different one (e.g. a Santana tone, ' +
      'humbuckers, played on an SSS Strat). Voice the preset so that THIS guitar gets as close as possible to the target sound: ' +
      'compensate in the chain. Single coils for a humbucker sound: more gain or a drive in front, more bass and low mids, a bit ' +
      'less treble and presence, a gate if it hums. Humbuckers for a single-coil sound: less gain, more treble and presence, ' +
      'fewer low mids, maybe a compressor for the snap. P-90 sit in between.',
      '  "pickups.layout" must be "' + mia + '": choose the positions on this guitar closest to the target (e.g. bridge + middle ' +
      'on a Strat for a quacky tone, the bridge single coil with the tone knob rolled back for a humbucker lead).',
      '  In "explanation" say in ' + lingua + ' what you compensated for this guitar.',
    ];
  }

  /** Gli stessi pickup su un'altra chitarra: con un numero diverso di pickup i posti cambiano, e si tengono
   *  manico e ponte (il centrale va solo su una chitarra a tre). Un posto vuoto si spegne; se non resta
   *  niente, si accende il pickup più vicino al ponte. Modifica pk e lo rende. */
  function adattaLayout(pk, layout) {
    const prima = pk.layout.length, n = layout.length;
    pk.layout = layout;
    if (n !== prima) {
      pk.attivi = pk.attivi.map(i => (i === prima - 1 ? n - 1 : i === 0 ? 0 : (n === 3 ? 1 : -1)))
        .filter((i, k, a) => i >= 0 && i < n && a.indexOf(i) === k).sort();
    }
    const veri = postiVeri(layout);
    pk.attivi = pk.attivi.filter(i => veri.includes(i));
    if (!pk.attivi.length && veri.length) pk.attivi = [veri[veri.length - 1]];
    if (!haHumbucker(layout)) pk.split = false;
    return pk;
  }

  /** Il messaggio di sistema. */
  function istruzioni(C, opz) {
    opz = opz || {};
    return [
      'You design guitar presets for the Hotone Pulze Mini multi-effects amp (firmware 1.1.x).',
      'A preset has seven blocks, each holding one model: PRE (pre-amp effects: drives, comps, wahs, ' +
      'filters, pitch), AMP, DYN (compressor or noise gate), CAB (cabinet or user IR), EQ/MOD (EQ or ' +
      'modulation), FX1 and FX2 (delays, reverbs, modulation). Models can only go in the slots listed ' +
      'for them in the catalog. Every block can be on or off independently.',
      'The device names are renamed real gear: use the "Based on" text to translate requests such as ' +
      '"a Marshall plexi", "a Tube Screamer", "a Fender Twin" to catalog models.',
      '',
      'Rules (from the Pulze Tone Generator by reniori):',
      '- Use model names and knob names exactly as written in the catalog.',
      '- Set every audible knob explicitly. Knobs you leave out get the factory value shown after "=".',
      '- Many effects ship with Mix or Level low or at 0: always set them to an audible value.',
      '- Time/Rate knobs marked "or division" take a number (ms or Hz) or a note division string ' +
      '("1/1","1/2","1/2d","1/2t","1/4","1/4d","1/4t","1/8","1/8d","1/8t","1/16") synced to the preset bpm.',
      '- Selectors in {braces} take one of the listed labels. On|Off knobs take "On" or "Off". ' +
      'Cab Low Cut / High Cut accept "Off" (factory: Low Cut 80 Hz, High Cut Off).',
      '- On amps the first knob (Gain or Volume) is the preamp gain; Master/Output is the level.',
      '- High-gain amps usually want Gate 2 in DYN (Threshold ~37, Attack 11-16, Release 58-75).',
      '- Blocks you do not need: pick a sensible model and set "on": false.',
      '- Default chain order is DYN, PRE, AMP, CAB, EQ/MOD, FX1, FX2. Reorder only when the sound calls ' +
      'for it (e.g. modulation before the amp for vintage throb). Any order of the seven is legal.',
      '- Preset volume 0-100 (around 50-70), bpm 40-250 (matters for synced delays).',
      '- The name: at most 16 plain ASCII characters, WITHOUT the artist prefix (MazzRig adds it).',
      '- "artist": when the request names or clearly points to an artist, band or famous song, the artist initials in ' +
      '2-3 capital letters (first name + surname: Brian May / Queen songs "BM", Carlos Santana "CS", David Gilmour / Pink Floyd "DG", ' +
      'Eddie Van Halen / Van Halen "VH", Jimi Hendrix "JH", Slash "SL", band names by their words: AC/DC "AC", Dire Straits "DS"). ' +
      'MazzRig names the preset "BM - <name>", so keep "name" short (about 11 characters, e.g. "Bohemian Ld"). "" when no artist.',
      '- "pickups": the ideal pickup setting for the sound. "layout" = the guitar pickups written the usual way, from bridge to neck (HSS = humbucker at the bridge), ' +
      'S single coil, H humbucker, M mini humbucker, P P-90, "-" an empty position (e.g. "SSS" Strat, "HH" Les Paul, "HSS", "SS" Tele, "PP", ' +
      '"--H" one humbucker at the neck; two letters = bridge and neck): the artist’s own guitar, ' +
      'or the user’s guitar when they describe it. "on" = the active positions among "neck", "middle", "bridge" ' +
      '("middle" only with three pickups). "split": true when a humbucker is coil-split. "tip": one short sentence in ' + (opz.lingua === 'en' ? 'English' : 'Italian') + ' ' +
      'with selector position, volume/tone knob and the artist’s trick if any (e.g. Brian May: bridge + neck in phase, treble booster).',
      '- When the user describes the guitar, the room or the band context, voice the preset for it ' +
      '(bedroom: lusher wet and full lows; band mix: carved mids, tighter low cut, drier tails).',
      '- User NAM captures (family "Sound Clone") and user IRs are the player’s own gear, loaded on the device: ' +
      'when the request names or matches one of them (by amp, brand or name), use it instead of a stock model. ' +
      'If several captures match, prefer the one whose name is closest to the words the user wrote ("my Mesa" → a capture named "Mesa …" before an abbreviation like "MES …"), and name the other matching captures in the explanation so the user can switch. ' +
      'A capture marked FULL RIG already contains the cabinet: keep the CAB block but set it "on": false. ' +
      'An "amp only" capture needs a CAB on (a matching user IR if there is one, else a stock cab).',
      '- "nam_tip": unless the preset already uses one of the user captures, ALWAYS suggest the NAM capture that ' +
      'would get closest to the requested sound: the exact real amp (and mods or channel, e.g. "Marshall 1959 Super Lead modded, ' +
      'EVH style"), amp only or full rig with which cab, and what to search for on TONE3000 ("A2" models). One or two short ' +
      'sentences in ' + (opz.lingua === 'en' ? 'English' : 'Italian') + '. Load it with MazzRig’s "Load NAM & IR". ' +
      'If the preset already uses a user capture, set "nam_tip" to "".',
      ...chitarraTesto(opz.chitarra, opz.lingua === 'en' ? 'English' : 'Italian'),
      opz.parti ? '- The user message includes the preset currently loaded: change it as asked, keep the rest.' : '',
      '',
      'Answer with ONE JSON object only, no other text:',
      '{"name": "...", "volume": 60, "bpm": 120,',
      ' "chain": ["DYN","PRE","AMP","CAB","EQ/MOD","FX1","FX2"],',
      ' "blocks": {"PRE": {"model": "...", "on": true, "knobs": {"Knob": value}}, "AMP": {...}, "DYN": {...},',
      '            "CAB": {...}, "EQ/MOD": {...}, "FX1": {...}, "FX2": {...}},',
      ' "explanation": "two or three short sentences in ' + (opz.lingua === 'en' ? 'English' : 'Italian') + ' on the choices",',
      ' "nam_tip": "…", "artist": "BM",',
      ' "pickups": {"layout": "SSS", "on": ["bridge", "middle"], "split": false, "tip": "…"}}',
      'All seven blocks must be present.',
      '',
      'Catalog (model | slots | family | description | knobs: name range =factory):',
      catalogoTesto(C, opz.utente),
    ].filter(r => r !== '').join('\n');
  }

  /** Il valore di una manopola come testo, per descrivere il tone che suona. */
  function valoreTesto(C, k, valori) {
    const [, pos, tipo] = k;
    const v = valori[pos];
    if (tipo === 't') return v >= 0.5 ? 'On' : 'Off';
    if (tipo === 'e') return k[3][Math.round(v)] != null ? k[3][Math.round(v)] : cifra(v);
    if (tipo === 'o') {
      const [, , , min, max, , lato] = k;
      return (lato === '<' && v < min) || (lato === '>' && v > max) ? 'Off' : cifra(v);
    }
    if (tipo === 'd' && valori[k[6]] >= 0.5) return C.divisioni[Math.round(v)] || cifra(v);
    return cifra(v);
  }

  /** Il tone che suona come ricetta JSON (testa: nome, volume, tempo, catena; blocchi per slot). */
  function descriviTone(C, tone, nomeDi) {
    const r = { name: tone.nome, volume: tone.volume, bpm: tone.tempo,
      chain: tone.catena.map(s => SLOT[s]), blocks: {} };
    tone.blocchi.forEach((b, s) => {
      if (!b) return;
      const m = C.modelli[b.uid];
      const knobs = {};
      if (m) for (const k of m.k) { const v = valoreTesto(C, k, b.valori); knobs[k[0]] = /^-?\d+(\.\d+)?$/.test(v) ? +v : v; }
      r.blocks[SLOT[s]] = { model: (nomeDi && nomeDi(b.uid)) || (m ? m.n : '?'), on: !!b.acceso, knobs };
    });
    return JSON.stringify(r);
  }

  // ---------------------------------------------------------------- dalla risposta al tone

  /** Il modello di uno slot dal nome: catalogo, o il nome dato dall'utente a un Sound Clone / IR. */
  function trovaModello(C, s, nome, utente) {
    const n = norm(nome);
    if (!n) return null;
    const ammessi = C.moduli[s] || [];
    for (const u of ammessi) if (norm(C.modelli[u].n) === n) return u;
    if (utente) for (const u of ammessi) { const x = utente.get(u); if (x && !x.vuoto && norm(x.nome) === n) return u; }
    return null;
  }

  const vero = v => v === true || v === 1 || /^(on|true|1|si|sì|yes)$/i.test(String(v).trim());
  const aPasso = (v, p) => (p ? Math.round(v / p) * p : v);
  const stretto = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Una manopola dalla ricetta → { pos: valore } (anche il Sync), o un errore in testo. */
  function codifica(C, k, v) {
    const [nome, pos, tipo] = k;
    const testo = String(v).trim();
    const numero = typeof v === 'number' ? v : (/^-?\d+(\.\d+)?/.test(testo) ? parseFloat(testo) : NaN);
    if (tipo === 't') return { [pos]: vero(v) ? 1 : 0 };
    if (tipo === 'e') {
      for (const [val, et] of voci(k)) if (norm(et) === norm(testo)) return { [pos]: val };
      if (/^-?\d+$/.test(testo) && k[3][+testo] != null) return { [pos]: +testo };
      return nome + ': «' + testo + '» non è fra ' + voci(k).map(x => x[1]).join(', ');
    }
    if (tipo === 'o') {
      const [, , , min, max, , lato] = k;
      if (/^off$/i.test(testo)) return { [pos]: lato === '<' ? min - 1 : max + 1 };
      if (!Number.isFinite(numero)) return nome + ': «' + testo + '» non è un numero';
      if ((lato === '<' && numero < min) || (lato === '>' && numero > max)) return { [pos]: lato === '<' ? min - 1 : max + 1 };
      return { [pos]: Math.round(stretto(numero, min, max)) };
    }
    if (tipo === 'd') {
      const [, , , min, max, , posSync, passo] = k;
      const div = Object.keys(C.divisioni).find(i => C.divisioni[i] === testo.toLowerCase().replace(/\s/g, ''));
      if (div != null) return { [pos]: +div, [posSync]: 1 };
      if (!Number.isFinite(numero)) return nome + ': «' + testo + '» non è né un numero né una divisione';
      return { [pos]: +aPasso(stretto(numero, min, max), passo).toFixed(2), [posSync]: 0 };
    }
    const [, , , min, max, , passo] = k;
    if (!Number.isFinite(numero)) return nome + ': «' + testo + '» non è un numero';
    return { [pos]: +aPasso(stretto(numero, min, max), passo).toFixed(2) };
  }

  const ascii = t => String(t || '').normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();

  /** Il nome del preset: «BM - Bohemian Ld» con la sigla dell'artista davanti (se l'AI la dà), 16 caratteri. */
  function nomeConSigla(nome, artista) {
    const sigla = ascii(artista).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    let n = ascii(nome);
    if (sigla) {
      n = n.replace(new RegExp('^' + sigla + '\\s*-\\s*', 'i'), '');
      n = sigla + ' - ' + n;
    }
    return n.slice(0, 16).trim().replace(/\s*-$/, '') || 'Nuovo preset';
  }

  /** I pickup consigliati: { layout: 'HSS' (come si scrive: dal ponte al manico), attivi: [indici dal
   *  manico], split, consiglio } o null. */
  function pickupDa(pk) {
    if (!pk || typeof pk !== 'object') return null;
    const layout = String(pk.layout || '').toUpperCase().replace(/[^SHMP-]/g, '').slice(0, 3);
    if (!layoutBuono(layout)) return null;
    const posti = layout.length === 3 ? ['neck', 'middle', 'bridge'] : layout.length === 2 ? ['neck', 'bridge'] : ['bridge'];
    const sinonimi = { manico: 'neck', neck: 'neck', centrale: 'middle', middle: 'middle', mid: 'middle', ponte: 'bridge', bridge: 'bridge' };
    const on = (Array.isArray(pk.on) ? pk.on : String(pk.on || '').split(/[\s,+]+/))
      .map(x => sinonimi[String(x).toLowerCase().trim()]).filter(Boolean);
    const veri = postiVeri(layout);
    const attivi = posti.map((p, i) => (on.includes(p) && veri.includes(i) ? i : -1)).filter(i => i >= 0);
    if (!attivi.length) return null;
    return { layout, attivi, split: vero(pk.split) && haHumbucker(layout), consiglio: String(pk.tip || '').trim() };
  }

  /** I pickup della risposta, portati sulla chitarra dell'utente (opz.chitarra) se la chat ha messo
   *  quella dell'artista; senza split se i suoi humbucker non si splittano. */
  function pickupPerChitarra(pk, chitarra) {
    let p = pickupDa(pk);
    const mia = chitarra && layoutBuono(chitarra.layout || '') ? chitarra.layout : '';
    if (!p || !mia) return p;
    if (p.layout !== mia) p = adattaLayout(p, mia);
    if (!p.attivi.length) return null;
    if (chitarra.split === false) p.split = false;
    return p;
  }

  /** Il JSON dell'AI → il tone come lo dà PulzePrst.aTone, più per blocco «sopra» (posizione → valore:
   *  fabbrica + ricetta, da mettere sopra i valori che ha il Mini) o «tieni» (resta il blocco del tone).
   *  opz.utente: i nomi di Sound Clone e IR; opz.tone: il tone che suona (per gli slot mancanti). */
  function aTone(ricetta, C, opz) {
    opz = opz || {};
    if (typeof ricetta === 'string') ricetta = JSON.parse(ricetta.replace(/^```(json)?|```$/gm, ''));
    if (!ricetta || typeof ricetta !== 'object') throw new Error('la risposta non è un preset');
    const avvisi = [];
    const blocchiR = ricetta.blocks || {};
    const perNome = {};
    for (const [k, v] of Object.entries(blocchiR)) perNome[norm(k)] = v;

    let catena = Array.isArray(ricetta.chain) ? ricetta.chain.map(x => SLOT.findIndex(n => norm(n) === norm(x))) : null;
    if (!catena || catena.length !== 7 || catena.slice().sort().join() !== '0,1,2,3,4,5,6') {
      if (ricetta.chain) avvisi.push('l\'ordine della catena non si capiva: messo quello comune');
      catena = CATENA_COMUNE.slice();
    }

    const blocchi = SLOT.map((nomeSlot, s) => {
      const r = perNome[norm(nomeSlot)];
      const attuale = opz.tone && opz.tone.blocchi[s];
      const fermo = perche => ({ slot: s, uid: attuale ? attuale.uid : 0, acceso: attuale ? !!attuale.acceso : false,
        valori: attuale ? attuale.valori.slice() : new Array(15).fill(0), tieni: perche });
      if (!r) { avvisi.push(nomeSlot + ' manca nella risposta'); return fermo('l\'AI non l\'ha scritto'); }
      const uid = trovaModello(C, s, r.model, opz.utente);
      if (uid == null) {
        avvisi.push(nomeSlot + ': «' + r.model + '» non c\'è o non va in ' + nomeSlot);
        return fermo('modello «' + r.model + '» sconosciuto');
      }
      const m = C.modelli[uid];
      const sopra = Object.assign({}, m.z || {});
      const knobs = r.knobs || {};
      for (const [nk, v] of Object.entries(knobs)) {
        const k = m.k.find(x => norm(x[0]) === norm(nk));
        if (!k) { avvisi.push(nomeSlot + ' ' + m.n + ': manopola «' + nk + '» sconosciuta'); continue; }
        const c = codifica(C, k, v);
        if (typeof c === 'string') { avvisi.push(nomeSlot + ' ' + m.n + ' ' + c); continue; }
        Object.assign(sopra, c);
      }
      const valori = new Array(15).fill(0);
      if (attuale && attuale.uid === uid) attuale.valori.forEach((v, i) => { valori[i] = v; });
      for (const [p, v] of Object.entries(sopra)) valori[+p] = v;
      return { slot: s, uid, acceso: r.on == null ? true : vero(r.on), valori, sopra };
    });

    const numero = (v, a, b, d) => (Number.isFinite(+v) ? Math.round(stretto(+v, a, b)) : d);
    return {
      nome: nomeConSigla(ricetta.name, ricetta.artist),
      volume: numero(ricetta.volume, 0, 100, 60),
      tempo: numero(ricetta.bpm, 40, 250, 120),
      catena,
      accesi: blocchi.reduce((a, b, s) => a | ((b.acceso ? 1 : 0) << s), 0),
      blocchi,
      dispositivo: 'AP-10',
      spiegazione: String(ricetta.explanation || '').trim(),
      namConsigliato: String(ricetta.nam_tip || '').trim(),
      pickup: pickupPerChitarra(ricetta.pickups, opz.chitarra),
      avvisi,
    };
  }

  const X = { SLOT, istruzioni, nomeConSigla, pickupDa, pickupPerChitarra, adattaLayout, layoutBuono, haHumbucker,
    postiVeri, TIPI_PICKUP, catalogoTesto, fullRig, descriviTone, aTone, codifica, trovaModello };
  if (typeof module !== 'undefined' && module.exports) module.exports = X; else g.PulzeRicetta = X;
})(this);
