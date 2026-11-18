"""Páginas: a página na tela, o histórico (voltar, início), a página temporária e as telas pintadas.

Trocar o que aparece marca todas as teclas para redesenhar (DrawQueue). Cada caminho limpa o que sempre limpou,
e nem todos limpam o mesmo: go_to_page para a repetição e esquece as marcas de erro; a página temporária e o fim
dela não param a repetição; as telas pintadas só redesenham.

Threads: go_to_page, paint_screens e show_temp_page vêm das ações (pool), do editor (/api/show) e das automações;
answer_press e expire, do laço do engine.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app import logs
from app.engine.core import Shared, Submit
from app.engine.drawing import DrawQueue
from app.engine.timers import Timers
from app.i18n import tr
from d6.device import KEY_COUNT

if TYPE_CHECKING:
    from app.config.model import Config

log = logs.get("engine")


class Navigation:
    def __init__(self, shared: Shared, queue: DrawQueue, timers: Timers, submit: Submit) -> None:
        self._shared = shared
        self._queue = queue
        self._timers = timers
        self._submit = submit
        self.page: str = shared.cfg.home
        self._history: list[str] = []
        self.overlay: dict[str, Any] | None = None  # telas pintadas (resposta temporária)
        self.temp: dict[str, Any] | None = None  # página temporária

    def go_to_page(self, name: str) -> str | None:
        """Troca de página ('back', 'home' ou o nome). Devolve a página nova, ou None se nada mudou."""
        with self._shared.lock:
            before = self.page
            if name == "back":
                if not self._history:
                    return None
                target = self._history.pop()
            elif name == "home":
                target, self._history = self._shared.cfg.home, []
            else:
                if name not in self._shared.cfg.pages:
                    raise ValueError(f"página '{name}' não existe")
                if name == self.page:
                    return None
                self._history.append(self.page)
                target = name
            self.page = target
            self._queue.mark_all()
            self._timers.clear_repeats()  # repetição é da tecla da página anterior
            self._queue.clear_errors()  # a marca de erro era de uma tecla da outra página
        log.info("Page changed: %s -> %s", before, target)
        if self.temp is not None and target != self.temp["page"]:
            self.temp = None  # saiu da página temporária na mão
        self._queue.forget_dynamic()
        return target

    def on_reload(self, new: Config) -> None:
        """Config relido (com a trava): a página sumiu do config, volta para a inicial."""
        if self.page not in new.pages:
            self.page, self._history = new.home, []

    # -- respostas temporárias
    def paint_screens(self, icon: dict[str, Any], seconds: float, dismiss: bool, passthrough: bool) -> None:
        with self._shared.lock:
            self.overlay = {
                "icon": icon,
                "until": self._shared.clock.monotonic() + seconds,
                "dismiss": dismiss,
                "passthrough": passthrough,
            }
            self._queue.mark_all()

    def end_overlay(self) -> None:
        with self._shared.lock:
            self.overlay = None
            self._queue.mark_all()

    def show_temp_page(self, page: str, seconds: float, dismiss: bool, passthrough: bool, show_left: bool) -> None:
        if page not in self._shared.cfg.pages:
            raise ValueError(tr("page '{page}' doesn't exist", page=page))
        now = self._shared.clock.monotonic()
        with self._shared.lock:
            ret = self.temp["ret"] if self.temp else self.page
            close = None
            if show_left:  # a última tecla vazia vira "Fechar" com o tempo que falta
                for k in range(KEY_COUNT, 0, -1):
                    if self._shared.cfg.spec_at(page, k)[0] is None:
                        close = k
                        break
            self.temp = {
                "page": page,
                "ret": ret,
                "until": now + seconds,
                "total": seconds,
                "dismiss": dismiss,
                "passthrough": passthrough,
                "close_key": close,
            }
            before = self.page
            self.page = page
            self._queue.mark_all()
            self._queue.forget_dynamic()
            self._queue.clear_errors()
        log.info("Page changed: %s -> %s (temporary, %.0f s)", before, page, seconds)

    def end_temp(self) -> None:
        t = self.temp
        if t is None:
            return
        with self._shared.lock:
            self.temp = None
            if self.page == t["page"]:
                cfg = self._shared.cfg
                self.page = t["ret"] if t["ret"] in cfg.pages else cfg.home
                self._queue.mark_all()
                self._queue.forget_dynamic()
                self._queue.clear_errors()
        log.info("Page changed: %s -> %s (temporary page ended)", t["page"], self.page)

    def answer_press(self, key: int) -> bool:
        """Tecla apertada durante uma resposta temporária. True = o aperto acabou aqui."""
        ov = self.overlay
        if ov is not None:
            if ov["dismiss"]:
                self.end_overlay()
            return not ov["passthrough"]
        t = self.temp
        if t is not None and self.page == t["page"]:
            if key == t.get("close_key"):
                self.end_temp()
                return True
            if t["dismiss"]:
                spec = self._shared.cfg.spec_at(t["page"], key)[0]
                self.end_temp()
                if t["passthrough"] and spec is not None:
                    # a página já fechou, mas a tecla apertada é da temporária: roda como tecla dela
                    self._submit(spec.action, key, page=t["page"])
                return True
        return False

    def expire(self, now: float) -> None:
        """Telas pintadas e página temporária cujo tempo acabou."""
        if self.overlay is not None and now >= self.overlay["until"]:
            self.end_overlay()
        if self.temp is not None and now >= self.temp["until"]:
            self.end_temp()
