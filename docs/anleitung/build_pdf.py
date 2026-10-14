"""Erzeugt die Installationsanleitung für den Music Generator als PDF.

Aufruf: build_pdf.py <ausgabe.pdf> [sprache]   (de = Standard; Texte in texts.py, Bilder von capture.py)
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from texts import TEXTS  # noqa: E402

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle

HERE = Path(__file__).parent
OUT = Path(sys.argv[1])
LANG = sys.argv[2] if len(sys.argv) > 2 else "de"
SUF = "" if LANG == "de" else f"-{LANG}"      # Bilder und Markierungen je Sprache: form-en.png, marks-en.json …


def T(key: str) -> str:
    return TEXTS.get(LANG, {}).get(key) or TEXTS["de"][key]


F = "/System/Library/Fonts/Supplemental/"
if LANG in ("zh", "ja", "ko"):
    # CJK: Arial Unicode deckt die Schriftzeichen ab; es gibt keinen fetten Schnitt, Fettdruck nutzt dieselbe Datei
    pdfmetrics.registerFont(TTFont("Arial", F + "Arial Unicode.ttf"))
    pdfmetrics.registerFont(TTFont("Arial-Bold", F + "Arial Unicode.ttf"))
    pdfmetrics.registerFont(TTFont("Mono", F + "Arial Unicode.ttf"))     # Terminal-Beispiel enthält Schriftzeichen
else:
    pdfmetrics.registerFont(TTFont("Arial", F + "Arial.ttf"))
    pdfmetrics.registerFont(TTFont("Arial-Bold", F + "Arial Bold.ttf"))
    pdfmetrics.registerFont(TTFont("Mono", F + "Courier New Bold.ttf"))
CJK = {"wordWrap": "CJK"} if LANG in ("zh", "ja") else {}   # Zeilenumbruch auch ohne Leerzeichen
pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial", boldItalic="Arial-Bold")

# Farben aus der App
BG = HexColor("#0c0e12")
PANEL = HexColor("#1a1d24")
BORDER = HexColor("#2a2e38")
GOLD = HexColor("#d1a75c")
BRAND = HexColor("#b09f84")
LOGO_TXT = HexColor("#ddc8aa")
INK = HexColor("#1b1d22")
MUTED = HexColor("#6b7080")
LIGHT = HexColor("#f4f2ee")
LINE = HexColor("#e2ded6")
BLUE = HexColor("#6d8cff")
RED = HexColor("#d9534f")
GREEN = HexColor("#2f9e5b")

W, H = A4
M = 50  # Rand

body = ParagraphStyle("body", fontName="Arial", fontSize=10.5, leading=15.5, textColor=INK, alignment=TA_LEFT, **CJK)
small = ParagraphStyle("small", parent=body, fontSize=9, leading=13, textColor=MUTED)
bold = ParagraphStyle("bold", parent=body, fontName="Arial-Bold")
cell = ParagraphStyle("cell", parent=body, fontSize=9.5, leading=13)
cellb = ParagraphStyle("cellb", parent=cell, fontName="Arial-Bold")


def para(c, text, x, y, w, style=body):
    """Zeichnet einen Absatz mit Oberkante y, gibt die neue y-Position zurück."""
    p = Paragraph(text, style)
    _, h = p.wrap(w, 1000)
    p.drawOn(c, x, y - h)
    return y - h


def logo(c, x, y, s):
    """Wellenform-Logo der App (Oberkante links = x, y; Kantenlänge s)."""
    k = s / 84
    c.setFillColor(HexColor("#3a3b3c"))
    c.setStrokeColor(BORDER)
    c.roundRect(x, y - s, s, s, 14 * k, stroke=1, fill=1)
    c.setFillColor(LOGO_TXT)
    for bx, by, bh in [(16, 36, 12), (25, 28, 28), (34, 20, 44), (43, 30, 24), (52, 24, 36), (61, 34, 16)]:
        c.roundRect(x + bx * k, y - (by + bh) * k, 5 * k, bh * k, 2.5 * k, stroke=0, fill=1)


def header(c, title, kicker):
    c.setFillColor(LIGHT)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(BG)
    c.rect(0, H - 92, W, 92, stroke=0, fill=1)
    logo(c, M, H - 24, 44)
    c.setFillColor(GOLD)
    c.setFont("Arial-Bold", 8.5)
    c.drawString(M + 58, H - 42, kicker.upper())
    c.setFillColor(white)
    c.setFont("Arial-Bold", 20)
    c.drawString(M + 58, H - 64, title)
    return H - 122


def footer(c, n):
    c.setFont("Arial", 8)
    c.setFillColor(MUTED)
    c.drawString(M, 28, T("footer"))
    c.drawRightString(W - M, 28, str(n))


def h2(c, text, y):
    c.setFillColor(INK)
    c.setFont("Arial-Bold", 13.5)
    c.drawString(M, y - 14, text)
    c.setStrokeColor(GOLD)
    c.setLineWidth(1.6)
    c.line(M, y - 21, M + 28, y - 21)
    return y - 34


def code(c, text, x, y, w):
    """Terminal-Befehl in dunkler Box, gibt neue y zurück."""
    lines = text.split("\n")
    h = 16 + 14 * len(lines)
    c.setFillColor(BG)
    c.roundRect(x, y - h, w, h, 6, stroke=0, fill=1)
    c.setFont("Mono", 9.5)
    for i, line in enumerate(lines):
        c.setFillColor(GOLD if "<" in line else LOGO_TXT)
        c.drawString(x + 12, y - 19 - 14 * i, line)
    return y - h


def note(c, text, y, color=GOLD, label=None):
    """Hinweis-Kasten mit farbigem Balken links."""
    p = Paragraph(f"<b>{label or T('hinweis')}:</b> {text}", body)
    _, h = p.wrap(W - 2 * M - 26, 1000)
    c.setFillColor(white)
    c.setStrokeColor(LINE)
    c.roundRect(M, y - h - 18, W - 2 * M, h + 18, 6, stroke=1, fill=1)
    c.setFillColor(color)
    c.rect(M, y - h - 18, 4, h + 18, stroke=0, fill=1)
    p.drawOn(c, M + 16, y - h - 9)
    return y - h - 18


def badge(c, n, x, y, r=10, fill=GOLD, fg=BG):
    c.setFillColor(fill)
    c.setStrokeColor(BG)
    c.setLineWidth(1.2)
    c.circle(x, y, r, stroke=1, fill=1)
    c.setFillColor(fg)
    c.setFont("Arial-Bold", r * 1.05)
    c.drawCentredString(x, y - r * 0.37, str(n))


def arrow_down(c, x, y1, y2, color=MUTED):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.4)
    c.line(x, y1, x, y2 + 5)
    p = c.beginPath()
    p.moveTo(x - 4, y2 + 6)
    p.lineTo(x + 4, y2 + 6)
    p.lineTo(x, y2)
    p.close()
    c.drawPath(p, stroke=0, fill=1)


def table(c, data, y, widths, head=True):
    rows = [[Paragraph(str(v), cellb if (head and r == 0) else cell) for v in row] for r, row in enumerate(data)]
    t = Table(rows, colWidths=widths)
    st = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.6, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 1), (-1, -1), white),
    ]
    if head:
        st += [("BACKGROUND", (0, 0), (-1, 0), HexColor("#ebe6dc")), ("LINEBELOW", (0, 0), (-1, 0), 1.2, GOLD)]
    t.setStyle(TableStyle(st))
    _, h = t.wrap(sum(widths), 1000)
    t.drawOn(c, M, y - h)
    return y - h


# ═════════════════════════════════════════════════════════════════ Seite 1: Titel
def page_cover(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    # weicher Schimmer oben (blau links, gold rechts), wie in der App
    for i in range(40):
        a = 0.006
        c.setFillColor(BLUE, alpha=a)
        c.circle(40, H - 40, 380 - i * 9, stroke=0, fill=1)
        c.setFillColor(GOLD, alpha=a * 0.7)
        c.circle(W - 40, H - 40, 340 - i * 8, stroke=0, fill=1)
    c.setFillAlpha(1)

    y = H - 150
    # Logo + Abstand + Wortmarke füllen genau die Textbreite, beide gleich hoch
    ratio = 908 / 149
    wh = (W - 2 * M - 14) / (1 + ratio)
    logo(c, M, y, wh)
    c.drawImage(str(HERE / "alphatester.png"), M + wh + 14, y - wh, height=wh, width=wh * ratio, mask="auto")
    c.setFillColor(HexColor("#8a90a0"))
    c.setFont("Arial-Bold", 50)
    c.drawString(M, y - 170, "MUSIC")
    c.setFont("Arial-Bold", 30)
    c.drawString(M, y - 206, "GENERATOR")
    c.setStrokeColor(GOLD)
    c.setLineWidth(2)
    c.line(M, y - 228, M + 60, y - 228)
    c.setFillColor(white)
    c.setFont("Arial-Bold", 22)
    c.drawString(M, y - 266, T("p1_01"))
    c.setFillColor(HexColor("#b8bcc8"))
    c.setFont("Arial", 12)
    c.drawString(M, y - 290, T("p1_02"))

    # Die drei Schritte als Vorschau
    sy = 250
    bw = (W - 2 * M - 24) / 3
    for i, (t, s) in enumerate([(T("p1_03"), T("p1_04")),
                                (T("p1_05"), T("p1_06")),
                                (T("p1_07"), "Music Generator ON")]):
        x = M + i * (bw + 12)
        c.setFillColor(PANEL)
        c.setStrokeColor(BORDER)
        c.roundRect(x, sy - 92, bw, 92, 10, stroke=1, fill=1)
        badge(c, i + 1, x + 24, sy - 26, 12)
        c.setFillColor(white)
        c.setFont("Arial-Bold", 12.5)
        c.drawString(x + 16, sy - 58, t)
        c.setFillColor(HexColor("#8a90a0"))
        c.setFont("Arial", 9)
        c.drawString(x + 16, sy - 75, s)

    c.setFillColor(HexColor("#6b7080"))
    c.setFont("Arial", 8.5)
    c.drawString(M, 52, T("p1_08"))


# ═════════════════════════════════════════════════════════════════ Seite 2: Überblick
def page_overview(c):
    y = header(c, T("p2_01"), T("p2_02"))
    y = para(c, T("p2_03"), M, y, W - 2 * M)
    y -= 22
    y = h2(c, T("p2_04"), y)
    rows = [["", T("p2_05"), T("p2_06")],
            ["Mac", T("p2_07"), T("p2_08")],
            ["Windows", T("p2_09"), T("p2_10")],
            [T("p2_11"), T("p2_12"), T("p2_13")],
            [T("p2_14"), T("p2_15"), T("p2_16")],
            ["Internet", T("p2_17"), T("p2_18")],
            [T("p2_19"), T("p2_20"), T("p2_21")]]
    y = table(c, rows, y, [70, 170, W - 2 * M - 240])
    y -= 26
    y = h2(c, T("p2_22"), y)

    # Drei große Schritte mit Pfeilen dazwischen
    bw = (W - 2 * M - 40) / 3
    bh = 128
    items = [(T("p2_23"), T("p2_24")),
             (T("p2_25"), T("p2_26")),
             (T("p2_27"), T("p2_28"))]
    for i, (t, s) in enumerate(items):
        x = M + i * (bw + 20)
        c.setFillColor(white)
        c.setStrokeColor(LINE)
        c.roundRect(x, y - bh, bw, bh, 10, stroke=1, fill=1)
        badge(c, i + 1, x + 22, y - 24, 12)
        c.setFillColor(INK)
        c.setFont("Arial-Bold", 12)
        c.drawString(x + 14, y - 56, t)
        para(c, s, x + 14, y - 64, bw - 28, small)
        if i < 2:
            ax = x + bw + 4
            c.setFillColor(GOLD)
            p = c.beginPath()
            p.moveTo(ax, y - bh / 2 + 6)
            p.lineTo(ax + 12, y - bh / 2)
            p.lineTo(ax, y - bh / 2 - 6)
            p.close()
            c.drawPath(p, stroke=0, fill=1)
    y -= bh + 22
    note(c, T("p2_29"), y, GOLD, T("p2_30"))
    footer(c, 2)


# ═════════════════════════════════════════════════════════════════ Seite 3: Schritt 1+2
def page_steps(c):
    y = header(c, T("p3_01"), T("p3_02"))
    y = h2(c, T("p3_03"), y)
    y = para(c, T("p3_04"), M, y, W - 2 * M)
    y -= 10
    y = code(c, T("p3_05"), M, y, W - 2 * M)
    y -= 8
    y = para(c, T("p3_06"), M, y, W - 2 * M, small)
    y -= 12
    y = para(c, T("p3_07"), M, y, W - 2 * M)
    y -= 26

    y = h2(c, T("p3_08"), y)
    y = para(c, T("p3_09"), M, y, W - 2 * M)
    y -= 10
    y = code(c, T("p3_10"), M, y, W - 2 * M)
    y -= 16

    # Terminal-Mockup mit typischer Ausgabe
    lines = [T("p3_11"),
             "",
             T("p3_12"),
             T("p3_13"),
             T("p3_14"),
             T("p3_15"),
             "",
             T("p3_16"),
             T("p3_17"),
             T("p3_18"),
             T("p3_19"),
             T("p3_20")]
    th = 30 + 12.5 * len(lines)
    c.setFillColor(HexColor("#16181d"))
    c.setStrokeColor(BORDER)
    c.roundRect(M, y - th, W - 2 * M, th, 8, stroke=1, fill=1)
    for i, col in enumerate(["#ff5f57", "#febc2e", "#28c840"]):
        c.setFillColor(HexColor(col))
        c.circle(M + 14 + i * 13, y - 11, 4, stroke=0, fill=1)
    c.setFont("Mono", 8.8)
    for i, line in enumerate(lines):
        c.setFillColor(GOLD if line.startswith("▸") or T("p3_21") in line else HexColor("#c9ccd4"))
        c.drawString(M + 14, y - 34 - 12.5 * i, line.replace("▸", ">"))
    y -= th + 14
    y = para(c, T("p3_22"), M, y, W - 2 * M)
    y -= 14
    note(c, T("p3_23"), y, BLUE, T("p3_24"))
    footer(c, 3)


# ═════════════════════════════════════════════════════════════════ Seite 4: Was passiert
def page_flow(c):
    y = header(c, T("p4_01"), T("p4_02"))
    steps = [
        (T("p4_03"), T("p4_04")),
        (T("p4_05"), T("p4_06")),
        (T("p4_07"), T("p4_08")),
        (T("p4_09"), T("p4_10")),
        (T("p4_11"), T("p4_12")),
        (T("p4_13"), T("p4_14")),
        (T("p4_15"), T("p4_16")),
        (T("p4_17"), T("p4_18")),
    ]
    x0 = M
    bw = 300
    bh = 50
    gap = 13
    for i, (t, s) in enumerate(steps):
        top = y - i * (bh + gap)
        last = i == len(steps) - 1
        c.setFillColor(BG if last else white)
        c.setStrokeColor(GOLD if last else LINE)
        c.roundRect(x0, top - bh, bw, bh, 8, stroke=1, fill=1)
        badge(c, i + 1, x0 + 22, top - bh / 2, 11, GOLD, BG)
        c.setFillColor(white if last else INK)
        c.setFont("Arial-Bold", 11)
        c.drawString(x0 + 42, top - 19, t)
        para(c, s, x0 + 42, top - 25, bw - 54,
             ParagraphStyle("s", parent=small, fontSize=8.3, leading=10.5,
                            textColor=HexColor("#b8bcc8") if last else MUTED))
        if not last:
            arrow_down(c, x0 + 22, top - bh - 1, top - bh - gap + 1, GOLD)

    # Rechte Spalte: Modellwahl + Dauer
    rx = x0 + bw + 22
    rw = W - M - rx
    ry = y
    c.setFillColor(INK)
    c.setFont("Arial-Bold", 12)
    c.drawString(rx, ry - 12, T("p4_19"))
    c.setStrokeColor(GOLD)
    c.line(rx, ry - 19, rx + 24, ry - 19)
    ry -= 30
    for ram, lm, dl, rec in [("8 GB", "0.6B", "4,4 GB", False), ("16 GB", "1.7B", "5,7 GB", True), ("24 GB", "4B", "8,1 GB", False)]:
        h = 58
        c.setFillColor(white)
        c.setStrokeColor(GOLD if rec else LINE)
        c.setLineWidth(1.4 if rec else 0.8)
        c.roundRect(rx, ry - h, rw, h, 8, stroke=1, fill=1)
        c.setFillColor(INK)
        c.setFont("Arial-Bold", 17)
        c.drawString(rx + 12, ry - 26, lm)
        c.setFont("Arial", 8.5)
        c.setFillColor(MUTED)
        c.drawString(rx + 12, ry - 42, T("p4_ram").format(ram=ram))
        c.drawString(rx + 12, ry - 52, T("p4_dl").format(dl=dl if LANG == "de" else dl.replace(",", ".")))
        if rec:
            c.setFillColor(GOLD)
            c.roundRect(rx + rw - 66, ry - 20, 56, 13, 6, stroke=0, fill=1)
            c.setFillColor(BG)
            c.setFont("Arial-Bold", 7)
            c.drawCentredString(rx + rw - 38, ry - 16, T("p4_20"))
        ry -= h + 8
    ry = para(c, T("p4_21"),
              rx, ry - 2, rw, ParagraphStyle("r", parent=small, fontSize=8.5, leading=11.5))
    ry -= 20
    c.setFillColor(INK)
    c.setFont("Arial-Bold", 12)
    c.drawString(rx, ry - 12, T("p4_22"))
    c.setStrokeColor(GOLD)
    c.line(rx, ry - 19, rx + 24, ry - 19)
    ry -= 30
    for k, v in [(T("p4_23"), T("p4_24")), (T("p4_25"), T("p4_26")),
                 (T("p4_27"), T("p4_28")), (T("p4_29"), T("p4_30"))]:
        c.setFont("Arial", 8.8)
        c.setFillColor(INK)
        c.drawString(rx, ry - 10, k)
        c.setFillColor(MUTED)
        c.drawRightString(rx + rw, ry - 10, v)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.line(rx, ry - 15, rx + rw, ry - 15)
        ry -= 20
    # Unter beiden Spalten: wenn macOS die Datei blockiert
    yy = y - len(steps) * (bh + gap) + gap - 24
    yy = h2(c, T("p4_31"), yy)
    yy = para(c, T("p4_32"), M, yy, W - 2 * M)
    yy -= 8
    yy = code(c, T("p4_33"), M, yy, W - 2 * M)
    yy -= 8
    para(c, T("p4_34"), M, yy, W - 2 * M, small)
    footer(c, 4)


# ═════════════════════════════════════════════════════════════════ Seite 5: Windows
def page_windows(c):
    y = header(c, T("p5_01"), T("p5_02"))
    y = h2(c, T("p5_03"), y)
    y = para(c, T("p5_04"), M, y, W - 2 * M)
    y -= 10
    y = code(c, T("p5_05"), M, y, W - 2 * M)
    y -= 8
    y = para(c, T("p5_06"), M, y, W - 2 * M, small)
    y -= 16

    y = h2(c, T("p5_07"), y)
    y = para(c, T("p5_08"), M, y, W - 2 * M)
    y -= 10
    y = code(c, T("p5_09"), M, y, W - 2 * M)
    y -= 10
    y = para(c, T("p5_10"), M, y, W - 2 * M)
    y -= 12
    y = note(c, T("p5_11"),
             y, BLUE, "SmartScreen")
    y -= 16

    y = h2(c, T("p5_12"), y)
    rows = [[T("p5_13"), "Windows"],
            [T("p5_14"), T("p5_15")],
            [T("p5_16"), T("p5_17")],
            [T("p5_18"), T("p5_19")],
            [T("p5_20"), T("p5_21")]]
    y = table(c, rows, y, [95, W - 2 * M - 95])
    y -= 12
    para(c, T("p5_22"), M, y, W - 2 * M, small)
    footer(c, 5)


# ═════════════════════════════════════════════════════════════════ Seite 6: Starten + App
def page_app(c):
    y = header(c, T("p6_01"), T("p6_02"))
    # ON/OFF
    iw = 50
    for i, (img, t, s) in enumerate([("icon-on.png", "Music Generator ON", T("p6_03")),
                                     ("icon-off.png", "Music Generator OFF", T("p6_04"))]):
        x = M + i * ((W - 2 * M) / 2)
        c.drawImage(str(HERE / img), x, y - iw, iw, iw, mask="auto")
        c.setFillColor(INK)
        c.setFont("Arial-Bold", 11.5)
        c.drawString(x + iw + 12, y - 20, t)
        para(c, s, x + iw + 12, y - 26, (W - 2 * M) / 2 - iw - 20, small)
    y -= iw + 12
    y = para(c, T("p6_05"), M, y, W - 2 * M, small)
    y -= 16
    y = h2(c, T("p6_06"), y)

    # Screenshot mit Markierungen (Positionen liefert capture.py in marks.json)
    mk = json.loads((HERE / f"marks{SUF}.json").read_text())["form"]
    iw_pt = 300
    ih_pt = iw_pt * mk["h"] / mk["w"]
    ix, iy = M, y - ih_pt
    c.setStrokeColor(BORDER)
    c.roundRect(ix - 1, iy - 1, iw_pt + 2, ih_pt + 2, 6, stroke=1, fill=0)
    c.drawImage(str(HERE / f"form{SUF}.png"), ix, iy, iw_pt, ih_pt)
    sc = iw_pt / mk["w"]
    for n, (px, py) in enumerate(mk["marks"], 1):
        badge(c, n, ix + px * sc, iy + ih_pt - py * sc, 7)

    legend = [
        ("Logo", T("p6_07")),
        (T("p6_08"), T("p6_09")),
        ("Prompt", T("p6_10")),
        (T("p6_11"), T("p6_12")),
        (T("p6_13"), T("p6_14")),
        ("BPM", T("p6_15")),
        ("Lyrics", T("p6_16")),
        (T("p6_17"), T("p6_18")),
        (T("p6_19"), T("p6_20")),
        (T("p6_21"), T("p6_22")),
    ]
    lx = ix + iw_pt + 18
    lw = W - M - lx
    ly = y
    st = ParagraphStyle("lg", parent=small, fontSize=8.4, leading=10.8, textColor=INK)
    for n, (t, s) in enumerate(legend, 1):
        badge(c, n, lx + 8, ly - 8, 7.5)
        ly = para(c, f"<b>{t}</b> · {s}", lx + 22, ly - 1, lw - 22, st) - 7.5
    footer(c, 6)


# ═════════════════════════════════════════════════════════════════ Seite 7: Bibliothek + Hilfe
def page_help(c):
    y = header(c, T("p7_01"), T("p7_02"))
    y = h2(c, T("p7_03"), y)
    rk = json.loads((HERE / f"marks{SUF}.json").read_text())["row"]
    iw_pt = W - 2 * M
    ih_pt = iw_pt * rk["h"] / rk["w"]
    ix, iy = M, y - ih_pt - 10
    c.setFillColor(PANEL)
    c.roundRect(ix - 4, iy - 4, iw_pt + 8, ih_pt + 8, 6, stroke=0, fill=1)
    c.drawImage(str(HERE / f"row{SUF}.png"), ix, iy, iw_pt, ih_pt)
    sc = iw_pt / rk["w"]
    # Play steht links, die fünf Knöpfe rechts; Nummern über die Zeile
    for n, px in enumerate(rk["xs"], 1):
        badge(c, n, ix + px * sc, iy + ih_pt + 8, 7.5)
    y = iy - 16
    items = [("Play", T("p7_04")), (T("p7_05"), T("p7_06")),
             ("WAV", T("p7_07")), ("TXT", T("p7_08")),
             (T("p7_09"), T("p7_10")), ("Plus", T("p7_11")),
             (T("p7_12"), T("p7_13")), (T("p7_14"), T("p7_15"))]
    if not rk.get("txt"):
        items.pop(3)
    colw = (W - 2 * M) / 3
    st = ParagraphStyle("it", parent=small, fontSize=8.6, leading=11, textColor=INK)
    for i, (t, s) in enumerate(items):
        cx = M + (i % 3) * colw
        cy = y - (i // 3) * 26
        badge(c, i + 1, cx + 8, cy - 7, 7.5)
        para(c, f"<b>{t}</b> · {s}", cx + 22, cy, colw - 28, st)
    y -= 26 * ((len(items) + 2) // 3) + 8
    y = para(c, T("p7_16"), M, y, W - 2 * M, small)
    y -= 16

    y = h2(c, T("p7_17"), y)
    bk = json.loads((HERE / f"marks{SUF}.json").read_text())["bar"]
    bh = iw_pt * bk["h"] / bk["w"]
    c.setFillColor(PANEL)
    c.roundRect(M - 4, y - bh - 12, iw_pt + 8, bh + 8, 6, stroke=0, fill=1)
    c.drawImage(str(HERE / f"folders{SUF}.png"), M, y - bh - 8, iw_pt, bh)
    y -= bh + 22
    y = para(c, T("p7_18"),
             M, y, W - 2 * M, small)
    y -= 16

    y = h2(c, T("p7_19"), y)
    y = para(c, T("p7_20"), M, y, W - 2 * M, small)
    y -= 16

    y = h2(c, T("p7_xl_h"), y)
    y = para(c, T("p7_xl"), M, y, W - 2 * M, small)
    y -= 16

    y = h2(c, T("p7_21"), y)
    y = para(c, T("p7_22"), M, y, W - 2 * M, small)
    footer(c, 7)


# ═════════════════════════════════════════════════════════════════ Seite 8: Hilfe
def page_trouble(c):
    y = header(c, T("p8_01"), T("p8_02"))
    y = h2(c, T("p8_03"), y)
    rows = [[T("p8_04"), T("p8_05")],
            [T("p8_06"), T("p8_07")],
            [T("p8_08"), T("p8_09")],
            [T("p8_10"), T("p8_11")],
            [T("p8_12"), T("p8_13")],
            [T("p8_14"), T("p8_15")],
            [T("p8_16"), T("p8_17")]]
    y = table(c, rows, y, [140, W - 2 * M - 140])
    y -= 20
    y = h2(c, T("p8_18"), y)
    rows = [[T("p8_19"), T("p8_20")],
            [T("p8_21"), T("p8_22")],
            [T("p8_23"), T("p8_24")],
            [T("p8_25"), T("p8_26")]]
    y = table(c, rows, y, [190, W - 2 * M - 190])
    y -= 20
    y = h2(c, T("p8_27"), y)
    y = para(c, T("p8_28"), M, y, W - 2 * M, small)
    y -= 14

    y = h2(c, T("p8_29"), y)
    para(c, T("p8_30"), M, y, W - 2 * M, small)
    footer(c, 8)


c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle(T("p8_31"))
c.setAuthor("Alphatester")
for fn in (page_cover, page_overview, page_steps, page_flow, page_windows, page_app, page_help, page_trouble):
    fn(c)
    c.showPage()
c.save()
print("ok", OUT)
