# -*- coding: utf-8 -*-
"""Grafiken „Ambientika SMART in Homey" für die Produktseiten SMART (SW10035) und OFFICE,
im selben Look wie die Home-Assistant-Grafiken (dunkles Navy, Türkis, Inter, echtes Logo).
Keine Fremdlogos: „Homey" nur als neutraler Text.
- homey-hero-<prod>-<lg>.jpg  1600x700  (prod = smart | office)
- homey-schritte-<lg>.png     1600x560
Aufruf: python3 homey_graphics.py <ausgabeordner>"""
import sys, os, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
F = "/usr/share/fonts/opentype/inter/"
S = 2
BG = (10, 14, 26); PANEL = (18, 24, 41); PANEL2 = (28, 39, 64); LINE = (44, 58, 85)
TEAL = (63, 224, 208); ORG = (255, 138, 76); PUR = (157, 140, 255); WHITE = (232, 246, 255); MUT = (174, 191, 208)
GREEN = (46, 214, 115); BLUE = (77, 150, 255)
PHOTO = {"smart": os.path.join(HERE, "assets", "smart.jpg"), "office": os.path.join(HERE, "assets", "office.jpg")}
PNAME = {"smart": "SMART", "office": "OFFICE"}
LOGO = os.path.join(HERE, "assets", "logo.svg.png")
problems = []


def ft(w, size): return ImageFont.truetype(F + {"r": "Inter-Regular.otf", "m": "Inter-Medium.otf", "sb": "Inter-SemiBold.otf", "b": "Inter-Bold.otf", "xb": "Inter-ExtraBold.otf"}[w], int(size * S))
def P(*a): return tuple(int(v * S) for v in a)
def tl(d, t, f): return d.textlength(t, font=f) / S


def fitfont(d, text, w, size, maxw, minsize):
    s = size
    while s > minsize and tl(d, text, ft(w, s)) > maxw: s -= 1
    if tl(d, text, ft(w, s)) > maxw: problems.append(f"zu lang: {text}")
    return ft(w, s)


def wrap(d, text, font, maxw):
    lines, cur = [], ""
    for w_ in text.split(" "):
        t = (cur + " " + w_).strip()
        if tl(d, t, font) <= maxw: cur = t
        else: lines.append(cur); cur = w_
    return lines + ([cur] if cur else [])


def glow(img, xy, r, color, alpha):
    g = Image.new("RGBA", img.size, (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse(P(xy[0] - r, xy[1] - r, xy[0] + r, xy[1] + r), fill=color + (alpha,))
    img.alpha_composite(g.filter(ImageFilter.GaussianBlur(r * S / 2)))


def finish(img, out, jpg=False):
    img = img.resize((img.width // S, img.height // S), Image.LANCZOS)
    if jpg: img.convert("RGB").save(out, quality=88, optimize=True, progressive=True)
    else: img.save(out, optimize=True)
    return out


def logo_pill(img, x, y, w):
    d = ImageDraw.Draw(img); lg = Image.open(LOGO).convert("RGBA"); lw = w - 40
    lg = lg.resize((int(lw * S), int(lw * S * lg.height / lg.width)), Image.LANCZOS)
    h = lg.height / S + 28
    d.rounded_rectangle(P(x, y, x + w, y + h), radius=int(16 * S), fill=(255, 255, 255, 255))
    img.alpha_composite(lg, (int((x + 20) * S), int((y + 14) * S))); return h


def photo_tile(img, prod, x, y, s, r=36):
    ph = Image.open(PHOTO[prod]).convert("RGB"); m_ = min(ph.size)
    ph = ph.crop(((ph.width - m_) // 2, (ph.height - m_) // 2, (ph.width + m_) // 2, (ph.height + m_) // 2)).resize((int(s * S), int(s * S)), Image.LANCZOS)
    mask = Image.new("L", ph.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, ph.width - 1, ph.height - 1), radius=int(r * S), fill=255)
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle(P(x + 10, y + 18, x + s + 10, y + s + 18), radius=int(r * S), fill=(0, 0, 0, 150))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18 * S)))
    img.paste(ph, P(x, y), mask)


def house_icon(d, cx, cy, s, col, w=4):
    d.line([P(cx - s, cy), P(cx, cy - s * .9), P(cx + s, cy)], fill=col, width=int(w * S), joint="curve")
    d.line([P(cx - s * .7, cy - s * .2), P(cx - s * .7, cy + s * .8), P(cx + s * .7, cy + s * .8), P(cx + s * .7, cy - s * .2)], fill=col, width=int(w * S), joint="curve")


def fan_icon(d, cx, cy, r, col, w=4):
    d.ellipse(P(cx - r, cy - r, cx + r, cy + r), outline=col, width=int(w * S))
    for a in range(3):
        ang = math.radians(a * 120 + 20); d.line(P(cx, cy, cx + math.cos(ang) * r * .72, cy + math.sin(ang) * r * .72), fill=col, width=int(w * S))


def drop_icon(d, cx, cy, r, col):
    d.polygon([P(cx, cy - r * 1.1), P(cx - r * .64, cy), P(cx + r * .64, cy)], fill=col); d.ellipse(P(cx - r * .68, cy - r * .45, cx + r * .68, cy + r * .8), fill=col)


def thermo_icon(d, cx, cy, r, col):
    d.rounded_rectangle(P(cx - r * .28, cy - r, cx + r * .28, cy + r * .3), radius=int(r * .28 * S), outline=col, width=int(3.5 * S))
    d.ellipse(P(cx - r * .5, cy + r * .1, cx + r * .5, cy + r * 1.05), fill=col)


def wind_icon(d, cx, cy, r, col, w=4):
    for i, (dx, ln) in enumerate([(0, 1.0), (0, 1.25), (0, .7)]):
        y = cy - r * .55 + i * r * .55; d.line(P(cx - r, y, cx - r + 2 * r * ln * .8, y), fill=col, width=int(w * S))


def moon_icon(d, cx, cy, r, col):
    d.ellipse(P(cx - r, cy - r, cx + r, cy + r), fill=col); d.ellipse(P(cx - r * .35, cy - r * 1.15, cx + r * 1.35, cy + r * .55), fill=PANEL2)


def homey_card(img, x, y, w, h):
    """Neutrale Geräteansicht: Kopf „Homey" als Text, Modus, Werte, Luftqualität, Flow-Beispiel (nur Symbole)."""
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(P(x, y, x + w, y + h), radius=int(26 * S), fill=PANEL2, outline=LINE, width=int(2 * S))
    house_icon(d, x + 52, y + 54, 22, TEAL, 5); d.text(P(x + 88, y + 34), "Homey", font=ft("b", 30), fill=WHITE)
    # Ein/Aus
    tgx = x + w - 96; d.rounded_rectangle(P(tgx, y + 36, tgx + 64, y + 72), radius=int(18 * S), fill=GREEN); d.ellipse(P(tgx + 32, y + 40, tgx + 60, y + 68), fill=WHITE)
    d.line(P(x + 28, y + 100, x + w - 28, y + 100), fill=LINE, width=int(2 * S))
    # Modus „Smart" + Lüfter
    r1 = y + 148; fan_icon(d, x + 54, r1, 22, TEAL)
    d.rounded_rectangle(P(x + 100, r1 - 22, x + 236, r1 + 22), radius=int(22 * S), fill=TEAL)
    f = ft("b", 24); t = "Smart"; d.text(P(x + 168 - tl(d, t, f) / 2, r1 - 15), t, font=f, fill=BG)
    for i in range(3):
        bx = x + 252 + i * 22; d.rounded_rectangle(P(bx, r1 - 10, bx + 14, r1 + 10), radius=int(5 * S), fill=TEAL if i < 2 else LINE)
    # Temperatur + Feuchte
    r2 = y + 216; thermo_icon(d, x + 54, r2 - 4, 20, ORG)
    f = ft("sb", 26); d.text(P(x + 100, r2 - 17), "21 °C", font=f, fill=WHITE)
    drop_icon(d, x + 236, r2, 18, PUR); d.text(P(x + 264, r2 - 17), "55 %", font=f, fill=WHITE)
    # Luftqualität
    r3 = y + 280; wind_icon(d, x + 54, r3, 22, TEAL)
    cols = [GREEN, (140, 220, 90), (230, 200, 60), ORG, (240, 84, 84)]
    for i, c in enumerate(cols):
        bx = x + 100 + i * 46; d.rounded_rectangle(P(bx, r3 - 9, bx + 38, r3 + 9), radius=int(9 * S), fill=c if i == 0 else LINE)
    # Flow: Mond -> Lüfter Stufe 1
    r4 = y + 344
    d.rounded_rectangle(P(x + 28, r4 - 26, x + w - 28, r4 + 26), radius=int(14 * S), fill=PANEL, outline=LINE, width=int(2 * S))
    moon_icon(d, x + 70, r4, 14, PUR)
    d.line(P(x + 104, r4, x + 170, r4), fill=MUT, width=int(4 * S)); d.polygon([P(x + 170, r4 - 9), P(x + 186, r4), P(x + 170, r4 + 9)], fill=MUT)
    fan_icon(d, x + 222, r4, 16, TEAL, 3)
    for i in range(3):
        bx = x + 252 + i * 22; d.rounded_rectangle(P(bx, r4 - 8, bx + 14, r4 + 8), radius=int(4 * S), fill=TEAL if i < 1 else LINE)


def wifi(d, x, y, col, s=1.0):
    for r in (26 * s, 50 * s, 74 * s): d.arc(P(x - r, y - r, x + r, y + r), start=-135, end=-45, fill=col, width=int(8 * s * S))
    d.ellipse(P(x - 8 * s, y - 8 * s, x + 8 * s, y + 8 * s), fill=col)


def chip(d, x, y, text, fg=WHITE, bg=PANEL2, size=24, icon=None):
    f = ft("sb", size); w = tl(d, text, f) + 44 + (40 if icon else 0); h = size + 26
    d.rounded_rectangle(P(x, y, x + w, y + h), radius=int(h / 2 * S), fill=bg)
    tx = x + 22
    if icon: icon(d, x + 38, y + h / 2); tx += 40
    d.text(P(tx, y + 11), text, font=f, fill=fg); return x + w


# ---------- Texte (11 Shop-Sprachen) ----------
LANGS = ["de", "en", "it", "fr", "es", "nl", "pl", "pt", "cs", "da", "sv"]
IN = {"de": "in", "en": "in", "it": "in", "fr": "dans", "es": "en", "nl": "in", "pl": "w", "pt": "no", "cs": "v", "da": "i", "sv": "i"}
SUB = {
    "de": "Offizielle Ambientika-App für Homey: Modus, Lüfterstufe, Sensoren und Flows. Anmeldung mit den Zugangsdaten der Ambientika App.",
    "en": "Official Ambientika app for Homey: mode, fan speed, sensors and flows. Sign in with the login of the Ambientika app.",
    "it": "App ufficiale Ambientika per Homey: modalità, velocità, sensori e flow. Accesso con le credenziali dell'app Ambientika.",
    "fr": "App officielle Ambientika pour Homey : mode, vitesse, capteurs et flows. Connexion avec les identifiants de l'app Ambientika.",
    "es": "App oficial de Ambientika para Homey: modo, velocidad, sensores y flows. Acceso con los datos de la app Ambientika.",
    "nl": "Officiële Ambientika-app voor Homey: modus, snelheid, sensoren en flows. Aanmelden met de gegevens van de Ambientika-app.",
    "pl": "Oficjalna aplikacja Ambientika dla Homey: tryb, bieg wentylatora, czujniki i flow. Logowanie danymi z aplikacji Ambientika.",
    "pt": "App oficial Ambientika para Homey: modo, velocidade, sensores e flows. Acesso com os dados da app Ambientika.",
    "cs": "Oficiální aplikace Ambientika pro Homey: režim, stupeň ventilátoru, senzory a flow. Přihlášení údaji z aplikace Ambientika.",
    "da": "Officiel Ambientika-app til Homey: tilstand, ventilatortrin, sensorer og flows. Log ind med login til Ambientika-appen.",
    "sv": "Officiell Ambientika-app för Homey: läge, fläktsteg, sensorer och flöden. Logga in med inloggningen till Ambientika-appen.",
}
NOHW = {"de": "WLAN, ohne Zusatzhardware", "en": "Wi-Fi, no extra hardware", "it": "Wi-Fi, senza hardware extra", "fr": "Wi-Fi, sans matériel en plus",
        "es": "Wi-Fi, sin hardware extra", "nl": "wifi, zonder extra hardware", "pl": "Wi-Fi, bez dodatkowego sprzętu", "pt": "Wi-Fi, sem hardware extra",
        "cs": "Wi-Fi, bez dalšího hardwaru", "da": "wifi, uden ekstra hardware", "sv": "wifi, utan extra hårdvara"}
FREE = {"de": "kostenlos", "en": "free", "it": "gratuita", "fr": "gratuite", "es": "gratis", "nl": "gratis", "pl": "bezpłatna", "pt": "grátis", "cs": "zdarma", "da": "gratis", "sv": "gratis"}
STEPS = {
    "de": [("App installieren", "„Ambientika“ im Homey App Store"), ("Anmelden", "Mit den Zugangsdaten der Ambientika App"), ("Geräte nutzen", "In Flows und Dashboards")],
    "en": [("Install the app", "“Ambientika” in the Homey App Store"), ("Sign in", "With the login of the Ambientika app"), ("Use your units", "In flows and dashboards")],
    "it": [("Installa l'app", "“Ambientika” nell'App Store di Homey"), ("Accedi", "Con le credenziali dell'app Ambientika"), ("Usa le unità", "Nei flow e nelle dashboard")],
    "fr": [("Installer l'app", "« Ambientika » dans l'App Store Homey"), ("Se connecter", "Avec les identifiants de l'app Ambientika"), ("Utiliser les unités", "Dans les flows et tableaux de\u00a0bord")],
    "es": [("Instalar la app", "«Ambientika» en la App Store de Homey"), ("Iniciar sesión", "Con los datos de la app Ambientika"), ("Usar las unidades", "En flows y paneles")],
    "nl": [("App installeren", "‘Ambientika’ in de Homey App Store"), ("Aanmelden", "Met de gegevens van de Ambientika-app"), ("Units gebruiken", "In flows en dashboards")],
    "pl": [("Zainstaluj aplikację", "„Ambientika” w Homey App Store"), ("Zaloguj się", "Danymi z aplikacji Ambientika"), ("Używaj urządzeń", "We flow i na pulpitach")],
    "pt": [("Instalar a app", "“Ambientika” na App Store do Homey"), ("Iniciar sessão", "Com os dados da app Ambientika"), ("Usar as unidades", "Em flows e painéis")],
    "cs": [("Nainstalovat aplikaci", "„Ambientika“ v Homey App Store"), ("Přihlásit se", "Údaji z aplikace Ambientika"), ("Používat jednotky", "Ve flow a na nástěnkách")],
    "da": [("Installer appen", "“Ambientika” i Homey App Store"), ("Log ind", "Med login til Ambientika-appen"), ("Brug enhederne", "I flows og dashboards")],
    "sv": [("Installera appen", "”Ambientika” i Homey App Store"), ("Logga in", "Med inloggningen till Ambientika-appen"), ("Använd aggregaten", "I flöden och instrumentpaneler")],
}


# ---------- Hero 1600x700 ----------
def hero(prod, l, out, w=1600, h=700):
    img = Image.new("RGBA", P(w, h), BG + (255,)); glow(img, (1180, 330), 360, TEAL, 34); glow(img, (300, 650), 260, PUR, 22)
    d = ImageDraw.Draw(img)
    chip(d, 70, 64, "Homey · Flows · Wi-Fi", fg=TEAL, size=22)
    title = f"{PNAME[prod]} {IN[l]} Homey"
    f1 = fitfont(d, title, "xb", 58, 650, 34); d.text(P(70, 140), title, font=f1, fill=WHITE)
    y = 140 + f1.size / S + 26; fs = ft("r", 27)
    sl = wrap(d, SUB[l], fs, 600)
    if len(sl) > 3: problems.append(f"hero {l}: Subline {len(sl)} Zeilen")
    for line in sl[:3]: d.text(P(70, y), line, font=fs, fill=MUT); y += 40
    y += 24
    x = chip(d, 70, y, FREE[l], fg=BG, bg=TEAL, size=24) + 14
    x2 = chip(d, x, y, NOHW[l], fg=WHITE, size=24, icon=lambda dd, cx, cy: wifi(dd, cx, cy + 8, MUT, .26))
    if x2 > 700: problems.append(f"hero {l}: Chips bis x={x2:.0f}")
    logo_pill(img, 70, 590, 240)
    # Szene rechts: Gerät -> WLAN -> Homey-Karte
    photo_tile(img, prod, 740, 175, 290, r=32)
    d = ImageDraw.Draw(img); f = ft("sb", 24); t = PNAME[prod]; d.text(P(885 - tl(d, t, f) / 2, 490), t, font=f, fill=WHITE)
    wifi(d, 1130, 330, TEAL, .9)
    homey_card(img, 1206, 150, 364, 400)
    return finish(img, out, jpg=True)


# ---------- Schritte 1600x560 ----------
def ic_store(img, cx, cy):
    d = ImageDraw.Draw(img)
    # Telefon mit App-Kachel und Download-Pfeil
    d.rounded_rectangle(P(cx - 60, cy - 92, cx + 60, cy + 92), radius=int(20 * S), outline=TEAL, width=int(5 * S))
    d.rounded_rectangle(P(cx - 30, cy - 52, cx + 30, cy + 8), radius=int(14 * S), fill=PANEL2, outline=LINE, width=int(2 * S))
    house_icon(d, cx, cy - 22, 16, TEAL, 4)
    d.line(P(cx, cy + 24, cx, cy + 62), fill=WHITE, width=int(6 * S)); d.polygon([P(cx - 16, cy + 50), P(cx + 16, cy + 50), P(cx, cy + 70)], fill=WHITE)


def ic_login(img, cx, cy):
    d = ImageDraw.Draw(img)
    for i, dots in enumerate([False, True]):
        y0 = cy - 62 + i * 70
        d.rounded_rectangle(P(cx - 130, y0, cx + 130, y0 + 50), radius=int(12 * S), fill=PANEL2, outline=LINE, width=int(2 * S))
        if dots:
            for k in range(8): d.ellipse(P(cx - 106 + k * 26, y0 + 18, cx - 92 + k * 26, y0 + 32), fill=WHITE)
        else:
            f = ft("m", 22); d.text(P(cx - 108, y0 + 12), "@", font=f, fill=TEAL); d.rounded_rectangle(P(cx - 78, y0 + 20, cx + 70, y0 + 30), radius=int(5 * S), fill=MUT)
    # Haken
    d.ellipse(P(cx + 96, cy + 46, cx + 146, cy + 96), fill=GREEN); d.line([P(cx + 108, cy + 71), P(cx + 118, cy + 82), P(cx + 135, cy + 60)], fill=BG, width=int(6 * S), joint="curve")


def ic_flow(img, cx, cy):
    d = ImageDraw.Draw(img)
    for i, (ix, col) in enumerate([(-120, PUR), (0, TEAL), (120, ORG)]):
        x = cx + ix; d.rounded_rectangle(P(x - 46, cy - 40, x + 46, cy + 40), radius=int(14 * S), fill=PANEL2, outline=col, width=int(4 * S))
        if i == 0: moon_icon(d, x, cy, 18, PUR)
        elif i == 1: fan_icon(d, x, cy, 20, TEAL)
        else: drop_icon(d, x, cy + 2, 18, ORG)
        if i < 2: d.line(P(x + 46, cy, x + 74, cy), fill=MUT, width=int(4 * S))


def schritte(l, out, w=1600, h=560):
    img = Image.new("RGBA", P(w, h), BG + (255,)); d = ImageDraw.Draw(img); cw, gap, x = 460, 70, 40
    for i, (title, sub) in enumerate(STEPS[l]):
        cx0 = x + i * (cw + gap); d.rounded_rectangle(P(cx0, 40, cx0 + cw, 520), radius=int(26 * S), fill=PANEL)
        d.ellipse(P(cx0 + 30, 66, cx0 + 82, 118), fill=TEAL); fn = ft("b", 28); n = str(i + 1); d.text(P(cx0 + 56 - tl(d, n, fn) / 2, 74), n, font=fn, fill=BG)
        [ic_store, ic_login, ic_flow][i](img, cx0 + cw / 2, 205); d = ImageDraw.Draw(img)
        ftit = fitfont(d, title, "b", 36, cw - 60, 26); d.text(P(cx0 + cw / 2 - tl(d, title, ftit) / 2, 330), title, font=ftit, fill=WHITE)
        sub = sub.replace('Homey App Store', 'Homey\u00a0App\u00a0Store').replace('App Store do Homey', 'App\u00a0Store do\u00a0Homey').replace('App Store de Homey', 'App\u00a0Store de\u00a0Homey').replace("App Store di Homey", 'App\u00a0Store di\u00a0Homey')
        fs = ft("r", 26); lines = wrap(d, sub, fs, cw - 60)
        if len(lines) > 3: problems.append(f"{l}: Schritt {i+1} {len(lines)} Zeilen")
        y = 390
        for line in lines[:3]: d.text(P(cx0 + cw / 2 - tl(d, line, fs) / 2, y), line, font=fs, fill=MUT); y += 36
        if i < 2: ax = cx0 + cw + gap / 2; d.polygon([P(ax - 14, 260), P(ax + 16, 280), P(ax - 14, 300)], fill=TEAL)
    return finish(img, out)


if __name__ == "__main__":
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    for l in LANGS:
        for prod in ("smart", "office"): hero(prod, l, f"{out}/homey-hero-{prod}-{l}.jpg")
        schritte(l, f"{out}/homey-schritte-{l}.png")
    print("Probleme:", problems or "keine")
