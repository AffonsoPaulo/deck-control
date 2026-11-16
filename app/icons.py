"""Transforma a descrição de um ícone (do config.yaml) numa imagem 112x112.

Layout fixo: o ícone (glifo ou imagem) tem sempre o mesmo tamanho e a mesma
posição, com ou sem texto, para as teclas ficarem alinhadas entre si. O texto
tem tamanho fixo; se não couber, primeiro quebra em duas linhas e só então
diminui.

Estilos (campo 'style' do ícone, ou 'icons: style:' no config para todas):
    below   ícone + texto numa faixa embaixo (padrão)
    top     texto numa faixa em cima + ícone embaixo
    big     só o ícone, grande (o texto não aparece)
Sem ícone nem imagem, o texto fica centralizado e maior, em qualquer estilo.

Campos do ícone (todos opcionais):
    bg, fg       cores de fundo e do texto/glifo ("#5865F2", "white"...)
    bg_to        segunda cor: o fundo vira um degradê de 'bg' até 'bg_to'
    bg_dir       direção do degradê: down (padrão) | right | diagonal | radial
    text         texto (Enter/\\n quebra linha)
    text_size    tamanho do texto (padrão 16, ou o de 'icons: text_size:')
    lucide       ícone do Lucide, pelo nome ("mic", "circle-dot"; lista em lucide.dev/icons)
    glyph        ícone da fonte Segoe Fluent Icons, em hexadecimal ("E720"); formato antigo, ainda aceito
    glyph_size   tamanho do ícone (padrão depende do estilo)
    image        caminho de uma imagem, relativo ao config.yaml (GIF animado anima)
    image_scale  fração da tecla ocupada pela imagem (0..1)
    image_fill   true: a imagem cobre a tecla toda (texto e fundo não aparecem)
    border       cor de uma borda de 4 px
    style        below | top | big
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont, ImageOps, ImageSequence

from app import logs
from d6 import render

log = logs.get("icons")
SIZE = render.TILE
STYLES = ("below", "top", "big")
TEXT_SIZE = 16          # texto junto com ícone
TEXT_ONLY_RATIO = 1.4   # texto sozinho fica 40% maior
MAX_W = SIZE - 12
MAX_FRAMES = 120        # GIFs maiores perdem quadros (a duração total se mantém)
MIN_FRAME_MS = 50       # mais rápido que isso o D6 não acompanha

# posições (em px, tecla de 112) de cada estilo: centro do ícone, tamanho do glifo,
# lado máximo da imagem e centro da faixa de texto (1 linha / 2 linhas)
LAYOUT = {
    "below": {"art_y": 50, "glyph": 48, "image": 56, "text_y": (94, 91)},
    "top":   {"art_y": 66, "glyph": 46, "image": 54, "text_y": (18, 21)},
    "big":   {"art_y": 56, "glyph": 66, "image": 88, "text_y": None},
}


# Ícones Segoe (formato antigo, campo 'glyph') -> o equivalente no Lucide (campo 'lucide')
SEGOE_TO_LUCIDE = {
    "E720": "mic", "EC54": "mic-off", "E7F6": "headphones", "E767": "volume-1", "E74F": "volume-x", "E993": "volume-1",
    "E995": "volume-2", "E768": "play", "E769": "pause", "E71A": "square", "E892": "skip-back", "E893": "skip-forward",
    "E8B1": "shuffle", "E8EE": "repeat", "E8D6": "music", "E7C8": "circle-dot", "E93E": "radio", "E714": "video",
    "E722": "camera", "E7F4": "monitor", "E7FC": "gamepad-2", "E8BD": "message-square", "E8F2": "messages-square",
    "E715": "mail", "E717": "phone", "E774": "globe", "E80F": "house", "E72B": "arrow-left", "E72A": "arrow-right",
    "E8B7": "folder", "E8A5": "file-text", "E70B": "sticky-note", "E765": "keyboard", "E713": "settings", "E706": "sun",
    "E708": "moon", "E7E8": "power", "E72E": "lock", "E785": "lock-open", "E77B": "user", "E716": "users", "E734": "star",
    "E735": "star", "EB51": "heart", "EB52": "heart", "E945": "zap", "E968": "network", "E896": "download", "E898": "upload",
    "E74E": "save", "E74D": "trash-2", "E710": "plus", "E738": "minus", "E711": "x", "E73E": "check", "E7BA": "triangle-alert",
    "E946": "info", "E897": "circle-help", "E8C8": "copy", "E77F": "clipboard-paste", "E8C6": "scissors", "E7A7": "undo-2",
    "E7A6": "redo-2", "E72C": "refresh-cw", "E787": "calendar", "E823": "clock", "E916": "timer", "E7B3": "eye",
    "ED1A": "eye-off", "E8A7": "app-window", "E790": "palette", "E771": "paintbrush", "EA8F": "bell", "E7F8": "laptop",
    "E701": "wifi", "E702": "bluetooth", "E719": "store", "E7BF": "shopping-cart", "E8EC": "tag", "E718": "pin",
    "E71C": "filter", "E721": "search", "E8FD": "list", "E700": "menu", "E81C": "history", "E8F1": "library",
    "E756": "terminal", "E71B": "link", "E70F": "text-cursor-input",
}

_GLYPH_FONTS = ("SegoeIcons.ttf", "segmdl2.ttf")
_STATIC = Path(__file__).parent / "editor" / "static"
_LUCIDE_TTF = _STATIC / "fonts" / "lucide.ttf"
_lucide_codes: dict[str, int] | None = None
_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _glyph_font(size: int):
    key = ("glyph", size)
    if key not in _font_cache:
        for name in _GLYPH_FONTS:
            try:
                _font_cache[key] = ImageFont.truetype(name, size)
                break
            except OSError:
                continue
        else:
            _font_cache[key] = render._font(size)
    return _font_cache[key]


def _lucide_font(size: int):
    key = ("lucide", size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(str(_LUCIDE_TTF), size)
    return _font_cache[key]


def lucide_code(name) -> int | None:
    """Código do ícone na fonte do Lucide, ou None se o nome não existir."""
    global _lucide_codes
    if _lucide_codes is None:
        import json
        try:
            data = json.loads((_STATIC / "lucide-index.json").read_text(encoding="utf-8"))
            _lucide_codes = {k: v[0] for k, v in data.items()}
        except (OSError, ValueError):
            _lucide_codes = {}
    return _lucide_codes.get(str(name or "").strip())


def _draw_lucide(img, name: str, size: int, cy: float, fg) -> None:
    """Desenha um ícone do Lucide centrado em (meio, cy).

    O traço do Lucide é fino para a tela de 112 px. Desenha em tamanho dobrado com 1 px de
    contorno e reduz: o traço engrossa meio pixel de cada lado (1 px inteiro ficava pesado demais).
    """
    k = 2
    layer = Image.new("L", (SIZE * k, SIZE * k), 0)
    ImageDraw.Draw(layer).text((SIZE * k / 2, cy * k), chr(lucide_code(name)), font=_lucide_font(size * k),
                               fill=255, anchor="mm", stroke_width=1, stroke_fill=255)
    mask = layer.resize((SIZE, SIZE), Image.LANCZOS)
    img.paste(Image.new("RGB", (SIZE, SIZE), fg), (0, 0), mask)


def merge_icon(icon: dict, override: dict) -> dict:
    """Ícone ativo = o normal com o que o ativo muda. Se o ativo troca o ícone, o do normal sai
    (sem isso, um 'lucide' do normal ganharia de um 'glyph' do ativo, e vice-versa)."""
    out = {**icon, **override}
    if "lucide" in override and "glyph" not in override:
        out.pop("glyph", None)
    if "glyph" in override and "lucide" not in override:
        out.pop("lucide", None)
    return out


def _color(value, default):
    if value is None:
        value = default
    if isinstance(value, (list, tuple)):
        return tuple(int(v) for v in value[:3])
    return ImageColor.getrgb(str(value))[:3]


def _glyph_char(glyph) -> str:
    g = str(glyph)
    if len(g) in (4, 5) and all(c in "0123456789abcdefABCDEF" for c in g):
        return chr(int(g, 16))
    return g


# -- texto --------------------------------------------------------------------------

def _wrap(draw, text: str, font) -> list[str]:
    """Quebra cada linha longa em duas, no espaço que deixa as metades mais parecidas."""
    lines: list[str] = []
    for raw in text.split("\n"):
        words = raw.split()
        if len(words) < 2 or draw.textlength(raw, font=font) <= MAX_W:
            lines.append(raw)
            continue
        best = None
        for i in range(1, len(words)):
            a, b = " ".join(words[:i]), " ".join(words[i:])
            w = max(draw.textlength(a, font=font), draw.textlength(b, font=font))
            if best is None or w < best[0]:
                best = (w, a, b)
        lines += [best[1], best[2]]
    return lines


def _layout_text(draw, text: str, size: int, max_lines: int, min_size: int = 9):
    """Tamanho fixo; só diminui se nem quebrando em linhas couber."""
    while True:
        font = render._font(size)
        lines = _wrap(draw, text, font)
        fits = len(lines) <= max_lines and all(draw.textlength(l, font=font) <= MAX_W for l in lines)
        if fits or size <= min_size:
            return font, lines[:max_lines]
        size -= 1


def _draw_lines(draw, lines, font, center_y: float, fill) -> None:
    line_h = round(font.size * 1.18)
    top = center_y - line_h * (len(lines) - 1) / 2
    for i, line in enumerate(lines):
        draw.text((SIZE / 2, top + i * line_h), line, font=font, fill=fill, anchor="mm")


# -- ícone ----------------------------------------------------------------------------

def render_icon(spec: dict | None, base_dir: Path | None = None, defaults: dict | None = None) -> Image.Image:
    """defaults: a seção 'icons:' do config (style, text_size) para todas as teclas.
    Com GIF animado, devolve só o primeiro quadro (ver render_frames)."""
    return _render(spec, base_dir, defaults, None)


def render_frames(spec: dict | None, base_dir: Path | None = None,
                  defaults: dict | None = None) -> list[tuple[Image.Image, int]]:
    """Quadros do ícone com a duração de cada um (ms). Um só quadro se não for animado."""
    spec = spec or {}
    frames = _gif_frames(_image_path(spec, base_dir)) if spec.get("image") else None
    if not frames or len(frames) < 2:
        return [(_render(spec, base_dir, defaults, None), 0)]
    return [(_render(spec, base_dir, defaults, art), ms) for art, ms in frames]


def _render(spec, base_dir, defaults, art) -> Image.Image:
    spec = spec or {}
    defaults = defaults or {}
    bg = _color(spec.get("bg"), "#202020")
    fg = _color(spec.get("fg"), "white")
    img = _background(bg, spec)
    draw = ImageDraw.Draw(img)

    if spec.get("image") and spec.get("image_fill"):
        _fill_image(img, draw, spec, base_dir, art)
        if spec.get("border"):
            draw.rectangle([0, 0, SIZE - 1, SIZE - 1], outline=_color(spec["border"], "red"), width=4)
        return img

    if spec.get("sub") not in (None, "") or isinstance(spec.get("bar"), dict) or spec.get("style") == "info":
        _render_info(img, draw, spec, base_dir, art, fg)
        if spec.get("border"):
            draw.rectangle([0, 0, SIZE - 1, SIZE - 1], outline=_color(spec["border"], "red"), width=4)
        return img

    text = spec.get("text")
    text = str(text) if text not in (None, "") else None
    has_art = bool(spec.get("image") or spec.get("glyph") or lucide_code(spec.get("lucide")))
    style = spec.get("style") or defaults.get("style") or "below"
    if style not in STYLES:
        style = "below"
    lay = LAYOUT[style]
    base_size = int(spec.get("text_size") or defaults.get("text_size") or TEXT_SIZE)

    if has_art:
        art_y = lay["art_y"]
        if spec.get("image"):
            _paste_image(img, draw, spec, base_dir, art_y, lay["image"], art)
        elif lucide_code(spec.get("lucide")):
            _draw_lucide(img, spec["lucide"], int(spec.get("glyph_size") or lay["glyph"]), art_y, fg)
        else:
            size = int(spec.get("glyph_size") or lay["glyph"])
            draw.text((SIZE / 2, art_y), _glyph_char(spec["glyph"]), font=_glyph_font(size), fill=fg, anchor="mm")
        if text and lay["text_y"]:
            font, lines = _layout_text(draw, text, base_size, max_lines=2)
            _draw_lines(draw, lines, font, lay["text_y"][0 if len(lines) == 1 else 1], fg)
    elif text:
        # só texto: centralizado e maior, até 3 linhas
        font, lines = _layout_text(draw, text, round(base_size * TEXT_ONLY_RATIO), max_lines=3)
        _draw_lines(draw, lines, font, SIZE / 2, fg)

    if spec.get("border"):
        draw.rectangle([0, 0, SIZE - 1, SIZE - 1], outline=_color(spec["border"], "red"), width=4)
    return img


def _fit_one_line(draw, text: str, start: int, min_size: int = 10):
    """Maior fonte (até 'start') em que o texto cabe numa linha."""
    size = start
    while size > min_size:
        font = render._font(size)
        if draw.textlength(text, font=font) <= MAX_W:
            return font
        size -= 1
    return render._font(min_size)


def _render_info(img, draw, spec, base_dir, art, fg) -> None:
    """Tecla de informação: [ícone] + texto grande + linha menor + barra embaixo (medidor).
    Os valores já vêm resolvidos pelo engine (o texto final, a porcentagem da barra, a cor)."""
    text = str(spec.get("text")) if spec.get("text") not in (None, "") else ""
    sub = str(spec.get("sub")) if spec.get("sub") not in (None, "") else ""
    bar = spec.get("bar") if isinstance(spec.get("bar"), dict) else None
    has_art = bool(spec.get("image") or lucide_code(spec.get("lucide")))
    sub_fg = _color(spec["sub_fg"], None) if spec.get("sub_fg") else tuple(min(255, int(c * .78 + 30)) for c in fg)
    bar_h = 12 if bar else 0
    # alturas de cada parte, distribuídas no espaço útil
    parts = []
    if has_art:
        parts.append(("art", 30 if (text and sub) else 40 if (text or sub) else 64))
    if text:
        big = int(spec.get("text_size") or (26 if has_art and sub else 30 if has_art or sub else 40))
        parts.append(("text", big))
    if sub:
        parts.append(("sub", 14))
    gap = 5
    total = sum(h for _, h in parts) + gap * max(0, len(parts) - 1)
    y = (SIZE - bar_h - total) / 2 + (2 if bar else 0)
    for kind, h in parts:
        cy = y + h / 2
        if kind == "art":
            if spec.get("image"):
                _paste_image(img, draw, spec, base_dir, int(cy), h + 4, art)
            else:
                _draw_lucide(img, spec["lucide"], h, cy, fg)
        elif kind == "text":
            font = _fit_one_line(draw, text, h)
            draw.text((SIZE / 2, cy), text, font=font, fill=fg, anchor="mm")
        else:
            font = _fit_one_line(draw, sub, h, 9)
            draw.text((SIZE / 2, cy), sub, font=font, fill=sub_fg, anchor="mm")
        y += h + gap
    if spec.get("edge"):                    # ex.: ":" na borda de dentro, entre duas teclas de um bloco
        side = spec.get("edge_side", "right")
        ex = SIZE - 7 if side == "right" else 7
        draw.text((ex, SIZE / 2 - 2), str(spec["edge"]), font=render._font(30), fill=sub_fg, anchor="mm")
    if bar:
        try:
            pct = max(0.0, min(100.0, float(bar.get("pct", 0))))
        except (TypeError, ValueError):
            pct = 0.0
        x0, x1, yb = 14, SIZE - 14, SIZE - 14
        draw.rounded_rectangle([x0, yb - 3, x1, yb + 3], radius=3, fill=_color(bar.get("track"), (52, 60, 73)))
        if pct > 0:
            draw.rounded_rectangle([x0, yb - 3, max(x0 + 6, x0 + (x1 - x0) * pct / 100), yb + 3], radius=3,
                                   fill=_color(bar.get("color"), (245, 165, 36)))


def block_slices(path: Path, cols: int, rows: int, gap: int) -> list[Image.Image]:
    """Uma imagem cobrindo um bloco de teclas, pulando o vão entre as telas, cortada em cada tecla."""
    w, h = cols * SIZE + (cols - 1) * gap, rows * SIZE + (rows - 1) * gap
    big = ImageOps.fit(Image.open(path).convert("RGB"), (w, h), Image.Resampling.LANCZOS)
    return [big.crop((c * (SIZE + gap), r * (SIZE + gap), c * (SIZE + gap) + SIZE, r * (SIZE + gap) + SIZE))
            for r in range(rows) for c in range(cols)]


def _background(bg, spec) -> Image.Image:
    """Cor sólida, ou degradê de 'bg' até 'bg_to'."""
    if not spec.get("bg_to"):
        return Image.new("RGB", (SIZE, SIZE), bg)
    try:
        to = _color(spec["bg_to"], "#000000")
    except ValueError:
        return Image.new("RGB", (SIZE, SIZE), bg)
    direction = spec.get("bg_dir") or "down"
    # máscara 0..255: 0 = cor inicial, 255 = cor final
    if direction == "radial":
        mask = Image.radial_gradient("L").resize((SIZE, SIZE))        # escuro no centro
        mask = mask.point(lambda v: min(255, int(v * 1.42)))           # chega na cor final nos cantos
    else:
        mask = Image.linear_gradient("L").resize((SIZE, SIZE))         # de cima para baixo
        if direction == "right":
            mask = mask.rotate(90)                                    # 0 fica à esquerda
        elif direction == "diagonal":
            big = Image.linear_gradient("L").resize((SIZE * 2, SIZE * 2)).rotate(45, resample=Image.Resampling.BILINEAR)
            off = SIZE // 2
            mask = big.crop((off, off, off + SIZE, off + SIZE))
    return Image.composite(Image.new("RGB", (SIZE, SIZE), to), Image.new("RGB", (SIZE, SIZE), bg), mask)


def _fill_image(img, draw, spec, base_dir, art) -> None:
    path = _image_path(spec, base_dir)
    try:
        if art is None:
            art = Image.open(path).convert("RGBA")
        art = ImageOps.fit(art, (SIZE, SIZE), Image.Resampling.LANCZOS)   # cobre a tecla, corta as sobras
        img.paste(art, (0, 0), art)
    except (OSError, ValueError) as e:
        draw.text((SIZE / 2, SIZE / 2), "?", font=render._font(40), fill=(255, 80, 80), anchor="mm")
        _warn_once(path, "Couldn't open the image %s: %s", e)


_warned: set[str] = set()


def _warn_once(path, msg: str, e) -> None:
    """Imagem que falta é redesenhada várias vezes: avisa uma vez por arquivo, depois só no detalhado."""
    k = str(path)
    if k in _warned:
        log.debug(msg, path, e)
        return
    if len(_warned) > 200:
        _warned.clear()
    _warned.add(k)
    log.warning(msg, path, e)


def error_mark(img: Image.Image) -> Image.Image:
    """A tecla com a marca de erro: a imagem atual escurecida, com um círculo vermelho e um X branco."""
    base = img.convert("RGBA")
    if base.size != (SIZE, SIZE):
        base = base.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    out = Image.alpha_composite(base, Image.new("RGBA", base.size, (15, 18, 23, round(0.62 * 255))))
    ss = 4                                             # desenha 4x maior e reduz (bordas suaves)
    n = SIZE * ss
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c, r = n / 2, n * 0.24                             # círculo com 48% da tecla
    d.ellipse([c - r, c - r, c + r, c + r], fill=(0xB4, 0x23, 0x2A, 255))
    a, w = r * 0.42, max(ss, round(n * 0.05))
    for p, q in (((c - a, c - a), (c + a, c + a)), ((c - a, c + a), (c + a, c - a))):
        d.line([p, q], fill=(255, 255, 255, 255), width=w)
        for x, y in (p, q):                            # pontas arredondadas
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=(255, 255, 255, 255))
    layer = layer.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return Image.alpha_composite(out, layer).convert("RGB")


def _image_path(spec, base_dir) -> Path:
    path = Path(spec["image"]).expanduser()
    if base_dir and not path.is_absolute():
        path = base_dir / path
    return path


def _paste_image(img, draw, spec, base_dir, center_y: int, default_box: int, art=None) -> None:
    path = _image_path(spec, base_dir)
    try:
        if art is None:
            art = Image.open(path).convert("RGBA")
        art = art.copy()
        box = int(SIZE * float(spec["image_scale"])) if spec.get("image_scale") else default_box
        art.thumbnail((box, box), Image.Resampling.LANCZOS)
        img.paste(art, ((SIZE - art.width) // 2, int(center_y - art.height / 2)), art)
    except (OSError, ValueError) as e:
        draw.text((SIZE / 2, center_y), "?", font=render._font(40), fill=(255, 80, 80), anchor="mm")
        _warn_once(path, "Couldn't open the image %s: %s", e)


# -- GIF animado --------------------------------------------------------------------

_gif_cache: dict[tuple[str, float], list[tuple[Image.Image, int]] | None] = {}


def _gif_frames(path: Path) -> list[tuple[Image.Image, int]] | None:
    """Quadros (RGBA, já compostos) e durações em ms. None se não for animado."""
    try:
        key = (str(path), path.stat().st_mtime)
    except OSError:
        return None
    if key in _gif_cache:
        return _gif_cache[key]
    frames = None
    try:
        with Image.open(path) as im:
            if getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1:
                frames = []
                for fr in ImageSequence.Iterator(im):
                    ms = int(fr.info.get("duration") or 0)
                    frames.append((fr.convert("RGBA"), 100 if ms <= 10 else ms))  # como os navegadores
    except (OSError, ValueError) as e:
        _warn_once(path, "Couldn't read the frames of %s: %s", e)
        frames = None
    if frames:
        frames = _limit_frames(frames)
    if len(_gif_cache) > 32:
        _gif_cache.clear()
    _gif_cache[key] = frames
    return frames


def _limit_frames(frames):
    """Junta quadros rápidos demais e corta o excesso, mantendo o tempo total."""
    out: list[list] = []
    for img, ms in frames:
        if out and out[-1][1] < MIN_FRAME_MS:
            out[-1][1] += ms          # o anterior fica mais tempo; este é pulado
        else:
            out.append([img, ms])
    if len(out) > MAX_FRAMES:
        step = len(out) / MAX_FRAMES
        picked = []
        for i in range(MAX_FRAMES):
            a, b = int(i * step), int((i + 1) * step)
            picked.append([out[a][0], sum(ms for _, ms in out[a:b])])
        out = picked
    return [(img, max(MIN_FRAME_MS, ms)) for img, ms in out]


BLANK = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
