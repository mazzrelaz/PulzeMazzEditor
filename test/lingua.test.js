// lingua.test.js - Ogni testo delle Novità e del Benvenuto ha la sua traduzione inglese in pulze-lingua.js.
// Gira anche dal pre-commit (tools/pre-commit): senza traduzione il commit si ferma.
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

const lingua = src('pulze-lingua.js');
// le coppie ['italiano', 'inglese'] del dizionario: le prime stringhe di ogni coppia
const chiavi = new Set();
const leggiStr = (s, i) => {          // stringa JS fra apici singoli dalla posizione i (che è l'apice)
  let o = '';
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { o += s[j + 1]; j++; continue; }
    if (s[j] === "'") return [o, j + 1];
    o += s[j];
  }
  return [o, s.length];
};
for (let i = 0; i < lingua.length; i++) {
  if (lingua[i] === '[' && lingua[i + 1] === "'") {
    const [it, fine] = leggiStr(lingua, i + 1);
    if (/^\s*,\s*'/.test(lingua.slice(fine, fine + 40))) chiavi.add(it);
  }
}

let fallite = 0, passate = 0;
const controlla = (dove, testo) => {
  if (chiavi.has(testo)) { passate++; return; }
  fallite++;
  console.log('NO  manca l\'inglese (' + dove + '): «' + testo + '»');
};

// Novità: titolo e testo di ogni voce
const novita = src('pulze-novita.js');
for (const m of novita.matchAll(/(titolo|testo):\s*'((?:\\.|[^'\\])*)'/g)) controlla('Novità', m[2].replace(/\\(.)/g, '$1'));

// Benvenuto: i testi chiusi fra un tag che si apre e uno che si chiude nella stessa stringa (<h2>…</h2>, <span>…</span>)
const benv = src('pulze-benvenuto.js');
for (const m of benv.matchAll(/'((?:\\.|[^'\\])*)'/g)) {
  const s = m[1].replace(/\\(.)/g, '$1');
  for (const x of s.matchAll(/<(h2|strong|span|p|button)[^>]*>([^<]{4,})<\/\1>/g)) {
    const t = x[2].replace(/^[^\wÀ-ú«]+/, '').trim();
    if (/[a-zà-ú]{3}/i.test(t)) controlla('Benvenuto', t.startsWith('⚠') ? x[2].trim() : x[2].trim());
  }
}

console.log(passate + ' prove passate, ' + fallite + ' fallite');
process.exitCode = fallite ? 1 : 0;
