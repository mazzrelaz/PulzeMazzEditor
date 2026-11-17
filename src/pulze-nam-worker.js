// pulze-nam-worker.js - Fa la conversione NAM → CLO (pulze-nam.js) fuori dalla pagina, che resta libera.
// Riceve { nam: testo del .nam, app?: Float32Array = il segnale di prova dell'app, portato dall'utente };
// manda { fase, frazione } mentre lavora, poi { mini } o { errore }.
'use strict';
importScripts('pulze-nam.js');

let ingresso = null;   // l'ingresso fisso di MazzRig (10 MB): si scarica una volta sola

self.onmessage = async e => {
  try {
    let nam;
    try { nam = JSON.parse(e.data.nam); } catch (x) { throw new Error('json'); }
    if (!ingresso && !e.data.app) {
      self.postMessage({ fase: 'scarico', frazione: 0 });
      const r = await fetch('../nam/segnale-prova-48k.s24');
      if (!r.ok) throw new Error('ingresso');
      ingresso = PulzeNam.leggiIngresso(new Uint8Array(await r.arrayBuffer()));
    }
    let ult = -1;
    const r = PulzeNam.converti(nam, e.data.app ? Float64Array.from(e.data.app) : ingresso, (fase, f) => {
      const v = Math.round(f * 100);
      if (v !== ult) { ult = v; self.postMessage({ fase, frazione: f }); }
    });
    self.postMessage({ mini: r.mini, canali: r.canali });
  } catch (x) {
    self.postMessage({ errore: x.message || String(x) });
  }
};
