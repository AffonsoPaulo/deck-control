"""O desenho nas telas do Deck.

DrawQueue: o que mudou e ainda não foi para o aparelho (teclas sujas, brilho, marcas de erro e a última leitura
das teclas que mostram valores). Todas as peças marcam aqui; só o laço do engine esvazia. A trava é de quem chama:
cada método mexe só nos campos, e quem chama segura a trava do engine (shared.lock) exatamente onde ela sempre
esteve (as exceções, que travam sozinhas, dizem isso).

Drawing: o que cada tecla mostra agora (resposta temporária, bloco, regras e valores), a imagem dela, o envio ao
Deck só do que mudou de fato e os quadros dos GIFs.

Threads: marcar a fila vem de qualquer uma (ações, editor, plugins); esvaziar, desenhar e animar só no laço do
engine.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection
from typing import TYPE_CHECKING, Any

from app import icons, logs, values
from app.engine.core import Shared
from app.i18n import tr
from d6 import render
from d6.device import KEY_COUNT

if TYPE_CHECKING:
    from PIL import Image

    from app.config import KeySpec
    from app.engine.navigation import Navigation
    from app.engine.states import StateTable
    from app.values import Values
    from d6.device import D6

klog = logs.get("keys")
dlog = logs.get("device")  # USB: conectar, desconectar, desenhar

ERROR_MARK_S = 1.0  # quanto tempo a tecla mostra a marca de erro

ALL_KEYS = range(1, KEY_COUNT + 1)
SKIP = "skip"  # _transition_for: não redesenha agora (a virada em andamento termina sozinha)
TRANSITIONS = {"flip"}  # as que o app sabe fazer (as outras, de versões mais novas, desenham direto)


class DrawQueue:
    def __init__(self, shared: Shared) -> None:
        self._shared = shared
        self._dirty: set[int] = set(ALL_KEYS)
        self.brightness: int = shared.cfg.brightness
        self._brightness_dirty = False
        self.dyn: dict[int, str] = {}  # tecla que mostra valores -> último ícone resolvido
        self.errors: dict[
            int, dict[str, Any]
        ] = {}  # tecla -> marca de erro {at, until} (until None: ainda não desenhou)

    # -- teclas a redesenhar
    def mark(self, key: int) -> None:
        self._dirty.add(key)

    def mark_all(self) -> None:
        self._dirty = set(ALL_KEYS)

    def take(self, only: set[int] | None = None) -> tuple[set[int], int | None]:
        """Esvazia a fila: (teclas a redesenhar, brilho novo ou None). Com `only`, tira só essas teclas
        (as outras continuam esperando); o brilho vai junto, porque é um comando curto."""
        if only is None:
            dirty, self._dirty = self._dirty, set()
        else:
            dirty = self._dirty & only
            self._dirty -= dirty
        bright = self.brightness if self._brightness_dirty else None
        self._brightness_dirty = False
        return dirty, bright

    def forget_dynamic(self) -> None:
        """Esquece a última leitura das teclas com valores (página nova, config novo): redesenham na próxima."""
        self.dyn.clear()

    # -- brilho
    def set_brightness(self, value: int, relative: bool = False) -> None:
        if relative:
            value = self.brightness + value
            if value > 100:
                value = 10
            elif value < 10:
                value = 100
        self.brightness = max(0, min(100, value))
        self._brightness_dirty = True

    def reload_brightness(self, value: int) -> None:
        if value != self.brightness:
            self.brightness, self._brightness_dirty = value, True

    # -- marca de erro
    def mark_error(self, key: int) -> None:
        self.errors[key] = {"at": self._shared.clock.monotonic(), "until": None}
        self._dirty.add(key)

    def clear_errors(self) -> None:
        self.errors.clear()

    def expire_errors(self, now: float) -> None:
        """Tira as marcas de erro vencidas (trava sozinha, como sempre fez)."""
        if self.errors:
            with self._shared.lock:
                for key, m in list(self.errors.items()):
                    # acabou o tempo, ou nunca chegou a desenhar (tecla presa, Deck fora): some
                    if (m["until"] is not None and now >= m["until"]) or now - m["at"] > 10:
                        del self.errors[key]
                        self._dirty.add(key)  # volta ao normal


Icon = dict[str, Any]


class Drawing:
    def __init__(self, shared: Shared, queue: DrawQueue, nav: Navigation, states: StateTable, values_: Values) -> None:
        self._shared = shared
        self._queue = queue
        self._nav = nav
        self._states = states
        self._values = values_
        self._sent: dict[int, str] = {}  # hash do JPEG atualmente em cada tecla
        self._anims: dict[int, dict[str, Any]] = {}  # tecla -> GIF tocando (quadros, durações, posição)
        self._frame_cache: dict[str, tuple[list[bytes], list[float]]] = {}
        self._dyn_at = 0.0
        # o que cada tecla mostrou por último e de onde veio (página, tecla do config, resposta): a virada dos
        # números só anima quando é a mesma tecla mudando de texto
        self._shown: dict[int, tuple[tuple[Any, ...], Icon | None]] = {}
        self._fast_poll: tuple[tuple[str, int], bool] | None = None
        # GIF que toca uma vez ("loop": false) e já terminou: tecla -> (de onde veio, ícone). Não recomeça
        # por um redesenho qualquer (estado, aperto, reconexão): só quando o ícone ou a página mudam
        self._played: dict[int, tuple[tuple[Any, ...], str]] = {}
        self._played_page: str | None = None  # trocou de página: os GIFs de tocar uma vez tocam de novo ao voltar
        self._slices: dict[tuple[str, float, int, int, int], Image.Image] = {}  # bloco "imagem contínua", já cortada

    # -- o Deck (re)conectou ou caiu
    def forget_screens(self) -> None:
        """O D6 pode ter perdido as imagens: todas vão de novo (quem chama segura a trava)."""
        self._sent.clear()
        self._shown.clear()  # sem virada no redesenho da reconexão
        self._queue.mark_all()

    def stop_animations(self) -> None:
        self._anims.clear()

    def restart_animation(self, key: int) -> None:
        """A tecla saiu do aperto: o GIF dela recomeça no próximo envio (a tela estava com a imagem encolhida).
        O que toca uma vez não recomeça: vai direto para o último quadro."""
        a = self._anims.pop(key, None)
        if a is not None and "once" in a:
            self._played[key] = a["once"]

    def forget_slices(self) -> None:
        self._slices.clear()

    # -- marca de erro
    def action_failed(self, key: int, page: str | None = None) -> None:
        """Uma ação da tecla deu erro: ela mostra a marca de erro por 1 s (config logging.key_error)."""
        if not isinstance(key, int) or not 1 <= key <= KEY_COUNT:
            return  # automação (tecla 0) ou fora do Deck
        if page is not None and page != self._nav.page:
            return  # a página já mudou: a tecla na tela é outra
        if logs.setting(self._shared.cfg.raw.get("logging"), "key_error", True) is False:
            return
        with self._shared.lock:
            self._queue.mark_error(key)
        klog.debug("Key %d shows the error mark for %g s", key, ERROR_MARK_S)

    # -- o que a tecla mostra
    def icon_for(self, key: int) -> Icon | None:
        """O ícone da tecla agora: resposta temporária, bloco, regras e valores já resolvidos."""
        ov = self._nav.overlay
        if ov is not None:
            painted: Icon = ov["icon"]
            return painted
        t = self._nav.temp
        if t is not None and key == t.get("close_key") and self._nav.page == t["page"]:
            left = max(0.0, t["until"] - self._shared.clock.monotonic())
            return {
                "lucide": "x",
                "text": tr("Close"),
                "bg": "#262d38",
                "style": "info",
                "bar": {"pct": 100 * left / t["total"] if t["total"] else 0, "color": "#eceef2"},
            }
        spec, idx = self._shared.cfg.spec_at(self._nav.page, key)
        if spec is None:
            return None
        if spec.span != (1, 1) and spec.mode == "image":
            return {"__slice__": idx, "__anchor__": spec}
        if spec.span != (1, 1) and spec.cells:
            icon = dict(spec.cells[idx]) if idx < len(spec.cells) else {}
        else:
            active = spec.state is not None and self._states.flags.get(spec.state, False)
            icon = dict(spec.active_icon if active else spec.icon)
        for rule in spec.rules:
            if values.test(rule.get("if"), self._values.get):
                icon.update(rule.get("icon") or {})
                break
        return self._resolve(icon) if spec.dynamic else icon

    def _resolve(self, icon: Icon) -> Icon:
        return values.resolve_icon(icon, self._values.get)

    def _block_slice(self, key: int, icon: Icon) -> Image.Image:
        """Bloco "imagem contínua": a imagem cobre o bloco inteiro, pulando o vão entre as telas."""
        from PIL import Image, ImageOps

        cfg = self._shared.cfg
        spec: KeySpec = icon["__anchor__"]
        idx: int = icon["__slice__"]
        cols, rows = spec.span
        gap = int((cfg.raw.get("device") or {}).get("gap_px", 28))
        tile = icons.SIZE
        src = (spec.icon or {}).get("image")
        if not src:
            return icons.render_icon(spec.icon, cfg.base_dir)
        path = icons._image_path({"image": src}, cfg.base_dir)
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = 0
        ck = (str(path), mtime, cols, rows, gap)
        if ck not in self._slices:
            w, h = cols * tile + (cols - 1) * gap, rows * tile + (rows - 1) * gap
            try:
                big = ImageOps.fit(Image.open(path).convert("RGB"), (w, h), Image.Resampling.LANCZOS)
            except (OSError, ValueError) as e:
                logs.get("icons").warning("Couldn't open the block image %s: %s", path, e)
                return icons.render_icon({"text": "?"}, cfg.base_dir)
            self._slices[ck] = big
            if len(self._slices) > 8:
                self._slices.pop(next(iter(self._slices)))
        big = self._slices[ck]
        c, r = idx % cols, idx // cols
        x, y = c * (tile + gap), r * (tile + gap)
        return big.crop((x, y, x + tile, y + tile))

    def _poll_s(self) -> float:
        """De quanto em quanto tempo conferir os valores: 0,5 s, ou 0,1 s se a página mostra segundos (a virada
        dos segundos sai no ritmo certo, sem atrasar até meio segundo)."""
        cfg = self._shared.cfg
        k = (self._nav.page, id(cfg))
        if self._fast_poll is None or self._fast_poll[0] != k:
            specs = cfg.page_keys(self._nav.page).values()
            fast = any("clock.second" in repr((s.icon, s.cells, s.rules)) for s in specs if s.dynamic)
            self._fast_poll = (k, fast)
        return 0.1 if self._fast_poll[1] else 0.5

    def refresh_dynamic(self) -> None:
        """Duas vezes por segundo (dez, com segundos na página): redesenha só as teclas cujos valores mudaram."""
        now = self._shared.clock.monotonic()
        if now - self._dyn_at < self._poll_s():
            return
        self._dyn_at = now
        if self._nav.overlay is not None:
            return
        for key in ALL_KEYS:
            spec = self._shared.cfg.spec_at(self._nav.page, key)[0]
            if spec is None or not spec.dynamic:
                continue
            sig = repr(sorted((self.icon_for(key) or {}).items(), key=str))
            if self._queue.dyn.get(key) != sig:
                self._queue.dyn[key] = sig
                with self._shared.lock:
                    self._queue.mark(key)
        t = self._nav.temp
        if t is not None and t.get("close_key"):
            with self._shared.lock:
                self._queue.mark(t["close_key"])

    # -- a imagem
    def _still_for(self, key: int) -> Image.Image:
        """Imagem (PIL) da tecla agora; de um GIF, o primeiro quadro."""
        icon = self.icon_for(key)
        if icon is None:
            return icons.BLANK
        if "__slice__" in icon:
            return self._block_slice(key, icon)
        cfg = self._shared.cfg
        defaults = cfg.raw.get("icons")
        if not (icon or {}).get("image"):
            return icons.render_icon(icon, cfg.base_dir, defaults)
        return icons.render_frames(icon, cfg.base_dir, defaults)[0][0]

    def _frames_for(self, key: int) -> tuple[list[bytes], list[float]]:
        """JPEGs da tecla e a duração de cada um (s). Um só quadro se não for GIF animado."""
        if key in self._queue.errors:
            return [render.encode(icons.error_mark(self._still_for(key)))], [0.0]
        icon = self.icon_for(key)
        if icon is None:
            return [render.encode(icons.BLANK)], [0.0]
        if "__slice__" in icon:
            return [render.encode(self._block_slice(key, icon))], [0.0]
        cfg = self._shared.cfg
        defaults = cfg.raw.get("icons")
        if not (icon or {}).get("image"):
            return [render.encode(icons.render_icon(icon, cfg.base_dir, defaults))], [0.0]
        # GIF: codificar todos os quadros custa; guarda o resultado por ícone + data do arquivo
        try:
            mtime = icons._image_path(icon, cfg.base_dir).stat().st_mtime
        except OSError:
            mtime = 0
        ck = repr((sorted(icon.items(), key=str), defaults, mtime))
        if ck not in self._frame_cache:
            frames = icons.render_frames(icon, cfg.base_dir, defaults)
            if len(self._frame_cache) > 24:
                self._frame_cache.clear()
            self._frame_cache[ck] = ([render.encode(img) for img, _ in frames], [ms / 1000 for _, ms in frames])
        return self._frame_cache[ck]

    # -- o envio
    def flush(self, deck: D6, sunk: Collection[int] = (), only: set[int] | None = None) -> None:
        """Manda ao Deck o brilho novo e as teclas marcadas cuja imagem mudou de fato.
        sunk: teclas apertadas que mostram a tela encolhida. only: manda só essas (as outras esperam)."""
        clock = self._shared.clock
        if self._nav.page != self._played_page:
            self._played.clear()
            self._played_page = self._nav.page
        with self._shared.lock:
            dirty, bright = self._queue.take(only)
        if bright is not None:
            deck.set_brightness(bright)
        if not dirty:
            return
        tiles: dict[int, bytes] = {}
        skipped: list[int] = []
        now = clock.monotonic()
        t_render = clock.monotonic()
        with self._shared.lock:
            for key in sorted(dirty):
                if key in sunk:
                    # apertada: a imagem de agora, encolhida (o GIF dela fica parado até soltar)
                    pressed = render.encode(icons.pressed_image(self._still_for(key)))
                    digest = hashlib.sha1(pressed).hexdigest()
                    if self._sent.get(key) != digest:
                        tiles[key] = pressed
                        self._sent[key] = digest
                    continue
                flip = self._transition_for(key)
                if flip == SKIP:
                    continue  # a virada para este mesmo texto ainda está andando: deixa terminar
                if isinstance(flip, bytes):
                    tiles[key] = flip
                    self._sent[key] = hashlib.sha1(flip).hexdigest()
                    continue
                jpegs, durations = self._frames_for(key)
                mark = self._queue.errors.get(key)
                if mark is not None and mark["until"] is None:
                    mark["until"] = now + ERROR_MARK_S  # o 1 s conta a partir de quando aparece
                if len(jpegs) > 1:
                    old = self._anims.get(key)
                    once = self._once_sig(key)
                    if once is not None and self._played.get(key) == once:
                        self._anims.pop(key, None)
                        data = jpegs[-1]  # já tocou: fica no último quadro
                        digest = hashlib.sha1(data).hexdigest()
                        if self._sent.get(key) != digest:
                            tiles[key] = data
                            self._sent[key] = digest
                        continue
                    if old is None or old.get("jpegs") is not jpegs:
                        self._anims[key] = {"jpegs": jpegs, "durations": durations, "i": 0, "due": now + durations[0]}
                        if once is not None:
                            self._anims[key]["once"] = once
                    else:
                        continue  # o mesmo GIF já está tocando
                else:
                    self._anims.pop(key, None)
                data = jpegs[0]
                digest = hashlib.sha1(data).hexdigest()
                if self._sent.get(key) != digest:
                    tiles[key] = data
                    self._sent[key] = digest
                else:
                    skipped.append(key)
        if skipped:
            dlog.debug("Skipped redraw of keys %s (same image)", skipped)
        if tiles:
            t0 = clock.monotonic()
            opts = dict(self._shared.cfg.draw_options)
            if opts.pop("session", False):
                # modo antigo: abre uma sessão (a iluminação pisca); só por segurança
                deck.draw(tiles, brightness=self._queue.brightness, **opts)
            else:
                for key in sorted(tiles, key=deck.screen_for_key):
                    deck.push(key, tiles[key])
            dlog.debug(
                "Drew keys %s in %d ms (render %d ms, %d bytes)",
                sorted(tiles),
                round((clock.monotonic() - t0) * 1000),
                round((t0 - t_render) * 1000),
                sum(len(b) for b in tiles.values()),
            )

    # -- transições entre o que a tecla mostrava e o novo (célula com "transition"; hoje: "flip", a virada dos
    # números: o texto que muda desce e o novo entra por cima). Nome desconhecido: desenha direto.
    def _ident(self, key: int) -> tuple[Any, ...]:
        """De onde vem o que a tecla mostra: muda com a página, o config, a resposta temporária."""
        spec, idx = self._shared.cfg.spec_at(self._nav.page, key)
        t = self._nav.temp
        close = t is not None and key == t.get("close_key")
        return (self._nav.page, id(spec), idx, id(self._nav.overlay), close)

    def _transition_for(self, key: int) -> bytes | str | None:
        """Se a tecla vai virar (mesma tecla, texto novo), começa a virada e devolve o 1º quadro (bytes);
        SKIP se a virada para este mesmo texto já está andando; None para o desenho normal.
        Quem chama segura a trava. Guarda o que a tecla passa a mostrar."""
        icon = self.icon_for(key)
        ident = self._ident(key)
        prev = self._shown.get(key)
        running = self._anims.get(key)
        if running is not None and "plan" in running and running["icon"] == icon:
            return SKIP
        self._shown[key] = (ident, icon)
        if (
            key in self._queue.errors
            or not icon
            or "__slice__" in icon
            or icon.get("transition") not in TRANSITIONS
            or prev is None
            or prev[0] != ident
            or not prev[1]
            or prev[1].get("transition") != icon.get("transition")
            or prev[1] == icon
        ):
            return None
        cfg = self._shared.cfg
        plan = icons.flip_plan(prev[1], icon, cfg.base_dir, cfg.raw.get("icons"))
        if plan is None:
            return None
        now = self._shared.clock.monotonic()
        self._anims[key] = {"plan": plan, "icon": icon, "i": 1, "due": now + icons.FLIP_FRAME_S}
        return render.encode(plan.frame(1))

    def _once_sig(self, key: int) -> tuple[tuple[Any, ...], str] | None:
        """Assinatura do GIF que toca uma vez nesta tecla agora (de onde vem + ícone), ou None se ele repete."""
        icon = self.icon_for(key)
        if not icon or icon.get("loop") is not False:
            return None
        return (self._ident(key), repr(sorted(icon.items(), key=str)))

    # -- GIFs
    def next_frame_due(self) -> float | None:
        """Quando vence o próximo quadro de GIF (None = nenhum GIF tocando)."""
        if not self._anims:
            return None
        due: float = min(a["due"] for a in self._anims.values())
        return due

    def advance_animations(self, deck: D6, skip: Collection[int] = ()) -> None:
        """Manda o próximo quadro de cada GIF cuja hora chegou (um envio curto por quadro).
        skip: teclas apertadas (mostram a tela encolhida; o GIF delas espera soltar)."""
        if not self._anims:
            return
        now = self._shared.clock.monotonic()
        for key, a in list(self._anims.items()):
            if now < a["due"] or key in skip:
                continue
            if "plan" in a:  # virada: um quadro por vez, montado agora; no último, para
                a["i"] += 1
                data = render.encode(a["plan"].frame(a["i"]))
                deck.push(key, data)
                self._sent[key] = hashlib.sha1(data).hexdigest()
                if a["i"] >= a["plan"].n:
                    del self._anims[key]
                    continue
                a["due"] += icons.FLIP_FRAME_S
                if a["due"] < now:
                    a["due"] = now + icons.FLIP_FRAME_S
                continue
            a["i"] = (a["i"] + 1) % len(a["jpegs"])
            data = a["jpegs"][a["i"]]
            deck.push(key, data)
            self._sent[key] = hashlib.sha1(data).hexdigest()
            if "once" in a and a["i"] == len(a["jpegs"]) - 1:
                # tocou uma vez ("loop": false): para no último quadro
                self._played[key] = a["once"]
                del self._anims[key]
                continue
            a["due"] += a["durations"][a["i"]]
            if a["due"] < now:  # atrasou muito (desenho longo): ressincroniza
                a["due"] = now + a["durations"][a["i"]]
