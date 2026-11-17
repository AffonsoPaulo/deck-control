"""GIF que toca uma vez ("loop": false no ícone) e transições em widgets de fora do app.

Caso de uso: o plugin de clima muda de ensolarado para nublado e publica o caminho de "sol-para-nuvem.gif"; a
tecla toca a animação uma vez e fica no último quadro (a nuvem). Um redesenho qualquer (estado, aperto,
reconexão) não recomeça a animação; ícone novo ou voltar à página, sim.
"""

from __future__ import annotations

from PIL import Image

from app.plugins import MANAGER, PluginAPI

R, G, B, Y = (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)


def near(got, want, tol: int = 40) -> bool:
    return all(abs(a - b) <= tol for a, b in zip(got, want))


def gif(path, colors) -> str:
    frames = [Image.new("RGB", (112, 112), c) for c in colors]
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=100, loop=0)
    return path.as_posix()


def cfg(image: str, extra: str = "", loop: str = "loop: false") -> str:
    return f"""
language: en
pages:
  main:
    4: {{icon: {{image: "{image}", {loop}}}, active_icon: {{image: "{image}", {loop}}}, state: s{extra}}}
    6: {{icon: {{bg: "#ffffff"}}, action: {{type: page, page: other}}}}
  other:
    6: {{icon: {{bg: "#000000"}}, action: {{type: page, page: main}}}}
"""


def test_plays_once_and_stays_on_the_last_frame(make_engine, tmp_path):
    rig = make_engine(cfg(gif(tmp_path / "a.gif", [R, G, B])))
    deck = rig.connect()
    assert near(deck.center(4), R)
    rig.clear()
    rig.advance(1000)
    assert deck.pushed_keys() == [4, 4]  # G e B, uma vez
    assert near(deck.center(4), B)


def test_default_gif_keeps_looping(make_engine, tmp_path):
    rig = make_engine(cfg(gif(tmp_path / "a.gif", [R, G, B]), loop="style: big"))
    deck = rig.connect()
    rig.clear()
    rig.advance(1000)
    assert deck.pushed_keys().count(4) >= 9  # continua (como sempre foi)


def test_unrelated_redraw_does_not_replay(make_engine, tmp_path):
    rig = make_engine(cfg(gif(tmp_path / "a.gif", [R, G, B])))
    deck = rig.connect()
    rig.advance(1000)
    rig.clear()
    rig.engine.set_state("s", True)  # a tecla redesenha (mesma imagem no estado ligado)
    rig.advance(1000)
    assert deck.pushed_keys().count(4) <= 1
    assert near(deck.center(4), B)


def test_pressing_after_it_finished_does_not_replay(make_engine, tmp_path):
    rig = make_engine(cfg(gif(tmp_path / "a.gif", [R, G, B]), extra=", action: {type: none, tag: x}"))
    deck = rig.connect()
    rig.advance(1000)
    rig.tap(4)
    rig.clear()
    rig.advance(1000)
    assert deck.pushed_keys() == []
    assert near(deck.center(4), B)


def test_pressing_in_the_middle_skips_to_the_end(make_engine, tmp_path):
    rig = make_engine(cfg(gif(tmp_path / "a.gif", [R, G, B]), extra=", action: {type: none, tag: x}"))
    deck = rig.connect()
    rig.press(4)
    rig.release(4)
    rig.advance(1000)
    assert near(deck.center(4), B)


def test_coming_back_to_the_page_plays_again(make_engine, tmp_path):
    rig = make_engine(
        cfg(gif(tmp_path / "a.gif", [R, G, B])).replace("language: en", "language: en\nicons: {press_shrink: false}")
    )
    deck = rig.connect()
    rig.advance(1000)
    rig.tap(6)
    rig.tap(6)
    assert rig.engine.page == "main"
    assert near(deck.center(4), R)  # recomeçou
    rig.advance(1000)
    assert near(deck.center(4), B)


PLUGIN = """
language: en
pages:
  main:
    4: {icon: {image: "{obs.test_anim}", loop: false}}
"""


def _plugin_values(rig) -> PluginAPI:
    api = PluginAPI(MANAGER, MANAGER.plugins["obs"])
    api._m.values = rig.engine.values  # (as Values do engine de teste)
    return api


def test_plugin_switches_the_animation_by_value(make_engine, tmp_path):
    """O jeito do clima: publicar o caminho do GIF da transição; cada mudança toca a sua uma vez."""
    sun = gif(tmp_path / "sol.gif", [Y, Y, R])
    cloud = gif(tmp_path / "sol-para-nuvem.gif", [Y, G, B])
    rig = make_engine(PLUGIN)
    api = _plugin_values(rig)
    api.set_value("obs.test_anim", sun)
    deck = rig.connect()
    rig.advance(1000)
    assert near(deck.center(4), R)
    api.set_value("obs.test_anim", cloud)
    rig.advance(1500)
    assert near(deck.center(4), B)  # tocou a nova e parou no fim
    rig.clear()
    rig.advance(1000)
    assert deck.pushed_keys() == []


TRANSITION = """
language: en
widgets:
  placar:
    label: Placar
    options: [{name: animate, kind: bool, default: true}]
    sizes:
      1x1:
        - - {text: "{obs.test_score}", sub: pontos, style: info, text_size: 46, bg: "#1d2330",
             transition: {$opt: animate, "true": flip}}
pages:
  main:
    1: {widget: placar, size: 1x1}
"""


def test_widget_from_outside_the_app_can_use_the_transition(make_engine):
    """Widget de plugin ou da pessoa (mesmo caminho): "transition": "flip" vira o texto igual ao relógio."""
    rig = make_engine(TRANSITION)
    api = _plugin_values(rig)
    api.set_value("obs.test_score", 7)
    deck = rig.connect()
    rig.clear()
    api.set_value("obs.test_score", 8)
    rig.advance(900)
    assert deck.pushed_keys().count(1) == 10


def test_unknown_transition_draws_straight(make_engine):
    rig = make_engine(TRANSITION.replace('"true": flip', '"true": morph'))
    api = _plugin_values(rig)
    api.set_value("obs.test_score", 7)
    deck = rig.connect()
    rig.clear()
    api.set_value("obs.test_score", 8)
    rig.advance(900)
    assert deck.pushed_keys().count(1) == 1
