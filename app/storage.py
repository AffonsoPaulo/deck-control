"""O config.yaml em disco: um lugar só para o arquivo, os backups e o histórico de versões.

Quem mexe no arquivo (o editor, a importação, o engine ao reler, o início do app) passa por ConfigRepository.
Por baixo continuam as mesmas peças:

- app/configio.py   o YAML "de ida e volta": grava só o que mudou, sem perder comentários; o .bak e a troca
                    atômica (configio.replace_text) valem para toda gravação
- app/history.py    as versões guardadas em %LOCALAPPDATA%, para voltar atrás
- app/config.py     a validação e o modelo tipado (Config)

As funções antigas desses módulos continuam funcionando; o repositório só junta tudo atrás de um caminho.
"""

from __future__ import annotations

import hashlib
import shutil
import threading
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import yaml

from app import configio, history
from app.config import Config, build_config, load_config


# conferir a versão e gravar acontecem juntos: o servidor do editor atende pedidos em paralelo (duas abas)
WRITE_LOCK = threading.Lock()


class ConfigRepository:
    """O config de um arquivo. Não guarda nada além do caminho: cada chamada lê ou grava o arquivo na hora."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    # -- o arquivo
    def exists(self) -> bool:
        return self.path.exists()

    def create_from(self, example: Path) -> bool:
        """Cria o arquivo a partir do exemplo, se ainda não existe. Devolve se criou."""
        if self.path.exists():
            return False
        shutil.copy(example, self.path)
        return True

    def revision(self) -> str:
        """Uma marca do arquivo como está agora (muda a cada gravação, de onde vier): o editor manda de volta ao
        salvar, e se o arquivo mudou no meio (outra aba, o histórico, edição à mão) a gravação é recusada."""
        try:
            return hashlib.sha256(self.path.read_bytes()).hexdigest()[:16]
        except OSError:
            return ""

    def read_text(self) -> str:
        """O texto exato do arquivo (com comentários)."""
        return self.path.read_text(encoding="utf-8")

    def read_raw(self) -> dict[str, Any]:
        """O config como o app lê (PyYAML), sem validar. Arquivo vazio = {}."""
        raw: dict[str, Any] = yaml.safe_load(self.read_text()) or {}
        return raw

    def read_plain(self) -> dict[str, Any]:
        """O config para o editor (JSON: as teclas viram texto)."""
        plain: dict[str, Any] = configio.read_plain(self.path)
        return plain

    def text_without_secrets(self, secret_paths: Iterable[Sequence[Any]]) -> str:
        """O texto do arquivo com as senhas em branco (para exportar e para o pacote de diagnóstico).
        secret_paths: o caminho até cada senha (PluginManager.secret_paths)."""
        text: str = configio.without_secrets(self.read_text(), secret_paths)
        return text

    # -- validar
    def load(self) -> Config:
        """Lê e valida o arquivo (levanta ConfigError com todos os problemas)."""
        return load_config(self.path)

    def validate(self, raw: Any) -> Config:
        """Valida um config ainda não gravado, como se fosse este arquivo (levanta ConfigError)."""
        return build_config(raw, self.path)

    # -- gravar
    def save(self, cfg: dict[str, Any]) -> None:
        """Grava mexendo só no que mudou (comentários e estilo ficam); o anterior vira o .bak. Não valida nem
        registra no histórico: quem grava valida antes e chama record() depois."""
        configio.save_plain(self.path, cfg)

    # -- histórico
    def record(self, reason: str | None = None) -> None:
        """Guarda o estado atual do arquivo no histórico, se mudou desde a última versão."""
        history.record(self.path, reason)

    def versions(self) -> list[dict[str, Any]]:
        """As versões guardadas, da mais nova para a mais antiga (sem o texto)."""
        return history.entries(self.path)

    def restore(self, entry_id: str) -> str:
        """Volta o arquivo para uma versão do histórico (o atual vira o .bak). Devolve quando era a versão."""
        return history.restore(self.path, entry_id)
