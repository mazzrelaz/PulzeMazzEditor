// pulze-tuner.js - L'accordatore col microfono del PC (18 novembre 2026).
// Il Mini resta solo in Bluetooth: la chitarra, anche staccata, suona abbastanza per il microfono.
// La grafica è quella dell'accordatore di SparklingTones (spark/src/app/16-accordatore.js): 21 tacche,
// una ogni 5 cent, dal ciano (calante) al viola al fucsia (crescente), la nota grande e i cent.
// La nota la calcola qui l'algoritmo YIN sul segnale del microfono; La di riferimento regolabile (430–450 Hz).
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const LETTERE_NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const CENT_INTONATA = 2;        // entro ±2 cent è intonata, come in SparklingTones
  const LETTURE_PER_CAMBIARE = 2; // una nota nuova si mostra dopo due letture uguali
  const SILENZI_PER_TACERE = 6;   // ~0,3 s senza nota e la corda è finita
  const SOGLIA_RMS = 0.006;       // sotto, è silenzio
  const MEMO_LA = 'pulzemazz.tuner.la', MEMO_MIC = 'pulzemazz.tuner.mic';

  const dialogo = $('#dialogo-tuner');
  if (!dialogo) return;
  const leggi = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const scrivi = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* niente */ } };

  let la = Number(leggi(MEMO_LA)) || 440;
  let ctx = null, flusso = null, analisi = null, buffer = null, giro = 0, ultimo = 0;
  const lettura = { nota: null, cent: 0, hz: 0, candidata: null, ripetute: 0, silenzi: 0 };

  // ---------------------------------------------------------------- le tacche (come SparklingTones)
  const TACCHE = (() => {
    const svg = $('#quadrante-tuner');
    const tinta = (a, b, f) => a.map((x, k) => Math.round(x + (b[k] - x) * f));
    const CIANO = [43, 228, 255], VIOLA = [123, 92, 255], FUCSIA = [255, 43, 214];
    const tacche = [];
    for (let i = 0; i <= 20; i++) {
      const r = (i - 10) * 6 * Math.PI / 180;
      const centro = i === 10;
      const dentro = centro ? 100 : 108, fuori = centro ? 146 : 138;
      const x = d => (150 + d * Math.sin(r)).toFixed(1);
      const y = d => (160 - d * Math.cos(r)).toFixed(1);
      const rgb = centro ? [255, 255, 255]
        : i < 10 ? tinta(CIANO, VIOLA, i / 10) : tinta(VIOLA, FUCSIA, (i - 10) / 10);
      const linea = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      linea.setAttribute('x1', x(dentro)); linea.setAttribute('y1', y(dentro));
      linea.setAttribute('x2', x(fuori)); linea.setAttribute('y2', y(fuori));
      linea.setAttribute('class', 'tacca');
      linea.style.color = linea.style.stroke = `rgb(${rgb.join(',')})`;
      svg.appendChild(linea);
      tacche.push(linea);
    }
    return tacche;
  })();

  function disegna() {
    const tace = lettura.nota === null || lettura.silenzi >= SILENZI_PER_TACERE;
    const cent = Math.max(-50, Math.min(50, lettura.cent));
    const intonata = !tace && Math.abs(cent) <= CENT_INTONATA;
    dialogo.classList.toggle('tace', tace);
    dialogo.classList.toggle('intonata', intonata);
    const nota = $('#nota-tuner');
    if (lettura.nota === null) nota.textContent = '';
    else {
      const l = LETTERE_NOTE[lettura.nota];
      nota.innerHTML = l.length > 1 ? `${l[0]}<span class="diesis">♯</span>` : l;
    }
    const c = Math.round(cent);
    const scritta = $('#cent-tuner');
    scritta.innerHTML = tace ? '' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)}<small>cent</small>`;
    scritta.classList.toggle('calante', !tace && !intonata && c < 0);
    scritta.classList.toggle('crescente', !tace && !intonata && c > 0);
    $('#hz-tuner').textContent = tace ? '' : lettura.hz.toFixed(1) + ' Hz';
    const qui = tace ? -99 : cent / 5 + 10;
    TACCHE.forEach((t, i) => {
      const d = Math.abs(i - qui);
      t.style.opacity = Math.max(0.09, 1 - d * 0.8).toFixed(2);
      t.classList.toggle('accesa', d < 0.5);
    });
  }

  // ---------------------------------------------------------------- YIN: la frequenza del pezzo di segnale
  function frequenza(dati, rate) {
    let rms = 0;
    for (let i = 0; i < dati.length; i++) rms += dati[i] * dati[i];
    if (Math.sqrt(rms / dati.length) < SOGLIA_RMS) return null;
    const minT = Math.floor(rate / 1100), maxT = Math.min(Math.floor(rate / 55), dati.length >> 1);
    const n = dati.length - maxT;
    const d = new Float32Array(maxT + 1);
    for (let t = 1; t <= maxT; t++) {
      let s = 0;
      for (let i = 0; i < n; i++) { const x = dati[i] - dati[i + t]; s += x * x; }
      d[t] = s;
    }
    // differenza normalizzata cumulativa
    let somma = 0;
    d[0] = 1;
    for (let t = 1; t <= maxT; t++) { somma += d[t]; d[t] = somma ? d[t] * t / somma : 1; }
    let tau = -1;
    for (let t = minT; t < maxT; t++) {
      if (d[t] < 0.12) { while (t + 1 < maxT && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) return null;
    // interpolazione parabolica
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    const fine = den ? tau + (a - c) / (2 * den) : tau;
    return rate / fine;
  }

  function ascolta(ora) {
    giro = requestAnimationFrame(ascolta);
    if (ora - ultimo < 45) return;   // ~20 letture al secondo
    ultimo = ora;
    analisi.getFloatTimeDomainData(buffer);
    const hz = frequenza(buffer, ctx.sampleRate);
    if (!hz) {
      lettura.silenzi++;
      lettura.candidata = null; lettura.ripetute = 0;
      if (lettura.silenzi === SILENZI_PER_TACERE) disegna();
      return;
    }
    lettura.silenzi = 0;
    const semitoni = 12 * Math.log2(hz / la) + 69;   // MIDI
    const tondo = Math.round(semitoni);
    const nota = ((tondo % 12) + 12) % 12;
    const cent = (semitoni - tondo) * 100;
    if (nota === lettura.nota) {
      lettura.cent += (cent - lettura.cent) * 0.75;
      lettura.hz += (hz - lettura.hz) * 0.75;
    } else {
      if (lettura.candidata === nota) lettura.ripetute++;
      else { lettura.candidata = nota; lettura.ripetute = 1; }
      if (lettura.ripetute < LETTURE_PER_CAMBIARE && lettura.nota !== null) return;
      Object.assign(lettura, { nota, cent, hz, candidata: null, ripetute: 0 });
    }
    disegna();
  }

  // ---------------------------------------------------------------- microfono
  async function elencaMicrofoni() {
    const scelta = $('#tuner-mic');
    let voci = [];
    try { voci = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); }
    catch (e) { /* niente */ }
    const memo = leggi(MEMO_MIC);
    scelta.innerHTML = '';
    voci.forEach((v, i) => {
      const o = document.createElement('option');
      o.value = v.deviceId;
      o.textContent = v.label || ('Microfono ' + (i + 1));
      o.setAttribute('data-notrad', '');
      scelta.appendChild(o);
    });
    const attivo = flusso && flusso.getAudioTracks()[0] && flusso.getAudioTracks()[0].getSettings().deviceId;
    scelta.value = attivo || memo || (voci[0] && voci[0].deviceId) || '';
  }

  async function accendi() {
    spegni();
    const stato = $('#tuner-stato');
    stato.textContent = '';
    const id = leggi(MEMO_MIC);
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (id) audio.deviceId = { ideal: id };
    try {
      flusso = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      stato.textContent = 'Il browser non lascia usare il microfono: permettilo dall’icona accanto all’indirizzo.';
      return;
    }
    if (!dialogo.open) { spegni(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analisi = ctx.createAnalyser();
    analisi.fftSize = 4096;
    buffer = new Float32Array(analisi.fftSize);
    ctx.createMediaStreamSource(flusso).connect(analisi);
    Object.assign(lettura, { nota: null, cent: 0, hz: 0, candidata: null, ripetute: 0, silenzi: 0 });
    disegna();
    elencaMicrofoni();
    giro = requestAnimationFrame(ascolta);
  }

  function spegni() {
    cancelAnimationFrame(giro);
    if (flusso) flusso.getTracks().forEach(t => t.stop());
    if (ctx) ctx.close().catch(() => {});
    flusso = ctx = analisi = null;
  }

  // ---------------------------------------------------------------- comandi
  function mostraLa() { $('#tuner-la-v').textContent = la + ' Hz'; }
  function cambiaLa(passo) {
    la = Math.max(430, Math.min(450, la + passo));
    scrivi(MEMO_LA, String(la));
    mostraLa();
  }

  $('#apri-tuner').addEventListener('click', () => { dialogo.showModal(); accendi(); });
  $('#tuner-chiudi').addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('close', spegni);
  $('#tuner-la-meno').addEventListener('click', () => cambiaLa(-1));
  $('#tuner-la-piu').addEventListener('click', () => cambiaLa(1));
  $('#tuner-mic').addEventListener('change', e => { scrivi(MEMO_MIC, e.target.value); accendi(); });
  document.addEventListener('visibilitychange', () => {
    if (!dialogo.open) return;
    if (document.visibilityState === 'visible') accendi(); else spegni();
  });
  mostraLa();
  disegna();
})();
