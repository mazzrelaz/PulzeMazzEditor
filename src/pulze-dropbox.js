// pulze-dropbox.js - I backup del Mini su Dropbox: lo stesso trasporto dell'app dello Spark
// (spark/src/dropbox-sync.js, verificato dall'utente il 24 agosto 2026), con più file invece di uno.
//
// Niente server: OAuth PKCE senza redirect. Dropbox mostra un codice e l'utente lo incolla, una volta
// sola per apparecchio; poi si tiene il refresh token, che non scade. Le trappole già pagate con lo Spark:
// il verifier si RIUSA finché l'autorizzazione non riesce (rigenerarlo uccide il codice appena copiato,
// e Dropbox dice «code doesn't exist or has expired»); un codice vale una volta sola.
//
// I file vanno in /Pulze Mini/ dentro la cartella dell'app su Dropbox (Apps/<nome app>/). Ognuno registra
// la sua app su dropbox.com/developers (App folder, files.content.write e .read) e ne incolla l'app key.
(function () {
  'use strict';

  const CARTELLA = '/Pulze Mini';
  const AUTORIZZA = 'https://www.dropbox.com/oauth2/authorize';
  const TOKEN = 'https://api.dropboxapi.com/oauth2/token';
  const RPC = 'https://api.dropboxapi.com/2/';
  const CONTENUTO = 'https://content.dropboxapi.com/2/';
  const MARGINE_MS = 60 * 1000;     // il token si rinnova un minuto prima che scada

  const base64url = bytes => btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function nuovoVerifier() {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return base64url(b);
  }

  async function sfida(verifier) {
    return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  }

  function urlAutorizza(appKey, challenge) {
    return AUTORIZZA + '?' + new URLSearchParams({
      client_id: appKey, response_type: 'code', code_challenge: challenge,
      code_challenge_method: 'S256', token_access_type: 'offline',
    }).toString();
  }

  /** L'argomento delle chiamate «content» va in un'intestazione, che ammette solo ASCII. */
  function arg(o) {
    return JSON.stringify(o).replace(/[\u0080-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  }

  function messaggioErrore(stato, corpo) {
    const t = typeof corpo === 'string' ? corpo : JSON.stringify(corpo || {});
    if (/not_found/.test(t)) return 'su Dropbox non c\'è ancora nessun backup';
    if (stato === 401 || /expired_access_token|invalid_access_token|invalid_grant/.test(t)) return 'l\'autorizzazione a Dropbox non vale più: scollega e ricollega';
    if (/insufficient_space/.test(t)) return 'lo spazio su Dropbox è finito';
    if (stato === 429) return 'Dropbox chiede di aspettare un momento e riprovare';
    if (stato >= 500) return 'Dropbox non risponde bene: riprova fra poco';
    return 'Dropbox ha rifiutato (' + stato + '): ' + t.slice(0, 200);
  }

  /** opz: { appKey, refreshToken, salvaRefresh(valore), fetch (per i test) } */
  function Client(opz) {
    const o = opz || {};
    this.appKey = o.appKey || '';
    this.refresh = o.refreshToken || null;
    this.salvaRefresh = o.salvaRefresh || (() => {});
    this.fetch = o.fetch || ((...a) => window.fetch(...a));
    this.token = null;
    this.scadeA = 0;
  }

  Client.prototype = {
    autorizzato() { return Boolean(this.appKey && this.refresh); },

    async completaAutorizzazione(verifier, codice) {
      const r = await this._token({
        code: String(codice || '').trim(), grant_type: 'authorization_code',
        code_verifier: verifier, client_id: this.appKey,
      });
      if (!r.refresh_token) throw new Error('Dropbox non ha dato un refresh token: rifai l\'autorizzazione');
      this.refresh = r.refresh_token;
      this.token = r.access_token || null;
      this.scadeA = this.token ? Date.now() + (r.expires_in || 14400) * 1000 : 0;
      await this.salvaRefresh(this.refresh);
    },

    /** Revoca su Dropbox e dimentica qui; se Dropbox non risponde si dimentica lo stesso. */
    async scollega() {
      let revocato = false;
      if (this.refresh) {
        try { await this._chiama(RPC + 'auth/token/revoke', {}); revocato = true; } catch (e) { /* si dimentica comunque */ }
      }
      this.refresh = null; this.token = null; this.scadeA = 0;
      await this.salvaRefresh(null);
      return revocato;
    },

    /** Manda su un file nella cartella dei backup (byte o testo). Non sovrascrive: ogni backup ha la sua data. */
    async carica(nome, dati) {
      const r = await this._chiama(CONTENUTO + 'files/upload', {
        headers: {
          'Dropbox-API-Arg': arg({ path: CARTELLA + '/' + nome, mode: 'add', autorename: true, mute: true }),
          'Content-Type': 'application/octet-stream',
        },
        body: new Blob([dati], { type: 'application/octet-stream' }),
      });
      return r.json();
    },

    /** I byte di un file della cartella dei backup. */
    async scarica(nome) {
      const r = await this._chiama(CONTENUTO + 'files/download', {
        headers: { 'Dropbox-API-Arg': arg({ path: CARTELLA + '/' + nome }) },
      });
      return r.arrayBuffer();
    },

    /** I backup che ci sono lassù, dal più nuovo: [{ nome, quando, byte }]. Nessuna cartella = nessun backup. */
    async elenco() {
      const json = { 'Content-Type': 'application/json' };
      let voci = [];
      try {
        let d = await (await this._chiama(RPC + 'files/list_folder', { headers: json, body: JSON.stringify({ path: CARTELLA }) })).json();
        voci = voci.concat(d.entries);
        while (d.has_more) {
          d = await (await this._chiama(RPC + 'files/list_folder/continue', { headers: json, body: JSON.stringify({ cursor: d.cursor }) })).json();
          voci = voci.concat(d.entries);
        }
      } catch (e) {
        if (/nessun backup/.test(e.message)) return [];
        throw e;
      }
      return voci.filter(v => v['.tag'] === 'file' && /\.zip$/i.test(v.name))
        .map(v => ({ nome: v.name, quando: v.server_modified, byte: v.size }))
        .sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
    },

    async _token(campi) {
      const r = await this.fetch(TOKEN, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(campi).toString(),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(messaggioErrore(r.status, t));
      return JSON.parse(t);
    },

    async _accesso() {
      if (this.token && Date.now() < this.scadeA - MARGINE_MS) return this.token;
      if (!this.refresh) throw new Error('Dropbox non è ancora collegato');
      const r = await this._token({ grant_type: 'refresh_token', refresh_token: this.refresh, client_id: this.appKey });
      this.token = r.access_token;
      this.scadeA = Date.now() + (r.expires_in || 14400) * 1000;
      return this.token;
    },

    async _chiama(url, o) {
      const headers = Object.assign({ Authorization: 'Bearer ' + await this._accesso() }, o.headers || {});
      const r = await this.fetch(url, { method: 'POST', headers, body: o.body });
      if (!r.ok) throw new Error(messaggioErrore(r.status, await r.text()));
      return r;
    },
  };

  window.PulzeDropbox = { Client, CARTELLA, nuovoVerifier, sfida, urlAutorizza, arg, messaggioErrore };
})();
