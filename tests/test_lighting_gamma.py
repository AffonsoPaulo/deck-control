"""A cor do anel convertida para o LED (correção de gama 2,8, escolhida comparando no D6).

As cores do config são de tela; o LED acende linear. Sem converter, as sobras de uma cor misturada apareciam
demais: o verde #22c55e puxava para o ciano e o vermelho #e5484d para o rosa.
"""

from __future__ import annotations

import pytest

from app import lighting


@pytest.mark.parametrize(
    ("screen", "led"),
    [
        ((34, 197, 94), (1, 124, 16)),  # o verde do toque duplo: o azul quase some
        ((229, 72, 77), (189, 7, 9)),  # o vermelho: verde e azul quase somem
        ((255, 0, 0), (255, 0, 0)),  # cor pura não muda (por isso a onda já parecia certa)
        ((0, 0, 0), (0, 0, 0)),
        ((255, 255, 255), (255, 255, 255)),
    ],
)
def test_to_led(screen, led):
    assert lighting.to_led(screen) == led


FLASH = """
language: en
lighting: {effect: solid, color: "#ff0000", brightness: 80}
pages:
  main:
    1: {icon: {text: a}, action: {type: light.flash, color: "#22c55e", seconds: 2}, light: {press: {kind: none}}}
"""


def test_flash_goes_converted_to_the_ring(make_engine):
    rig = make_engine(FLASH)
    deck = rig.connect()
    rig.tap(1)
    rig.advance(100)
    assert deck.leds[-1] == [(1, 124, 16)] * lighting.N
    assert rig.engine.leds_now() == [(34, 197, 94)] * lighting.N  # a prévia continua em cores de tela


def test_brightness_curve_on_the_led_stays_as_before(make_engine):
    """Brilho 80 num vermelho puro: o LED recebe ~(80/100)^1,6 do máximo, como antes da correção."""
    rig = make_engine(FLASH)
    deck = rig.connect()
    rig.advance(100)
    red = deck.leds[-1][0][0]
    assert abs(red - round(255 * 0.8**1.6)) <= 3
