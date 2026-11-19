"""Avisos de energia do Windows (app/windows/power.py): quem recebe cada um, e a janela de verdade no Windows."""

from __future__ import annotations

import sys

import pytest

from app.windows import power


def recorder() -> tuple[list[str], power.Handlers]:
    calls: list[str] = []
    return calls, power.Handlers(
        suspend=lambda: calls.append("suspend"),
        resume=lambda: calls.append("resume"),
        end_session=lambda: calls.append("end_session"),
    )


def test_each_notice_goes_to_its_handler():
    calls, h = recorder()
    assert power.dispatch(power.WM_QUERYENDSESSION, 0, h) == 1  # nunca segura o desligamento
    assert power.dispatch(power.WM_ENDSESSION, 0, h) == 0  # desligamento cancelado: nada a fazer
    assert power.dispatch(power.WM_ENDSESSION, 1, h) == 0
    assert power.dispatch(power.WM_POWERBROADCAST, power.PBT_APMSUSPEND, h) == 1
    assert power.dispatch(power.WM_POWERBROADCAST, power.PBT_APMRESUMEAUTOMATIC, h) == 1
    assert power.dispatch(power.WM_POWERBROADCAST, power.PBT_APMRESUMESUSPEND, h) == 1
    assert power.dispatch(power.WM_POWERBROADCAST, 0x8013, h) == 1  # outro aviso de energia: ignorado
    assert power.dispatch(0x0001, 0, h) is None  # WM_CREATE etc.: para o DefWindowProc
    assert calls == ["end_session", "suspend", "resume", "resume"]


@pytest.mark.skipif(sys.platform != "win32", reason="a janela de avisos só existe no Windows")
def test_the_hidden_window_receives_the_notices():
    import ctypes

    calls, h = recorder()
    hwnd = power.watch(h)
    assert hwnd
    send = ctypes.windll.user32.SendMessageW
    send.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
    send.restype = ctypes.c_ssize_t
    assert send(hwnd, power.WM_POWERBROADCAST, power.PBT_APMSUSPEND, 0) == 1
    assert send(hwnd, power.WM_POWERBROADCAST, power.PBT_APMRESUMEAUTOMATIC, 0) == 1
    assert send(hwnd, power.WM_QUERYENDSESSION, 0, 0) == 1
    assert calls == ["suspend", "resume"]
    assert not ctypes.windll.user32.IsWindowVisible(ctypes.c_void_p(hwnd))
