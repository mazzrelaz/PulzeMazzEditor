// pulze-novita.js - La finestra «Novità», come in SparklingTones: ogni aggiornamento pubblicato porta le sue
// novità, che si vedono una volta sola alla prima apertura dopo l'aggiornamento. Chi apre l'editor per la
// prima volta non le vede: per lui è tutto nuovo. Con #novita nell'indirizzo si vede sempre (per provarla).
// Per pubblicare: una voce nuova IN CIMA a NOVITA, con la stessa versione di VERSIONE in sw.js.
// I testi sono in italiano: in inglese li traduce pulze-lingua.js, come il resto della pagina.
(function () {
  const NOVITA = [
    {
      versione: 'v8.5',
      data: '17 novembre 2026',
      voci: [
        { icona: '🎛️', titolo: 'Carica NAM & IR',
          testo: 'Un nuovo tasto carica sul Mini i modelli NAM (.nam) come Sound Clone e le risposte all’impulso dei cabinet (.wav) come User IR, senza l’app Hotone.' },
        { icona: '🎯', titolo: 'Sound Clone identico a quello dell’app',
          testo: 'Indicando una volta l’APK dell’app Hotone, MazzRig ne usa il segnale di prova e il Sound Clone viene identico. Resta solo nel tuo browser.' },
        { icona: '✏️', titolo: 'Rinomina NAM e IR',
          testo: 'Nella finestra Carica NAM & IR il tasto Rinomina… cambia il nome del posto scelto.' },
        { icona: '✨', titolo: 'L’AI usa i tuoi NAM',
          testo: 'Crea preset AI sceglie i tuoi Sound Clone e User IR quando la richiesta corrisponde, spegne il cab se il nome del NAM contiene FR (full rig) e ti consiglia quale NAM cercare.' },
      ],
    },
    {
      versione: 'v8.4',
      data: '15 novembre 2026',
      voci: [
        { icona: '🗑️', titolo: 'Attenzione ai tone ripetuti',
          testo: 'Prima di cancellare un tone che nell\'elenco del Mini compare più volte, MazzRig avvisa: la cancellazione toglierebbe tutte le voci e il tone sparirebbe.' },
        { icona: '🛑', titolo: 'Senza copia di sicurezza ci si ferma',
          testo: 'Se la copia di sicurezza prima di salvare, copiare, scambiare, cancellare o ripristinare non riesce, MazzRig si ferma e chiede se andare avanti.' },
        { icona: '🔁', titolo: 'Scambio interrotto: si sa dove sono i tone',
          testo: 'Se uno scambio si ferma a metà, il messaggio dice in quale posto è rimasto ciascun tone.' },
      ],
    },
    {
      versione: 'v8.3',
      data: '15 novembre 2026',
      voci: [
        { icona: '⚠️', titolo: 'Lo usi a tuo rischio',
          testo: 'Al primo uso e a ogni aggiornamento MazzRig ricorda che è un progetto indipendente, senza garanzie. Il testo intero è in ☰ → Crediti e responsabilità.' },
        { icona: '🔎', titolo: 'Controllo dei tone ripetuti',
          testo: 'Se l\'elenco interno del Mini ha lo stesso tone due volte (l\'app originale lo mostra doppio), MazzRig lo dice al collegamento, e subito se succede dopo un salvataggio.' },
      ],
    },
    {
      versione: 'v8.2',
      data: '13 novembre 2026',
      voci: [
        { icona: '🧯', titolo: 'Copia di sicurezza anche sullo stesso posto',
          testo: 'Ora anche quando sovrascrivi il tone che suona, la versione di prima resta in Backup… → Copie di sicurezza.' },
        { icona: '🛡️', titolo: 'Un suono nuovo va in un posto vuoto',
          testo: 'Per un suono importato o creato con l\'AI, Salva… propone il primo posto vuoto. Sopra un tone pieno il tasto dice quale si perde: «Sovrascrivi «Europa»».' },
      ],
    },
    {
      versione: 'v8',
      data: '13 novembre 2026',
      voci: [
        { icona: '💾', titolo: 'Salvato in un altro posto: si passa lì',
          testo: 'Quando salvi un tone in un altro posto, il Mini passa al tone appena salvato e la scritta «modificato non salvato» sparisce.' },
      ],
    },
    {
      versione: 'v7.10',
      data: '13 novembre 2026',
      voci: [
        { icona: '🌍', titolo: 'Tutto anche in inglese',
          testo: 'Anche i messaggi nuovi (diagnosi, cancellazione) si leggono in inglese.' },
      ],
    },
    {
      versione: 'v7.9',
      data: '13 novembre 2026',
      voci: [
        { icona: '🔤', titolo: 'Niente più nomi doppi',
          testo: 'Se salvi o copi un tone in un altro posto con un nome che c\'è già, MazzRig aggiunge un numero: «EVH Eruption (2)», «(3)»…' },
        { icona: '🏷️', titolo: 'Il nome giusto in alto',
          testo: 'Un preset importato o creato con l\'AI mostra subito il suo nome, anche prima di salvarlo.' },
      ],
    },
    {
      versione: 'v7.8',
      data: '13 novembre 2026',
      voci: [
        { icona: '🎯', titolo: 'Cambio di tone corretto',
          testo: 'Dopo aver cancellato dei tone, il doppio clic in «Tutti i tone» poteva non cambiare tone. Ora va al tone giusto.' },
      ],
    },
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
