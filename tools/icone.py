"""icone.py - Le icone dell'app installabile (icons/), dal disegno a sinistra del logo (img/logo.png):
la paletta della chitarra, chiaro su un quadrato ardesia. Uso: python tools/icone.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

radice = Path(__file__).resolve().parent.parent
logo = Image.open(radice / 'img' / 'logo.png').convert('RGBA')
# il disegno sta nei primi ~640 px del logo (poi c'è la scritta MAZZRIG)
segno = logo.crop((0, 0, 640, logo.height))
segno = segno.crop(segno.getbbox())
ARDESIA = (42, 49, 60, 255)      # --panel dell'editor
BLU = (47, 127, 232, 255)        # --accent

def icona(lato, occupa, angoli):
    img = Image.new('RGBA', (lato, lato), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(lato * angoli)
    d.rounded_rectangle((0, 0, lato - 1, lato - 1), radius=r, fill=ARDESIA)
    # una riga blu in basso, come le selezioni dell'editor
    h = max(2, lato // 40)
    d.rounded_rectangle((int(lato * 0.3), int(lato * 0.8), int(lato * 0.7), int(lato * 0.8) + h), radius=h // 2, fill=BLU)
    w = int(lato * occupa)
    s = segno.resize((w, int(w * segno.height / segno.width)), Image.LANCZOS)
    img.alpha_composite(s, ((lato - s.width) // 2, int(lato * 0.45 - s.height / 2)))
    return img

cartella = radice / 'icons'
cartella.mkdir(exist_ok=True)
icona(192, 0.74, 0.18).save(cartella / 'icon-192.png')
icona(512, 0.74, 0.18).save(cartella / 'icon-512.png')
# mascherabile: lo sfondo arriva ai bordi, il disegno sta nel cerchio sicuro (80%)
icona(512, 0.58, 0).save(cartella / 'icon-maskable-512.png')
icona(32, 0.86, 0.18).save(cartella / 'favicon-32.png')
icona(180, 0.7, 0).save(cartella / 'apple-touch-icon.png')
print('icone in', cartella)
