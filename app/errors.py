"""Erros do app, com uma base comum.

`except DeckError` pega qualquer erro "esperado" do app: o texto já vem traduzido e pensado para a pessoa ler.
Cada um também continua sendo um `ValueError`, como antes, para não mudar quem já captura por essa classe.

O driver do aparelho (`d6/`) tem os erros dele (`DeviceNotFound`) e não depende do app, porque as ferramentas de
`tools/` usam o driver sozinho.
"""

from __future__ import annotations


class DeckError(Exception):
    """Base dos erros do app."""


class ConfigError(DeckError, ValueError):
    """O config tem problemas (a mensagem lista todos)."""


class PluginError(DeckError, ValueError):
    """Um plugin não pôde ser lido, instalado ou removido."""
