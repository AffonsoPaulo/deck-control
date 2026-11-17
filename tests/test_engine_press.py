"""A tecla encolhe ao apertar (icons.press_shrink) e o que pode redesenhar com tecla apertada.

Aprovado no canvas ("Aperto: a tecla encolhe"): a tela fica com 76% do tamanho e a cor da tecla escurecida em
volta; volta ao normal ao soltar. Com tecla apertada, só redesenham a que acabou de encolher e as apertadas que
não seguram combinação (o soltar de quem segura "apertar para falar" não pode esperar um envio).
"""

from __future__ import annotations

from tests.fakes.deck import decode

RED = (255, 0, 0)
DARK_RED = (round(255 * 0.55), 0, 0)


def corner(deck, key: int):
    return decode(deck.screens[key]).getpixel((2, 2))


def near(got, want, tol: int = 30) -> bool:
    return all(abs(a - b) <= tol for a, b in zip(got, want))


BASIC = """
language: en
pages:
  main:
    1: {icon: {bg: "#ff0000"}, action: {type: none, tag: a}}
    2: {icon: {bg: "#00ff00"}, action: {type: bind, keys: "ctrl+f13"}}
    3: {icon: {bg: "#0000ff"}, action: {type: page, page: other}}
    5: {icon: {bg: "#ff0000"}, action: {type: page.temp, page: popup, seconds: 5}}
  other:
    2: {icon: {bg: "#ffff00"}, action: {type: page, page: main}}
  popup:
    1: {icon: {bg: "#00ffff"}}
"""


def test_press_shows_the_shrunk_screen_and_release_restores_it(make_engine):
    rig = make_engine(BASIC)
    deck = rig.connect()
    normal = deck.screens[1]
    rig.clear()
    rig.press(1)
    assert deck.pushed_keys() == [1]  # um envio só, no aperto
    assert near(corner(deck, 1), DARK_RED)  # em volta: a cor da tecla, mais escura
    assert near(deck.center(1), RED)  # no meio: a tela, menor
    rig.release(1)
    assert deck.screens[1] == normal
    assert deck.pushed_keys() == [1, 1]


def test_shrink_comes_after_the_combo_is_held_and_restore_after_it_is_released(make_engine):
    rig = make_engine(BASIC)
    deck = rig.connect()
    rig.clear()
    push = deck.push

    def logged_push(key, jpeg):
        rig.keys.append(("push", str(key)))
        push(key, jpeg)

    deck.push = logged_push
    rig.press(2)
    rig.release(2)
    assert rig.keys == [("down", "ctrl+f13"), ("push", "2"), ("up", "ctrl+f13"), ("push", "2")]


def test_empty_key_does_not_react(make_engine):
    rig = make_engine(BASIC)
    deck = rig.connect()
    rig.clear()
    rig.tap(10)
    assert deck.pushed_keys() == []


def test_turned_off_in_the_config(make_engine):
    rig = make_engine(BASIC.replace("language: en", "language: en\nicons: {press_shrink: false}"))
    deck = rig.connect()
    rig.clear()
    rig.press(1)
    assert deck.pushed_keys() == []
    rig.release(1)
    assert deck.pushed_keys() == []


def test_not_a_boolean_in_the_config_keeps_it_on(make_engine):
    rig = make_engine(BASIC.replace("language: en", 'language: en\nicons: {press_shrink: "sim"}'))
    deck = rig.connect()
    rig.clear()
    rig.press(1)
    assert deck.pushed_keys() == [1]


def test_page_action_on_press_does_not_leave_the_key_shrunk(make_engine):
    """A ação troca a página no aperto; o soltar chega numa tecla vazia da página nova."""
    rig = make_engine(BASIC)
    deck = rig.connect()
    rig.tap(3)
    assert rig.engine.page == "other"
    assert rig.engine._input.sunk == {}  # (interno) nenhuma tecla ficou encolhida
    assert deck.center(3) == (0, 0, 0)  # tecla vazia, normal (preta)
    assert near(corner(deck, 2), (255, 255, 0))  # a 2 da página nova, inteira


def test_temporary_answer_close_key_shrinks_too(make_engine):
    """O aperto que só fecha a página temporária (o soltar é engolido) também encolhe e volta."""
    rig = make_engine(BASIC)
    deck = rig.connect()
    rig.tap(5)  # abre a popup
    assert rig.engine.page == "popup"
    rig.press(1)  # só fecha
    assert rig.engine.page == "main"
    assert near(corner(deck, 1), DARK_RED)  # a tecla de baixo (main) aparece encolhida
    rig.release(1)
    assert near(corner(deck, 1), RED)
    assert rig.engine._input.sunk == {}


def test_lost_release_does_not_keep_the_key_shrunk(make_engine):
    rig = make_engine(BASIC)
    deck = rig.connect()
    rig.press(1)
    rig.advance(4900)
    assert near(corner(deck, 1), DARK_RED)
    rig.advance(200)  # 5 s: o 'soltar' se perdeu
    assert near(corner(deck, 1), RED)


def test_recording_a_shortcut_does_not_shrink(make_engine):
    rig = make_engine(BASIC)
    deck = rig.connect()
    rig.engine.arm_record("ctrl+f20", 30)
    rig.clear()
    rig.tap(1)
    assert deck.pushed_keys() == []


STATES = """
language: en
pages:
  main:
    1: {icon: {bg: "#ff0000"}, state: lit, active_icon: {bg: "#00ff00"}, action: {type: bind, keys: "ctrl+f13"}}
    2: {icon: {bg: "#ff0000"}, state: lit, active_icon: {bg: "#00ff00"}, action: {type: none, tag: b}}
    3: {icon: {bg: "#ff0000"}, state: lit, active_icon: {bg: "#00ff00"}}
"""


def test_while_held_only_the_pressed_key_redraws(make_engine):
    """A tecla apertada (sem combinação) redesenha na hora; as outras esperam soltar."""
    rig = make_engine(STATES)
    deck = rig.connect()
    rig.press(2)
    rig.clear()
    rig.engine.set_state("lit", True)
    rig.tick()
    assert deck.pushed_keys() == [2]  # a apertada, já com o estado novo (encolhida)
    assert near(deck.center(2), (0, 255, 0))
    rig.release(2)
    assert sorted(deck.pushed_keys()) == [1, 2, 2, 3]


def test_key_holding_a_combo_does_not_redraw_while_held(make_engine):
    """'Apertar para falar': depois de encolher, nada redesenha até soltar."""
    rig = make_engine(STATES)
    deck = rig.connect()
    rig.press(1)
    rig.clear()
    rig.engine.set_state("lit", True)
    rig.advance(100)
    assert deck.pushed_keys() == []
    rig.release(1)
    assert sorted(deck.pushed_keys()) == [1, 2, 3]


COUNTDOWN = """
language: en
pages:
  main:
    6:
      widget: app.countdown
      size: 1x1
      options: {id: egg, minutes: 1}
      action: {type: timer.toggle, id: egg, minutes: 1}
      hold: {type: timer.reset, id: egg}
"""


def test_hold_result_shows_without_waiting_for_release(make_engine):
    """O caso da página de teste: segurar zera a contagem, e a tecla mostra 01:00 com o dedo ainda nela."""
    rig = make_engine(COUNTDOWN)
    deck = rig.connect()
    rig.tap(6)
    rig.advance(5000)
    running = deck.screens[6]
    rig.press(6)
    rig.advance(100)
    pressed_running = deck.screens[6]
    rig.advance(1000)  # passou dos 500 ms: o 'ao segurar' zerou
    assert rig.engine.values.get("timer.egg") == "01:00"
    assert deck.screens[6] not in (running, pressed_running)  # já mostra o zerado, ainda encolhida
    rig.release(6)
    assert near(corner(deck, 6), decode(running).getpixel((2, 2)))  # inteira de novo


GIF_CFG = """
language: en
pages:
  main:
    4: {{icon: {{image: "{gif}"}}, action: {{type: none, tag: g}}}}
"""


def test_gif_pauses_while_pressed_and_restarts_after(make_engine, tmp_path):
    from PIL import Image

    frames = [Image.new("RGB", (112, 112), c) for c in ((255, 0, 0), (0, 255, 0), (0, 0, 255))]
    gif = tmp_path / "a.gif"
    frames[0].save(gif, save_all=True, append_images=frames[1:], duration=100, loop=0)
    rig = make_engine(GIF_CFG.format(gif=gif.as_posix()))
    deck = rig.connect()
    rig.press(4)
    rig.clear()
    rig.advance(400)
    assert deck.pushed_keys() == []  # o GIF não passa por cima da tela encolhida
    rig.release(4)
    assert near(deck.center(4), (255, 0, 0))  # recomeça do primeiro quadro
    rig.advance(150)
    assert len(deck.pushed_keys()) >= 2  # e volta a animar


BRIGHT = """
language: en
brightness: 50
pages:
  main:
    1: {icon: {bg: "#ff0000"}, action: {type: brightness, step: 10}, repeat: press, repeat_delay: 400, repeat_ms: 300}
"""


def test_brightness_while_held_applies_right_away(make_engine):
    """A tecla de brilho com repetição: o brilho muda enquanto segura (antes só mudava ao soltar)."""
    rig = make_engine(BRIGHT)
    deck = rig.connect()
    rig.press(1)
    rig.advance(800)
    assert deck.brightness[-3:] == [60, 70, 80]
    rig.release(1)
