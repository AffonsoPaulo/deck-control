"""Engine e o aparelho: conectar, perder o D6 e reconectar (pelo run() de verdade), brilho e anel de LEDs,
com o D6 falso (tests/fakes). Também confere que o FakeDeck acompanha o d6.device.D6 de verdade.
"""

from __future__ import annotations

import inspect
import re
from pathlib import Path

import pytest

from app import logs
from d6.device import D6, DeviceNotFound
from tests.fakes import DeckProtocol, FakeDeck

ENGINE_DIR = Path(__file__).resolve().parent.parent / "app" / "engine"


def _engine_sources() -> dict[str, str]:
    """Os módulos do engine (app/engine/*.py), pelo nome do arquivo."""
    return {p.name: p.read_text(encoding="utf-8") for p in sorted(ENGINE_DIR.glob("*.py"))}


RECONNECT = """
language: en
brightness: 70
device: {settle: 0.5}
pages:
  main:
    1: {icon: {text: Mic}, action: {type: bind, keys: "ctrl+f13"}}
    2: {icon: {bg: "#ff0000"}}
"""


# ---------------------------------------------------------------------------- o falso e o de verdade


def _members(cls) -> set[str]:
    return {n for n in vars(cls) if not n.startswith("_")}


def test_engine_uses_only_what_the_deck_protocol_has():
    """Tudo o que o engine chama no aparelho está no DeckProtocol (senão o FakeDeck está atrasado)."""
    used = set(re.findall(r"\bdeck\.([a-z_]+)", "\n".join(_engine_sources().values())))
    # lê todo o app/engine/: se a conversa com o aparelho sair de lá, isto falha em vez de passar vazio
    assert {"events", "push", "set_leds", "enable_keys", "close"} <= used, "o uso do aparelho saiu do app/engine/?"
    used.add("open")  # D6().open(), pelo `device` do Engine
    assert used <= _members(DeckProtocol) | {"settle"}, used - _members(DeckProtocol)


@pytest.mark.parametrize("name", sorted(_members(DeckProtocol)))
def test_real_d6_has_the_protocol_with_the_same_parameters(name):
    real, fake = getattr(D6, name), getattr(FakeDeck, name)
    if isinstance(inspect.getattr_static(D6, name), property):
        return
    rp = inspect.signature(real).parameters
    for p in inspect.signature(fake).parameters.values():
        if p.kind is p.VAR_KEYWORD:
            continue
        assert p.name in rp, f"D6.{name} não tem o parâmetro {p.name}"
        assert rp[p.name].default == p.default, f"D6.{name}({p.name}) tem outro padrão"


def test_engine_reads_time_and_opens_the_deck_only_through_what_it_receives():
    """O relógio e o D6 entram pelo Engine(clock=..., device=...): nenhuma peça lê o `time` nem cria o D6 direto
    (senão o relógio falso e o D6 falso dos testes não valeriam para ela)."""
    sources = _engine_sources()
    assert "engine.py" in sources and len(sources) > 1
    for name, src in sources.items():
        assert not re.search(r"\btime\.[a-z_]+\(", src), f"{name} lê o time direto"
        assert not re.search(r"\bD6\(", src), f"{name} cria o D6 direto"


def test_real_d6_sets_settle():
    assert "self.settle" in inspect.getsource(D6.__init__)


# ---------------------------------------------------------------------------- conectar


def test_connect_enables_keys_with_the_config_options(make_engine):
    rig = make_engine(RECONNECT)
    assert rig.engine.device_connected is False
    deck = rig.connect()
    assert rig.engine.device_connected is True
    assert deck.opened
    assert deck.enabled == [70]  # brilho do config
    assert deck.settle == 0.5  # device.settle
    assert rig.engine.firmware == "V3.D6.1.009"
    assert rig.engine.device_info()["usb"] == "3142:0060"


def test_keys_are_always_drawn_without_a_session(make_engine):
    """Só o envio rápido (push, sem sessão). As chaves do modo antigo num config velho são ignoradas."""
    rig = make_engine(RECONNECT.replace("{settle: 0.5}", "{session: true, per_key_session: true, key_delay: 0.3}"))
    deck = rig.connect()
    assert sorted(k for k, _ in deck.pushes) == list(range(1, 16))


# ---------------------------------------------------------------------------- perder e reconectar


@pytest.mark.parametrize("error", [OSError("unplugged"), ValueError("bad report")])
def test_lost_deck_is_closed_and_reopened_with_every_key_redrawn(make_engine, error):
    """Erro de HID no meio do loop: solta as combinações seguradas, fecha o Deck, abre de novo e reenvia as
    15 imagens (o D6 pode ter perdido as telas), mesmo sem nada ter mudado."""
    rig = make_engine(RECONNECT)
    first, second = rig.factory.prepare(), rig.factory.prepare()

    def unplug():
        raise error

    first.script = [None, lambda: first.queue(1, True), unplug]  # desenha, aperta o bind, cabo puxado
    second.script = [rig.engine.stop]
    rig.run()

    assert rig.factory.made == [first, second]
    # as 15 telas, mais a tecla 1 encolhida (o cabo saiu com ela apertada)
    assert sorted(set(first.pushed_keys())) == list(range(1, 16))
    assert first.pushed_keys().count(1) == 2
    normal_1 = next(img for k, img in first.pushes if k == 1)
    assert first.closed
    assert rig.keys == [("down", "ctrl+f13"), ("up", "ctrl+f13")]  # Ctrl não fica preso
    assert second.enabled == [70]
    assert second.settle == 0.5
    assert sorted(second.pushed_keys()) == list(range(1, 16))
    # depois de reconectar nenhuma tecla está apertada: a 1 volta normal, as outras iguais
    assert second.screens == {**first.screens, 1: normal_1}
    # ao parar: plugins desligados, pool fechado sem esperar, Deck fechado
    assert second.closed
    assert rig.engine.deck is None
    assert rig.engine.plugins.calls == ["attach", "sync", "stop_all"]
    assert rig.pool.shutdowns == [{"wait": False, "cancel_futures": True}]


BLACK_RING = [(0, 0, 0)] * 18


def test_quitting_turns_the_screens_and_the_light_off(make_engine):
    """Ao fechar o app, o Deck não fica congelado na última imagem: anel preto e telas dormindo (HAN), e só
    depois a conexão fecha. A USB segue ligada (o PC pode estar carregando algo nela)."""
    rig = make_engine(RECONNECT)
    deck = rig.factory.prepare()
    deck.script = [None, rig.engine.stop]
    rig.run()
    assert deck.slept == 1 and deck.leds[-1] == BLACK_RING
    assert deck.closed


def test_pc_going_to_sleep_turns_the_deck_off_and_waking_up_redraws_it(make_engine):
    """suspend(): o laço apaga o Deck e o solta; resume(): reconecta (a sessão acorda as telas) e redesenha as
    15 teclas. Enquanto o PC dorme, nada é mandado ao aparelho."""
    rig = make_engine(RECONNECT)
    first, second = rig.factory.prepare(), rig.factory.prepare()
    first.script = [None, rig.engine.suspend]
    second.script = [rig.engine.stop]
    stop = rig.run(on_wait=[lambda: None, rig.engine.resume])  # duas esperas dormindo, depois acorda
    assert first.slept == 1 and first.leds[-1] == BLACK_RING and first.closed
    assert stop.waits[:2] == [0.5, 0.5]
    assert rig.factory.made == [first, second]
    assert second.enabled == [70]  # a sessão de enable_keys acorda as telas
    assert sorted(second.pushed_keys()) == list(range(1, 16))
    assert second.slept == 1  # e ao parar, apaga de novo


def test_turning_off_a_deck_that_was_unplugged_does_not_break_the_stop(make_engine):
    rig = make_engine(RECONNECT)
    deck = rig.factory.prepare()

    def unplugged() -> None:
        raise OSError("unplugged")

    deck.sleep = unplugged  # type: ignore[method-assign]
    deck.script = [None, rig.engine.stop]
    rig.run()
    assert deck.closed and rig.engine.deck is None


def test_other_errors_stop_the_loop_and_close_the_deck(make_engine):
    """Só OSError/ValueError (HID) reconectam; outro erro sai do run(), que ainda fecha tudo."""
    rig = make_engine(RECONNECT)
    deck = rig.factory.prepare()

    def bug():
        raise RuntimeError("boom")

    deck.script = [None, bug]
    with pytest.raises(RuntimeError):
        rig.run()
    assert rig.factory.made == [deck]
    assert deck.closed
    assert rig.engine.deck is None


def test_missing_deck_is_retried_every_2_s_and_becomes_a_problem_after_5_s(make_engine, monkeypatch):
    opened: list[str] = []
    real_problem = logs.problem
    monkeypatch.setattr(logs, "problem", lambda pid, *a, **k: (opened.append(pid), real_problem(pid, *a, **k)))
    rig = make_engine(RECONNECT)
    rig.factory.fail = [DeviceNotFound("Fifine D6 not found")] * 4
    deck = rig.factory.prepare()
    deck.script = [rig.engine.stop]
    stop = rig.run()
    assert stop.waits == [2, 2, 2, 2]  # tentativas aos 0, 2, 4 e 6 s; a 5ª conecta
    assert opened == ["device.disconnected"]  # aos 4 s ainda não; aos 6 s sim
    assert rig.factory.made == [deck]
    assert sorted(deck.pushed_keys()) == list(range(1, 16))
    assert "device.disconnected" not in [p.get("id") for p in logs.problems()]  # conectou: resolvido


# ---------------------------------------------------------------------------- brilho


def test_brightness_action_absolute_and_in_cycle(make_engine):
    rig = make_engine("""
        language: en
        brightness: 90
        pages:
          main:
            1: {icon: {text: "40"}, action: {type: brightness, value: 40}}
            2: {icon: {text: "+"}, action: {type: brightness, step: 25}}
    """)
    deck = rig.connect()
    assert deck.enabled == [90]
    rig.tap(1)
    assert deck.brightness == [40]
    rig.tap(2)
    rig.tap(2)
    rig.tap(2)
    rig.tap(2)
    assert deck.brightness == [40, 65, 90, 10, 35]  # passou de 100: volta para 10


# ---------------------------------------------------------------------------- anel de LEDs


LIGHT = """
language: en
lighting:
  effect: solid
  color: "#ff0000"
  brightness: 100
  off_with_screen: false
  reaction: {kind: none}
pages:
  main:
    1: {icon: {bg: "#0000ff"}, action: {type: light.flash, color: "#00ff00", seconds: 2}}
"""


def test_light_section_paints_the_ring_and_flash_answers_for_a_while(make_engine):
    rig = make_engine(LIGHT)
    deck = rig.connect()
    assert deck.leds
    base = deck.leds[-1]
    assert len(set(base)) == 1 and base[0][0] > 200 and base[0][1] < 30  # vermelho no anel todo
    rig.tap(1)
    assert deck.leds[-1] == [(0, 255, 0)] * 18
    rig.advance(1900)
    assert deck.leds[-1] == [(0, 255, 0)] * 18
    rig.advance(200)
    assert deck.leds[-1] == base


def test_same_ring_frame_is_resent_every_1_5_s(make_engine):
    """O anel volta sozinho depois dos dois cliques no botão de trás: o mesmo quadro é reenviado."""
    rig = make_engine(LIGHT)
    deck = rig.connect()
    deck.clear_log()
    rig.advance(1400, step=100)
    assert deck.leds == []
    rig.advance(200, step=100)
    assert len(deck.leds) == 1


def test_without_light_section_the_ring_is_left_alone(make_engine):
    rig = make_engine("""
        language: en
        pages:
          main:
            1: {icon: {bg: "#0000ff"}, action: {type: light.flash, color: "#00ff00", seconds: 2}}
    """)
    deck = rig.connect()
    rig.tap(1)  # light.flash é ignorado (com aviso no log)
    rig.advance(2000)
    assert deck.leds == []
