"""O anel de LEDs: o efeito do config (app/lighting.py), as reações às teclas e a cor temporária (light.flash).

Threads: update() só no laço do engine; flash() vem das ações (pool); now() é lido pelo editor.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

from app import lighting, logs, winutil
from app.engine.core import Shared

if TYPE_CHECKING:
    from app.config import KeySpec
    from d6.device import D6

log = logs.get("engine")

Rgb = tuple[int, int, int]


class Leds:
    def __init__(self, shared: Shared, page: Callable[[], str]) -> None:
        self._shared = shared
        self._page = page  # a página na tela agora (lida a cada uso)
        self.light = lighting.Lighting()
        self.light.configure(shared.cfg.lighting)
        self._led_sent: list[Rgb] | None = None  # último quadro mandado ao anel de LEDs
        self._led_at = 0.0  # quando foi mandado
        self._screen_off = False
        self._screen_checked = 0.0
        self._flash: dict[str, Any] | None = None  # cor no anel (resposta temporária)

    def configure(self, section: dict[str, Any] | None) -> None:
        """Config relido: o efeito novo e o próximo quadro vai de qualquer jeito."""
        self.light.configure(section)
        self._led_sent = None

    def forget(self) -> None:
        """O Deck (re)conectou: o próximo quadro vai de qualquer jeito."""
        self._led_sent = None

    def animating(self) -> bool:
        return self.light.enabled and self.light.animating(self._page())

    def on_key(self, key: int, pressed: bool, spec: KeySpec | None, now: float) -> None:
        self.light.on_key(key, pressed, spec.light if spec else None, self.key_color(spec), self._page(), now)

    @staticmethod
    def key_color(spec: KeySpec | None) -> str | None:
        """Cor de fundo da tecla, usada pela reação "na cor da tecla"."""
        if spec is None:
            return None
        bg = (spec.icon or {}).get("bg")
        return bg if isinstance(bg, str) and bg.startswith("#") and len(bg) == 7 else None

    def _hold_ms(self, key: int) -> int:
        spec = self._shared.cfg.spec_at(self._page(), key)[0]
        return spec.hold_ms if spec else 500

    # -- resposta temporária na luz
    def flash(self, color: str, seconds: float, blink: bool) -> None:
        if not self.light.enabled:
            log.warning("Light answer ignored: the app doesn't control the light (Light > Control the Deck light)")
            return
        h = color.lstrip("#")
        try:
            rgb = tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            rgb = (34, 197, 94)
        self._flash = {"rgb": rgb, "until": self._shared.clock.monotonic() + seconds, "blink": blink}

    def expire_flash(self, now: float) -> None:
        if self._flash is not None and now >= self._flash["until"]:
            self._flash = None
            self._led_sent = None

    # -- o quadro do anel
    def update(self, deck: D6) -> None:
        """Manda o próximo quadro do anel. Sem a seção 'lighting:' no config, não mexe na luz."""
        if not self.light.enabled:
            return
        now = self._shared.clock.monotonic()
        s = self.light.settings(self._page())
        if s.get("off_with_screen") and now - self._screen_checked > 2.0:
            self._screen_checked = now
            self._screen_off = winutil.screen_off()
        self.light.check_holds(self._hold_ms, self._page(), now)
        animating = self.light.animating(self._page())
        if animating and now - self._led_at < 1 / 30:
            return
        f = self._flash
        if f is not None:  # resposta temporária na luz
            on = not f["blink"] or int((f["until"] - now) * 3) % 2 == 0
            frame = [f["rgb"] if on else (0, 0, 0)] * lighting.N
        else:
            frame = (
                [(0, 0, 0)] * lighting.N
                if (self._screen_off and s.get("off_with_screen"))
                else self.light.frame(self._page(), now)
            )
        # reenvia o mesmo quadro de vez em quando: depois dos dois cliques no botão de trás,
        # a luz do app volta sozinha
        if frame != self._led_sent or now - self._led_at > 1.5:
            deck.set_leds(frame)
            self._led_sent, self._led_at = frame, now

    def now(self) -> list[Rgb] | None:
        """Último quadro mandado ao anel (para a prévia do editor)."""
        return self._led_sent
