// pulze-novita.js - La finestra «Novità», come in SparklingTones: ogni aggiornamento pubblicato porta le sue
// novità, che si vedono una volta sola alla prima apertura dopo l'aggiornamento. Chi apre l'editor per la
// prima volta non le vede: per lui è tutto nuovo. Con #novita nell'indirizzo si vede sempre (per provarla).
// Per pubblicare: una voce nuova IN CIMA a NOVITA, con la stessa versione di VERSIONE in sw.js.
// I testi sono in italiano: in inglese li traduce pulze-lingua.js, come il resto della pagina.
(function () {
  const NOVITA = [
    {
      versione: 'v7.7',
      data: '13 novembre 2026',
      voci: [
        { icona: '🛠️', titolo: 'Salvare e cancellare: corretto un errore grave',
          testo: 'Dopo aver cancellato un tone, MazzRig poteva salvare, copiare o cancellare nel posto sbagliato. Ora legge i posti come li tiene davvero il Mini.' },
        { icona: '⚠️', titolo: 'Fai un backup',
          testo: 'MazzRig è in beta: prima di salvare o cancellare preset fai un backup completo da ☰ → Backup….' },
        { icona: '🔢', titolo: 'La versione si vede',
          testo: 'Sotto «Collega il Pulze Mini» e in fondo al menu ☰: così sai se hai l\'ultima.' },
        { icona: '🩺', titolo: 'Copia diagnosi',
          testo: 'In Backup…, un tasto copia lo stato dei posti del Mini da mandare se qualcosa non torna.' },
      ],
    },
    {
      versione: 'v7',
      data: '13 novembre 2026',
      voci: [
        { icona: '🎸', titolo: 'Nuovo nome: MazzRig',
          testo: 'Pulze Mazz Editor ora si chiama MazzRig, con un logo nuovo. Funziona come prima: i tuoi backup e le impostazioni restano.' },
        { icona: '🎤', titolo: 'Live', guida: 'g-live',
          testo: 'Il tasto rosso Live apre una schermata per suonare: le Songlist a pagine da 8 e lo Stomp per accendere e spegnere i blocchi del tone.' },
        { icona: '🦶', titolo: 'Pedaliera MIDI', guida: 'g-live-pedaliera',
          testo: 'Comanda il Live con una pedaliera MIDI, Bluetooth o USB: suona i tone, cambia pagina, accende e spegne gli effetti.' },
        { icona: '✨', titolo: 'Crea preset AI senza chiavi', guida: 'g-ai',
          testo: 'Descrivi il suono, copia la domanda nella chat che usi (ChatGPT, Claude, Gemini…) e incolla qui la risposta. Niente chiavi API, niente costi.' },
        { icona: 'ℹ️', titolo: 'App non ufficiale',
          testo: 'MazzRig è un\'app di terze parti, senza alcun rapporto con Hotone. I dettagli sono in ☰ → Crediti e responsabilità.' },
        { icona: '☕', titolo: 'Sempre gratis',
          testo: 'L\'editor resta gratuito. Se ti è utile, un caffè dal menu ☰ aiuta a farlo crescere.' },
      ],
    },
  ];
  const CHIAVE = 'pulzemazz.novitaViste';

  function mostra(n) {
    const velo = document.createElement('div');
    velo.className = 'velo-novita';
    velo.innerHTML =
      '<div class="novita" role="dialog" aria-modal="true">' +
        '<div class="novita-sopra"><span>Novità</span> · ' + n.versione + '</div>' +
        '<h2 class="novita-titolo">Cosa c\'è di nuovo</h2>' +
        '<div class="novita-data">' + n.data + '</div>' +
        '<ul class="novita-voci">' + n.voci.map(v =>
          '<li><span class="novita-icona">' + v.icona + '</span>' +
          '<div><strong>' + v.titolo + (v.guida ? '<button type="button" class="aiuto novita-guida" data-guida="' + v.guida +
            '" title="Guida: ' + v.titolo + '" aria-label="Guida: ' + v.titolo + '"></button>' : '') +
          '</strong><span>' + v.testo + '</span></div></li>').join('') + '</ul>' +
        '<button type="button" class="primario novita-ok">Ho capito</button>' +
      '</div>';
    const chiudi = () => { velo.remove(); document.removeEventListener('keydown', tasto); };
    const tasto = e => { if (e.key === 'Escape') chiudi(); };
    velo.querySelector('.novita-ok').addEventListener('click', chiudi);
    // i «?»: chiudono le novità e aprono la guida alla voce
    for (const g of velo.querySelectorAll('.novita-guida')) {
      const app = window.MazzRigApp;
      if (app && app.icona) g.prepend(app.icona('domanda'));
      g.addEventListener('click', () => { chiudi(); if (window.MazzRigApp) window.MazzRigApp.apriGuida(g.dataset.guida); });
    }
    velo.addEventListener('click', e => { if (e.target === velo) chiudi(); });
    document.addEventListener('keydown', tasto);
    document.body.appendChild(velo);
    velo.querySelector('.novita-ok').focus();
  }

  const ultima = NOVITA[0];
  let vista = null, giaUsato = false;
  try {
    vista = localStorage.getItem(CHIAVE);
    // primo uso in assoluto: nessuna chiave dell'editor nel browser (la lingua la scrive pulze-lingua.js
    // solo se l'utente la sceglie)
    giaUsato = vista !== null || Object.keys(localStorage).some(k => /^pulze(mazz|max)\./.test(k) && k !== CHIAVE);
    localStorage.setItem(CHIAVE, ultima.versione);
  } catch (e) { return; }
  const prova = location.hash === '#novita';
  if (!prova && (vista === ultima.versione || !giaUsato)) return;
  if (document.readyState !== 'complete') addEventListener('load', () => mostra(ultima));
  else mostra(ultima);
})();
