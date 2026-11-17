"""Os estados liga/desliga (mic, obs.recording, toggle:main:3...): o ícone ativo e as regras das teclas olham aqui.

Mudar um estado marca para redesenhar as teclas da página na tela que mostram esse estado e as que têm regras
ou valores (podem depender dele).

Threads: set() vem das ações (pool) e dos plugins (OBS, Discord, plugins de terceiros); get() também do laço do
engine (desenho) e do app/values.py.
"""

from __future__ import annotations

from typing import Callable

from app import logs
from app.engine.core import Shared
from app.engine.drawing import ALL_KEYS, DrawQueue

vlog = logs.get("values")


class StateTable:
    def __init__(self, shared: Shared, page: Callable[[], str], queue: DrawQueue) -> None:
        self._shared = shared
        self._page = page  # a página na tela agora (lida a cada uso)
        self._queue = queue
        self.flags: dict[str, bool] = {}

    def register(self) -> None:
        """Os estados que o config usa começam desligados (os que já existem ficam como estão)."""
        with self._shared.lock:
            for name in self._shared.cfg.all_states():
                self.flags.setdefault(name, False)

    def get(self, name: str) -> bool:
        with self._shared.lock:
            return self.flags.get(name, False)

    def set(self, name: str, value: bool) -> None:
        with self._shared.lock:
            old = self.flags.get(name)
            if old == value:
                return
            self.flags[name] = value
            cfg = self._shared.cfg
            for key, spec in cfg.page_keys(self._page()).items():
                if spec.state == name:
                    self._queue.mark(key)
            for key in ALL_KEYS:  # teclas com regras/valores podem depender do estado
                sp = cfg.spec_at(self._page(), key)[0]
                if sp is not None and sp.dynamic:
                    self._queue.mark(key)
        vlog.debug("State %s: %s -> %s", name, old, value)

    def with_prefix(self, prefix: str) -> list[str]:
        with self._shared.lock:
            return [n for n in self.flags if n.startswith(prefix)]
