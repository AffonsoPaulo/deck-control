"""Servidor do editor ATUAL para os prints de referência (porta 8797).

Usa uma cópia do config fixo desta pasta (config.reference.yaml) numa pasta temporária, com a pasta de dados também temporária (nada do
app de verdade é lido ou gravado; tudo fica em reference/.work), e o relógio dos valores parado em 14:32 de 17/11/2026, para as prévias saírem
iguais toda vez. O endereço (com o token) vai para reference/.url, que o capture.spec.ts lê.
"""

from __future__ import annotations

import os
import shutil
import sys
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE.parents[1] / "reference"
PORT = 8797
FIXED = time.mktime((2026, 11, 17, 14, 32, 0, 0, 0, -1))

# pasta fixa (e não um nome aleatório): a tela Sobre e a aba Logs mostram o caminho dela
work = OUT / ".work"
shutil.rmtree(work, ignore_errors=True)
work.mkdir(parents=True)
os.environ["LOCALAPPDATA"] = str(work / "data")
sys.path.insert(0, str(ROOT))

from app import logs, values  # noqa: E402
from app.bootstrap import services  # noqa: E402
from app.editor.server import EditorServer  # noqa: E402

# relógio parado só para os valores (clock.*, date.*); o resto do app segue o tempo real
_clock = {n: getattr(time, n) for n in dir(time) if not n.startswith("_")}
_clock.update(localtime=lambda *a: time.localtime(FIXED), time=lambda: FIXED)
values.time = types.SimpleNamespace(**_clock)  # type: ignore[assignment]
logs._started = FIXED  # a aba Logs mostra "gravando desde" com a hora de início

cfg = work / "config.yaml"
shutil.copy(HERE / "config.reference.yaml", cfg)  # nome próprio: config.yaml é ignorado pelo git
svc = services()
srv = EditorServer(cfg, None, port=PORT, plugins=svc.plugins, values=svc.values)
if srv.port != PORT:
    raise SystemExit(f"a porta {PORT} está ocupada")
srv.start()
OUT.mkdir(exist_ok=True)
(OUT / ".url").write_text(srv.url, encoding="utf-8")
print(srv.url.split("#")[0], flush=True)
try:
    while True:
        time.sleep(3600)
finally:
    shutil.rmtree(work, ignore_errors=True)
