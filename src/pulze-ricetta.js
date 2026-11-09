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
        info = (m.f === 'Sound Clone' ? 'user NAM capture' : 'user impulse response') +
          (x.nome ? ' named "' + x.nome + '"' : '');
      }
      if (!slotDi[uid]) continue;
      righe.push(nome + ' | ' + slotDi[uid].join(',') + ' | ' + m.f + ' | ' + info + ' | ' +
        m.k.map(k => manopolaTesto(C, k, m.z || {})).join('; '));
    }
    return righe.join('\n');
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
      '- The name: at most 16 plain ASCII characters.',
      '- When the user describes the guitar, the room or the band context, voice the preset for it ' +
      '(bedroom: lusher wet and full lows; band mix: carved mids, tighter low cut, drier tails).',
      opz.parti ? '- The user message includes the preset currently loaded: change it as asked, keep the rest.' : '',
      '',
      'Answer with ONE JSON object only, no other text:',
      '{"name": "...", "volume": 60, "bpm": 120,',
      ' "chain": ["DYN","PRE","AMP","CAB","EQ/MOD","FX1","FX2"],',
      ' "blocks": {"PRE": {"model": "...", "on": true, "knobs": {"Knob": value}}, "AMP": {...}, "DYN": {...},',
      '            "CAB": {...}, "EQ/MOD": {...}, "FX1": {...}, "FX2": {...}},',
      ' "explanation": "two or three short sentences in ' + (opz.lingua === 'en' ? 'English' : 'Italian') + ' on the choices"}',
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
      nome: String(ricetta.name || 'Nuovo preset').normalize('NFD').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 16).trim() || 'Nuovo preset',
      volume: numero(ricetta.volume, 0, 100, 60),
      tempo: numero(ricetta.bpm, 40, 250, 120),
      catena,
      accesi: blocchi.reduce((a, b, s) => a | ((b.acceso ? 1 : 0) << s), 0),
      blocchi,
      dispositivo: 'AP-10',
      spiegazione: String(ricetta.explanation || '').trim(),
      avvisi,
    };
  }

  const X = { SLOT, istruzioni, catalogoTesto, descriviTone, aTone, codifica, trovaModello };
  if (typeof module !== 'undefined' && module.exports) module.exports = X; else g.PulzeRicetta = X;
})(this);
