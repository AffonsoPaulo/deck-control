"""O texto da Release no GitHub: os commits desde a tag anterior, agrupados pelo tipo (Conventional Commits).

    python packaging/release_notes.py v0.9.0-rc3                          # na tela
    python packaging/release_notes.py v0.9.0-rc3 packaging/Output/release-notes.md

Roda no job de build da CI de versão (só leitura); o job que cria a Release só usa o arquivo pronto. Os commits
antigos (antes de 2026-11-19, "Área: o que mudou", em português) entram em "Other changes".
"""

from __future__ import annotations

import re
import subprocess
import sys

REPO = "https://github.com/AffonsoPaulo/deck-control"
# tipo -> seção, na ordem em que aparecem
SECTIONS = {
    "feat": "New",
    "fix": "Fixes",
    "perf": "Performance",
    "docs": "Documentation",
}
OTHER = "Other changes"  # refactor, test, ci, build, chore, style e o que não segue o formato
_CONVENTIONAL = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[^)]+)\))?(?P<bang>!)?:\s*(?P<text>.+)$")


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", check=True).stdout


def previous_tag(tag: str) -> str | None:
    """A tag v* anterior a esta (None na primeira)."""
    try:
        return _git("describe", "--tags", "--abbrev=0", "--match", "v*", f"{tag}^").strip() or None
    except subprocess.CalledProcessError:
        return None


def entry(subject: str) -> tuple[str, str]:
    """(seção, linha da lista) de um commit."""
    m = _CONVENTIONAL.match(subject.strip())
    if not m:
        return OTHER, f"- {subject.strip()}"
    scope = f"**{m['scope']}:** " if m["scope"] else ""
    breaking = " (breaking)" if m["bang"] else ""
    return SECTIONS.get(m["type"], OTHER), f"- {scope}{m['text']}{breaking}"


def notes(subjects: list[str], tag: str, previous: str | None) -> str:
    groups: dict[str, list[str]] = {}
    for s in subjects:
        if s.strip():
            section, line = entry(s)
            groups.setdefault(section, []).append(line)
    out: list[str] = []
    for section in [*SECTIONS.values(), OTHER]:
        if groups.get(section):
            out += [f"## {section}", "", *groups[section], ""]
    if not out:
        out = ["No changes since the previous version.", ""]
    out.append(
        "Download `Deck-Setup.exe` below and run it. The app isn't digitally signed yet, so Windows SmartScreen may "
        "warn you: choose **More info › Run anyway**."
    )
    if previous:
        out += ["", f"**Full changelog**: {REPO}/compare/{previous}...{tag}"]
    return "\n".join(out) + "\n"


def main() -> int:
    tag = sys.argv[1]
    prev = previous_tag(tag)
    rng = f"{prev}..{tag}" if prev else tag
    subjects = _git("log", "--no-merges", "--format=%s", rng).splitlines()
    text = notes(subjects, tag, prev)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    else:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
