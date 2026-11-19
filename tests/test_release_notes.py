"""O changelog das Releases (packaging/release_notes.py): os commits agrupados pelo tipo."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "release_notes", Path(__file__).parents[1] / "packaging" / "release_notes.py"
)
assert _spec and _spec.loader
rn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rn)


def test_commits_are_grouped_by_type_with_the_scope_in_bold():
    text = rn.notes(
        [
            "feat(editor): open the editor at deck.localhost",
            "fix: the ring stayed lit",
            "docs(readme): rewrite the README",
            "refactor(d6)!: drop the old draw",
            "Telas: corrige a cor que o D6 mostra",  # formato antigo
            "",
        ],
        "v1.0.0",
        "v0.9.0",
    )
    assert text.index("## New") < text.index("## Fixes") < text.index("## Documentation") < text.index("## Other")
    assert "- **editor:** open the editor at deck.localhost\n" in text
    assert "- the ring stayed lit\n" in text
    assert "- **d6:** drop the old draw (breaking)\n" in text
    assert "- Telas: corrige a cor que o D6 mostra\n" in text
    assert text.rstrip().endswith("/compare/v0.9.0...v1.0.0")


def test_no_previous_tag_and_no_commits():
    text = rn.notes([], "v0.1.0", None)
    assert "No changes since the previous version." in text and "compare" not in text
