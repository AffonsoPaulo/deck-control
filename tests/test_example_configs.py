"""Os dois configs de exemplo (português e inglês) andam juntos: mesmos campos, mesmos valores, só o texto muda.

A primeira abertura copia um deles conforme o idioma do Windows (paths.example_config). Mudou um, mude o outro:
este teste aponta onde eles se separaram.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app import paths
from app.config.load import build_config

PT = paths.EXAMPLE_CONFIG
EN = paths.EXAMPLE_CONFIG_EN

# campos cujo texto é traduzido (o que aparece na tecla ou é digitado) e os nomes de cena do OBS
TRANSLATED = {"text", "scene"}


def _load(p: Path) -> dict[str, Any]:
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def _differences(pt: Any, en: Any, where: str, pages: dict[str, str]) -> list[str]:
    """Onde os dois se separam. `pages`: nome da página em português -> em inglês (pela ordem)."""
    if isinstance(pt, dict) and isinstance(en, dict):
        if pt.keys() != en.keys():
            return [f"{where}: fields {sorted(map(str, pt.keys() ^ en.keys()))} are only in one of the files"]
        out: list[str] = []
        for k in pt:
            field = str(k)
            if field in TRANSLATED and isinstance(pt[k], str) and isinstance(en[k], str):
                continue
            if field == "page" and isinstance(pt[k], str):  # page: nome (a ação "page" por extenso)
                if pages.get(pt[k], pt[k]) != en[k]:
                    out.append(f"{where}.page: '{pt[k]}' should be '{pages.get(pt[k], pt[k])}' in English")
                continue
            out += _differences(pt[k], en[k], f"{where}.{field}", pages)
        return out
    if isinstance(pt, list) and isinstance(en, list):
        if len(pt) != len(en):
            return [f"{where}: {len(pt)} items in Portuguese, {len(en)} in English"]
        return [d for i, (a, b) in enumerate(zip(pt, en)) for d in _differences(a, b, f"{where}[{i}]", pages)]
    if isinstance(pt, str) and isinstance(en, str) and pt.startswith("page:") and en.startswith("page:"):
        want = "page:" + pages.get(pt[5:], pt[5:])  # "page:mais" -> "page:more"
        return [] if en == want else [f"{where}: '{en}' should be '{want}'"]
    return [] if pt == en else [f"{where}: {pt!r} in Portuguese, {en!r} in English"]


def test_both_example_configs_have_the_same_fields():
    pt, en = _load(PT), _load(EN)
    pt_pages, en_pages = pt.pop("pages"), en.pop("pages")
    # as páginas podem ter nome traduzido, mas a ordem e as teclas são as mesmas
    assert len(pt_pages) == len(en_pages), "the two examples have a different number of pages"
    names = dict(zip(pt_pages, en_pages))
    problems = _differences(pt, en, "config", names)
    for (pt_name, pt_keys), en_keys in zip(pt_pages.items(), en_pages.values()):
        problems += _differences(pt_keys, en_keys, f"pages.{pt_name}", names)
    assert problems == [], "config.example.yaml and config.example.en.yaml drifted apart:\n" + "\n".join(problems)


def test_the_comparison_catches_a_drift():
    # sem isto, um _differences que nunca acha nada passaria no teste de cima
    pt = {"brightness": 80, "pages": {"main": {1: {"icon": {"text": "Mais", "bg": "#000"}, "action": "page:mais"}}}}
    en = {"brightness": 70, "pages": {"main": {1: {"icon": {"text": "More", "bg": "#fff"}, "action": "page:mais"}}}}
    problems = _differences(pt, en, "config", {"main": "main", "mais": "more"})
    assert problems == [
        "config.brightness: 80 in Portuguese, 70 in English",
        "config.pages.main.1.icon.bg: '#000' in Portuguese, '#fff' in English",
        "config.pages.main.1.action: 'page:mais' should be 'page:more'",
    ]


def test_both_example_configs_validate():
    for p in (PT, EN):
        assert build_config(_load(p), p).pages


def test_first_run_picks_the_example_in_the_windows_language():
    assert paths.example_config("pt-BR") == PT
    assert paths.example_config("en") == EN
    assert EN.is_file() and "example config (en)" in paths.RESOURCES
