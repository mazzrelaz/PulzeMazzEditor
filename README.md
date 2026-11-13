# MazzRig

*Italiano · [English](README.en.md)*

Un editor per l'**Hotone Pulze Mini**, dal PC, via Bluetooth, dentro il browser. Niente da installare, niente
account.

**→ [mazzrelaz.github.io/PulzeMazzEditor](https://mazzrelaz.github.io/PulzeMazzEditor/)**
(la guida è dentro l'editor: menu ☰ → Guida)

> **App non ufficiale di terze parti**, senza alcun rapporto con Hotone Audio: non è prodotta, approvata, sponsorizzata
> né supportata da Hotone. «Hotone» e «Pulze» sono marchi di Hotone Audio, citati solo per dire con cosa funziona.
> Fornita «così com'è», senza garanzie (licenza MIT): l'autore non risponde di danni o perdite di dati. Provato su un solo Pulze Mini, firmware 1.1.2: il
> protocollo è stato ricostruito osservando l'apparecchio, non viene da documentazione ufficiale. Lo usi a tuo
> rischio: prima di lavori grossi fai un backup completo (c'è nell'editor).

## Cosa fa

- **Modifica il tone che suona**: la catena dei sette blocchi con le immagini dei modelli, manopole, on/off, cambio
  di modello, blocchi da trascinare. Annulla / Ripeti e il confronto **A/B** col tone salvato.
- **Salva** in qualsiasi posto, copia, scambia, rinomina e cancella i tone.
- **Songlist** in una schermata a blocchi, da riordinare col mouse.
- **File .prst**: importa ed esporta, compatibili con l'app Pulze Editor del telefono.
- **Crea preset AI**: descrivi il suono a parole, copi la domanda nella chat che usi (ChatGPT, Claude, Gemini…) e
  incolli la risposta: il tone si compone coi modelli veri del Mini. Niente chiavi API, niente costi.
- **Jam** (la batteria del Mini), **Impostazioni** generali e **Global EQ** con la curva da trascinare.
- **Backup** completo sul PC o sul tuo **Dropbox**, ripristino dei tone confrontandoli col Mini, e copie di sicurezza
  automatiche prima di ogni lavoro che sovrascrive qualcosa.
- In **italiano** e in **inglese**.

## Cosa serve

- Un PC col **Bluetooth** e **Chrome** o **Edge** (gli altri browser non hanno il Bluetooth per le pagine web).
- Il Pulze Mini, con l'app del telefono **chiusa**: il Mini accetta un collegamento alla volta.

Senza il Mini puoi vedere come è fatto: [`#esempio`](https://mazzrelaz.github.io/PulzeMazzEditor/#esempio) mostra un
tone registrato, [`#finto`](https://mazzrelaz.github.io/PulzeMazzEditor/#finto) un Mini finto che risponde.

## Privacy

L'editor non raccoglie niente e non ha un server suo. Escono solo: i comandi al Mini, via Bluetooth; i backup su
Dropbox, se lo colleghi (nella tua app Dropbox); con Crea preset AI, la descrizione che scrivi, al fornitore che
scegli. Chiavi e collegamenti restano nel browser.

## Usarlo dal PC senza internet

Scarica il repository e apri `avvia-editor.cmd` (serve [Node.js](https://nodejs.org/)): parte un piccolo server su
`http://localhost:8100` e la pagina in Edge. I test: `node test/protocollo.test.js` (e gli altri in `test/`).

## Crediti

Scritto da **Massimo Togni**. Etichette dei selettori, unità e catalogo per l'AI da
[Reniori/pulze-tone-generator](https://github.com/Reniori/pulze-tone-generator) (MIT). Nomi dei modelli, posizioni e
limiti delle manopole dal catalogo dell'app ufficiale Pulze Editor 2.1.3. Le immagini dei modelli sono disegni
generati per questo programma, non foto dei prodotti; i nomi dei prodotti a cui si ispirano appartengono ai loro
titolari. «Hotone», «Pulze» e «Pulze Mini» sono marchi dei rispettivi titolari.

Licenza [MIT](LICENSE). Se ti è utile: [offrimi un caffè](https://buymeacoffee.com/mazzgear).
