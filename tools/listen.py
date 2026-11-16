"""Fase 1: conecta no Fifine D6 e mostra as teclas apertadas.

Uso:
    python tools/listen.py            # mostra eventos de tecla
    python tools/listen.py --raw      # também despeja reports desconhecidos em hex
    python tools/listen.py --seconds 10

Feche o app "fifine Control Deck" antes (inclusive da bandeja), senão os dois
programas brigam pelo dispositivo.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from d6.device import COLS, KEY_COUNT, D6, DeviceNotFound  # noqa: E402


def fifine_app_running() -> bool:
    if sys.platform != "win32":
        return False
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq fifine Control Deck.exe"],
                             capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return False
    return "fifine Control Deck.exe" in out


def grid(pressed: set[int]) -> str:
    lines = []
    for r in range(KEY_COUNT // COLS):
        cells = []
        for c in range(COLS):
            k = r * COLS + c + 1
            cells.append(f"[{k:>2}]" if k in pressed else f" {k:>2} ")
        lines.append("   " + " ".join(cells))
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", action="store_true", help="mostra reports que não são eventos de tecla")
    ap.add_argument("--seconds", type=float, default=0, help="sai após N segundos (0 = até Ctrl+C)")
    args = ap.parse_args()
    # Sem isso, quando a saída vai para arquivo/pipe, nada aparece até o fim.
    sys.stdout.reconfigure(line_buffering=True)

    if fifine_app_running():
        print("AVISO: o 'fifine Control Deck' está aberto. Feche-o (inclusive da bandeja)\n"
              "       para evitar conflito. Continuando mesmo assim...\n")

    try:
        deck = D6().open()
    except DeviceNotFound as e:
        print(e)
        return 1
    except OSError as e:
        print(f"Não consegui abrir o D6: {e}")
        return 1

    print(f"Conectado: {deck.info.get('product_string', '?')}  firmware {deck.firmware_version() or '?'}")
    deck.enable_keys()
    print("Teclas ligadas. Aperte as teclas do D6. Ctrl+C para sair.\n")

    pressed: set[int] = set()
    deadline = time.time() + args.seconds if args.seconds else None
    try:
        while deadline is None or time.time() < deadline:
            data = deck.read_raw(250)
            if not data:
                continue
            if args.raw:
                print("raw:", data.rstrip(b"\x00").hex(" ") or "(zeros)")
            evs = deck.parse(data)

            for ev in evs:
                (pressed.add if ev.pressed else pressed.discard)(ev.key)
                state = "APERTOU" if ev.pressed else "soltou "
                print(f"{time.strftime('%H:%M:%S')}  tecla {ev.key:>2} {state}  "
                      f"(linha {ev.row + 1}, coluna {ev.col + 1})")
                print(grid(pressed) + "\n")
    except KeyboardInterrupt:
        pass
    finally:
        deck.close()
    print("Desconectado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
