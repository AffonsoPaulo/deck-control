"""Experimento: anima um GIF numa tecla trocando a imagem sem abrir sessão
(só BAT + dados + STP, como o app oficial faz) e confere se as teclas
continuam respondendo durante a animação.

Uso: python tools/push_test.py [gif] [tecla] [segundos]   (feche os outros apps do D6)
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import icons  # noqa: E402
from d6 import render  # noqa: E402
from d6.device import D6  # noqa: E402


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    gif = Path(sys.argv[1] if len(sys.argv) > 1 else "teste-animado.gif")
    key = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    secs = float(sys.argv[3]) if len(sys.argv) > 3 else 20
    frames = icons.render_frames({"image": str(gif.resolve()), "style": "big", "image_scale": 1})
    jpegs = [render.encode(img) for img, _ in frames]
    durs = [ms / 1000 for _, ms in frames]
    print(f"{len(jpegs)} quadros, {[len(j) for j in jpegs]} bytes, {durs} s")
    with D6() as deck:
        deck.enable_keys(100)   # uma vez só, como na abertura do app
        i, due, end = 0, time.monotonic(), time.monotonic() + secs
        while time.monotonic() < end:
            now = time.monotonic()
            if now >= due:
                t0 = time.perf_counter()
                deck.push(key, jpegs[i])
                print(f"quadro {i} em {(time.perf_counter() - t0) * 1000:.1f} ms")
                due += durs[i]
                i = (i + 1) % len(jpegs)
            for ev in deck.events(timeout_ms=max(1, int((due - time.monotonic()) * 1000))):
                print(f"  tecla {ev.key} {'apertou' if ev.pressed else 'soltou'}")
    print("fim")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
