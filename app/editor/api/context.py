"""O que toda rota da API recebe: o config, o engine (se o app estiver rodando), os plugins e os valores."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from app.i18n import tr

if TYPE_CHECKING:
    from app.engine import Engine
    from app.plugins import PluginManager
    from app.values import Values

MAX_BODY = 8 * 1024 * 1024  # maior corpo aceito (e maior arquivo dentro dele: importação, plugin)


@dataclass(frozen=True, slots=True)
class Context:
    config_path: Path
    engine: "Engine | None"
    plugins: "PluginManager"
    values: "Values"

    def need_engine(self) -> "Engine":
        """Para as rotas que só funcionam com o app rodando (testar tecla, gravar atalho)."""
        if self.engine is None:
            raise RuntimeError(tr("the app isn't running"))
        return self.engine
