// pulze-avvertenza.js - Lo scarico di responsabilità, come in SparklingTones (15 novembre 2026).
// Regola dell'utente: «tutti devono sapere che lo usano a loro rischio». Una schermata che non si chiude né
// con Esc né cliccando fuori, solo col tasto «Ho capito: lo uso a mio rischio». Si vede al primo uso e di
// nuovo a ogni aggiornamento (la versione accettata sta in localStorage). Con #avvertenza si vede sempre.
// Il testo lungo resta in ☰ → Crediti e responsabilità, che ora comincia con lo stesso riquadro.
// Testi nelle due lingue qui dentro (data-notrad: pulze-lingua.js non li tocca).
(function () {
  const CHIAVE = 'pulzemazz.avvertenza';
  const versione = (document.querySelector('.versione-menu') || {}).textContent || '';
  const v = (versione.match(/v[\d.]+/) || [''])[0];

  const TESTI = {
    it: {
      sopra: 'Prima di cominciare' + (v ? ' · ' + v : ''),
      titolo: '⚠️ Lo usi a tuo rischio',
      corpo: [
        'MazzRig è un progetto <strong>amatoriale e indipendente</strong>, gratuito, <strong>senza alcun rapporto con Hotone Audio</strong>.',
        'È fornito <strong>così com\'è, senza garanzie di alcun tipo</strong>. L\'autore <strong>non risponde di nessun danno</strong>: tone, Songlist o settaggi persi o sovrascritti, un Pulze Mini che si blocca o si guasta, qualunque conseguenza dei comandi mandati via Bluetooth.',
        'Prima di salvare o cancellare fai un <strong>Backup completo</strong> (☰ → Backup…). Continuando accetti di usare MazzRig <strong>a tuo rischio</strong>.',
      ],
      ok: 'Ho capito: lo uso a mio rischio',
    },
    en: {
      sopra: 'Before you start' + (v ? ' · ' + v : ''),
      titolo: '⚠️ Use it at your own risk',
      corpo: [
        'MazzRig is an <strong>independent hobby project</strong>, free, <strong>not affiliated with Hotone Audio in any way</strong>.',
        'It is provided <strong>as is, without warranty of any kind</strong>. The author <strong>is not liable for any damage</strong>: tones, Songlists or settings lost or overwritten, a Pulze Mini that freezes or breaks, any consequence of the commands sent over Bluetooth.',
        'Before saving or deleting, make a <strong>Full backup</strong> (☰ → Backup…). By continuing you agree to use MazzRig <strong>at your own risk</strong>.',
      ],
      ok: 'I understand: I use it at my own risk',
    },
  };

  /** Il riquadro, per la splash e per la cima di Crediti e responsabilità. */
  function riquadro(lingua, conTasto) {
    const t = TESTI[lingua] || TESTI.it;
    return '<div class="novita avvertenza" data-notrad' + (conTasto ? ' role="alertdialog" aria-modal="true" aria-labelledby="avvertenza-titolo"' : '') + '>' +
      '<div class="novita-sopra">' + t.sopra + '</div>' +
      '<h2 class="novita-titolo"' + (conTasto ? ' id="avvertenza-titolo"' : '') + '>' + t.titolo + '</h2>' +
      '<div class="avvertenza-corpo">' + t.corpo.map(p => '<p>' + p + '</p>').join('') + '</div>' +
      (conTasto ? '<button type="button" class="primario novita-ok">' + t.ok + '</button>' : '') +
    '</div>';
  }
  const lingua = () => (document.documentElement.lang === 'en' ? 'en' : 'it');

  function mostra() {
    const velo = document.createElement('div');
    velo.className = 'velo-novita velo-avvertenza';
    velo.innerHTML = riquadro(lingua(), true);
    // niente Esc, niente clic fuori: solo il tasto
    const tasto = e => { if (e.key === 'Escape') e.preventDefault(); };
    velo.querySelector('.novita-ok').addEventListener('click', () => {
      try { localStorage.setItem(CHIAVE, v || new Date().toISOString().slice(0, 10)); } catch (e) { /* niente */ }
      document.removeEventListener('keydown', tasto, true);
      velo.remove();
    });
    document.addEventListener('keydown', tasto, true);
    document.body.appendChild(velo);
    velo.querySelector('.novita-ok').focus();
  }

  // in cima a Crediti e responsabilità, nelle due lingue
  for (const corpo of document.querySelectorAll('#dialogo-crediti .crediti-corpo[data-lingua]')) {
    corpo.insertAdjacentHTML('afterbegin', riquadro(corpo.dataset.lingua, false).replace('class="novita avvertenza"', 'class="novita avvertenza in-crediti"'));
  }

  let accettata = null;
  try { accettata = localStorage.getItem(CHIAVE); } catch (e) { /* senza memoria: si mostra */ }
  if (accettata === v && location.hash !== '#avvertenza') return;
  if (document.readyState !== 'complete') addEventListener('load', mostra);
  else mostra();
})();
