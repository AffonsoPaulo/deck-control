"""Marca do app: DE / CK em branco num fundo escuro, dentro de um anel em degradê.

O anel usa as cores das categorias do editor, uma em cada canto (azul, verde,
laranja, âmbar) e misturadas pelas bordas. Desconectado, o anel fica cinza.

Com um problema em aberto (app/logs.py), a bandeja põe um selo âmbar com "!" no canto
de baixo à direita (alert=True).

O desenho mora aqui, numa grade de 32: a bandeja (PIL) e o favicon (SVG) saem
da mesma geometria. Depois de mudar algo, rode `python -m app.brand` para
regravar editor/static/favicon.svg e favicon-off.svg.
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw

INK = (22, 24, 29)
WHITE = (255, 255, 255)
# fmt: off
CORNERS = ((62, 99, 221), (47, 158, 106),     # em cima: azul, verde
           (229, 112, 26), (245, 165, 36))    # embaixo: laranja, âmbar
# fmt: on
RING_OFF = (74, 80, 92)
ALERT = (245, 165, 36)  # selo de alerta (âmbar #F5A524)
RADIUS = 8.5  # canto externo, na grade de 32
RING = 3  # largura do anel, na grade de 32
STROKE = 0.35  # engrossa um pouco o traço da Figtree 700
BLEND = (0.15, 0.85)  # faixa vertical em que as cores de cima viram as de baixo
TRAY_SIZES = (16, 20, 24, 32, 40, 48, 64)

# DE / CK em Figtree 700, contornos já achatados em polígonos na grade de 32
# (gerados pela fonte do editor; True = furo, como o miolo do D)
# fmt: off
LETTERS = [
    (False, [(9.04, 15.0), (9.04, 7.4), (11.48, 7.4), (11.7, 7.4), (11.93, 7.42), (12.15, 7.44), (12.36, 7.48), (12.57, 7.52), (12.77, 7.58), (12.97, 7.64), (13.16, 7.71), (13.35, 7.8), (13.53, 7.89), (13.71, 7.99), (13.88, 8.1), (14.03, 8.21), (14.19, 8.34), (14.33, 8.47), (14.47, 8.61), (14.6, 8.75), (14.72, 8.9), (14.83, 9.06), (14.93, 9.23), (15.03, 9.4), (15.11, 9.58), (15.19, 9.76), (15.26, 9.95), (15.31, 10.15), (15.36, 10.35), (15.39, 10.55), (15.42, 10.76), (15.43, 10.98), (15.44, 11.2), (15.43, 11.42), (15.42, 11.63), (15.39, 11.84), (15.36, 12.05), (15.31, 12.25), (15.26, 12.44), (15.19, 12.63), (15.11, 12.81), (15.03, 12.99), (14.93, 13.17), (14.83, 13.33), (14.72, 13.49), (14.6, 13.65), (14.47, 13.79), (14.33, 13.93), (14.19, 14.06), (14.03, 14.19), (13.88, 14.3), (13.71, 14.41), (13.53, 14.51), (13.35, 14.6), (13.16, 14.69), (12.97, 14.76), (12.77, 14.82), (12.57, 14.88), (12.36, 14.92), (12.15, 14.96), (11.93, 14.98), (11.7, 15.0), (11.48, 15.0)]),
    (True, [(10.53, 13.61), (11.48, 13.61), (11.58, 13.61), (11.68, 13.6), (11.78, 13.59), (11.88, 13.58), (11.98, 13.56), (12.07, 13.54), (12.17, 13.52), (12.26, 13.49), (12.35, 13.46), (12.44, 13.43), (12.53, 13.39), (12.61, 13.35), (12.7, 13.3), (12.78, 13.26), (12.86, 13.21), (12.93, 13.15), (13.01, 13.1), (13.08, 13.04), (13.15, 12.98), (13.22, 12.92), (13.28, 12.85), (13.34, 12.78), (13.4, 12.71), (13.46, 12.64), (13.51, 12.56), (13.56, 12.48), (13.61, 12.4), (13.65, 12.32), (13.7, 12.24), (13.73, 12.15), (13.77, 12.06), (13.8, 11.97), (13.83, 11.88), (13.85, 11.79), (13.87, 11.69), (13.89, 11.6), (13.9, 11.5), (13.91, 11.4), (13.92, 11.3), (13.92, 11.2), (13.92, 11.1), (13.91, 11.0), (13.9, 10.9), (13.89, 10.8), (13.87, 10.71), (13.85, 10.61), (13.83, 10.52), (13.8, 10.43), (13.77, 10.34), (13.73, 10.25), (13.7, 10.16), (13.65, 10.08), (13.61, 10.0), (13.56, 9.92), (13.51, 9.84), (13.46, 9.76), (13.4, 9.69), (13.34, 9.62), (13.28, 9.55), (13.22, 9.48), (13.15, 9.42), (13.08, 9.36), (13.01, 9.3), (12.93, 9.25), (12.86, 9.19), (12.78, 9.14), (12.7, 9.1), (12.61, 9.05), (12.53, 9.01), (12.44, 8.97), (12.35, 8.94), (12.26, 8.91), (12.17, 8.88), (12.07, 8.86), (11.98, 8.84), (11.88, 8.82), (11.78, 8.81), (11.68, 8.8), (11.58, 8.79), (11.48, 8.79), (10.53, 8.79)]),
    (False, [(17.78, 15.0), (17.78, 7.4), (22.59, 7.4), (22.59, 8.76), (19.27, 8.76), (19.27, 10.48), (22.14, 10.48), (22.14, 11.81), (19.27, 11.81), (19.27, 13.64), (22.64, 13.64), (22.64, 15.0)]),
    (False, [(12.43, 24.73), (12.21, 24.73), (12.0, 24.71), (11.79, 24.68), (11.58, 24.65), (11.39, 24.6), (11.19, 24.55), (11.0, 24.48), (10.82, 24.41), (10.64, 24.32), (10.47, 24.23), (10.3, 24.12), (10.14, 24.01), (9.98, 23.89), (9.84, 23.76), (9.7, 23.63), (9.57, 23.48), (9.45, 23.33), (9.33, 23.17), (9.22, 23.01), (9.12, 22.84), (9.03, 22.66), (8.94, 22.47), (8.87, 22.28), (8.81, 22.09), (8.75, 21.88), (8.71, 21.68), (8.67, 21.47), (8.65, 21.25), (8.64, 21.03), (8.63, 20.8), (8.64, 20.57), (8.65, 20.35), (8.67, 20.13), (8.71, 19.92), (8.75, 19.72), (8.81, 19.51), (8.87, 19.32), (8.94, 19.13), (9.03, 18.94), (9.12, 18.76), (9.22, 18.59), (9.33, 18.43), (9.45, 18.27), (9.57, 18.12), (9.7, 17.97), (9.84, 17.84), (9.98, 17.71), (10.13, 17.59), (10.29, 17.48), (10.46, 17.37), (10.63, 17.28), (10.81, 17.19), (10.99, 17.12), (11.18, 17.05), (11.38, 17.0), (11.57, 16.95), (11.78, 16.92), (11.99, 16.89), (12.2, 16.87), (12.42, 16.87), (12.57, 16.87), (12.73, 16.88), (12.88, 16.89), (13.03, 16.91), (13.17, 16.94), (13.32, 16.97), (13.46, 17.01), (13.6, 17.05), (13.74, 17.09), (13.87, 17.15), (14.01, 17.2), (14.14, 17.27), (14.26, 17.33), (14.39, 17.4), (14.51, 17.48), (14.62, 17.56), (14.73, 17.64), (14.84, 17.73), (14.95, 17.82), (15.05, 17.92), (15.15, 18.02), (15.25, 18.12), (15.33, 18.23), (15.42, 18.34), (15.5, 18.45), (15.57, 18.56), (15.64, 18.68), (15.71, 18.8), (15.77, 18.93), (15.83, 19.05), (14.45, 19.56), (14.41, 19.48), (14.37, 19.41), (14.33, 19.33), (14.28, 19.26), (14.24, 19.19), (14.19, 19.12), (14.13, 19.05), (14.08, 18.99), (14.02, 18.92), (13.96, 18.86), (13.9, 18.8), (13.84, 18.75), (13.77, 18.69), (13.7, 18.64), (13.64, 18.6), (13.57, 18.55), (13.49, 18.51), (13.42, 18.47), (13.34, 18.43), (13.27, 18.4), (13.19, 18.36), (13.11, 18.33), (13.03, 18.31), (12.94, 18.29), (12.86, 18.27), (12.77, 18.25), (12.69, 18.24), (12.6, 18.23), (12.51, 18.23), (12.42, 18.23), (12.29, 18.23), (12.16, 18.24), (12.04, 18.26), (11.91, 18.28), (11.79, 18.31), (11.68, 18.35), (11.56, 18.39), (11.45, 18.44), (11.35, 18.5), (11.24, 18.56), (11.14, 18.63), (11.04, 18.7), (10.95, 18.78), (10.87, 18.86), (10.78, 18.95), (10.7, 19.04), (10.63, 19.14), (10.56, 19.24), (10.5, 19.35), (10.44, 19.46), (10.38, 19.58), (10.33, 19.7), (10.29, 19.83), (10.25, 19.95), (10.22, 20.09), (10.2, 20.22), (10.18, 20.36), (10.16, 20.5), (10.15, 20.65), (10.15, 20.8), (10.15, 20.95), (10.16, 21.1), (10.18, 21.24), (10.2, 21.38), (10.22, 21.52), (10.26, 21.65), (10.29, 21.78), (10.34, 21.9), (10.39, 22.02), (10.44, 22.14), (10.5, 22.25), (10.57, 22.36), (10.64, 22.47), (10.71, 22.57), (10.79, 22.66), (10.88, 22.75), (10.97, 22.83), (11.06, 22.91), (11.16, 22.98), (11.26, 23.05), (11.36, 23.12), (11.47, 23.17), (11.58, 23.22), (11.7, 23.26), (11.82, 23.3), (11.94, 23.33), (12.06, 23.35), (12.19, 23.37), (12.32, 23.38), (12.45, 23.38), (12.54, 23.38), (12.64, 23.38), (12.73, 23.37), (12.81, 23.36), (12.9, 23.34), (12.98, 23.32), (13.07, 23.3), (13.15, 23.27), (13.23, 23.24), (13.3, 23.2), (13.38, 23.17), (13.46, 23.13), (13.53, 23.09), (13.6, 23.04), (13.67, 22.99), (13.74, 22.94), (13.8, 22.89), (13.87, 22.83), (13.93, 22.77), (13.99, 22.71), (14.05, 22.65), (14.1, 22.58), (14.16, 22.51), (14.21, 22.44), (14.26, 22.37), (14.31, 22.3), (14.35, 22.22), (14.39, 22.14), (14.43, 22.06), (14.47, 21.98), (15.85, 22.48), (15.79, 22.61), (15.73, 22.74), (15.67, 22.87), (15.6, 22.99), (15.52, 23.11), (15.44, 23.22), (15.36, 23.34), (15.27, 23.45), (15.17, 23.55), (15.07, 23.66), (14.97, 23.76), (14.87, 23.85), (14.76, 23.94), (14.64, 24.03), (14.53, 24.11), (14.41, 24.19), (14.29, 24.26), (14.16, 24.33), (14.03, 24.39), (13.9, 24.45), (13.76, 24.5), (13.62, 24.55), (13.48, 24.59), (13.34, 24.63), (13.19, 24.66), (13.05, 24.69), (12.9, 24.7), (12.74, 24.72), (12.59, 24.73), (12.43, 24.73)]),
    (False, [(17.94, 22.68), (17.77, 20.81), (21.33, 17.0), (23.25, 17.0)]),
    (False, [(17.05, 24.6), (17.05, 17.0), (18.52, 17.0), (18.52, 24.6)]),
    (False, [(21.53, 24.6), (18.51, 20.73), (19.58, 19.84), (23.37, 24.6)]),
]
# fmt: on


def _ring_image(n: int, lit: bool) -> Image.Image:
    """Quadrado n x n com o degradê dos quatro cantos (ou cinza, desconectado)."""
    if not lit:
        return Image.new("RGB", (n, n), RING_OFF)
    tl, tr, bl, br = (Image.new("RGB", (n, n), c) for c in CORNERS)
    down = Image.linear_gradient("L").resize((n, n), Image.BILINEAR)  # 0 em cima, 255 embaixo
    across = down.transpose(Image.Transpose.ROTATE_90)  # 0 à esquerda
    a, b = BLEND[0] * 255, BLEND[1] * 255
    blend = down.point(lambda v: round(min(255, max(0, (v - a) * 255 / (b - a)))))
    top = Image.composite(tr, tl, across)
    bottom = Image.composite(br, bl, across)
    return Image.composite(bottom, top, blend)


def mark(size: int = 64, lit: bool = True, alert: bool = False) -> Image.Image:
    """A marca em `size` px. lit=False: anel cinza (D6 desconectado). alert=True: selo de problema."""
    ss = 8  # desenha 8x maior e reduz
    n = size * ss
    u = n / 32  # 1 unidade da grade, em px
    ring = max(2, round(size * RING / 32)) * ss  # anel preso à grade de pixels
    r = round(RADIUS * u)

    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=r, fill=255)
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    img.paste(_ring_image(n, lit), (0, 0), mask)

    d = ImageDraw.Draw(img)
    d.rounded_rectangle([ring, ring, n - 1 - ring, n - 1 - ring], radius=max(ss, r - round(ring * 0.8)), fill=INK)
    w = max(1, round(STROKE * u))
    for hole in (False, True):
        for is_hole, pts in LETTERS:
            if is_hole != hole:
                continue
            p = [(x * u, y * u) for x, y in pts]
            d.polygon(p, fill=INK if hole else WHITE)
            d.line(p + [p[0]], fill=WHITE, width=w, joint="curve")
    if alert:
        _alert_badge(d, n, size, ss)
    return img.resize((size, size), Image.LANCZOS)


def _alert_badge(d: ImageDraw.ImageDraw, n: int, size: int, ss: int) -> None:
    """Quadrado âmbar arredondado com um "!" escuro, no canto de baixo à direita."""
    side = max(9, round(size * 0.46)) * ss  # em 16 px: 9 px, ainda legível
    x0 = y0 = n - side
    edge = max(1, round(size / 16)) * ss  # contorno escuro para separar do anel
    d.rounded_rectangle([x0 - edge, y0 - edge, n - 1, n - 1], radius=round(side * 0.3) + edge, fill=INK)
    d.rounded_rectangle([x0, y0, n - 1, n - 1], radius=round(side * 0.3), fill=ALERT)
    cx = x0 + side / 2
    bw = max(2 * ss, round(side * 0.2))  # largura do traço do "!"
    top, bottom = y0 + side * 0.18, y0 + side * 0.6
    d.rounded_rectangle([cx - bw / 2, top, cx + bw / 2, bottom], radius=bw / 2, fill=INK)
    dot = y0 + side * 0.8
    d.ellipse([cx - bw / 2, dot - bw / 2, cx + bw / 2, dot + bw / 2], fill=INK)


def ico(lit: bool = True, sizes=TRAY_SIZES, alert: bool = False) -> bytes:
    """Arquivo .ico com cada tamanho desenhado à parte (não reduzido de um só)."""
    frames = [mark(s, lit, alert) for s in sizes]
    buf = io.BytesIO()
    frames[-1].save(buf, format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    return buf.getvalue()


def svg(lit: bool = True) -> str:
    """A mesma marca em SVG (favicon e logo do topo do editor)."""
    hexc = lambda c: "#%02x%02x%02x" % c
    if lit:
        (tl, tr, bl, br) = (hexc(c) for c in CORNERS)
        ring = (
            f'<defs><linearGradient id="t"><stop offset="0" stop-color="{tl}"/><stop offset="1" stop-color="{tr}"/></linearGradient>'
            f'<linearGradient id="b"><stop offset="0" stop-color="{bl}"/><stop offset="1" stop-color="{br}"/></linearGradient>'
            f'<linearGradient id="v" x2="0" y2="1"><stop offset="{BLEND[0]}" stop-color="#fff" stop-opacity="0"/>'
            f'<stop offset="{BLEND[1]}" stop-color="#fff"/></linearGradient>'
            f'<mask id="m"><rect width="32" height="32" fill="url(#v)"/></mask></defs>'
            f'<rect width="32" height="32" rx="{RADIUS}" fill="url(#t)"/>'
            f'<rect width="32" height="32" rx="{RADIUS}" fill="url(#b)" mask="url(#m)"/>'
        )
    else:
        ring = f'<rect width="32" height="32" rx="{RADIUS}" fill="{hexc(RING_OFF)}"/>'
    inner = (
        f'<rect x="{RING}" y="{RING}" width="{32 - 2 * RING}" height="{32 - 2 * RING}" '
        f'rx="{RADIUS - RING + 0.5:g}" fill="{hexc(INK)}"/>'
    )
    d = "".join("M" + "L".join(f"{x:g} {y:g}" for x, y in pts) + "Z" for _, pts in LETTERS)
    letters = f'<path fill="#fff" stroke="#fff" stroke-width="{STROKE}" stroke-linejoin="round" d="{d}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">{ring}{inner}{letters}</svg>\n'


if __name__ == "__main__":
    from app import paths

    static = paths.STATIC
    (static / "favicon.svg").write_text(svg(True), encoding="utf-8")
    (static / "favicon-off.svg").write_text(svg(False), encoding="utf-8")
    print("favicons rewritten")
