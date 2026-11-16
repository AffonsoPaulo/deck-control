"""Diagnóstico: testa sequências de inicialização até o D6 mandar eventos de tecla.

Uso: python -u tools/probe.py [--step-seconds 12]
Durante TODO o teste, fique apertando uma tecla do D6 (~1 vez por segundo).
Nenhum passo envia imagem; no pior caso o CONNECT apaga as telas.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from d6.device import D6, crt  # noqa: E402

CONNECT = crt("CONNECT")

# Cada passo: (nome, [payloads], mandar CONNECT a cada 2 s?)
STEPS = [
    ("A: MOD 0x31 (akksmash, só modo)", [crt("MOD", 0, 0, 0x31)], False),
    ("B: DIS, LIG 0, MOD 0x31, LIG 100 (akksmash, sessão completa)",
     [crt("DIS"), crt("LIG", 0, 0, 0, 0), crt("MOD", 0, 0, 0x31), crt("LIG", 0, 0, 100), crt("STP")], False),
    ("C: CONNECT, MOD 0x31", [CONNECT, crt("MOD", 0, 0, 0x31)], False),
    ("D: CONNECT, BLEF, MOD 0x01, DIS 0x01, LIG 100 + CONNECT a cada 2 s (micah)",
     [CONNECT, crt("BLEF"), crt("MOD", 0, 0, 0x01), crt("DIS", 0, 0, 0x01), crt("LIG", 0, 0, 100)], True),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--step-seconds", type=float, default=12)
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)

    with D6() as deck:
        print(f"Aberto: {deck.info.get('product_string')} | out={deck._out_size}")

        try:
            fw = bytes(deck._dev.get_input_report(0, 513))
            print("get_input_report:", fw.rstrip(b"\x00")[:64], "| hex:", fw.rstrip(b"\x00")[:32].hex(" "))
        except Exception as e:  # nem todo firmware responde
            print("get_input_report falhou:", e)

        for name, payloads, heartbeat in STEPS:
            print(f"\n=== {name} ===")
            for p in payloads:
                deck.send(p)
                time.sleep(0.15)
            end = time.time() + args.step_seconds
            last_hb = time.time()
            got_any = False
            while time.time() < end:
                data = deck.read_raw(200)
                if data:
                    got_any = True
                    print(f"  {time.strftime('%H:%M:%S')} raw: {data.rstrip(bytes(1))[:24].hex(' ')}")
                    for ev in deck.parse(data):
                        print(f"  -> tecla {ev.key} {'APERTOU' if ev.pressed else 'soltou'}")
                if heartbeat and time.time() - last_hb >= 2:
                    deck.send(CONNECT)
                    last_hb = time.time()
            if got_any:
                print(f"\nSUCESSO no passo: {name}")
                return 0
            print("  (nada recebido)")
    print("\nNenhuma sequência funcionou.")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
