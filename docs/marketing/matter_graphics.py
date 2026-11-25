# -*- coding: utf-8 -*-
"""Grafiken „Ambientika SMART mit Matter" (Matterbridge-Plugin) für die Produktseiten SMART und OFFICE,
im selben Look wie die Home-Assistant- und Homey-Grafiken. Keine Fremdlogos: Namen nur als Text.
- matter-hero-<prod>-<lg>.jpg  1600x700  (prod = smart | office)
- matter-schritte-<lg>.png     1600x560
Aufruf: python3 matter_graphics.py <ausgabeordner>"""
import sys, os
from PIL import Image, ImageDraw
import homey_graphics as G
from homey_graphics import P, ft, tl, BG, PANEL, PANEL2, LINE, TEAL, ORG, PUR, WHITE, MUT, GREEN, S

LANGS = G.LANGS
MIT = {"de": "mit", "en": "with", "it": "con", "fr": "avec", "es": "con", "nl": "met", "pl": "z", "pt": "com", "cs": "s", "da": "med", "sv": "med"}
SUB = {
    "de": "Mit dem kostenlosen Ambientika-Plugin für Matterbridge erscheint jedes Gerät als Matter-Lüfter mit Temperatur, Feuchte und Luftqualität.",
    "en": "With the free Ambientika plugin for Matterbridge, every unit appears as a Matter fan with temperature, humidity and air quality.",
    "it": "Con il plugin gratuito Ambientika per Matterbridge, ogni unità compare come ventilatore Matter con temperatura, umidità e qualità dell'aria.",
    "fr": "Avec le plugin gratuit Ambientika pour Matterbridge, chaque unité apparaît comme ventilateur Matter avec température, humidité et qualité de l'air.",
    "es": "Con el plugin gratuito de Ambientika para Matterbridge, cada unidad aparece como ventilador Matter con temperatura, humedad y calidad del aire.",
    "nl": "Met de gratis Ambientika-plugin voor Matterbridge verschijnt elke unit als Matter-ventilator met temperatuur, vochtigheid en luchtkwaliteit.",
    "pl": "Dzięki bezpłatnej wtyczce Ambientika dla Matterbridge każde urządzenie pojawia się jako wentylator Matter z temperaturą, wilgotnością i jakością powietrza.",
    "pt": "Com o plugin gratuito Ambientika para Matterbridge, cada unidade aparece como ventilador Matter com temperatura, humidade e qualidade do ar.",
    "cs": "S bezplatným pluginem Ambientika pro Matterbridge se každá jednotka zobrazí jako ventilátor Matter s teplotou, vlhkostí a kvalitou vzduchu.",
    "da": "Med det gratis Ambientika-plugin til Matterbridge vises hver enhed som en Matter-ventilator med temperatur, fugt og luftkvalitet.",
    "sv": "Med det kostnadsfria Ambientika-pluginet för Matterbridge visas varje aggregat som en Matter-fläkt med temperatur, fukt och luftkvalitet.",
}
OPEN = {"de": "Open Source", "en": "open source", "it": "open source", "fr": "open source", "es": "código abierto", "nl": "open source", "pl": "open source", "pt": "open source", "cs": "open source", "da": "open source", "sv": "öppen källkod"}
STEPS = {
    "de": [("Matterbridge starten", "Auf Raspberry Pi, NAS oder als Home-Assistant-Add-on"), ("Plugin installieren", "„matterbridge-ambientika“, Anmeldung wie in der Ambientika App"), ("QR-Code scannen", "In Ihrer Matter-App, die Geräte erscheinen von selbst")],
    "en": [("Start Matterbridge", "On a Raspberry Pi, a NAS or as a Home Assistant add-on"), ("Install the plugin", "“matterbridge-ambientika”, sign in as in the Ambientika app"), ("Scan the QR code", "In your Matter app, the units appear by themselves")],
    "it": [("Avvia Matterbridge", "Su Raspberry Pi, NAS o come add-on di Home Assistant"), ("Installa il plugin", "“matterbridge-ambientika”, accesso come nell'app Ambientika"), ("Scansiona il codice QR", "Nella tua app Matter, le unità compaiono da sole")],
    "fr": [("Démarrer Matterbridge", "Sur Raspberry Pi, NAS ou comme module Home Assistant"), ("Installer le plugin", "« matterbridge-ambientika », connexion comme dans l'app Ambientika"), ("Scanner le code QR", "Dans votre app Matter, les unités apparaissent d'elles-mêmes")],
    "es": [("Iniciar Matterbridge", "En Raspberry Pi, NAS o como complemento de Home Assistant"), ("Instalar el plugin", "«matterbridge-ambientika», acceso como en la app Ambientika"), ("Escanear el código QR", "En su app Matter, las unidades aparecen solas")],
    "nl": [("Matterbridge starten", "Op een Raspberry Pi, NAS of als Home Assistant-add-on"), ("Plugin installeren", "‘matterbridge-ambientika’, aanmelden zoals in de Ambientika-app"), ("QR-code scannen", "In uw Matter-app, de units verschijnen vanzelf")],
    "pl": [("Uruchom Matterbridge", "Na Raspberry Pi, NAS lub jako dodatek Home Assistant"), ("Zainstaluj wtyczkę", "„matterbridge-ambientika”, logowanie jak w aplikacji Ambientika"), ("Zeskanuj kod QR", "W aplikacji Matter, urządzenia pojawią się same")],
    "pt": [("Iniciar o Matterbridge", "Num Raspberry Pi, NAS ou como add-on do Home Assistant"), ("Instalar o plugin", "“matterbridge-ambientika”, acesso como na app Ambientika"), ("Ler o código QR", "Na sua app Matter, as unidades aparecem sozinhas")],
    "cs": [("Spustit Matterbridge", "Na Raspberry Pi, NAS nebo jako doplněk Home Assistant"), ("Nainstalovat plugin", "„matterbridge-ambientika“, přihlášení jako v aplikaci Ambientika"), ("Naskenovat QR kód", "Ve vaší aplikaci Matter, jednotky se objeví samy")],
    "da": [("Start Matterbridge", "På Raspberry Pi, NAS eller som Home Assistant-tilføjelse"), ("Installer pluginet", "“matterbridge-ambientika”, log ind som i Ambientika-appen"), ("Scan QR-koden", "I din Matter-app, enhederne dukker op af sig selv")],
    "sv": [("Starta Matterbridge", "På Raspberry Pi, NAS eller som Home Assistant-tillägg"), ("Installera pluginet", "”matterbridge-ambientika”, logga in som i Ambientika-appen"), ("Skanna QR-koden", "I din Matter-app, aggregaten dyker upp av sig själva")],
}
CONTROLLERS = ["Apple Home", "Google Home", "Alexa", "SmartThings", "Homey"]
problems = G.problems


def star(d, cx, cy, r, col, w=5):
    """Neutrales Symbol: drei gekreuzte Linien (kein Matter-Logo)."""
    import math
    for a in (90, 210, 330):
        d.line(P(cx, cy, cx + math.cos(math.radians(a)) * r, cy - math.sin(math.radians(a)) * r), fill=col, width=int(w * S))
    d.ellipse(P(cx - w, cy - w, cx + w, cy + w), fill=col)


def bridge_box(img, x, y, w=150, h=110):
    d = ImageDraw.Draw(img)
    G.glow(img, (x + w / 2, y + h / 2), 90, TEAL, 60); d = ImageDraw.Draw(img)
    d.rounded_rectangle(P(x, y, x + w, y + h), radius=int(18 * S), fill=(40, 44, 50), outline=(70, 75, 82), width=int(3 * S))
    for i in range(3): d.ellipse(P(x + 22 + i * 20, y + 20, x + 32 + i * 20, y + 30), fill=GREEN if i == 0 else LINE)
    f = ft("sb", 17); t = "Matterbridge"; d.text(P(x + w / 2 - tl(d, t, f) / 2, y + 56), t, font=f, fill=WHITE)


def matter_card(img, x, y, w, h):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(P(x, y, x + w, y + h), radius=int(26 * S), fill=PANEL2, outline=LINE, width=int(2 * S))
    star(d, x + 52, y + 56, 20, TEAL); d.text(P(x + 88, y + 34), "Matter", font=ft("b", 30), fill=WHITE)
    d.line(P(x + 28, y + 100, x + w - 28, y + 100), fill=LINE, width=int(2 * S))
    f = ft("sb", 22); yy = y + 122
    for i, name in enumerate(CONTROLLERS):
        d.rounded_rectangle(P(x + 28, yy, x + w - 28, yy + 44), radius=int(12 * S), fill=PANEL, outline=LINE, width=int(2 * S))
        d.ellipse(P(x + 44, yy + 15, x + 58, yy + 29), fill=[TEAL, PUR, ORG, GREEN, G.BLUE][i])
        d.text(P(x + 72, yy + 8), name, font=f, fill=WHITE); yy += 54


def hero(prod, l, out, w=1600, h=700):
    img = Image.new("RGBA", P(w, h), BG + (255,)); G.glow(img, (1180, 330), 360, TEAL, 34); G.glow(img, (300, 650), 260, PUR, 22)
    d = ImageDraw.Draw(img)
    G.chip(d, 70, 64, "Matter · Matterbridge · Wi-Fi", fg=TEAL, size=22)
    title = f"{G.PNAME[prod]} {MIT[l]} Matter"
    f1 = G.fitfont(d, title, "xb", 58, 600, 34); d.text(P(70, 140), title, font=f1, fill=WHITE)
    y = 140 + f1.size / S + 26; fs = ft("r", 27)
    sl = G.wrap(d, SUB[l], fs, 590)
    if len(sl) > 4: problems.append(f"matter hero {l}: Subline {len(sl)} Zeilen")
    for line in sl[:4]: d.text(P(70, y), line, font=fs, fill=MUT); y += 40
    y += 24
    x = G.chip(d, 70, y, {"it": "gratuito", "fr": "gratuit"}.get(l, G.FREE[l]), fg=BG, bg=TEAL, size=24) + 14
    G.chip(d, x, y, OPEN[l], fg=WHITE, size=24)
    if y + 50 > 580: problems.append(f"matter hero {l}: Chips bei y={y:.0f}")
    G.logo_pill(img, 70, 590, 240)
    G.photo_tile(img, prod, 700, 195, 250, r=30)
    d = ImageDraw.Draw(img); f = ft("sb", 24); t = G.PNAME[prod]; d.text(P(825 - tl(d, t, f) / 2, 468), t, font=f, fill=WHITE)
    G.wifi(d, 992, 330, TEAL, .55)
    bridge_box(img, 1030, 265)
    d = ImageDraw.Draw(img)
    d.line(P(1180, 320, 1226, 320), fill=TEAL, width=int(5 * S)); d.polygon([P(1226, 308), P(1244, 320), P(1226, 332)], fill=TEAL)
    matter_card(img, 1256, 130, 314, 410)
    return G.finish(img, out, jpg=True)


def ic_bridge(img, cx, cy):
    bridge_box(img, cx - 75, cy - 70)


def ic_plugin(img, cx, cy):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(P(cx - 130, cy - 112, cx + 130, cy - 62), radius=int(12 * S), fill=PANEL2, outline=TEAL, width=int(3 * S))
    f = ft("m", 19); t = "matterbridge-ambientika"; d.text(P(cx - tl(d, t, f) / 2, cy - 99), t, font=f, fill=WHITE)
    G.ic_login(img, cx, cy + 16)


def ic_qr(img, cx, cy):
    d = ImageDraw.Draw(img); s = 150; x0, y0 = cx - s / 2, cy - s / 2 + 4
    d.rounded_rectangle(P(x0 - 14, y0 - 14, x0 + s + 14, y0 + s + 14), radius=int(16 * S), fill=WHITE)
    import random
    rnd = random.Random(7); n = 9; c = s / n
    for i in range(n):
        for j in range(n):
            corner = (i < 3 and j < 3) or (i < 3 and j >= n - 3) or (i >= n - 3 and j < 3)
            if corner: continue
            if rnd.random() < 0.5: d.rectangle(P(x0 + j * c, y0 + i * c, x0 + (j + 1) * c - 1, y0 + (i + 1) * c - 1), fill=BG)
    for (i, j) in ((0, 0), (0, n - 3), (n - 3, 0)):
        d.rectangle(P(x0 + j * c, y0 + i * c, x0 + (j + 3) * c - 1, y0 + (i + 3) * c - 1), fill=BG)
        d.rectangle(P(x0 + (j + .6) * c, y0 + (i + .6) * c, x0 + (j + 2.4) * c - 1, y0 + (i + 2.4) * c - 1), fill=WHITE)
        d.rectangle(P(x0 + (j + 1) * c, y0 + (i + 1) * c, x0 + (j + 2) * c - 1, y0 + (i + 2) * c - 1), fill=TEAL)


def schritte(l, out, w=1600, h=560):
    img = Image.new("RGBA", P(w, h), BG + (255,)); d = ImageDraw.Draw(img); cw, gap, x = 460, 70, 40
    for i, (title, sub) in enumerate(STEPS[l]):
        cx0 = x + i * (cw + gap); d.rounded_rectangle(P(cx0, 40, cx0 + cw, 520), radius=int(26 * S), fill=PANEL)
        d.ellipse(P(cx0 + 30, 66, cx0 + 82, 118), fill=TEAL); fn = ft("b", 28); n = str(i + 1); d.text(P(cx0 + 56 - tl(d, n, fn) / 2, 74), n, font=fn, fill=BG)
        [ic_bridge, ic_plugin, ic_qr][i](img, cx0 + cw / 2, 205); d = ImageDraw.Draw(img)
        ftit = G.fitfont(d, title, "b", 36, cw - 60, 26); d.text(P(cx0 + cw / 2 - tl(d, title, ftit) / 2, 335), title, font=ftit, fill=WHITE)
        sub = sub.replace("Raspberry Pi", "Raspberry Pi").replace("Home Assistant", "Home Assistant")
        fs = ft("r", 25); lines = G.wrap(d, sub, fs, cw - 50)
        if len(lines) > 3: problems.append(f"matter {l}: Schritt {i+1} {len(lines)} Zeilen")
        y = 392
        for line in lines[:3]: d.text(P(cx0 + cw / 2 - tl(d, line, fs) / 2, y), line, font=fs, fill=MUT); y += 35
        if i < 2: ax = cx0 + cw + gap / 2; d.polygon([P(ax - 14, 260), P(ax + 16, 280), P(ax - 14, 300)], fill=TEAL)
    return G.finish(img, out)


if __name__ == "__main__":
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    del problems[:]
    for l in LANGS:
        for prod in ("smart", "office"): hero(prod, l, f"{out}/matter-hero-{prod}-{l}.jpg")
        schritte(l, f"{out}/matter-schritte-{l}.png")
    print("Probleme:", problems or "keine")
