"""prepara-immagini.py - Le immagini dei modelli per la pagina.

Prende le PNG grandi di Desktop\\Immagini pulze (fatte con «Immagini Pulze.html», una sottocartella per
tipo, ognuna col suo modelli.json: nome del modello -> file) e ne fa copie WebP piccole in
editor/img/modelli/<sottocartella>/, più src/pulze-immagini.js (nome del modello -> percorso).

    python tools/prepara-immagini.py            (dalla cartella editor)
"""
import json
import os
import sys
from PIL import Image

SORGENTE = os.path.join(os.path.expanduser('~'), 'Desktop', 'Immagini pulze')
QUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(QUI, 'img', 'modelli')
LATO = 640          # il lato lungo: basta per il palco anche su schermi fitti
QUALITA = 85

# Ogni sottocartella ha lo stesso modelli.json (tutti i modelli): il file sta in una sola di esse.
nomi = {}
cartelle = [c for c in sorted(os.listdir(SORGENTE)) if os.path.isdir(os.path.join(SORGENTE, c))]
for cartella in cartelle:
    elenco = os.path.join(SORGENTE, cartella, 'modelli.json')
    if os.path.isfile(elenco):
        nomi.update(json.load(open(elenco, encoding='utf-8')))

mappa = {}
fatti = 0
for nome, file in nomi.items():
    cartella = next((c for c in cartelle if os.path.isfile(os.path.join(SORGENTE, c, file))), None)
    if not cartella:
        print('manca', file, 'per', nome, file=sys.stderr)
        continue
    png = os.path.join(SORGENTE, cartella, file)
    sotto = cartella.lower()
    os.makedirs(os.path.join(DEST, sotto), exist_ok=True)
    webp = os.path.splitext(file)[0] + '.webp'
    uscita = os.path.join(DEST, sotto, webp)
    if not os.path.exists(uscita) or os.path.getmtime(uscita) < os.path.getmtime(png):
        im = Image.open(png).convert('RGBA')
        im = im.crop(im.getbbox() or (0, 0) + im.size)     # via il bordo trasparente
        im.thumbnail((LATO, LATO), Image.LANCZOS)
        im.save(uscita, 'WEBP', quality=QUALITA, method=6)
        fatti += 1
    mappa[nome] = 'img/modelli/' + sotto + '/' + webp

with open(os.path.join(QUI, 'src', 'pulze-immagini.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('// pulze-immagini.js - GENERATO da tools/prepara-immagini.py: non si modifica a mano.\n')
    f.write('// Nome del modello -> immagine (Desktop\\\\Immagini pulze, rimpicciolite).\n')
    f.write('window.PulzeImmagini = ' + json.dumps(mappa, ensure_ascii=False, indent=0, sort_keys=True) + ';\n')

print(len(mappa), 'modelli,', fatti, 'immagini rifatte')
