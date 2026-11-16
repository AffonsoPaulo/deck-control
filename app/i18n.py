"""Idiomas do app (português e inglês).

O texto em inglês é a própria chave (estilo gettext): tr("Open editor") devolve a tradução
do idioma atual, ou o inglês se faltar. Variáveis vão por nome: tr("Key {n}", n=3).
As traduções ficam em app/locales/<idioma>.json ({"texto em inglês": "tradução"}).

O idioma vem do config ('language: en' ou 'language: pt-BR'); sem ele, segue o do Windows.
Os logs do app continuam em português (são para quem desenvolve).
"""
from __future__ import annotations

import json
from pathlib import Path

LANGS = ("pt-BR", "en")
SOURCE = "en"          # idioma das chaves (o texto no código)
DEFAULT = "pt-BR"       # se não der para descobrir o do Windows
_DIR = Path(__file__).parent / "locales"
_lang: str | None = None
_catalogs: dict[str, dict] = {}


def detect() -> str:
    """Idioma da interface do Windows: português -> pt-BR, qualquer outro -> en."""
    try:
        import ctypes
        langid = ctypes.windll.kernel32.GetUserDefaultUILanguage()
        return "pt-BR" if (langid & 0x3FF) == 0x16 else "en"
    except Exception:
        return DEFAULT


def normalize(lang) -> str:
    if not lang:
        return detect()
    s = str(lang).replace("_", "-").lower()
    return "pt-BR" if s.startswith("pt") else "en" if s.startswith("en") else detect()


def set_language(lang) -> str:
    global _lang
    _lang = normalize(lang)
    return _lang


def language() -> str:
    global _lang
    if _lang is None:
        _lang = detect()
    return _lang


def catalog(lang: str) -> dict:
    if lang not in _catalogs:
        try:
            _catalogs[lang] = json.loads((_DIR / f"{lang}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _catalogs[lang] = {}
    return _catalogs[lang]


def tr(text: str, lang: str | None = None, **kw) -> str:
    lang = lang or language()
    out = text if lang == SOURCE else catalog(lang).get(text, text)
    if kw:
        try:
            out = out.format(**kw)
        except (KeyError, IndexError, ValueError):
            out = text.format(**kw)
    return out
