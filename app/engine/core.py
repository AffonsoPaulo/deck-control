"""O que todas as peças do engine compartilham: o config em uso, a trava e o relógio."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.config import Config


class Clock(Protocol):
    """O que o engine usa do módulo `time` (o próprio módulo serve; os testes passam um relógio falso)."""

    def monotonic(self) -> float: ...
    def time(self) -> float: ...


class Submit(Protocol):
    """Manda uma ação para o pool de ações (Engine._submit). As peças recebem esta função, nunca o pool: os
    testes trocam o pool depois de o Engine nascer.

    page: a página da tecla, quando não é mais a da tela (a página temporária que acabou de fechar); None = a
    página na tela.
    then: outra ação da mesma tecla (spec, momento, página) que roda logo depois, na mesma tarefa: o pool tem
    várias threads, e duas tarefas mandadas juntas podem rodar ao mesmo tempo ou fora de ordem."""

    def __call__(
        self,
        spec: object,
        key: int,
        moment: str = "press",
        label: str | None = None,
        page: str | None = None,
        then: tuple[object, str, str | None] | None = None,
    ) -> None: ...


class Shared:
    """O config em uso (trocado inteiro a cada releitura: as peças leem `shared.cfg` na hora, nunca guardam), a
    trava única do engine e o relógio. A trava é reentrante e a mesma para todas as peças: cada trecho que
    antes era um `with self._lock` continua sendo um só."""

    def __init__(self, cfg: Config, clock: Clock) -> None:
        self.cfg = cfg
        self.clock = clock
        self.lock = threading.RLock()
