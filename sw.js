/**
 * sw.js - Il service worker: rende l'editor installabile come app e lo fa partire anche senza internet.
 * Come quello dello Spark: si risponde dalla cache quando c'Ã¨, e la rete la rinfresca in sottofondo per la
 * volta dopo (stale-while-revalidate). Gira solo sul sito pubblicato (https), non da localhost: lÃ¬ si lavora
 * sul codice e una cache in mezzo darebbe file vecchi (lo decide src/pulze-pwa.js).
 *
 * VERSIONE va alzata a ogni pubblicazione: fa ripartire l'installazione, butta le cache vecchie e fa
 * comparire nella pagina Â«C'Ã¨ una versione nuovaÂ». Anche dimenticandosene, la rete rinfresca i file
 * comunque: solo un caricamento piÃ¹ tardi.
 */
'use strict';

const VERSIONE = 'v8';
const CACHE = 'pulzemazz-' + VERSIONE;

// l'elenco delle immagini dei modelli (window.PulzeImmagini): va caricato qui in cima, Chrome non lo
// permette piÃ¹ tardi
self.window = self;
try { importScripts('./src/pulze-immagini.js'); } catch (e) { /* senza: le immagini si prendono quando servono */ }

/** Quello che serve per far partire l'editor da spento, senza rete. Un solo file mancante fa fallire
 *  tutta l'installazione: qui solo file che esistono. */
const GUSCIO = [
  './',
  './index.html',
  './guida.html',
  './guida.en.html',
  './manifest.webmanifest',
  './src/pulze-lingua.js',
  './src/pulze-protocollo.js',
  './src/pulze-catalogo.js',
  './src/pulze-immagini.js',
  './src/pulze-prst.js',
  './src/pulze-ricetta.js',
  './src/pulze-ble.js',
  './src/pulze-dropbox.js',
  './src/pulze-pwa.js',
  './src/app.js',
  './src/pulze-live.js',
  './src/pulze-novita.js',
  './src/pulze-benvenuto.js',
  './fonts/inter-latin.woff2',
  './fonts/space-grotesk-latin.woff2',
  './img/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' scavalca la cache HTTP: senza, si rischia di mettere nella cache nuova i file vecchi
    await cache.addAll(GUSCIO.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi.filter(n => n.startsWith('pulzemazz-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

/** Le immagini dei modelli (174, ~9 MB), per averle anche senza internet: una per una, in sottofondo,
 *  quando la pagina lo chiede (a ogni apertura riprende da dove era rimasta). Non qui nell'activate:
 *  finchÃ© l'activate non finisce, la pagina aspetterebbe. */
async function precaricaImmagini() {
  const cache = await caches.open(CACHE);
  for (const src of new Set(Object.values(self.PulzeImmagini || {}))) {
    const url = new URL(src, self.registration.scope).href;
    if (await cache.match(url)) continue;
    try { const r = await fetch(url); if (r.ok) await cache.put(url, r); } catch (e) { return; /* offline: la prossima volta */ }
  }
}

self.addEventListener('fetch', event => {
  const richiesta = event.request;
  if (richiesta.method !== 'GET') return;
  const url = new URL(richiesta.url);
  // OpenAI, Anthropic, Dropbox e il caffÃ¨ passano dritti: qui solo i file dell'editor
  if (url.origin !== self.location.origin) return;
  event.respondWith(rispondi(event));
});

/** La copia in cache subito, la rete la aggiorna per la volta dopo; senza copia si aspetta la rete; senza
 *  rete nÃ© copia, la pagina principale (cosÃ¬ l'app aperta offline non finisce sul dinosauro). */
async function rispondi(event) {
  const richiesta = event.request;
  const cache = await caches.open(CACHE);
  // l'ancora (#finto, #esempio) non fa parte del file: senza toglierla sarebbero voci diverse della cache
  const url = new URL(richiesta.url);
  const chiave = url.origin + url.pathname + url.search;
  const salvata = await cache.match(chiave);
  const dallaRete = fetch(richiesta).then(r => {
    // le risposte fallite non entrano: sostituirebbero un file buono con un errore
    if (r && r.ok && r.type === 'basic') cache.put(chiave, r.clone());
    return r;
  }).catch(() => null);
  if (salvata) { event.waitUntil(dallaRete); return salvata; }
  const r = await dallaRete;
  if (r) return r;
  if (richiesta.mode === 'navigate') {
    const casa = await cache.match(new URL('./index.html', self.registration.scope).href);
    if (casa) return casa;
  }
  return new Response('Non disponibile senza internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// l'aggiornamento parte solo quando chi usa l'editor lo accetta: ricaricare da solo scollegherebbe il Mini
self.addEventListener('message', event => {
  if (event.data === 'aggiorna') self.skipWaiting();
  if (event.data === 'immagini') event.waitUntil(precaricaImmagini());
});
