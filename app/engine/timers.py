"""O que espera o relógio nas teclas: o toque simples esperando ver se vem o 2º (toque duplo), o aperto adiado
(página com toque duplo) e a repetição enquanto a tecla está segurada.

Quem decide o que entra aqui é o app/engine/input.py; run() roda o que chegou a hora.

Threads: tudo no laço do engine, menos clear_repeats(), que vem de quem troca a página (ações, editor).
"""

from __future__ import annotations

from typing import Any, Container

from app import logs
from app.engine.core import Shared, Submit

klog = logs.get("keys")


class Timers:
    def __init__(self, shared: Shared, submit: Submit) -> None:
        self._shared = shared
        self._submit = submit
        self._taps: dict[int, dict[str, Any]] = {}  # toque simples esperando ver se vem o 2º (toque duplo)
        self._deferred: dict[int, dict[str, Any]] = {}  # aperto adiado: página com toque duplo espera igual em todas
        self._repeat: dict[int, dict[str, Any]] = {}  # tecla -> {action, next, every, since} (repetir enquanto segura)

    @property
    def busy(self) -> bool:
        return bool(self._taps or self._deferred or self._repeat)

    # -- toque duplo e aperto adiado
    def wait_double(self, key: int, due: float, action: object) -> None:
        """Toque simples numa tecla com 'double': a ação espera a janela para ver se vem o segundo."""
        self._taps[key] = {"due": due, "action": action}

    def take_tap(self, key: int) -> dict[str, Any] | None:
        """O toque simples que esperava nesta tecla (que, apertada de novo, decide agora)."""
        return self._taps.pop(key, None)

    def defer(self, key: int, due: float, action: object) -> None:
        old = self._deferred.get(key)
        if old is not None and "release" in old:
            # apertou de novo antes do aperto adiado rodar: esse aperto se perde (como sempre), mas o soltar
            # dele, que esperava, roda agora
            self._submit_release(key, old)
        self._deferred[key] = {"due": due, "action": action}

    def defer_release(self, key: int, action: object, page: str) -> bool:
        """A tecla soltou com o aperto ainda adiado: o 'release' espera e roda logo depois dele, para a ordem
        continuar aperto -> soltar. Devolve False se não há aperto adiado (quem chama roda o 'release' já)."""
        item = self._deferred.get(key)
        if item is None or action is None:
            return False
        item["release"] = action
        item["release_page"] = page  # a página na hora do soltar, como seria se rodasse agora
        return True

    def _submit_release(self, key: int, item: dict[str, Any]) -> None:
        self._submit(item["release"], key, "release", page=item["release_page"])

    # -- repetição
    def start_repeat(self, key: int, action: object, first: float, every: float, since: float, moment: str) -> None:
        self._repeat[key] = {"action": action, "next": first, "every": every, "since": since, "n": 0, "moment": moment}

    def stop_repeat(self, key: int) -> dict[str, Any] | None:
        return self._repeat.pop(key, None)

    def clear_repeats(self) -> None:
        self._repeat.clear()

    def run(self, pressed: Container[int]) -> None:
        """Toques simples esperando o toque duplo, apertos adiados e repetições."""
        now = self._shared.clock.monotonic()
        for store in (self._taps, self._deferred):
            for key, item in list(store.items()):
                if now >= item["due"]:
                    del store[key]
                    if store is self._taps:
                        klog.debug("Key %d: no second tap within %d ms -> single tap", key, self._shared.cfg.double_ms)
                    # o 'release' que esperava vai junto, na mesma tarefa: aperto e soltar nunca ao mesmo tempo
                    then = (item["release"], "release", item["release_page"]) if "release" in item else None
                    self._submit(item["action"], key, then=then)
        for key, r in list(self._repeat.items()):
            # para se a tecla soltou ou se um "soltou" se perdeu (nunca repetir para sempre)
            if key not in pressed or now - r["since"] > 30:
                del self._repeat[key]
                continue
            if now >= r["next"]:
                r["n"] = r.get("n", 0) + 1
                self._submit(r["action"], key, r.get("moment", "repeat"))
                r["next"] = max(r["next"] + r["every"], now + r["every"] / 2)
