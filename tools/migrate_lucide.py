"""Troca os ícones Segoe ('glyph: E720') do config pelos equivalentes do Lucide ('lucide: mic').

Mexe só nessas linhas, então comentários e formatação do arquivo ficam iguais.
Ícones sem equivalente ficam como estão (o app continua desenhando o Segoe).

    python tools/migrate_lucide.py config.yaml
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.icons import SEGOE_TO_LUCIDE  # noqa: E402


def migrate(text: str) -> tuple[str, int, list[str]]:
    left = []

    def sub(m):
        code = m.group(1).upper()
        name = SEGOE_TO_LUCIDE.get(code)
        if not name:
            left.append(code)
            return m.group(0)
        return f"lucide: {name}"

    out, n = re.subn(r'\bglyph:\s*["\']?([0-9A-Fa-f]{4,5})["\']?', sub, text)
    return out, n - len(left), left


if __name__ == "__main__":
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "config.yaml")
    text = path.read_text(encoding="utf-8")
    new, n, left = migrate(text)
    if new != text:
        path.write_text(new, encoding="utf-8")
    print(f"{n} ícones trocados" + (f"; sem equivalente: {', '.join(sorted(set(left)))}" if left else ""))
