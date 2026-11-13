// pulze-pwa.js - L'editor come app da installare (sw.js, manifest.webmanifest), come per lo Spark:
// - quando il browser dice che si può installare, compare da sola una striscia in basso a sinistra
//   «Installa sul PC» (✕ = non riproporla; resta la voce nel menu ☰);
// - quando sul sito c'è una versione nuova, la striscia «C'è una versione nuova» col tasto Aggiorna
//   (non si ricarica da sola: scollegherebbe il Mini nel mezzo di un lavoro).
// Il service worker gira solo sul sito pubblicato (https): da localhost si lavora sul codice e una cache in
// mezzo darebbe file vecchi (per provarlo lì: localStorage pulzemazz.sw.locale = 1). I testi sono in
// italiano: in inglese li traduce src/pulze-lingua.js.
(function () {
  const NO = 'pulzemazz.installa.no';
  const locale = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const memo = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const SUPPORTATO = 'serviceWorker' in navigator && location.protocol !== 'file:' &&
    (!locale || memo('pulzemazz.sw.locale') === '1');
  const installata = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  /** Una striscia in basso a sinistra: testo, un tasto, la ✕. */
  function striscia(testo, etichetta, azione, chiudi) {
    const vecchia = document.querySelector('.pwa-striscia');
    if (vecchia) vecchia.remove();
    const s = document.createElement('div');
    s.className = 'pwa-striscia';
    s.setAttribute('role', 'status');
    const t = document.createElement('span');
    t.textContent = testo;
    const si = document.createElement('button');
    si.type = 'button';
    si.className = 'primario';
    si.textContent = etichetta;
    si.addEventListener('click', () => { s.remove(); azione(); });
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'icona pwa-no';
    no.title = 'Chiudi';
    no.setAttribute('aria-label', 'Chiudi');
    no.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
    no.addEventListener('click', () => { s.remove(); if (chiudi) chiudi(); });
    s.append(t, si, no);
    document.body.appendChild(s);
    return s;
  }

  // ---------------------------------------------------------------- installare
  // Chrome ed Edge fanno installare solo dopo un clic di chi usa la pagina: l'invito si tiene da parte.
  let invito = null;
  const voceMenu = () => document.getElementById('installa');

  async function installa() {
    if (!invito) return;
    invito.prompt();
    await invito.userChoice.catch(() => null);
    invito = null;
    if (voceMenu()) voceMenu().hidden = true;
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    invito = e;
    if (voceMenu()) voceMenu().hidden = false;
    if (memo(NO) === '1') return;
    striscia('Installa il MazzRig sul PC: si apre dal Desktop, in una finestra sua, anche senza internet.',
      'Installa', installa, () => { try { localStorage.setItem(NO, '1'); } catch (x) { /* niente */ } });
  });

  window.addEventListener('appinstalled', () => {
    invito = null;
    if (voceMenu()) voceMenu().hidden = true;
    const s = document.querySelector('.pwa-striscia');
    if (s) s.remove();
    try { localStorage.removeItem(NO); } catch (x) { /* niente */ }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const v = voceMenu();
    if (v) v.addEventListener('click', installa);
  });

  // ---------------------------------------------------------------- il service worker
  if (!SUPPORTATO) {
    // da localhost: se un giorno ce n'è stato uno, via (darebbe file vecchi mentre si lavora)
    if ('serviceWorker' in navigator && locale) {
      navigator.serviceWorker.getRegistrations().then(rr => rr.forEach(r => r.unregister())).catch(() => {});
    }
    return;
  }
  const eraControllata = !!navigator.serviceWorker.controller;

  window.addEventListener('load', async () => {
    let reg;
    try { reg = await navigator.serviceWorker.register('sw.js'); } catch (e) { return; }
    if (reg.waiting && navigator.serviceWorker.controller) proponiAggiornamento(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nuovo = reg.installing;
      if (!nuovo) return;
      nuovo.addEventListener('statechange', () => {
        // senza controller è la prima installazione: niente da aggiornare
        if (nuovo.state === 'installed' && navigator.serviceWorker.controller) proponiAggiornamento(nuovo);
      });
    });
    // alla prima visita il worker prende il controllo da solo: lì non si ricarica
    let ricaricando = !eraControllata;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (ricaricando) return;
      ricaricando = true;
      location.reload();
    });
    // le immagini dei modelli, per averle anche senza internet
    navigator.serviceWorker.ready.then(r => r.active && r.active.postMessage('immagini')).catch(() => {});
  });

  function proponiAggiornamento(worker) {
    striscia('C\'è una versione nuova dell\'editor (la pagina si ricarica e il Mini si scollega).', 'Aggiorna',
      () => worker.postMessage('aggiorna'));
  }
})();
