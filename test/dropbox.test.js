// dropbox.test.js - Prova pulze-dropbox.js contro un Dropbox finto (un fetch che risponde come quello vero).
// Dice che parliamo il protocollo giusto, non che Dropbox risponda come crediamo.
// Uso: node test/dropbox.test.js          (dalla cartella editor)
globalThis.window = globalThis;
require('../src/pulze-dropbox.js');
const D = window.PulzeDropbox;

let ok = 0, ko = 0;
function prova(nome, cond, dettaglio) {
  if (cond) ok++; else { ko++; console.log('NO  ' + nome + (dettaglio ? ' — ' + dettaglio : '')); }
}

/** Un Dropbox finto: file in memoria, token, refresh, revoca. */
function finto() {
  const file = new Map(), chiamate = [];
  let token = 0, revocato = false;
  const risposta = (stato, corpo) => new Response(typeof corpo === 'string' || corpo instanceof ArrayBuffer ? corpo : JSON.stringify(corpo), { status: stato });
  const fetch = async (url, o) => {
    chiamate.push({ url, o });
    const auth = o.headers && o.headers.Authorization;
    if (url.endsWith('/oauth2/token')) {
      const q = new URLSearchParams(o.body);
      if (q.get('grant_type') === 'authorization_code') {
        if (q.get('code') !== 'CODICE' || !q.get('code_verifier')) return risposta(400, { error: 'invalid_grant', error_description: 'code doesn\'t exist or has expired' });
        return risposta(200, { access_token: 'T' + (++token), expires_in: 14400, refresh_token: 'R1' });
      }
      if (q.get('grant_type') === 'refresh_token') {
        if (revocato || q.get('refresh_token') !== 'R1') return risposta(400, { error: 'invalid_grant' });
        return risposta(200, { access_token: 'T' + (++token), expires_in: 14400 });
      }
    }
    // la revoca spegne anche i token di accesso, come quella vera
    if (!auth || !/^Bearer T\d+$/.test(auth) || (revocato && !url.endsWith('/auth/token/revoke'))) return risposta(401, { error: 'invalid_access_token' });
    if (url.endsWith('/auth/token/revoke')) { revocato = true; return risposta(200, 'null'); }
    if (url.endsWith('/files/upload')) {
      const a = JSON.parse(o.headers['Dropbox-API-Arg']);
      let p = a.path, k = 1;
      while (file.has(p) && a.autorename) p = a.path.replace(/(\.zip)$/, ' (' + k++ + ')$1');
      file.set(p, { dati: new Uint8Array(await o.body.arrayBuffer()), quando: new Date(Date.now() + file.size * 1000).toISOString() });
      return risposta(200, { name: p.split('/').pop(), path_display: p, size: file.get(p).dati.length });
    }
    if (url.endsWith('/files/download')) {
      const f = file.get(JSON.parse(o.headers['Dropbox-API-Arg']).path);
      return f ? risposta(200, f.dati.buffer.slice(0)) : risposta(409, { error_summary: 'path/not_found/' });
    }
    if (url.endsWith('/files/list_folder')) {
      const cart = JSON.parse(o.body).path;
      const voci = [...file].filter(([p]) => p.startsWith(cart + '/'))
        .map(([p, f]) => ({ '.tag': 'file', name: p.split('/').pop(), server_modified: f.quando, size: f.dati.length }));
      if (!voci.length) return risposta(409, { error_summary: 'path/not_found/..' });
      voci.push({ '.tag': 'folder', name: 'altro' });
      return risposta(200, { entries: voci.slice(0, 2), has_more: voci.length > 2, cursor: 'C2' });
    }
    if (url.endsWith('/files/list_folder/continue')) {
      const voci = [...file].map(([p, f]) => ({ '.tag': 'file', name: p.split('/').pop(), server_modified: f.quando, size: f.dati.length }));
      voci.push({ '.tag': 'file', name: 'appunti.txt', server_modified: '2000-01-01T00:00:00Z', size: 3 });
      return risposta(200, { entries: voci.slice(2), has_more: false });
    }
    return risposta(404, 'boh');
  };
  return { fetch, file, chiamate };
}

(async () => {
  // l'indirizzo per autorizzare: PKCE S256, offline, nessun redirect
  const v = D.nuovoVerifier();
  prova('verifier lungo e base64url', /^[A-Za-z0-9_-]{43}$/.test(v), v);
  const u = new URL(D.urlAutorizza('CHIAVE', await D.sfida(v)));
  prova('url: client_id', u.searchParams.get('client_id') === 'CHIAVE');
  prova('url: S256 e offline', u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('token_access_type') === 'offline');
  prova('url: niente redirect', !u.searchParams.has('redirect_uri'));
  prova('url: sfida diversa dal verifier', u.searchParams.get('code_challenge') !== v);
  prova('sfida sempre uguale per lo stesso verifier', await D.sfida(v) === await D.sfida(v));
  prova('arg: accenti in ASCII', /^[\x00-\x7f]*$/.test(D.arg({ path: '/Pulze Mini/però.zip' })) && JSON.parse(D.arg({ path: 'però' })).path === 'però');

  const f = finto();
  let salvato = 'nessuno';
  const c = new D.Client({ appKey: 'CHIAVE', fetch: f.fetch, salvaRefresh: x => { salvato = x; } });
  prova('all\'inizio non collegato', !c.autorizzato());
  let errore = '';
  try { await c.completaAutorizzazione(v, 'SBAGLIATO'); } catch (e) { errore = e.message; }
  prova('codice sbagliato: errore', errore !== '' && !c.autorizzato(), errore);
  await c.completaAutorizzazione(v, '  CODICE \n');
  prova('codice giusto: collegato, refresh salvato', c.autorizzato() && salvato === 'R1');

  prova('elenco vuoto senza cartella', (await c.elenco()).length === 0);
  const zip = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 250]);
  const r1 = await c.carica('Pulze Mini backup 2026-11-08 21-00-00.zip', zip);
  prova('carica: nome tornato', r1.name === 'Pulze Mini backup 2026-11-08 21-00-00.zip', r1.name);
  const su = f.chiamate.find(x => x.url.endsWith('/files/upload'));
  const a = JSON.parse(su.o.headers['Dropbox-API-Arg']);
  prova('carica: nella cartella Pulze Mini, senza sovrascrivere', a.path === '/Pulze Mini/Pulze Mini backup 2026-11-08 21-00-00.zip' && a.mode === 'add' && a.autorename === true);
  const r2 = await c.carica('Pulze Mini backup 2026-11-08 21-00-00.zip', zip);
  prova('stesso nome: non cancella il primo', r2.name !== r1.name && f.file.size === 2, r2.name);
  await c.carica('Pulze Mini backup 2026-11-09 08-00-00.zip', new Uint8Array([9]));
  const el = await c.elenco();
  prova('elenco: solo gli .zip, anche dopo «continue»', el.length === 3 && el.every(x => /\.zip$/.test(x.nome)), JSON.stringify(el));
  prova('elenco: il più nuovo in cima', el[0].nome === 'Pulze Mini backup 2026-11-09 08-00-00.zip', el[0] && el[0].nome);
  const giu = new Uint8Array(await c.scarica(r1.name));
  prova('scarica: gli stessi byte', giu.length === zip.length && giu.every((b, i) => b === zip[i]));
  errore = '';
  try { await c.scarica('non-ce.zip'); } catch (e) { errore = e.message; }
  prova('scarica di un file che non c\'è: errore chiaro', /nessun backup/.test(errore), errore);

  // un token scaduto si rifà da sé col refresh
  const prima = f.chiamate.filter(x => x.url.endsWith('/oauth2/token')).length;
  c.scadeA = Date.now() + 1000;
  await c.elenco();
  prova('token in scadenza: rinnovato', f.chiamate.filter(x => x.url.endsWith('/oauth2/token')).length === prima + 1);

  // un client nuovo col solo refresh salvato (pagina riaperta) funziona
  const c2 = new D.Client({ appKey: 'CHIAVE', refreshToken: salvato, fetch: f.fetch });
  prova('pagina riaperta: legge l\'elenco', (await c2.elenco()).length === 3);

  prova('scollega: revocato', await c.scollega() === true && !c.autorizzato() && salvato === null);
  errore = '';
  try { await c2.elenco(); } catch (e) { errore = e.message; }
  prova('dopo la revoca: dice di ricollegare', /ricollega/.test(errore), errore);

  console.log(ok + ' ok, ' + ko + ' no');
  process.exit(ko ? 1 : 0);
})();
