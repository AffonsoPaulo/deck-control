"""A virada dos números (células com "transition": "flip", como as do widget Relógio): o texto que muda desce e o novo entra por
cima, em 10 quadros de 30 ms (300 ms), terminando exatamente na imagem nova. Só anima a mesma tecla mudando de
texto: troca de página, config novo, reconexão e fim de resposta temporária desenham direto."""

from __future__ import annotations

import time

from app import icons
from d6 import render


def wall(rig, h: int, m: int, s: int = 0) -> None:
    rig.clock.set_wall(time.mktime((2026, 11, 17, h, m, s, 0, 0, -1)))


def drawn(rig, icon: dict) -> bytes:
    cfg = rig.engine.cfg
    return render.encode(icons.render_icon(icon, cfg.base_dir, cfg.raw.get("icons")))


def timed_pushes(rig, deck) -> list[tuple[int, float]]:
    """Registra (tecla, hora em ms) de cada envio daqui para a frente."""
    out: list[tuple[int, float]] = []
    push = deck.push

    def logged(key, jpeg):
        out.append((key, round(rig.clock.monotonic() * 1000)))
        push(key, jpeg)

    deck.push = logged
    return out


CLOCK = """
language: en
pages:
  main:
    1: {widget: app.clock, size: 1x3, options: {third: seconds}}
    6: {icon: {bg: "#ff0000"}, action: {type: page, page: other}}
    7: {icon: {bg: "#ff0000"}, action: {type: page.temp, page: popup, seconds: 2}}
  other:
    1: {widget: app.clock, size: 1x2, options: {format: "12"}}
    6: {icon: {bg: "#00ff00"}, action: {type: page, page: main}}
  popup:
    1: {icon: {text: "99", style: info, text_size: 46, bg: "#1d2330", transition: flip}}
    2: {icon: {bg: "#0000ff"}}
"""
# (a outra página em 12 h e a tecla 1 da popup com outro número: sem a proteção, essas teclas virariam)


def test_changing_minute_flips_in_ten_frames_of_30_ms(make_engine):
    rig = make_engine(CLOCK)
    wall(rig, 14, 32, 58)
    deck = rig.connect()
    pushes = timed_pushes(rig, deck)
    wall(rig, 14, 33, 0)  # minuto e segundo mudam juntos
    rig.advance(600)
    keys = [k for k, _ in pushes]
    assert keys.count(2) == 10 and keys.count(3) == 10 and keys.count(1) == 0  # a hora não mudou
    t2 = [t for k, t in pushes if k == 2]
    gaps = {b - a for a, b in zip(t2, t2[1:])}
    assert gaps == {30}  # um quadro a cada 30 ms
    cells = rig.engine.cfg.pages["main"][1].cells
    assert deck.screens[2] == drawn(rig, {**cells[1], "text": "33"})
    assert deck.screens[3] == drawn(rig, {**cells[2], "text": "00"})


def test_page_with_seconds_checks_values_every_100_ms(make_engine):
    """Com segundos na página, a virada começa até 0,1 s depois da mudança (sem segundos, até 0,5 s)."""
    rig = make_engine(CLOCK)
    wall(rig, 14, 32, 10)
    deck = rig.connect()
    pushes = timed_pushes(rig, deck)
    start = round(rig.clock.monotonic() * 1000)
    wall(rig, 14, 32, 11)
    rig.advance(150)
    first = next(t for k, t in pushes if k == 3)
    assert first - start <= 110


def test_animate_off_draws_straight(make_engine):
    rig = make_engine(CLOCK.replace("options: {third: seconds}", "options: {third: seconds, animate: false}"))
    wall(rig, 14, 32, 58)
    deck = rig.connect()
    rig.clear()
    wall(rig, 14, 33, 0)
    rig.advance(600)
    assert sorted(deck.pushed_keys()) == [2, 3]


def test_switching_between_two_pages_with_clocks_does_not_flip(make_engine):
    rig = make_engine(CLOCK.replace("language: en", "language: en\nicons: {press_shrink: false}"))
    wall(rig, 14, 32, 10)
    deck = rig.connect()
    rig.clear()
    rig.tap(6)
    rig.advance(400)
    assert rig.engine.page == "other"
    assert deck.pushed_keys().count(1) <= 1 and deck.pushed_keys().count(2) <= 1  # direto, sem quadros


def test_reconnect_redraws_without_flipping(make_engine):
    rig = make_engine(CLOCK)
    wall(rig, 14, 32, 10)
    rig.connect()
    wall(rig, 14, 33, 10)
    second = rig.connect()  # o Deck voltou: as telas vão direto
    second.clear_log()
    rig.advance(400)
    assert second.pushed_keys() == []  # nada a virar: já desenhou o minuto novo direto


def test_temporary_page_ending_does_not_flip(make_engine):
    rig = make_engine(CLOCK.replace("language: en", "language: en\nicons: {press_shrink: false}"))
    wall(rig, 14, 32, 10)
    deck = rig.connect()
    rig.tap(7)
    assert rig.engine.page == "popup"
    rig.advance(1000)
    deck.clear_log()
    rig.advance(1200)  # a popup acabou
    assert rig.engine.page == "main"
    assert deck.pushed_keys().count(1) == 1  # a hora volta direto


def test_pressing_a_flipping_key_stops_the_flip_and_shows_it_shrunk(make_engine):
    rig = make_engine(CLOCK)
    wall(rig, 14, 32, 58)
    deck = rig.connect()
    wall(rig, 14, 33, 0)
    rig.advance(120)  # a virada começou
    rig.press(2)
    deck.clear_log()
    rig.advance(400)
    assert deck.pushed_keys().count(2) == 0  # parou: a tecla está encolhida
    rig.release(2)
    cells = rig.engine.cfg.pages["main"][1].cells
    assert deck.screens[2] == drawn(rig, {**cells[1], "text": "33"})


def test_config_reload_draws_straight(make_engine):
    """Trocar o relógio para 12 h no editor (o config recarrega): a hora muda direto, sem virar."""
    import os

    rig = make_engine(CLOCK)
    wall(rig, 14, 32, 10)
    deck = rig.connect()
    path = rig.engine.config_path
    path.write_text(
        path.read_text(encoding="utf-8").replace("{third: seconds}", '{third: seconds, format: "12"}'), encoding="utf-8"
    )
    st = path.stat()
    os.utime(path, (st.st_atime, st.st_mtime + 5))  # o arquivo mudou (garante a data nova)
    deck.clear_log()
    rig.engine._reload_if_changed()  # (interno) o que o laço faz a cada 1 s
    rig.advance(400)
    assert deck.pushed_keys().count(1) == 1  # 14 -> 2 direto
