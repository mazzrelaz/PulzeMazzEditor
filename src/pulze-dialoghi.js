// pulze-dialoghi.js - Le domande e gli avvisi nello stile di MazzRig, al posto di confirm(), prompt() e alert()
// del browser. Tutte rispondono con una Promise: conferma → true/false, chiedi → testo o null, avvisa → niente.
// Il testo finisce nella pagina, così pulze-lingua lo traduce come tutto il resto.
(function () {
  'use strict';

  // La stessa domanda già aperta (es. clic + doppio clic sullo stesso tone) non se ne apre un'altra:
  // la risposta vale per chi l'ha aperta, i doppioni ricevono «no» così l'azione parte una volta sola.
  const aperte = new Map();

  function apri(messaggio, opzioni = {}) {
    const chiave = JSON.stringify([String(messaggio), opzioni]);
    if (aperte.has(chiave)) return aperte.get(chiave).then(() => (opzioni.campo ? null : false));
    const p = crea(messaggio, opzioni).finally(() => aperte.delete(chiave));
    aperte.set(chiave, p);
    return p;
  }

  function crea(messaggio, { campo = false, valore = '', annulla = true, si = 'OK' } = {}) {
    return new Promise(risolvi => {
      const d = document.createElement('dialog');
      d.className = 'domanda';
      const p = document.createElement('p');
      p.className = 'domanda-testo';
      p.textContent = String(messaggio);
      d.appendChild(p);
      let input = null;
      if (campo) {
        input = document.createElement('input');
        input.className = 'domanda-campo';
        input.autocomplete = 'off';
        input.value = valore == null ? '' : String(valore);
        d.appendChild(input);
      }
      const azioni = document.createElement('div');
      azioni.className = 'azioni';
      let no = null;
      if (annulla) {
        no = document.createElement('button');
        no.type = 'button';
        no.textContent = 'Annulla';
        azioni.appendChild(no);
      }
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'primario';
      ok.textContent = si;
      azioni.appendChild(ok);
      d.appendChild(azioni);

      let fatto = false;
      const chiudi = esito => {
        if (fatto) return;
        fatto = true;
        d.close();
        // gli avvisi della pagina (#avvisi) si spostano dentro la finestra aperta: vanno rimessi fuori,
        // se no spariscono con lei
        for (const figlio of [...d.children]) if (figlio.id) document.body.appendChild(figlio);
        d.remove();
        risolvi(esito);
      };
      const sì = () => chiudi(campo ? input.value : true);
      const rinuncia = () => chiudi(campo ? null : (annulla ? false : undefined));
      ok.addEventListener('click', sì);
      if (no) no.addEventListener('click', rinuncia);
      d.addEventListener('cancel', e => { e.preventDefault(); rinuncia(); });
      if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sì(); } });

      document.body.appendChild(d);
      d.showModal();
      if (input) { input.focus(); input.select(); } else ok.focus();
    });
  }

  window.PulzeDialoghi = {
    conferma: m => apri(m, { si: 'Sì' }),
    chiedi: (m, valore) => apri(m, { campo: true, valore }),
    avvisa: m => apri(m, { annulla: false })
  };
})();
