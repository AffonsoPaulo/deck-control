"""Engine: o que cada jeito de apertar uma tecla roda hoje (toque, segurar, toque duplo, repetir, combinação
segurada), com o D6 e o relógio falsos (tests/fakes). Estes testes fixam o comportamento atual antes de dividir
o app/engine.py (Fase 3): se um deles quebrar, o comportamento mudou.

As ações dos configs são {type: none, tag: x}: não fazem nada, e o 'tag' diz qual rodou.
"""

from __future__ import annotations

import pytest

STEP = 10  # ms por volta do loop (o app roda o _tick a cada ~10 ms quando há temporizador)


def _since(rig, t0: float, i: int = -1) -> float:
    """Quantos ms depois de t0 rodou a ação i."""
    return (rig.ran[i].at - t0) * 1000


# ---------------------------------------------------------------------------- toque simples


TAP = """
language: en
pages:
  main:
    1: {icon: {text: A}, action: {type: none, tag: a}, release: {type: none, tag: r}}
    2: {icon: {text: B}, action: {type: none, tag: b}}
"""


def test_tap_runs_the_action_on_press_and_release_on_release(make_engine):
    """Tecla sem hold/duplo: a ação roda já no aperto; a de soltar, no soltar."""
    rig = make_engine(TAP)
    rig.connect()
    rig.press(1)
    assert rig.moments() == [("a", "press")]
    r = rig.ran[0]
    assert (r.key, r.page) == (1, "main")
    rig.advance(100)
    rig.release(1)
    assert rig.moments() == [("a", "press"), ("r", "release")]
    rig.advance(1000)
    assert len(rig.ran) == 2  # nada atrasado


def test_repeated_press_from_the_d6_while_held_is_ignored(make_engine):
    """O D6 reenvia "apertou" de uma tecla segurada quando outra é tocada: a ação não roda duas vezes."""
    rig = make_engine(TAP)
    rig.connect()
    rig.press(2)
    rig.press(2)
    rig.release(2)
    assert rig.moments() == [("b", "press")]


def test_empty_key_runs_nothing(make_engine):
    rig = make_engine(TAP)
    rig.connect()
    rig.tap(7)
    rig.advance(500)
    assert rig.ran == []


# ---------------------------------------------------------------------------- segurar


HOLD = """
language: en
pages:
  main:
    1:
      icon: {text: H}
      action: {type: none, tag: a}
      hold: {type: none, tag: h}
      hold_ms: 500
      release: {type: none, tag: r}
"""


def test_short_press_on_a_hold_key_runs_the_action_on_release(make_engine):
    """Com 'hold', a ação principal espera o soltar (só assim dá para saber que não foi segurado)."""
    rig = make_engine(HOLD)
    rig.connect()
    rig.press(1)
    assert rig.ran == []
    rig.advance(200)
    rig.release(1)
    assert rig.moments() == [("a", "press"), ("r", "release")]


def test_holding_runs_hold_once_after_hold_ms_and_not_the_action(make_engine):
    rig = make_engine(HOLD)
    rig.connect()
    rig.press(1)
    t0 = rig.clock.monotonic()
    rig.advance(490)
    assert rig.ran == []
    rig.advance(20)
    assert rig.moments() == [("h", "hold")]
    assert 500 <= _since(rig, t0) <= 500 + STEP
    rig.advance(1000)
    assert rig.moments() == [("h", "hold")]  # uma vez só
    rig.release(1)
    assert rig.moments() == [("h", "hold"), ("r", "release")]


def test_hold_with_a_bind_holds_the_combo_until_release(make_engine):
    """'hold' com combinação para segurar: aperta ao completar o hold_ms e só solta junto com a tecla."""
    rig = make_engine("""
        language: en
        pages:
          main:
            1: {icon: {text: H}, action: {type: none, tag: a}, hold: {type: bind, keys: "ctrl+f14"}}
    """)
    rig.connect()
    rig.press(1)
    rig.advance(520)
    assert rig.keys == [("down", "ctrl+f14")]
    assert rig.ran == []  # não passa pelas ações: o engine segura direto
    rig.release(1)
    assert rig.keys == [("down", "ctrl+f14"), ("up", "ctrl+f14")]
    assert rig.ran == []


# ---------------------------------------------------------------------------- combinação segurada (bind)


def test_bind_is_held_while_the_key_is_held(make_engine):
    """Ação principal 'bind' (mirror): Ctrl+F13 fica apertado enquanto a tecla do D6 estiver apertada."""
    rig = make_engine("""
        language: en
        pages:
          main:
            1: {icon: {text: Mic}, action: {type: bind, keys: "ctrl+f13"}}
            2: {icon: {text: Tap}, action: {type: bind, keys: "ctrl+f15", mirror: false}}
    """)
    rig.connect()
    rig.press(1)
    assert rig.keys == [("down", "ctrl+f13")]
    rig.advance(300)
    rig.release(1)
    assert rig.keys == [("down", "ctrl+f13"), ("up", "ctrl+f13")]
    assert rig.ran == []
    # mirror: false é um toque comum, pela ação
    rig.clear()
    rig.tap(2)
    assert rig.moments() == [("bind", "press")]


# ---------------------------------------------------------------------------- toque duplo


DOUBLE = """
language: en
pages:
  main:
    1:
      icon: {text: D}
      action: {type: none, tag: a}
      double: {type: none, tag: d}
      release: {type: none, tag: r}
    2: {icon: {text: B}, action: {type: none, tag: b}}
  other:
    1: {icon: {text: C}, action: {type: none, tag: c}}
"""


def test_double_tap_within_the_window_runs_double_and_not_the_action(make_engine):
    rig = make_engine(DOUBLE)
    rig.connect()
    rig.tap(1)
    rig.advance(100)
    rig.press(1)
    assert rig.moments() == [("r", "release"), ("d", "double")]
    rig.release(1)
    # o 'release' roda nos dois soltar
    assert rig.moments() == [("r", "release"), ("d", "double"), ("r", "release")]
    rig.advance(500)
    assert ("a", "press") not in rig.moments()


def test_single_tap_on_a_double_key_runs_the_action_after_the_window(make_engine):
    """Toque simples numa tecla com 'double': a ação espera double_tap_ms (padrão 250) contados do soltar.
    O 'release' roda antes, no soltar (mesma inversão do teste xfail de baixo)."""
    rig = make_engine(DOUBLE)
    rig.connect()
    rig.tap(1)
    t_release = rig.clock.monotonic()
    assert rig.moments() == [("r", "release")]
    rig.advance(240)
    assert rig.moments() == [("r", "release")]
    rig.advance(20)
    assert rig.moments() == [("r", "release"), ("a", "press")]
    assert 250 <= _since(rig, t_release) <= 250 + STEP
    # um 2º toque depois da janela começa outro ciclo (não é duplo)
    rig.clear()
    rig.tap(1)
    rig.advance(300)
    assert rig.moments() == [("r", "release"), ("a", "press")]


def test_double_tap_window_comes_from_the_config(make_engine):
    rig = make_engine("double_tap_ms: 400\n" + DOUBLE)
    rig.connect()
    rig.tap(1)
    rig.advance(350)
    rig.press(1)
    assert ("d", "double") in rig.moments()


def test_plain_keys_wait_the_double_window_on_a_page_with_double_taps(make_engine):
    """Numa página com alguma tecla de toque duplo, todas as teclas esperam igual antes de rodar."""
    rig = make_engine(DOUBLE)
    rig.connect()
    rig.press(2)
    t0 = rig.clock.monotonic()
    assert rig.ran == []
    rig.advance(260)
    assert rig.moments() == [("b", "press")]
    assert 250 <= _since(rig, t0) <= 250 + STEP
    rig.release(2)
    # em outra página sem toque duplo, roda já no aperto
    rig.engine.go_to_page("other")
    rig.clear()
    rig.press(1)
    assert rig.moments() == [("c", "press")]


DEFERRED = """
language: en
pages:
  main:
    1: {icon: {text: D}, action: {type: none, tag: a}, double: {type: none, tag: d}}
    2: {icon: {text: B}, action: {type: none, tag: b}, release: {type: none, tag: rb}}
"""


def test_deferred_press_today_runs_after_its_release(make_engine):
    """Hoje: o 'release' roda no soltar e o aperto adiado só depois da janela (ver o xfail de baixo)."""
    rig = make_engine(DEFERRED)
    rig.connect()
    rig.tap(2)
    rig.advance(300)
    assert rig.moments() == [("rb", "release"), ("b", "press")]


@pytest.mark.xfail(
    strict=True,
    reason="numa página com toque duplo, o aperto adiado roda depois do 'release' da mesma tecla (ordem invertida)",
)
def test_deferred_press_runs_before_release(make_engine):
    rig = make_engine(DEFERRED)
    rig.connect()
    rig.tap(2)
    rig.advance(300)
    assert rig.moments() == [("b", "press"), ("rb", "release")]


# ---------------------------------------------------------------------------- repetir enquanto segura


def test_repeat_press_runs_now_then_repeats_after_the_delay(make_engine):
    """repeat: press — roda no aperto, espera repeat_delay e repete a cada repeat_ms até soltar."""
    rig = make_engine("""
        language: en
        pages:
          main:
            1:
              icon: {text: Vol}
              action: {type: none, tag: v}
              repeat: press
              repeat_ms: 100
              repeat_delay: 400
    """)
    rig.connect()
    rig.press(1)
    t0 = rig.clock.monotonic()
    assert rig.moments() == [("v", "press")]
    rig.advance(390)
    assert len(rig.ran) == 1
    rig.advance(320)  # 710 ms: repetiu aos 400, 500, 600 e 700
    assert rig.moments() == [("v", "press")] + [("v", "repeat")] * 4
    gaps = [round((r.at - t0) * 1000) for r in rig.ran[1:]]
    assert gaps == [400, 500, 600, 700]
    rig.release(1)
    rig.advance(1000)
    assert len(rig.ran) == 5  # parou ao soltar


def test_repeat_stops_by_itself_after_30_seconds(make_engine):
    """Se o "soltou" se perder, a repetição para sozinha depois de 30 s (nunca repete para sempre)."""
    rig = make_engine("""
        language: en
        pages:
          main:
            1: {icon: {text: Vol}, action: {type: none, tag: v}, repeat: press, repeat_ms: 500, repeat_delay: 0}
    """)
    rig.connect()
    rig.press(1)
    rig.advance(29_900, step=100)
    n = len(rig.ran)
    assert n > 50
    rig.advance(5_000, step=100)
    assert len(rig.ran) <= n + 1  # no máximo a última antes do corte
    after = len(rig.ran)
    rig.advance(5_000, step=100)
    assert len(rig.ran) == after


def test_repeat_hold_runs_hold_and_repeats_it_with_moment_hold(make_engine):
    """repeat: hold — o 'hold' roda ao completar hold_ms e repete a cada repeat_ms; as repetições também
    chegam com o momento 'hold' (não 'repeat'). O toque curto continua rodando a ação no soltar."""
    rig = make_engine("""
        language: en
        pages:
          main:
            1:
              icon: {text: Zoom}
              action: {type: none, tag: a}
              hold: {type: none, tag: h}
              hold_ms: 300
              repeat: hold
              repeat_ms: 100
    """)
    rig.connect()
    rig.press(1)
    t0 = rig.clock.monotonic()
    rig.advance(310)
    assert rig.moments() == [("h", "hold")]
    assert 300 <= _since(rig, t0) <= 300 + STEP
    rig.advance(300)
    assert rig.moments() == [("h", "hold")] * 4
    ats = [round(r.at * 1000) for r in rig.ran]
    assert [b - a for a, b in zip(ats, ats[1:])] == [100, 100, 100]  # contado de quando o hold rodou
    rig.release(1)
    rig.advance(500)
    assert rig.moments() == [("h", "hold")] * 4  # a ação principal não roda depois de segurar
    rig.clear()
    rig.tap(1, ms=100)
    assert rig.moments() == [("a", "press")]


# ---------------------------------------------------------------------------- marca de erro


ERROR = """
language: en
pages:
  main:
    1: {icon: {text: Bad, bg: "#0000ff"}, action: {type: brightness, value: abc}}
"""


def test_failing_action_shows_the_error_mark_for_one_second(make_engine):
    """Uma ação com erro (aqui brightness com valor que não é número) marca a tecla por 1 s, contado de
    quando a marca aparece; depois a tecla volta ao normal."""
    rig = make_engine(ERROR)
    deck = rig.connect()
    normal = deck.screens[1]
    rig.press(1)
    assert rig.moments() == [("brightness", "press")]
    assert deck.screens[1] == normal  # com a tecla apertada não redesenha
    rig.release(1)
    assert deck.screens[1] != normal
    rig.advance(990)
    assert deck.screens[1] != normal
    rig.advance(20)
    assert deck.screens[1] == normal


def test_error_mark_can_be_turned_off(make_engine):
    rig = make_engine(ERROR + "logging: {key_error: false}\n")
    deck = rig.connect()
    normal = deck.screens[1]
    rig.tap(1)
    rig.advance(100)
    assert deck.screens[1] == normal
