// pulze-ble.js - Il collegamento Web Bluetooth col Pulze Mini: la caratteristica MIDI, la coda d'invio
// (una scrittura alla volta, con una pausa come l'app), le conferme ai dati del Mini e le richieste
// che aspettano la loro risposta. Sopra pulze-protocollo.js (window.Pulze).
(function (g) {
  const P = g.Pulze;
  const PAUSA_MS = 40;          // fra un pacchetto e l'altro (l'app ne manda uno ogni ~25-70 ms)
  const ATTESA_MS = 3000;       // per la risposta a una richiesta, poi si riprova
  const TENTATIVI = 3;

  function PulzeBle(opz) {
    this.alMessaggio = opz.alMessaggio || function () {};   // ogni messaggio intero del Mini
    this.alloStato = opz.alloStato || function () {};       // 'collegato', 'scollegato', testo
    this.dispositivo = null;
    this.caratt = null;
    this.num = 0;
    this.max = 180;               // byte per scrittura; scende a 20 se Windows non ne accetta tanti
    this.coda = [];
    this.inviando = false;
    this.attese = [];
    this.registro = [];           // gli ultimi pacchetti, per capire cosa è successo
    const ric = P.Ricompositore(m => this._arrivato(m));
    this.lettore = P.Lettore(ric);
  }

  PulzeBle.supportato = () => !!(g.navigator && g.navigator.bluetooth);

  PulzeBle.prototype.collega = async function () {
    const nav = g.navigator.bluetooth;
    this.alloStato('scelta');
    this.dispositivo = await nav.requestDevice({
      filters: [{ namePrefix: 'Pulze' }, { services: [P.SERVIZIO_MIDI] }],
      optionalServices: [P.SERVIZIO_MIDI],
    });
    this.dispositivo.addEventListener('gattserverdisconnected', () => this._caduto());
    await this._apri();
  };

  PulzeBle.prototype._apri = async function () {
    this.alloStato('collego', this.dispositivo.name);
    let ultimo;
    // Il primo collegamento a volte non trova il servizio MIDI (visto col pedale): si riprova.
    for (let i = 0; i < 3; i++) {
      try {
        const server = await this.dispositivo.gatt.connect();
        const servizio = await server.getPrimaryService(P.SERVIZIO_MIDI);
        this.caratt = await servizio.getCharacteristic(P.CARATT_MIDI);
        this.caratt.addEventListener('characteristicvaluechanged', e => {
          const v = e.target.value;
          const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
          this._annota('<-', b);
          this.lettore(Array.from(b));
        });
        await this.caratt.startNotifications();
        this.alloStato('collegato', this.dispositivo.name);
        return;
      } catch (e) {
        ultimo = e;
        try { this.dispositivo.gatt.disconnect(); } catch (_) { /* già giù */ }
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    throw ultimo;
  };

  PulzeBle.prototype.scollega = function () {
    if (this.dispositivo && this.dispositivo.gatt.connected) this.dispositivo.gatt.disconnect();
  };

  PulzeBle.prototype.collegato = function () {
    return !!(this.dispositivo && this.dispositivo.gatt.connected && this.caratt);
  };

  PulzeBle.prototype._caduto = function () {
    this.caratt = null;
    this.coda = [];
    for (const a of this.attese) a.rifiuta(new Error('collegamento caduto'));
    this.attese = [];
    this.alloStato('scollegato');
  };

  PulzeBle.prototype._annota = function (dir, b) {
    this.registro.push(dir + ' ' + Array.from(b, x => x.toString(16).padStart(2, '0')).join(' '));
    if (this.registro.length > 400) this.registro.splice(0, 100);
  };

  /** Un messaggio dal Mini: si conferma (come l'app), poi si danno le risposte a chi le aspetta. */
  PulzeBle.prototype._arrivato = function (m) {
    if (m.comando === 0x12 && m.num === 0 && this.caratt) this._accoda(P.conferma(m.gruppo, m.lo, m.hi, this.max));
    for (const a of this.attese.slice()) {
      // chi ha mandato dati aspetta la 14 col suo num; chi ha chiesto, i dati che rispondono
      const giusto = a.conferma != null ? (m.comando === 0x14 && m.num === a.conferma)
        : (m.comando === 0x12 && a.vale(m));
      if (giusto) { this.attese.splice(this.attese.indexOf(a), 1); clearTimeout(a.timer); a.risolvi(m); }
    }
    this.alMessaggio(m);
  };

  PulzeBle.prototype._accoda = function (pacchetti) {
    this.coda.push(...pacchetti);
    if (!this.inviando) this._invia();
  };

  PulzeBle.prototype._invia = async function () {
    this.inviando = true;
    while (this.coda.length && this.caratt) {
      const p = Uint8Array.from(this.coda.shift());
      try {
        await this.caratt.writeValueWithoutResponse(p);
        this._annota('->', p);
      } catch (e) {
        // Un pacchetto troppo lungo per l'MTU: d'ora in poi pezzi da 20 (le richieste si rifanno).
        if (this.max > 20 && p.length > 20) { this.max = 20; this._annota('!!', [p.length]); }
        else this._annota('!!', []);
      }
      await new Promise(r => setTimeout(r, PAUSA_MS));
    }
    this.inviando = false;
  };

  /** Chiede al Mini (comando 11) e aspetta il messaggio che risponde (vale(m) dice se è quello). */
  PulzeBle.prototype.chiedi = async function (tipo, gruppo, corpo, vale) {
    let errore;
    for (let t = 0; t < TENTATIVI; t++) {
      if (!this.collegato()) throw new Error('il Mini non è collegato');
      this.num = (this.num + 1) & 0x7f || 1;
      const attesa = new Promise((risolvi, rifiuta) => {
        const a = { vale, risolvi, rifiuta };
        a.timer = setTimeout(() => {
          this.attese.splice(this.attese.indexOf(a), 1);
          rifiuta(new Error('nessuna risposta'));
        }, ATTESA_MS);
        this.attese.push(a);
      });
      this._accoda(P.richiesta(this.num, tipo, gruppo, corpo, this.max));
      try { return await attesa; } catch (e) { errore = e; }
    }
    throw errore;
  };

  /** Manda dati (comando 12) e aspetta la conferma 14 del Mini, che ripete il nostro num.
   *  crea(num, max) dà i pacchetti. */
  PulzeBle.prototype.manda = function (crea) {
    if (!this.collegato()) return Promise.reject(new Error('il Mini non è collegato'));
    this.num = (this.num + 1) & 0x7f || 1;
    const num = this.num;
    const attesa = new Promise((risolvi, rifiuta) => {
      const a = { conferma: num, risolvi, rifiuta };
      a.timer = setTimeout(() => {
        this.attese.splice(this.attese.indexOf(a), 1);
        rifiuta(new Error('il Mini non ha confermato'));
      }, ATTESA_MS);
      this.attese.push(a);
    });
    this._accoda(crea(num, this.max));
    return attesa;
  };

  /** Aspetta un messaggio del Mini senza chiedere niente (per esempio dopo un CC). */
  PulzeBle.prototype.aspetta = function (vale, ms) {
    return new Promise((risolvi, rifiuta) => {
      const a = { vale, risolvi, rifiuta };
      a.timer = setTimeout(() => {
        this.attese.splice(this.attese.indexOf(a), 1);
        rifiuta(new Error('nessuna risposta'));
      }, ms || ATTESA_MS);
      this.attese.push(a);
    });
  };

  PulzeBle.prototype.mandaCC = function (numero, valore) {
    if (this.collegato()) this._accoda([P.cc(numero, valore)]);
  };

  /** Le Songlist (2848 byte: i primi 40 sono il loro ordine, che serve al salvataggio). */
  PulzeBle.prototype.chiediSonglist = function () {
    return this.chiedi(P.TIPO.SONGLIST, 3, [], m => m.tipo === P.TIPO.SONGLIST && m.gruppo === 3);
  };

  /** Salva il tone che suona al posto «numero» col nome dato; aspetta la risposta 09/02 del Mini. */
  PulzeBle.prototype.salva = async function (numero, nome, ordine, dest) {
    const risposta = this.aspetta(m => m.comando === 0x12 && m.tipo === P.TIPO.SALVATO && m.gruppo === 2, 6000);
    await this.manda((num, max) => P.salva(num, numero, nome, ordine, max, dest));
    return risposta;
  };

  /** I nomi dei 200 tone (4400 byte). */
  PulzeBle.prototype.chiediNomi = async function () {
    const m = await this.chiedi(P.TIPO.NOMI, 0, [], m => m.tipo === P.TIPO.NOMI && m.gruppo === 0);
    return P.leggiNomi(m.corpo);
  };

  /** Le impostazioni generali (7/1): dentro c'è l'Auto CAB. */
  PulzeBle.prototype.chiediImpostazioni = async function () {
    const m = await this.chiedi(7, 1, [], m => m.tipo === 7 && m.gruppo === 1);
    return P.leggiImpostazioni(m.corpo);
  };

  /** Una lista dei modelli dell'utente (2/5 Sound Clone, 2/4 IR utente): [{ uid, vuoto, nome }]. */
  PulzeBle.prototype.chiediListaUtente = async function (gruppo) {
    const m = await this.chiedi(P.TIPO.BLOCCO, gruppo, [], m => m.tipo === P.TIPO.BLOCCO && m.gruppo === gruppo);
    return P.leggiListaUtente(m.corpo);
  };

  /** Il tone intero al posto n (0/0, 532 byte); ai posti vuoti il Mini non risponde (null). */
  PulzeBle.prototype.chiediToneIntero = async function (n) {
    const vale = m => m.tipo === 0 && m.gruppo === 0 && m.corpo && m.corpo.length >= 532 && m.corpo[8] === (n & 0xff);
    // tre tentativi, sempre più pazienti: l'8 novembre nel backup il Mini si è fermato per sei tone di fila
    for (const ms of [1500, 3000, 5000]) {
      if (!this.collegato()) throw new Error('il Mini non è collegato');
      this.num = (this.num + 1) & 0x7f || 1;
      const attesa = this.aspetta(vale, ms);
      this._accoda(P.richiesta(this.num, 0, 0, P.corpoChiediTone(n), this.max));
      try { return (await attesa).corpo; } catch (e) { /* si riprova una volta */ }
    }
    return null;
  };

  /** Tutti i settaggi (0/1, 288 byte). */
  PulzeBle.prototype.chiediSettaggi = async function () {
    const m = await this.chiedi(0, 1, [], m => m.tipo === 0 && m.gruppo === 1 && m.corpo && m.corpo.length >= 288);
    return m.corpo;
  };

  PulzeBle.prototype.chiediTesta = function () {
    return this.chiedi(P.TIPO.TESTA, 0, [], m => m.tipo === P.TIPO.TESTA && m.gruppo === 0);
  };

  PulzeBle.prototype.chiediBlocco = function (posizione) {
    return this.chiedi(P.TIPO.BLOCCO, 0, [posizione, 0, 0],
      m => m.tipo === P.TIPO.BLOCCO && m.gruppo === 0 && m.corpo[0] === posizione);
  };

  g.PulzeBle = PulzeBle;
})(this);
