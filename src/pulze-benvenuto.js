// pulze-benvenuto.js - Le due finestre di benvenuto, come in SparklingTones (spark/src/pc/13-benvenuto.js):
// alla prima apertura il grazie, alla decima l'invito al caffè. Ognuna una volta sola.
// Per provarle: index.html#benvenuto1 o index.html#benvenuto2.
// I testi sono in italiano: in inglese li traduce pulze-lingua.js.
(function () {
  const CHIAVE = 'pulzemazz.benvenuto';   // { avvii, visto1, visto2 }
  const CAFFE_AL = 10;
  const CAFFE = 'https://buymeacoffee.com/mazzgear';

  function leggi() { try { return JSON.parse(localStorage.getItem(CHIAVE)) || {}; } catch (e) { return {}; } }
  function scrivi(s) { try { localStorage.setItem(CHIAVE, JSON.stringify(s)); } catch (e) { /* senza memoria: pazienza */ } }

  const MESTIERE = 'Dietro però ci sono centinaia di ore di lavoro: notti passate a decifrare il protocollo del Pulze Mini, a provare e riprovare sul Mini vero.';
  const FIRMA = '<p class="benvenuto-firma">— Massimo, chitarrista. Con metà del tempo passato sugli effetti, oggi suonerebbe meglio di Hendrix.</p>';
  const LOGO = '<span class="benvenuto-logo"><img src="img/logo.png" alt="MazzRig"></span>';

  function mostra(quale) {
    const velo = document.createElement('div');
    velo.className = 'benvenuto-velo';
    velo.innerHTML = quale === 1
      ? '<div class="bv-carta" role="dialog" aria-modal="true">' + LOGO +
        '<h2>Benvenuto in MazzRig</h2>' +
        '<p>Grazie per aver scelto MazzRig! MazzRig è e resterà gratuito. ' + MESTIERE + '</p>' +
        '<p>Se l\'app ti piace, un caffè è il modo più bello per dirmelo e per farla crescere.</p>' + FIRMA +
        '<div class="benvenuto-azioni"><button type="button" class="primario grande" data-a="chiudi">Cominciamo</button>' +
        '<a href="#" class="benvenuto-link" data-a="caffe">☕ <span>Offrimi un caffè</span></a></div></div>'
      : '<div class="bv-carta" role="dialog" aria-modal="true">' + LOGO +
        '<h2>Ti sta tornando utile?</h2>' +
        '<p>MazzRig è e resterà gratuito. ' + MESTIERE + '</p>' +
        '<p>Se l\'app ti piace, un caffè è il modo più bello per dirmelo e per farla crescere.</p>' + FIRMA +
        '<div class="benvenuto-azioni"><button type="button" class="caffe grande" data-a="caffe">☕ <span>Offrimi un caffè</span></button>' +
        '<button type="button" class="discreto" data-a="chiudi">Magari più avanti</button></div></div>';

    const chiudi = () => { velo.remove(); removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') chiudi(); };
    velo.addEventListener('click', e => {
      if (e.target === velo) return chiudi();
      const a = e.target.closest('[data-a]');
      if (!a) return;
      e.preventDefault();
      if (a.dataset.a === 'caffe') window.open(CAFFE, '_blank', 'noopener');
      chiudi();
    });
    addEventListener('keydown', esc);
    document.body.appendChild(velo);
    velo.querySelector('[data-a]').focus();
  }

  function parti() {
    const prova = /^#benvenuto([12])$/.exec(location.hash);
    if (prova) return mostra(+prova[1]);
    if (/^#(esempio|finto|novita)$/.test(location.hash)) return;
    const s = leggi();
    // chi usava già l'editor prima di questa versione non è nuovo: niente «Benvenuto», ma i 10 avvii contano
    if (!s.avvii) {
      let gia = false;
      try { gia = Object.keys(localStorage).some(k => /^pulze(mazz|max)\./.test(k) && k !== CHIAVE && k !== 'pulzemazz.novitaViste'); } catch (e) { /* niente */ }
      if (gia) s.visto1 = true;
    }
    s.avvii = (s.avvii || 0) + 1;
    let quale = 0;
    if (!s.visto1) { s.visto1 = true; quale = 1; }
    else if (!s.visto2 && s.avvii >= CAFFE_AL) { s.visto2 = true; quale = 2; }
    scrivi(s);
    // le Novità hanno la precedenza: il benvenuto aspetta che si chiudano
    if (!quale) return;
    const quando = () => {
      if (document.querySelector('.velo-novita')) setTimeout(quando, 500);
      else mostra(quale);
    };
    setTimeout(quando, 300);
  }
  if (document.readyState !== 'complete') addEventListener('load', parti); else parti();
})();
