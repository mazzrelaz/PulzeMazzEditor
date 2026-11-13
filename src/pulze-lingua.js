// pulze-lingua.js - L'editor in italiano o in inglese. Il codice scrive tutto in italiano; in inglese questo
// file traduce al volo quello che finisce sullo schermo: i testi e i titoli della pagina, quelli che il codice
// aggiunge o cambia (un MutationObserver li vede tutti) e le domande di confirm() e prompt().
// Due elenchi: ESATTI (la frase intera) e MODELLI (frasi con pezzi variabili, {0} {1}…: i pezzi si traducono
// a loro volta, così «Salvataggio non confermato: il Mini non ha confermato» diventa inglese tutto).
// Guida e crediti hanno un testo per lingua (guida.en.html, i blocchi data-lingua): qui non si toccano.
// La lingua: quella scelta nel menu ☰ (localStorage pulzemazz.lingua), sennò quella del browser.
(function () {
  const MEMO = 'pulzemazz.lingua';
  let lingua = null;
  try { lingua = localStorage.getItem(MEMO); } catch (e) { /* niente */ }
  if (lingua !== 'it' && lingua !== 'en') lingua = /^it\b/i.test(navigator.language || '') ? 'it' : 'en';
  document.documentElement.lang = lingua;

  const ESATTI = [
    // ---- la vista Live
    ['Live', 'Live'], ['Pedaliera MIDI', 'MIDI pedalboard'],
    ['Il tasto rosso Live apre una schermata per suonare: le Songlist a pagine da 8 e lo Stomp per accendere e spegnere i blocchi del tone.',
      'The red Live button opens a screen for playing: Songlists in pages of 8, and Stomp to turn the tone\'s blocks on and off.'],
    ['Comanda il Live con una pedaliera MIDI, Bluetooth o USB: suona i tone, cambia pagina, accende e spegne gli effetti.',
      'Drive Live with a MIDI pedalboard, Bluetooth or USB: play tones, change page, turn effects on and off.'],
    // ---- le finestre di benvenuto
    ['Benvenuto in MazzRig', 'Welcome to MazzRig'],
    ['Salvare e cancellare: corretto un errore grave', 'Saving and deleting: a serious bug fixed'],
    ['Dopo aver cancellato un tone, MazzRig poteva salvare, copiare o cancellare nel posto sbagliato. Ora legge i posti come li tiene davvero il Mini.',
      'After a tone was deleted, MazzRig could save, copy or delete in the wrong slot. It now reads the slots the way the Mini really keeps them.'],
    ['Fai un backup', 'Make a backup'], ['Niente più nomi doppi', 'No more duplicate names'],
    ['Se salvi o copi un tone in un altro posto con un nome che c\'è già, MazzRig aggiunge un numero: «EVH Eruption (2)», «(3)»…',
      'If you save or copy a tone to another slot with a name that already exists, MazzRig adds a number: “EVH Eruption (2)”, “(3)”…'],
    ['Il nome giusto in alto', 'The right name at the top'],
    ['Un preset importato o creato con l\'AI mostra subito il suo nome, anche prima di salvarlo.',
      'A preset imported or created with AI shows its name right away, even before saving it.'], ['Cambio di tone corretto', 'Tone change fixed'],
    ['Dopo aver cancellato dei tone, il doppio clic in «Tutti i tone» poteva non cambiare tone. Ora va al tone giusto.',
      'After deleting tones, double-clicking in “All tones” could fail to change tone. It now goes to the right tone.'],
    ['MazzRig è in beta: prima di salvare o cancellare preset fai un backup completo da ☰ → Backup….',
      'MazzRig is in beta: before saving or deleting presets, make a full backup from ☰ → Backup….'],
    ['La versione si vede', 'The version is shown'],
    ['Sotto «Collega il Pulze Mini» e in fondo al menu ☰: così sai se hai l\'ultima.',
      'Under “Connect the Pulze Mini” and at the bottom of the ☰ menu: so you know you have the latest.'],
    ['Copia diagnosi', 'Copy diagnostics'],
    ['In Backup…, un tasto copia lo stato dei posti del Mini da mandare se qualcosa non torna.',
      'In Backup…, a button copies the state of the Mini\'s slots, to send if something looks wrong.'], ['⚠️ App in beta', '⚠️ Beta app'],
    ['Prima di usarla fai assolutamente un backup completo della tua libreria (dall\'app ufficiale o da Backup… qui in MazzRig): salvare, copiare e cancellare i preset può ancora toccare il posto sbagliato.',
      'Before using it, make sure you back up your whole library (from the official app or from Backup… here in MazzRig): saving, copying and deleting presets may still hit the wrong slot.'],
    ['Grazie per aver scelto MazzRig! MazzRig è e resterà gratuito. Dietro però ci sono centinaia di ore di lavoro: notti passate a decifrare il protocollo del Pulze Mini, a provare e riprovare sul Mini vero.',
      'Thanks for choosing MazzRig! MazzRig is and will stay free. Behind it, though, are hundreds of hours of work: nights spent decoding the Pulze Mini\'s protocol, testing again and again on the real Mini.'],
    ['MazzRig è e resterà gratuito. Dietro però ci sono centinaia di ore di lavoro: notti passate a decifrare il protocollo del Pulze Mini, a provare e riprovare sul Mini vero.',
      'MazzRig is and will stay free. Behind it, though, are hundreds of hours of work: nights spent decoding the Pulze Mini\'s protocol, testing again and again on the real Mini.'],
    ['Se l\'app ti piace, un caffè è il modo più bello per dirmelo e per farla crescere.',
      'If you like the app, a coffee is the nicest way to tell me and to help it grow.'],
    ['— Massimo, chitarrista. Con metà del tempo passato sugli effetti, oggi suonerebbe meglio di Hendrix.',
      '— Massimo, guitarist. With half the time spent on effects, he would play better than Hendrix by now.'],
    ['Cominciamo', 'Let\'s start'], ['Ti sta tornando utile?', 'Is it coming in handy?'], ['Magari più avanti', 'Maybe later'],
    ['Guida: Live', 'Guide: Live'], ['Guida: pedaliera', 'Guide: pedalboard'], ['Guida: Jam', 'Guide: Jam'], ['Guida: Salvare', 'Guide: Saving'],
    ['Nessuna azione', 'No action'], ['Tone successivo', 'Next tone'], ['Tone precedente', 'Previous tone'],
    ['Passa da Preset a Stomp e ritorno', 'Switch between Preset and Stomp'], ['Premuto, in Preset', 'Pressed, in Preset'],
    ['Premuto, in Stomp', 'Pressed, in Stomp'],
    ['Pedaliera', 'Pedalboard'],
    ['Stomp', 'Stomp'],
    ['Stomp su', 'Stomp on'],
    ['Pagina precedente', 'Previous page'],
    ['Pagina successiva', 'Next page'],
    ['Cambia Songlist', 'Change Songlist'],
    ['Entra/esci dallo Stomp', 'Enter/leave Stomp'],
    ['Passa dalla prima alla seconda metà', 'Switch between first and second half'],
    ['Collega un pedale Bluetooth', 'Connect a Bluetooth pedal'],
    ['Usa i pedali USB', 'Use USB pedals'],
    ['MIDI USB attivo', 'USB MIDI on'],
    ['Switch', 'Switch'],
    ['Messaggio', 'Message'],
    ['Preset · tocco', 'Preset · tap'],
    ['Stomp · tocco', 'Stomp · tap'],
    ['Tenuto premuto', 'Held down'],
    ['Togli', 'Remove'],
    ['Nessuno switch.', 'No switches.'],
    ['＋ Impara uno switch', '＋ Learn a switch'],
    ['Premi uno switch del pedale…', 'Press a pedal switch…'],
    ['Pressione lunga', 'Long press'],
    ['La vista Live, con la pedaliera', 'The Live view, with the pedalboard'],
    ['Collega il Pulze Mini per suonare dal Live.', 'Connect the Pulze Mini to play from Live.'],
    ['Prima fai suonare un tone.', 'Play a tone first.'],
    ['Nome dello switch', 'Switch name'],
    ['Collega prima un pedale Bluetooth o attiva i pedali USB.', 'First connect a Bluetooth pedal or turn on USB pedals.'],
    ['Questo browser non ha il MIDI.', 'This browser has no MIDI.'],
    ['Questo browser non ha il Bluetooth.', 'This browser has no Bluetooth.'],
    ['Pedali USB in ascolto.', 'USB pedals listening.'],
    ['Il pedale Bluetooth si è staccato.', 'The Bluetooth pedal disconnected.'],
    ["Questo switch c'è già.", 'This switch is already there.'],
    // ---- la pagina: barra, menu, sotto-barra
    ['Collega', 'Connect'], ['Scollega', 'Disconnect'], ['Suona', 'Play'], ['Rinomina…', 'Rename…'],
    ['Copia in un altro posto…', 'Copy to another slot…'], ['Scambia con…', 'Swap with…'], ['Cancella…', 'Delete…'],
    ['Impostazioni', 'Settings'], ['Guida', 'Guide'], ['Crediti e responsabilità', 'Credits and disclaimer'],
    ['Offrimi un caffè', 'Buy me a coffee'], ['Salva…', 'Save…'], ['Importa…', 'Import…'], ['Esporta', 'Export'],
    ['modificato · non salvato', 'modified · not saved'], ['ascolti il tone salvato', 'listening to the saved tone'],
    ['Crea preset', 'Create preset'], ['Collega il Pulze Mini', 'Connect the Pulze Mini'],
    ['Chiudi prima l\'app Pulze Editor sul telefono: il Mini accetta un collegamento alla volta.',
      'First close the Pulze Editor app on your phone: the Mini accepts one connection at a time.'],
    ['App non ufficiale di terze parti, senza alcun rapporto con Hotone Audio. La usi a tuo rischio: ☰ → Crediti e responsabilità.',
      'Unofficial third-party app, not affiliated with Hotone Audio in any way. Use it at your own risk: ☰ → Credits and disclaimer.'],
    // ---- la finestra Novità
    ['Novità', 'News'],
    ['13 novembre 2026', '13 November 2026'],
    ['Cosa c\'è di nuovo', 'What\'s new'],
    ['Ho capito', 'Got it'],
    ['Nuovo nome: MazzRig', 'New name: MazzRig'],
    ['Pulze Mazz Editor ora si chiama MazzRig, con un logo nuovo. Funziona come prima: i tuoi backup e le impostazioni restano.', 'Pulze Mazz Editor is now called MazzRig, with a new logo. It works as before: your backups and settings stay.'],
    ['Crea preset AI senza chiavi', 'Create AI preset without keys'],
    ['Descrivi il suono, copia la domanda nella chat che usi (ChatGPT, Claude, Gemini…) e incolla qui la risposta. Niente chiavi API, niente costi.', 'Describe the sound, copy the question into the chat you use (ChatGPT, Claude, Gemini…) and paste the answer back here. No API keys, no costs.'],
    ['App non ufficiale', 'Unofficial app'],
    ['MazzRig è un\'app di terze parti, senza alcun rapporto con Hotone. I dettagli sono in ☰ → Crediti e responsabilità.', 'MazzRig is a third-party app, not affiliated with Hotone in any way. The details are in ☰ → Credits and disclaimer.'],
    ['Sempre gratis', 'Always free'],
    ['L\'editor resta gratuito. Se ti è utile, un caffè dal menu ☰ aiuta a farlo crescere.', 'The editor stays free. If you find it useful, a coffee from the ☰ menu helps it grow.'],
    ['Tutti i tone', 'All tones'], ['leggo l\'elenco…', 'reading the list…'], ['Rileggi', 'Reload from the Mini'],
    ['Ritmo precedente', 'Previous rhythm'], ['Ritmo', 'Rhythm'], ['Ritmo successivo', 'Next rhythm'],
    ['Collega / Scollega il Pulze Mini', 'Connect / disconnect the Pulze Mini'],
    ['Annulla l\'ultima modifica', 'Undo the last change'], ['Ripeti la modifica annullata', 'Redo the undone change'],
    ['Confronta col tone salvato', 'Compare with the saved tone'], ['Torna alle modifiche', 'Back to your changes'],
    ['Importa un .prst nel tone che suona', 'Import a .prst into the current tone'],
    ['Esporta il tone che suona in un .prst', 'Export the current tone to a .prst'],
    ['Tone precedente', 'Previous tone'], ['Tone successivo', 'Next tone'], ['Cerca modello…', 'Search models…'],
    ['Quale elenco', 'Which list'], ['Cerca tone…', 'Search tones…'], ['Cerca…', 'Search…'],
    ['MazzRig · catalogo Pulze Editor 2.1.3 · etichette da Reniori/pulze-tone-generator (MIT)',
      'MazzRig · Pulze Editor 2.1.3 catalog · labels from Reniori/pulze-tone-generator (MIT)'],
    ['Mini finto pronto: premi Collega.', 'Fake Mini ready: press Connect.'],
    ['Indice della guida', 'Guide contents'], ['Lingua', 'Language'],
    ['Installa sul PC', 'Install on this PC'], ['Installa', 'Install'], ['Aggiorna', 'Update'],
    ['Installa il MazzRig sul PC: si apre dal Desktop, in una finestra sua, anche senza internet.',
      'Install MazzRig on this PC: it opens from the Desktop, in its own window, even without internet.'],
    ['C\'è una versione nuova dell\'editor (la pagina si ricarica e il Mini si scollega).',
      'There is a new version of the editor (the page reloads and the Mini disconnects).'],
    ['La pagina si ricarica e il Mini si scollega: le modifiche non salvate si perdono. Cambio lingua?',
      'The page reloads and the Mini disconnects: unsaved changes are lost. Change language?'],
    // ---- il palco e la catena
    ['Modello sconosciuto', 'Unknown model'], ['leggo…', 'reading…'], ['(vuoto)', '(empty)'], ['(senza nome)', '(no name)'],
    ['nessuna manopola', 'no knobs'], ['doppio clic: valore di fabbrica', 'double-click: factory value'],
    ['acceso', 'on'], ['spento', 'off'], ['vuoto', 'empty'],
    // ---- le finestre
    ['Crea preset AI', 'Create AI preset'], ['Il suono', 'The sound'],
    ['Descrivilo a parole: genere, artista, ampli, effetti.', 'Describe it in words: genre, artist, amp, effects.'],
    ['Parti dal tone che suona', 'Start from the current tone'], ['L\'AI', 'The AI'],
    ['La domanda', 'The question'], ['La risposta', 'The answer'], ['Copia la domanda', 'Copy the question'],
    ['Copiala e incollala nella chat che usi: ChatGPT, Claude, Gemini…', 'Copy it and paste it into the chat you use: ChatGPT, Claude, Gemini…'],
    ['Copia tutta la risposta della chat e incollala qui.', 'Copy the chat\'s whole answer and paste it here.'],
    ['Incolla qui la risposta', 'Paste the answer here'], ['Guida: copia e incolla', 'Guide: copy and paste'],
    ['Copiata: incollala nella chat', 'Copied: paste it into the chat'],
    ['Non riesco a copiare negli appunti.', 'I can\'t copy to the clipboard.'],
    ['Incolla prima la risposta della chat.', 'Paste the chat\'s answer first.'],
    ['Nella risposta non c\'è il preset: copiala intera, o chiedi alla chat di rispondere solo col JSON.',
      'The answer has no preset in it: copy all of it, or ask the chat to reply with the JSON only.'],
    ['Modello', 'Model'], ['Chiave…', 'Key…'], ['Annulla', 'Cancel'], ['Crea', 'Create'], ['Importa', 'Import'],
    ['Per esempio: crunch anni \'70 con un po\' di delay', 'For example: \'70s crunch with a touch of delay'],
    ['Nel tone che suona', 'Into the current tone'],
    ['Catena e blocchi del file. Niente è salvato finché non premi Salva.',
      'The file\'s chain and blocks. Nothing is saved until you press Save.'],
    ['Copia', 'Copy'], ['Scambia', 'Swap'], ['Nel posto', 'To slot'], ['Con', 'With'], ['Nome', 'Name'],
    ['Salva sul Mini', 'Save to the Mini'], ['Il tone che suona', 'The current tone'],
    ['Nel suo posto o in un altro: quello che c\'era si sovrascrive.', 'In its own slot or another one: whatever was there is overwritten.'],
    ['Posto', 'Slot'], ['leggo i nomi…', 'reading the names…'], ['Sovrascrivi', 'Overwrite'], ['Salva', 'Save'],
    ['Sul PC', 'On this PC'], ['I file vanno nella cartella Download.', 'Files go to the Downloads folder.'],
    ['Backup completo', 'Full backup'], ['tutti i tone, i settaggi e le Songlist in uno .zip', 'all tones, settings and Songlists in one .zip'],
    ['Ripristina preset…', 'Restore presets…'], ['Settaggi', 'Settings'], ['Preset', 'Presets'],
    ['Nella tua app Dropbox, cartella dell\'app.', 'In your Dropbox app\'s folder.'],
    ['Backup su Dropbox', 'Backup to Dropbox'], ['lo stesso .zip, mandato lassù', 'the same .zip, sent up there'],
    ['(nessun backup su Dropbox)', '(no backups on Dropbox)'], ['Rimetti', 'Restore'], ['Scarica', 'Download'],
    ['Fatto', 'Done'], ['apri Dropbox', 'open Dropbox'], ['Copie di sicurezza', 'Safety copies'],
    ['Si fanno da sole prima dei lavori che sovrascrivono qualcosa. Restano in questo browser.',
      'Made automatically before anything that overwrites something. They stay in this browser.'],
    ['Ferma', 'Stop'], ['Chiudi', 'Close'], ['Rimetti tone dal backup', 'Restore tones from a backup'],
    ['Solo i diversi', 'Only the different ones'], ['Tutti', 'All'], ['Nessuno', 'None'],
    ['modifiche non salvate', 'unsaved changes'], ['Nuova Songlist', 'New Songlist'], ['Annulla modifiche', 'Discard changes'],
    ['Scarica sul PC il backup scelto', 'Download the chosen backup to this PC'],
    ['Scollega Dropbox da questo browser', 'Disconnect Dropbox from this browser'],
    ['app key della tua app Dropbox', 'your Dropbox app\'s app key'], ['codice da Dropbox', 'code from Dropbox'],
    ['Ripristina', 'Restore'], ['Nella cartella Download', 'To the Downloads folder'],
    ['Rinomina', 'Rename'], ['Cancella', 'Delete'], ['Togli dalla Songlist', 'Remove from the Songlist'],
    ['Rinomina, copia, scambia, cancella', 'Rename, copy, swap, delete'], ['Azioni sul tone', 'Tone actions'],
    ['Sta suonando: passa a un altro tone per cancellarlo', 'It is playing: switch to another tone to delete it'],
    ['la chiave API', 'the API key'], ['file .prst', '.prst files'], ['copiare e scambiare i tone', 'copying and swapping tones'],
    ['collegare Dropbox', 'connecting Dropbox'], ['copie di sicurezza', 'safety copies'], ['rimettere i tone', 'restoring tones'],
    ['Oro', 'Gold'], ['Rosso', 'Red'], ['Arancio', 'Orange'], ['Verde', 'Green'], ['Azzurro', 'Light blue'], ['Blu', 'Blue'],
    ['Viola', 'Purple'], ['Rosa', 'Pink'],
    // ---- messaggi senza pezzi variabili
    ['Esempio: le modifiche restano nella pagina, niente va al Mini.', 'Example: changes stay in the page, nothing goes to the Mini.'],
    ['Stai ascoltando il tone com\'è salvato. Ripremi A/B per tornare alle modifiche.',
      'You are listening to the tone as saved. Press A/B again to go back to your changes.'],
    ['Annullo', 'Undoing'], ['Ripeto', 'Redoing'], ['Il tone salvato', 'The saved tone'],
    ['Aspetta un attimo: sto ancora leggendo i blocchi dal Mini.', 'Wait a moment: still reading the blocks from the Mini.'],
    ['Non ho letto i nomi dei tone: si salva solo sul posto.', 'Could not read the tone names: saving only to the same slot.'],
    ['Da 1 a 16 caratteri, senza accenti.', '1 to 16 characters, no accented letters.'],
    ['Leggo l\'ordine delle Songlist…', 'Reading the Songlist order…'], ['Leggo i nomi dei tone…', 'Reading the tone names…'],
    ['Leggo i settaggi…', 'Reading the settings…'], ['Leggo le Songlist…', 'Reading the Songlists…'],
    ['Mando il backup su Dropbox…', 'Sending the backup to Dropbox…'], ['nella cartella Download', 'in the Downloads folder'],
    ['su Dropbox', 'on Dropbox'], ['Backup fermato: non è stato salvato niente.', 'Backup stopped: nothing was saved.'],
    ['Importazione annullata.', 'Import cancelled.'], ['Leggo i settaggi di adesso…', 'Reading the current settings…'],
    ['Mando i settaggi…', 'Sending the settings…'],
    ['Ancora nessuna: si fanno da sole prima dei lavori che sovrascrivono qualcosa.',
      'None yet: they are made automatically before anything that overwrites something.'],
    ['mai fatto un backup', 'no backup yet'], ['ultimo backup: oggi', 'last backup: today'], ['ultimo backup: ieri', 'last backup: yesterday'],
    ['leggo Dropbox…', 'reading Dropbox…'], ['(Dropbox non letto)', '(Dropbox not read)'],
    ['Serve l\'app key della tua app Dropbox.', 'Your Dropbox app\'s app key is needed.'],
    ['Il browser ha bloccato la finestra: premi «apri Dropbox».', 'The browser blocked the window: press “open Dropbox”.'],
    ['Su Dropbox premi «Consenti», copia il codice e incollalo qui.', 'On Dropbox press “Allow”, copy the code and paste it here.'],
    ['Incolla il codice che ti ha dato Dropbox.', 'Paste the code Dropbox gave you.'],
    ['Ricomincia da «Collega».', 'Start again from “Connect”.'],
    ['Su Dropbox non c\'è ancora un backup: fai prima «Backup su Dropbox».', 'There is no backup on Dropbox yet: do a “Backup to Dropbox” first.'],
    ['Scollego Dropbox? I backup lassù restano dove sono.', 'Disconnect Dropbox? The backups up there stay where they are.'],
    ['Dropbox scollegato.', 'Dropbox disconnected.'],
    ['Dropbox scollegato qui (lassù non ho potuto revocarlo: si toglie da dropbox.com, app collegate).',
      'Dropbox disconnected here (it could not be revoked up there: remove it at dropbox.com, connected apps).'],
    ['il file non dice il cabinet («auto cab»)', 'the file does not name the cabinet (“auto cab”)'],
    ['il Mini ha tenuto l\'ordine della catena', 'the Mini kept the chain order'],
    ['Importo: volume, tempo e catena…', 'Importing: volume, tempo and chain…'],
    ['Claude ha rifiutato la richiesta', 'Claude refused the request'],
    ['la risposta è stata tagliata (troppo lunga)', 'the answer was cut off (too long)'],
    ['leggo i modelli…', 'reading the models…'], ['nessun modello di testo su questo account', 'no text model on this account'],
    ['Scrivi che suono vuoi.', 'Write what sound you want.'], ['l\'AI non ha risposto niente', 'the AI did not answer anything'],
    ['Fermato.', 'Stopped.'], ['serve un posto vuoto di appoggio, e sono tutti pieni', 'an empty spare slot is needed, and they are all full'],
    ['copia di sicurezza dei due tone', 'safety copy of the two tones'], ['4 di 4: libero il posto di appoggio', '4 of 4: freeing the spare slot'],
    ['Ci sono già 40 Songlist: è il massimo.', 'There are already 40 Songlists: that is the maximum.'],
    ['Nome della Songlist nuova (al massimo 16 caratteri, senza accenti):', 'Name of the new Songlist (16 characters max, no accented letters):'],
    ['Salvo le Songlist sul Mini', 'Saving the Songlists to the Mini'], ['salvo le Songlist sul Mini', 'saving the Songlists to the Mini'],
    ['Songlist salvate sul Mini (rilette: uguali).', 'Songlists saved to the Mini (re-read: identical).'],
    ['Le modifiche alle Songlist non sono sul Mini. Chiudo lo stesso? (restano qui finché non chiudi la pagina)',
      'The Songlist changes are not on the Mini. Close anyway? (they stay here until you close the page)'],
    ['Attenzione: le Songlist sul Mini non sono come dovevano.', 'Warning: the Songlists on the Mini are not as they should be.'],
    ['nello .zip non ci sono le Songlist (backup fatto prima che ci fossero)', 'the .zip has no Songlists (backup made before they existed)'],
    ['non è un file di Songlist', 'not a Songlist file'], ['Rimetto le Songlist', 'Restoring the Songlists'],
    ['rimetto le Songlist', 'restoring the Songlists'],
    ['Leggo i nomi dei tone sul Mini…', 'Reading the tone names on the Mini…'], ['posto vuoto', 'empty slot'],
    ['da confrontare', 'to compare'], ['uguale', 'identical'],
    ['Confronto fermato: quelli non confrontati non sono spuntati.', 'Comparison stopped: the ones not compared are not ticked.'],
    ['Tutti i tone del backup sono uguali a quelli sul Mini: non c\'è niente da rimettere.',
      'All tones in the backup are identical to the ones on the Mini: nothing to restore.'],
    ['Il tone che suona fa da appoggio: le sue modifiche non salvate si perdono. Ci vogliono alcuni secondi per tone.',
      'The current tone is used as a workspace: its unsaved changes are lost. It takes a few seconds per tone.'],
    ['Copia di sicurezza dei preset che vengono sostituiti…', 'Safety copy of the presets being replaced…'],
    ['lo rimetto…', 'restoring…'], ['non riletto', 'not re-read'], ['rimesso (riletto: uguale)', 'restored (re-read: identical)'],
    ['Torno al tone di partenza…', 'Going back to the starting tone…'],
    ['Fermato: gli altri non sono stati toccati.', 'Stopped: the others were not touched.'],
    ['Fermo? Il tone in corso finisce, gli altri restano come sono.', 'Stop? The tone in progress finishes, the others stay as they are.'],
    ['Leggo il tone…', 'Reading the tone…'], ['Mi collego…', 'Connecting…'], ['Cambio tone…', 'Changing tone…'],
    ['Questo browser non ha il Bluetooth per le pagine web: apri la pagina con Chrome o Edge.',
      'This browser has no Bluetooth for web pages: open the page in Chrome or Edge.'],
    ['Nessun dispositivo scelto.', 'No device chosen.'], ['Scollegato.', 'Disconnected.'],
    ['Scegli il Pulze Mini nella finestra del browser.', 'Choose the Pulze Mini in the browser window.'],
    ['Nome vuoto: non cambio niente.', 'Empty name: nothing changed.'],
    ['Esempio: «To Rachael», registrato dal Mini il 4 novembre. Niente è collegato.',
      'Example: “To Rachael”, recorded from the Mini on 4 November. Nothing is connected.'],
    ['catena', 'chain'], ['tempo', 'tempo'],
    // ---- errori che arrivano dagli altri file (Bluetooth, Dropbox, file)
    ['il Mini non è collegato', 'the Mini is not connected'], ['il Mini non ha confermato', 'the Mini did not confirm'],
    ['collegamento caduto', 'connection lost'], ['nessuna risposta', 'no answer'], ['fermato', 'stopped'],
    ['su Dropbox non c\'è ancora nessun backup', 'there is no backup on Dropbox yet'],
    ['l\'autorizzazione a Dropbox non vale più: scollega e ricollega', 'the Dropbox authorization is no longer valid: disconnect and reconnect'],
    ['lo spazio su Dropbox è finito', 'your Dropbox is full'],
    ['Dropbox chiede di aspettare un momento e riprovare', 'Dropbox asks to wait a moment and try again'],
    ['Dropbox non risponde bene: riprova fra poco', 'Dropbox is not responding properly: try again shortly'],
    ['Dropbox non ha dato un refresh token: rifai l\'autorizzazione', 'Dropbox gave no refresh token: redo the authorization'],
    ['Dropbox non è ancora collegato', 'Dropbox is not connected yet'],
    ['non è un file .prst', 'not a .prst file'], ['tone non valido', 'invalid tone'], ['non è un file .glb', 'not a .glb file'],
    ['settaggi del Mini incompleti', 'incomplete settings from the Mini'], ['la risposta non è un preset', 'the answer is not a preset'],
    ['l\'ordine della catena non si capiva: messo quello comune', 'the chain order was unclear: the usual one was used'],
    ['l\'AI non l\'ha scritto', 'the AI did not write it'],
  ];

  const MODELLI = [
    ['Suona il riquadro {0}', 'Play tile {0}'], ['Accendi/spegni {0}', 'Turn {0} on/off'],
    ['Stacca {0}', 'Disconnect {0}'],
    ['Posto {0} della pagina', 'Slot {0} of the page'],
    ['Posto {0} della metà accesa', 'Slot {0} of the active half'],
    ['dopo {0} s', 'after {0} s'],
    ['MIDI USB non disponibile: {0}', 'USB MIDI not available: {0}'],
    ['«{0}» collegato.', '«{0}» connected.'],
    ['Pedale non collegato: {0}', 'Pedal not connected: {0}'],
    ['CC {0} · canale {1}', 'CC {0} · channel {1}'],
    ['PC {0} · canale {1}', 'PC {0} · channel {1}'],
    ['Posto {0}', 'Slot {0}'], ['valore {0}', 'value {0}'], ['Il Mini dice slot {0}', 'The Mini says slot {0}'],
    ['{0} (vuoto)', '{0} (empty)'], ['Guida: {0}', 'Guide: {0}'], ['Chiave {0}', '{0} key'],
    ['Auto CAB {0} (vale per tutti i tone): il Mini conferma.', 'Auto CAB {0} (applies to all tones): the Mini confirms.'],
    ['Il Mini ha tenuto l\'Auto CAB {0}.', 'The Mini kept Auto CAB {0}.'],
    ['Auto CAB non confermato: {0}', 'Auto CAB not confirmed: {0}'],
    ['Il Mini non ha preso volume o tempo: {0}', 'The Mini did not take the volume or tempo: {0}'],
    ['Il Mini non ha preso la modifica di {0}: {1}', 'The Mini did not take the change to {0}: {1}'],
    ['Attenzione: dopo l\'on/off di {0} (posizione {1}) il Mini dice {2} {3}.', 'Warning: after switching {0} (position {1}) the Mini says {2} {3}.'],
    ['{0} {1}: il Mini conferma.', '{0} {1}: the Mini confirms.'],
    ['On/off di {0} non confermato: {1}', 'On/off of {0} not confirmed: {1}'],
    ['Metto {0} in {1}…', 'Putting {0} in {1}…'],
    ['{0}: {1}, coi valori di fabbrica; Auto CAB: {2}.', '{0}: {1}, with factory values; Auto CAB: {2}.'],
    ['{0}: {1}, coi valori di fabbrica.', '{0}: {1}, with factory values.'],
    ['Attenzione: il Mini in {0} dice {1}.', 'Warning: in {0} the Mini says {1}.'],
    ['Cambio di modello non riuscito: {0}', 'Model change failed: {0}'],
    ['{0}: fatto.', '{0}: done.'], ['{0} non riuscito: {1}. Premi Rileggi.', '{0} failed: {1}. Press Reload.'],
    ['Sposto {0} appena il Mini ha finito di rileggere i blocchi…', 'Moving {0} as soon as the Mini has finished re-reading the blocks…'],
    ['Sposto {0} in posizione {1}', 'Moving {0} to position {1}'],
    ['Rileggo il blocco {0} di 7…', 'Re-reading block {0} of 7…'],
    ['Il Mini ha tenuto l\'ordine di prima: {0}.', 'The Mini kept the previous order: {0}.'],
    ['Catena cambiata, ma i blocchi riletti non tornano: {0}. Premi Rileggi.', 'Chain changed, but the re-read blocks do not match: {0}. Press Reload.'],
    ['{0} in posizione {1}: il Mini conferma. Non è salvato.', '{0} at position {1}: the Mini confirms. Not saved.'],
    ['Spostamento non confermato: {0}. Premi Rileggi.', 'Move not confirmed: {0}. Press Reload.'],
    ['{0} · (vuoto)', '{0} · (empty)'],
    ['Copia di sicurezza di «{0}»…', 'Safety copy of “{0}”…'], ['copia di sicurezza di «{0}»', 'safety copy of “{0}”'],
    ['Salvo «{0}» nel posto {1}…', 'Saving “{0}” to slot {1}…'],
    ['Il Mini ha risposto, ma nel posto {0} c\'è «{1}».', 'The Mini answered, but slot {0} holds “{1}”.'],
    ['Salvato sul Mini: «{0}», posto {1}.', 'Saved to the Mini: “{0}”, slot {1}.'],
    ['Salvataggio non confermato: {0}', 'Save not confirmed: {0}'],
    ['Esportato «{0}» (nella cartella Download).', 'Exported “{0}” (in the Downloads folder).'],
    ['Leggo il tone {0} di {1}: «{2}»…', 'Reading tone {0} of {1}: “{2}”…'],
    ['Riprovo i tone saltati: {0} di {1}, «{2}»…', 'Retrying the skipped tones: {0} of {1}, “{2}”…'],
    ['Fatto: «{0}» {1}, {2} tone, i settaggi e {3} Songlist. Non letti (il Mini non ha risposto): {4}.',
      'Done: “{0}” {1}, {2} tones, the settings and {3} Songlists. Not read (the Mini did not answer): {4}.'],
    ['Fatto: «{0}» {1}, {2} tone, i settaggi e {3} Songlist.', 'Done: “{0}” {1}, {2} tones, the settings and {3} Songlists.'],
    ['Backup non riuscito: {0}.', 'Backup failed: {0}.'],
    ['Esportati in «{0}» (nella cartella Download).', 'Exported to “{0}” (in the Downloads folder).'],
    ['Esportazione non riuscita: {0}.', 'Export failed: {0}.'],
    ['Metto sul Mini i settaggi di «{0}»? Quelli di adesso vengono sostituiti (conviene prima «Esporta settaggi»).',
      'Put the settings from “{0}” on the Mini? The current ones will be replaced (better to export them first).'],
    ['Settaggi di «{0}» messi sul Mini (riletti: uguali).', 'Settings from “{0}” put on the Mini (re-read: identical).'],
    ['Settaggi mandati, ma riletti non sono del tutto uguali (byte {0}): controlla dalle Impostazioni.',
      'Settings sent, but re-read they are not quite identical (byte {0}): check them in Settings.'],
    ['Importazione non riuscita: {0}.', 'Import failed: {0}.'],
    ['Copia di sicurezza non riuscita ({0}): il lavoro va avanti lo stesso.', 'Safety copy failed ({0}): the job goes on anyway.'],
    ['«{0}» nella cartella Download.', '“{0}” in the Downloads folder.'],
    ['prima di salvare «{0}» sopra «{1}» (posto {2})', 'before saving “{0}” over “{1}” (slot {2})'],
    ['prima di importare «{0}»', 'before importing “{0}”'], ['prima di cancellare «{0}» (posto {1})', 'before deleting “{0}” (slot {1})'],
    ['prima di copiare «{0}» sopra «{1}» (posto {2})', 'before copying “{0}” over “{1}” (slot {2})'],
    ['prima di scambiare «{0}» e «{1}»', 'before swapping “{0}” and “{1}”'],
    ['prima di ripristinare {0} preset', 'before restoring {0} presets'], ['prima di: {0}', 'before: {0}'],
    ['oggi {0}', 'today {0}'], ['ieri {0}', 'yesterday {0}'],
    ['ultimo backup: {0} giorni fa', 'last backup: {0} days ago'],
    ['Non riesco a leggere Dropbox: {0}.', 'Cannot read Dropbox: {0}.'],
    ['Dropbox non ha accettato il codice{0}. Un codice vale una volta sola: premi «apri Dropbox», «Consenti» e incolla quello nuovo.',
      'Dropbox did not accept the code{0}. A code works only once: press “open Dropbox”, “Allow” and paste the new one.'],
    ['Prendo «{0}» da Dropbox…', 'Fetching “{0}” from Dropbox…'], ['Non riesco a prenderlo: {0}.', 'Cannot fetch it: {0}.'],
    ['In «{0}» non ci sono i settaggi.', 'There are no settings in “{0}”.'],
    ['«{0}» scaricato nella cartella Download.', '“{0}” downloaded to the Downloads folder.'],
    ['{0} non va in {1}', '{0} does not fit in {1}'], ['valori di {0} illeggibili', 'unreadable values for {0}'],
    ['«{0}» non si legge: {1}.', '“{0}” cannot be read: {1}.'],
    ['Prova «{0}»', 'Try “{0}”'], ['Importa «{0}»', 'Import “{0}”'],
    ['resta quello del tone: {0}', 'the tone\'s own block stays: {0}'],
    ['Attenzione: {0}.', 'Warning: {0}.'], ['Volume {0}, tempo {1} bpm.', 'Volume {0}, tempo {1} bpm.'],
    ['Il file è per «{0}», non per il Pulze Mini (AP-10).', 'The file is for “{0}”, not for the Pulze Mini (AP-10).'],
    ['Importo: la catena è cambiata, rileggo il blocco {0} di 7…', 'Importing: the chain changed, re-reading block {0} of 7…'],
    ['{0}: il Mini non ha preso {1}', '{0}: the Mini did not take {1}'],
    ['Importo: i valori di {0}…', 'Importing: the values of {0}…'], ['Importo: riscrivo {0}…', 'Importing: rewriting {0}…'], ['Importo: {0} in {1}…', 'Importing: {0} into {1}…'],
    ['Importo: controllo il blocco {0} di 7…', 'Importing: checking block {0} of 7…'], ['Importo: {0} {1}…', 'Importing: {0} {1}…'],
    ['{0} non riletto', '{0} not re-read'], ['{0}: il Mini dice {1}', '{0}: the Mini says {1}'],
    ['{0} {1}, nel file no', '{0} {1}, not in the file'],
    ['Importato «{0}», ma: {1}. Niente è salvato.', 'Imported “{0}”, but: {1}. Nothing is saved.'],
    ['Importato «{0}» nel tone che suona{1}. Per tenerlo: Salva… (propone «{2}»).',
      'Imported “{0}” into the current tone{1}. To keep it: Save… (suggests “{2}”).'],
    ['({0} blocco tenuto dal tone)', '({0} block kept from the tone)'], ['({0} blocchi tenuti dal tone)', '({0} blocks kept from the tone)'],
    ['Import interrotto: {0}. Il tone è a metà: Rileggi per vedere com\'è.', 'Import interrupted: {0}. The tone is half done: Reload to see how it is.'],
    ['Esempio: «{0}» importato nella pagina, niente va al Mini.', 'Example: “{0}” imported in the page, nothing goes to the Mini.'],
    ['Claude ha rifiutato la richiesta: {0}', 'Claude refused the request: {0}'],
    ['La chiave non va: {0}', 'The key does not work: {0}'], ['Serve la chiave {0}.', 'The {0} key is needed.'],
    ['{0} sta componendo il suono… {1} s', '{0} is composing the sound… {1} s'],
    ['Non è andata: {0}', 'It did not work: {0}'], ['La risposta non si legge: {0}', 'The answer cannot be read: {0}'], ['Elenco non letto: {0}', 'List not read: {0}'],
    ['{0}: non riuscito ({1}).', '{0}: failed ({1}).'],
    ['Rinomino «{0}» in «{1}»…', 'Renaming “{0}” to “{1}”…'], ['Rinomino «{0}»', 'Renaming “{0}”'], ['Cancello «{0}»', 'Deleting “{0}”'],
    ['Nuovo nome per «{0}» (al massimo 16 caratteri, senza accenti):', 'New name for “{0}” (16 characters max, no accented letters):'],
    ['Nuovo nome per «{0}» (al massimo 15 caratteri, senza accenti):', 'New name for “{0}” (15 characters max, no accented letters):'],
    ['Nuovo nome per «{0}»:', 'New name for “{0}”:'],
    ['Tone rinominato: «{0}».', 'Tone renamed: “{0}”.'],
    ['«{0}» sta suonando: passa a un altro tone prima di cancellarlo.', '“{0}” is playing: switch to another tone before deleting it.'],
    ['Cancello il tone «{0}» (posto {1}) dal Mini? Ne resta una copia di sicurezza in Backup….',
      'Delete the tone “{0}” (slot {1}) from the Mini? A safety copy stays in Backup….'],
    ['Tone «{0}» cancellato: il posto {1} è vuoto.', 'Tone “{0}” deleted: slot {1} is empty.'],
    ['nel posto {0} il Mini dice «{1}»', 'in slot {0} the Mini says “{1}”'],
    ['Copia «{0}»', 'Copy “{0}”'], ['Scambia «{0}»', 'Swap “{0}”'],
    ['Il posto {0} ha già «{1}»: viene sovrascritto.', 'Slot {0} already holds “{1}”: it will be overwritten.'],
    ['Il posto {0} è vuoto.', 'Slot {0} is empty.'],
    ['{0} La copia prende anche le modifiche non salvate.', '{0} The copy also takes the unsaved changes.'],
    ['{0} Le modifiche non salvate di «{1}» si perdono.', '{0} The unsaved changes to “{1}” are lost.'],
    ['I due tone si scambiano di posto. Le Songlist usano i posti: in {0} al loro posto suonerà l\'altro tone.',
      'The two tones swap slots. Songlists use slots: in {0} the other tone will play in their place.'],
    ['I due tone si scambiano di posto.', 'The two tones swap slots.'],
    ['Copio «{0}» nel posto {1}', 'Copying “{0}” to slot {1}'], ['Copiato: «{0}» nel posto {1}.', 'Copied: “{0}” to slot {1}.'],
    ['Scambio «{0}» e «{1}»', 'Swapping “{0}” and “{1}”'],
    ['1 di 4: «{0}» nel posto di appoggio {1}', '1 of 4: “{0}” to spare slot {1}'],
    ['2 di 4: «{0}» nel posto {1}', '2 of 4: “{0}” to slot {1}'], ['3 di 4: «{0}» nel posto {1}', '3 of 4: “{0}” to slot {1}'],
    ['riletti: posto {0} «{1}», posto {2} «{3}»', 're-read: slot {0} “{1}”, slot {2} “{3}”'],
    ['Scambiati: «{0}» ora è nel posto {1}, «{2}» nel posto {3}. Attenzione: il posto di appoggio {4} non si è liberato.',
      'Swapped: “{0}” is now in slot {1}, “{2}” in slot {3}. Warning: spare slot {4} was not freed.'],
    ['Scambiati: «{0}» ora è nel posto {1}, «{2}» nel posto {3}.', 'Swapped: “{0}” is now in slot {1}, “{2}” in slot {3}.'],
    ['«{0}» ha già 50 tone: è il massimo.', '“{0}” already has 50 tones: that is the maximum.'],
    ['{0}… ({1} tone rimessi)', '{0}… ({1} tones restored)'],
    ['Esportate {0} Songlist in «{1}» (nella cartella Download).', 'Exported {0} Songlists to “{1}” (in the Downloads folder).'],
    ['File non letto: {0}.', 'File not read: {0}.'], ['Non riesco a leggere il Mini: {0}.', 'Cannot read the Mini: {0}.'],
    ['Metto sul Mini le {0} Songlist del file al posto delle {1} che ci sono?', 'Put the file\'s {0} Songlists on the Mini in place of the {1} there now?'],
    ['{0} tone nel file hanno un nome diverso da quello che ora è in quel posto (es. posto {1}: «{2}», ora «{3}»): metto quello che c\'è ora.',
      '{0} tones in the file have a different name from the one now in that slot (e.g. slot {1}: “{2}”, now “{3}”): the current one is used.'],
    ['{0} posti ora sono vuoti: quei tone li salto.', '{0} slots are now empty: those tones are skipped.'],
    ['Songlist rimesse dal file: {0}, rilette dal Mini e uguali.', 'Songlists restored from the file: {0}, re-read from the Mini and identical.'],
    ['nome «{0}»', 'name “{0}”'], ['{0} manopole', '{0} knobs'], ['diverso: {0}', 'different: {0}'],
    ['rimesso, ma diverso: {0}', 'restored, but different: {0}'], ['non riuscito: {0}', 'failed: {0}'],
    ['In «{0}» non ci sono tone (i .prst del backup completo).', 'There are no tones in “{0}” (the .prst files of the full backup).'],
    ['{0} tone in «{1}».', '{0} tones in “{1}”.'], ['Confronto col Mini: {0} di {1}…', 'Comparing with the Mini: {0} of {1}…'],
    ['non letto, ora «{0}»', 'not read, now “{0}”'],
    ['{0} tone è diverso da quelli sul Mini (spuntati); gli altri sono uguali.', '{0} tone differs from the one on the Mini (ticked); the others are identical.'],
    ['{0} tone sono diversi da quelli sul Mini (spuntati); gli altri sono uguali.', '{0} tones differ from the ones on the Mini (ticked); the others are identical.'],
    ['Rimetti {0} tone', 'Restore {0} tones'],
    ['Rimetto sul Mini {0} tone del backup, ognuno nel suo posto?', 'Restore {0} tones from the backup to the Mini, each in its own slot?'],
    ['{0} posto ha già un tone: viene sostituito da quello del backup.', '{0} slot already holds a tone: it will be replaced by the one from the backup.'],
    ['{0} posti hanno già un tone: viene sostituito da quello del backup.', '{0} slots already hold a tone: they will be replaced by the ones from the backup.'],
    ['Tone {0} di {1}, «{2}» nel posto {3}: {4}', 'Tone {0} of {1}, “{2}” to slot {3}: {4}'],
    ['salvo…', 'saving…'], ['controllo…', 'checking…'],
    ['Rimessi {0} tone (riletti: uguali){1}.{2}', 'Restored {0} tones (re-read: identical){1}.{2}'],
    [', {0} con differenze, {1} non riusciti', ', {0} with differences, {1} failed'], [', {0} con differenze', ', {0} with differences'],
    [', {0} non riusciti', ', {0} failed'],
    ['Ripristino interrotto: {0}.', 'Restore interrupted: {0}.'],
    ['Nella Songlist {0}', 'In the Songlist {0}'], ['Nelle Songlist {0}', 'In the Songlists {0}'],
    ['Nessun tone con «{0}».', 'No tone matching “{0}”.'],
    ['Le modifiche di «{0}» non sono salvate e si perdono. Cambio tone?', 'The changes to “{0}” are not saved and will be lost. Change tone?'],
    ['Vado a «{0}»…', 'Going to “{0}”…'], ['Il Mini non ha preso il cambio di tone: {0}', 'The Mini did not take the tone change: {0}'],
    ['Leggo il blocco {0} di 7…', 'Reading block {0} of 7…'], ['Collegato a {0}. Il tone è aggiornato.', 'Connected to {0}. The tone is up to date.'],
    ['Lettura interrotta: {0}', 'Reading interrupted: {0}'], ['Rinominato: «{0}». Il Mini conferma.', 'Renamed: “{0}”. The Mini confirms.'],
    ['Attenzione: il Mini dice ancora «{0}».', 'Warning: the Mini still says “{0}”.'], ['Rinomina non riuscita: {0}', 'Rename failed: {0}'],
    ['Impostazione non mandata: {0}', 'Setting not sent: {0}'], ['Lettura non riuscita: {0}', 'Reading failed: {0}'],
    ['Non riesco a caricare la guida ({0}).', 'Cannot load the guide ({0}).'],
    ['Non riesco a collegarmi: {0}. Il Mini accetta un collegamento alla volta: chiudi l\'app sul telefono e riprova.',
      'Cannot connect: {0}. The Mini accepts one connection at a time: close the app on your phone and try again.'],
    ['Mi collego a {0}…', 'Connecting to {0}…'],
    ['non è un preset (fileType {0})', 'not a preset (fileType {0})'], ['non sono settaggi (fileType {0})', 'not settings (fileType {0})'],
    ['{0}: «{1}» non è fra {2}', '{0}: “{1}” is not one of {2}'], ['{0}: «{1}» non è né un numero né una divisione', '{0}: “{1}” is neither a number nor a division'],
    ['{0}: «{1}» non è un numero', '{0}: “{1}” is not a number'], ['{0} manca nella risposta', '{0} is missing from the answer'],
    ['{0}: «{1}» non c\'è o non va in {2}', '{0}: “{1}” does not exist or does not fit in {2}'],
    ['modello «{0}» sconosciuto', 'unknown model “{0}”'], ['{0} {1}: manopola «{2}» sconosciuta', '{0} {1}: unknown knob “{2}”'],
    // i più generici, per ultimi: un lavoro in corso e le parti fra parentesi
    ['{0}: {1}…', '{0}: {1}…'], ['{0}…', '{0}…'], ['({0})', '({0})'],
  ];

  const esatti = new Map(ESATTI);
  const escapa = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // prima i modelli con più testo fisso (i più precisi); a parità, l'ordine scritto
  // i pezzi fra «» sono nomi (di tone, Songlist, file): restano come sono, anche se somigliano a una parola nota
  const modelli = MODELLI.map(([it, en], i) => ({
    re: new RegExp('^' + it.split(/\{\d\}/).map(escapa).join('([\\s\\S]*?)') + '$'),
    ordine: (it.match(/\{(\d)\}/g) || []).map(x => +x[1]),
    nomi: new Set((it.match(/«\{(\d)\}»/g) || []).map(x => +x[2])),
    en, fisso: it.replace(/\{\d\}/g, '').length, i,
  })).sort((a, b) => b.fisso - a.fisso || a.i - b.i);

  const memoria = new Map();
  /** Il testo in inglese (in italiano lo stesso). Tiene gli spazi attorno; i pezzi variabili si traducono a loro volta. */
  function traduci(s, profondo) {
    if (lingua === 'it' || typeof s !== 'string' || !/[A-Za-zÀ-ú]{2}/.test(s)) return s;
    if (memoria.has(s)) return memoria.get(s);
    const t = s.trim();
    let r = null;
    if (esatti.has(t)) r = esatti.get(t);
    else if ((profondo || 0) < 6) {
      for (const m of modelli) {
        const x = m.re.exec(t);
        if (!x) continue;
        const pezzi = x.slice(1);
        r = m.en.replace(/\{(\d)\}/g, (_, n) => {
          const k = m.ordine.indexOf(+n);
          if (k < 0) return '';
          return m.nomi.has(+n) ? pezzi[k] : traduci(pezzi[k], (profondo || 0) + 1);
        });
        break;
      }
      // domande su più paragrafi, ed elenchi («; » e «, ») di cose che si sanno tradurre
      if (r == null && t.includes('\n\n')) r = t.split('\n\n').map(p => traduci(p, (profondo || 0) + 1)).join('\n\n');
      for (const sep of ['; ', ', ']) {
        if (r != null || !t.includes(sep)) continue;
        const parti = t.split(sep), tradotte = parti.map(p => traduci(p, (profondo || 0) + 1));
        if (tradotte.some((p, i) => p !== parti[i])) r = tradotte.join(sep);
      }
    }
    // in inglese le virgolette sono “ ” (i nomi fra «» restano com'erano, cambiano solo i segni)
    const fuori = (r == null ? s : s.replace(t, () => r)).replace(/«/g, '“').replace(/»/g, '”');
    if (memoria.size > 4000) memoria.clear();
    memoria.set(s, fuori);
    return fuori;
  }

  // ---------------------------------------------------------------- la pagina
  const ATTRIBUTI = ['title', 'placeholder', 'aria-label', 'aria-description'];
  const fuoriDaTradurre = n => n.closest && n.closest('[data-notrad], [data-lingua], script, style');
  // dove ci sono i nomi dei tone e delle Songlist: solo i due segnaposto si traducono
  const NOMI = '.nome, .sl-nome, .rip-nome, #tone-nome, #det-nome';
  const SEGNAPOSTO = new Set(['(vuoto)', '(senza nome)']);
  function testo(x) {
    const v = x.nodeValue;
    if (x.parentElement && x.parentElement.tagName === 'TEXTAREA') return;     // quello che scrive chi usa la pagina
    if (x.parentElement && x.parentElement.closest(NOMI) && !SEGNAPOSTO.has(v.trim())) return;
    const t = traduci(v);
    if (t !== v) x.nodeValue = t;
  }

  function traduciNodo(n) {
    if (n.nodeType === 3) {
      const p = n.parentElement;
      if (!p || fuoriDaTradurre(p)) return;
      testo(n);
      return;
    }
    if (n.nodeType !== 1 || fuoriDaTradurre(n)) return;
    traduciAttributi(n);
    const w = document.createTreeWalker(n, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: x => (x.nodeType === 1 && x.matches('[data-notrad], [data-lingua], script, style')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let x;
    while ((x = w.nextNode())) {
      if (x.nodeType === 1) traduciAttributi(x); else testo(x);
    }
  }
  function traduciAttributi(e) {
    for (const a of ATTRIBUTI) {
      const v = e.getAttribute(a);
      if (v) { const t = traduci(v); if (t !== v) e.setAttribute(a, t); }
    }
    if (e.tagName === 'OPTGROUP' && e.label) { const t = traduci(e.label); if (t !== e.label) e.label = t; }
  }

  if (lingua === 'en') {
    traduciNodo(document.body);
    new MutationObserver(lista => {
      for (const m of lista) {
        if (m.type === 'childList') m.addedNodes.forEach(traduciNodo);
        else if (m.type === 'characterData') traduciNodo(m.target);
        else if (m.type === 'attributes' && !fuoriDaTradurre(m.target)) traduciAttributi(m.target);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTI.concat(['label']) });
    // le domande del browser
    const conferma = window.confirm.bind(window), chiedi = window.prompt.bind(window), avvisa = window.alert.bind(window);
    window.confirm = m => conferma(traduci(String(m)));
    window.prompt = (m, d) => chiedi(traduci(String(m)), d);
    window.alert = m => avvisa(traduci(String(m)));
  }

  /** Cambia lingua: la pagina si ricarica. */
  function scegli(l) {
    try { localStorage.setItem(MEMO, l); } catch (e) { /* niente */ }
    location.reload();
  }

  window.PulzeLingua = { lingua, traduci, scegli };
})();
