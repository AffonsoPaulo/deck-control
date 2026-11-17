"""Engine: o que aparece nas telas hoje — páginas, página temporária, telas pintadas, estados, regras, contagens,
blocos e widgets —, olhando as imagens que chegam ao D6 falso (tests/fakes).

As cores são conferidas no pixel do meio de teclas só com fundo (sem texto); quando o texto importa, a imagem
inteira é comparada com a do ícone esperado desenhado pelo mesmo app.icons.
"""

from __future__ import annotations

import time

import pytest

from app import icons
from d6 import render

BLACK = (0, 0, 0)
RED = (255, 0, 0)
GREEN = (0, 255, 0)
BLUE = (0, 0, 255)
YELLOW = (255, 255, 0)
CYAN = (0, 255, 255)
MAGENTA = (255, 0, 255)
ACTIVE_RED = (0xC6, 0x28, 0x28)  # DEFAULT_ACTIVE_OVERRIDE do app/config.py


def near(got, want, tol: int = 30) -> bool:
    return all(abs(a - b) <= tol for a, b in zip(got, want))


def colors(deck, keys) -> list:
    return [deck.center(k) for k in keys]


def assert_colors(deck, expected: dict) -> None:
    got = {k: deck.center(k) for k in expected}
    assert all(near(got[k], c) for k, c in expected.items()), got


def drawn(rig, icon: dict) -> bytes:
    """O JPEG que o engine mandaria para este ícone (já resolvido)."""
    cfg = rig.engine.cfg
    return render.encode(icons.render_icon(icon, cfg.base_dir, cfg.raw.get("icons")))


# ---------------------------------------------------------------------------- páginas


PAGES = """
language: en
pages:
  main:
    1: {icon: {bg: "#ff0000"}, action: {type: page, page: other}}
    2: {icon: {bg: "#00ff00"}, action: {type: none, tag: m2}}
  other:
    1: {icon: {bg: "#0000ff"}, action: {type: page, page: back}}
    2: {icon: {bg: "#ffff00"}, action: {type: page, page: third}}
    3: {icon: {bg: "#00ffff"}, action: {type: page, page: home}}
  third:
    1: {icon: {bg: "#ff00ff"}, action: {type: page, page: back}}
    3: {icon: {bg: "#ffffff"}, action: {type: page, page: home}}
"""


def test_connect_draws_all_15_keys_of_the_home_page(make_engine):
    rig = make_engine(PAGES)
    deck = rig.connect()
    assert rig.engine.page == "main"
    assert sorted(deck.pushed_keys()) == list(range(1, 16))
    assert_colors(deck, {1: RED, 2: GREEN, 3: BLACK, 15: BLACK})
    # ordem de envio: pela tela do D6 (linha de baixo primeiro), não pela tecla
    assert deck.pushed_keys() == sorted(range(1, 16), key=deck.screen_for_key)


def test_page_action_switches_and_redraws_only_what_changed(make_engine):
    rig = make_engine(PAGES)
    deck = rig.connect()
    rig.clear()
    rig.tap(1)
    assert rig.engine.page == "other"
    # as vazias continuam pretas: não reenvia; a 1 vai duas vezes (encolhida no aperto, normal ao soltar)
    assert sorted(deck.pushed_keys()) == [1, 1, 2, 3]
    assert_colors(deck, {1: BLUE, 2: YELLOW, 3: CYAN})
    rig.tap(1)  # back
    assert rig.engine.page == "main"
    assert_colors(deck, {1: RED, 2: GREEN, 3: BLACK})


def test_back_and_home_follow_the_history(make_engine):
    rig = make_engine(PAGES)
    rig.connect()
    rig.tap(1)  # main -> other
    rig.tap(2)  # other -> third
    assert rig.engine.page == "third"
    rig.tap(1)  # back -> other
    assert rig.engine.page == "other"
    rig.tap(2)  # -> third
    rig.tap(3)  # home: volta para a inicial e limpa o histórico
    assert rig.engine.page == "main"
    rig.engine.go_to_page("back")  # histórico vazio: fica onde está
    assert rig.engine.page == "main"
    rig.engine.go_to_page("main")  # a mesma página: nada muda
    assert rig.engine.page == "main"
    with pytest.raises(ValueError):
        rig.engine.go_to_page("nope")


def test_home_page_comes_from_the_config(make_engine):
    rig = make_engine("home: other\n" + PAGES)
    deck = rig.connect()
    assert rig.engine.page == "other"
    assert_colors(deck, {1: BLUE})


# ---------------------------------------------------------------------------- página temporária


TEMP = """
language: en
pages:
  main:
    1: {icon: {bg: "#ff0000"}, action: {type: page.temp, page: popup, seconds: 5}}
    2:
      icon: {bg: "#00ff00"}
      action: {type: page.temp, page: popup, seconds: 5, passthrough: true, show_left: false}
    3: {icon: {bg: "#0000ff"}, action: {type: none, tag: m3}, release: {type: none, tag: m3r}}
    4: {icon: {bg: "#ffff00"}, action: {type: page.temp, page: popup, seconds: 5, dismiss: false}}
  popup:
    1: {icon: {bg: "#ff00ff"}, action: {type: none, tag: p1}}
    2: {icon: {bg: "#00ffff"}, action: {type: toggle, on: {type: none}}}
"""


def test_temp_page_shows_a_close_key_and_returns_by_itself(make_engine):
    rig = make_engine(TEMP)
    deck = rig.connect()
    rig.tap(1)
    assert rig.engine.page == "popup"
    assert_colors(deck, {1: MAGENTA, 2: CYAN})
    assert deck.center(15) != BLACK  # show_left: a última tecla vazia vira "Fechar" com o tempo que falta
    first = deck.screens[15]
    rig.advance(1000)
    assert deck.screens[15] != first  # a barra do tempo diminui
    rig.advance(3900)
    assert rig.engine.page == "popup"
    rig.advance(200)  # 5 s
    assert rig.engine.page == "main"
    assert_colors(deck, {1: RED, 15: BLACK})


def test_temp_page_closes_on_any_press_and_swallows_it(make_engine):
    """dismiss (padrão): a tecla apertada só fecha a página; nem o aperto nem o soltar rodam nada."""
    rig = make_engine(TEMP)
    rig.connect()
    rig.tap(1)
    rig.clear()
    rig.tap(3)  # vazia na popup; na main tem ação
    assert rig.engine.page == "main"
    assert rig.ran == []
    rig.tap(3)  # agora é a tecla da main
    assert rig.moments() == [("m3", "press"), ("m3r", "release")]


def test_temp_page_without_dismiss_runs_its_keys_until_close(make_engine):
    rig = make_engine(TEMP)
    deck = rig.connect()
    rig.tap(4)
    rig.clear()
    rig.tap(1)
    assert rig.moments() == [("p1", "press")]
    assert rig.engine.page == "popup"
    assert deck.center(15) != BLACK
    rig.tap(15)  # a tecla "Fechar" fecha mesmo sem dismiss
    assert rig.engine.page == "main"
    assert rig.moments() == [("p1", "press")]


def test_temp_page_passthrough_closes_and_runs_the_pressed_key(make_engine):
    rig = make_engine(TEMP)
    deck = rig.connect()
    rig.tap(2)
    assert deck.center(15) == BLACK  # show_left: false
    rig.clear()
    rig.tap(1)
    assert rig.engine.page == "main"
    assert rig.moments() == [("p1", "press")]  # o soltar foi engolido
    assert rig.ran[0].page == "main"  # hoje: a página de volta, não a popup (ver o xfail de baixo)


@pytest.mark.xfail(
    strict=True,
    reason="passthrough roda a ação da tecla da página temporária com ctx.page da página de volta "
    "(o toggle muda o estado toggle:main:2 em vez de toggle:popup:2)",
)
def test_temp_page_passthrough_runs_the_action_as_a_key_of_the_temp_page(make_engine):
    rig = make_engine(TEMP)
    rig.connect()
    rig.tap(2)
    rig.clear()
    rig.tap(2)  # a tecla 2 da popup é um toggle
    assert [(r.tag, r.page) for r in rig.ran] == [("toggle", "popup")]
    assert rig.engine.get_state("toggle:popup:2") is True


# ---------------------------------------------------------------------------- telas pintadas


PAINT = """
language: en
pages:
  main:
    1: {icon: {bg: "#ff0000"}, action: {type: screens.paint, color: "#00ff00", seconds: 2}}
    2: {icon: {bg: "#0000ff"}, action: {type: none, tag: b}}
"""


def test_paint_screens_covers_all_keys_until_time_runs_out(make_engine):
    rig = make_engine(PAINT)
    deck = rig.connect()
    rig.tap(1)
    assert all(near(c, GREEN) for c in colors(deck, range(1, 16)))
    rig.advance(2000)
    assert_colors(deck, {1: RED, 2: BLUE, 3: BLACK})


def test_paint_screens_is_dismissed_by_a_press_that_runs_nothing(make_engine):
    rig = make_engine(PAINT)
    deck = rig.connect()
    rig.tap(1)
    rig.clear()
    rig.tap(2)
    assert rig.ran == []
    assert_colors(deck, {1: RED, 2: BLUE})


# ---------------------------------------------------------------------------- estados


STATES = """
language: en
pages:
  main:
    1: {icon: {bg: "#0000ff"}, action: {type: toggle, state: mic, on: {type: none}, off: {type: none}}}
    2: {icon: {bg: "#0000ff"}, active_icon: {bg: "#00ff00"}, state: mic}
    3: {icon: {bg: "#0000ff"}, action: {type: toggle, on: {type: none}}}
"""


def test_toggle_switches_the_state_and_the_icons_that_show_it(make_engine):
    rig = make_engine(STATES)
    deck = rig.connect()
    assert rig.engine.get_state("mic") is False
    rig.tap(1)
    assert rig.engine.get_state("mic") is True
    # sem active_icon, o ativo é o mesmo ícone com o fundo vermelho padrão
    assert_colors(deck, {1: ACTIVE_RED, 2: GREEN, 3: BLUE})
    rig.tap(1)
    assert rig.engine.get_state("mic") is False
    assert_colors(deck, {1: BLUE, 2: BLUE})
    rig.tap(3)  # sem 'state', o estado é da tecla
    assert rig.engine.get_state("toggle:main:3") is True
    assert_colors(deck, {3: ACTIVE_RED})


def test_state_set_from_outside_redraws_the_keys(make_engine):
    """set_state é como plugins (OBS, Discord) avisam o engine."""
    rig = make_engine(STATES)
    deck = rig.connect()
    rig.clear()
    rig.engine.set_state("mic", True)
    rig.tick()
    assert sorted(deck.pushed_keys()) == [1, 2]
    assert_colors(deck, {1: ACTIVE_RED, 2: GREEN})
    rig.clear()
    rig.engine.set_state("mic", True)  # o mesmo valor: nada a redesenhar
    rig.tick()
    assert deck.pushes == []


# ---------------------------------------------------------------------------- regras e valores


RULES = """
language: en
pages:
  main:
    1:
      icon: {bg: "#0000ff"}
      rules:
        - if: {value: test.temp, op: gt, to: 30}
          icon: {bg: "#ff0000"}
        - if: {value: mic}
          icon: {bg: "#00ff00"}
    2: {icon: {text: "{test.name}"}}
"""


def test_rules_change_the_icon_when_values_change(make_engine):
    """Regras: a primeira que vale muda o ícone; as teclas com valores se conferem a cada 0,5 s."""
    rig = make_engine(RULES)
    deck = rig.connect()
    assert_colors(deck, {1: BLUE})
    rig.engine.values.set("test.temp", 35)
    rig.advance(500)
    assert_colors(deck, {1: RED})
    rig.engine.values.set("test.temp", 10)
    rig.advance(500)
    assert_colors(deck, {1: BLUE})
    rig.engine.set_state("mic", True)  # estado também é valor
    rig.tick()
    assert_colors(deck, {1: GREEN})
    rig.engine.values.set("test.temp", 40)  # as duas valem: ganha a primeira
    rig.advance(500)
    assert_colors(deck, {1: RED})


def test_values_in_the_text_are_resolved_before_drawing(make_engine):
    rig = make_engine(RULES)
    deck = rig.connect()
    assert deck.screens[2] == drawn(rig, {"text": "–"})  # valor que não existe
    rig.engine.values.set("test.name", "hello")
    rig.advance(500)
    assert deck.screens[2] == drawn(rig, {"text": "hello"})


# ---------------------------------------------------------------------------- contagens


TIMER = """
language: en
pages:
  main:
    1: {icon: {text: "{timer.egg}"}, action: {type: timer.toggle, id: egg, minutes: 1}}
    2: {icon: {text: R}, action: {type: timer.reset, id: egg}}
"""


def test_countdown_starts_pauses_resumes_and_resets(make_engine):
    rig = make_engine(TIMER)
    deck = rig.connect()
    get = rig.engine.values.get
    assert get("timer.egg") is None
    assert deck.screens[1] == drawn(rig, {"text": "–"})
    rig.tap(1)  # começa no aperto
    assert get("timer.egg") == "01:00"
    assert get("timer.egg.running") is True
    rig.advance(30_000, step=100)
    assert get("timer.egg") == "00:30"
    assert get("timer.egg.pct") == 50
    assert deck.screens[1] == drawn(rig, {"text": "00:30"})
    rig.tap(1)  # pausa
    rig.advance(10_000, step=100)
    assert get("timer.egg") == "00:30"
    assert get("timer.egg.running") is False
    rig.tap(1)  # continua
    rig.advance(10_000, step=100)
    assert get("timer.egg") == "00:20"
    assert deck.screens[1] == drawn(rig, {"text": "00:20"})
    rig.tap(2)  # volta ao começo, parada
    rig.advance(1000, step=100)
    assert get("timer.egg") == "01:00"
    assert get("timer.egg.running") is False
    assert deck.screens[1] == drawn(rig, {"text": "01:00"})


def test_finished_countdown_needs_two_presses_to_start_again(make_engine):
    """Comportamento de hoje: acabou a contagem, o 1º toque "pausa" em 00:00 e só o 2º recomeça."""
    rig = make_engine(TIMER)
    rig.connect()
    get = rig.engine.values.get
    rig.tap(1)
    rig.advance(61_000, step=500)
    assert get("timer.egg") == "00:00"
    assert get("timer.egg.running") is False
    rig.tap(1)
    assert get("timer.egg") == "00:00"
    rig.tap(1)
    assert get("timer.egg") == "01:00"
    assert get("timer.egg.running") is True


# ---------------------------------------------------------------------------- blocos


def test_split_block_draws_one_cell_per_key_and_covered_keys_run_the_anchor(make_engine):
    rig = make_engine("""
        language: en
        pages:
          main:
            1:
              span: [2, 2]
              cells: [{bg: "#ff0000"}, {bg: "#00ff00"}, {bg: "#0000ff"}, {bg: "#ffff00"}]
              action: {type: none, tag: blk}
    """)
    deck = rig.connect()
    # [2, 2] a partir da tecla 1: teclas 1, 2 (linha de cima) e 6, 7 (de baixo), células em ordem de leitura
    assert_colors(deck, {1: RED, 2: GREEN, 6: BLUE, 7: YELLOW, 3: BLACK})
    rig.tap(7)
    assert [(r.tag, r.moment, r.key) for r in rig.ran] == [("blk", "press", 7)]


def test_image_block_spreads_one_image_over_the_keys(make_engine, tmp_path):
    """mode: image — a imagem cobre o bloco inteiro, pulando o vão entre as telas (device.gap_px, padrão 28)."""
    from PIL import Image

    tile, gap = icons.SIZE, 28
    w = 2 * tile + gap
    img = Image.new("RGB", (w, tile), RED)
    img.paste(Image.new("RGB", (w // 2, tile), BLUE), (w // 2, 0))
    img.save(tmp_path / "wide.png")  # gerada aqui: *.png fica fora do git
    rig = make_engine("""
        language: en
        pages:
          main:
            3: {span: [2, 1], mode: image, icon: {image: wide.png}}
    """)
    deck = rig.connect()
    assert_colors(deck, {3: RED, 4: BLUE})
    assert near(deck.pixel(3, 2, 56), RED) and near(deck.pixel(4, tile - 3, 56), BLUE)


# ---------------------------------------------------------------------------- widgets


WIDGETS = """
language: en
pages:
  main:
    1: {widget: app.clock, size: 1x2}
    6:
      widget: app.countdown
      size: 1x1
      options: {id: egg, minutes: 2}
      action: {type: timer.toggle, id: egg, minutes: 2}
    11: {widget: app.countdown, size: 1x1, options: {id: bare}}
"""


def test_clock_widget_spans_its_size_and_follows_the_clock(make_engine):
    rig = make_engine(WIDGETS)
    rig.clock.set_wall(time.mktime((2026, 11, 17, 14, 32, 8, 0, 0, -1)))
    deck = rig.connect()
    cells = rig.engine.cfg.pages["main"][1].cells  # o modelo do widget, montado pelo config
    assert len(cells) == 2
    assert deck.screens[1] == drawn(rig, {**cells[0], "text": "14"})
    assert deck.screens[2] == drawn(rig, {**cells[1], "text": "32"})
    rig.clear()
    rig.clock.set_wall(time.mktime((2026, 11, 17, 14, 33, 0, 0, 0, -1)))
    rig.advance(900)  # a conferência (até 0,5 s) e a virada (10 quadros de 30 ms)
    assert deck.pushed_keys() == [2] * 10  # só os minutos viram
    assert deck.screens[2] == drawn(rig, {**cells[1], "text": "33"})  # e terminam exatamente no número novo


def test_countdown_widget_runs_the_action_saved_on_the_key(make_engine):
    """O editor copia a ação do modelo para a tecla; o config não copia sozinho: sem 'action' a tecla não roda
    nada (a tecla 11)."""
    rig = make_engine(WIDGETS)
    deck = rig.connect()
    cell = rig.engine.cfg.pages["main"][6].cells[0]
    assert cell["text"] == "{timer.egg}"
    assert deck.screens[6] == drawn(rig, {**cell, "text": "–"})
    rig.tap(6)
    assert rig.moments() == [("timer.toggle", "press")]
    assert rig.engine.values.get("timer.egg") == "02:00"
    # ao soltar, a tecla redesenha (sai do aperto) já com o valor novo, sem esperar a conferência de 0,5 s
    assert deck.screens[6] == drawn(rig, {**cell, "text": "02:00"})
    rig.clear()
    rig.tap(11)
    rig.advance(100)
    assert rig.ran == []
