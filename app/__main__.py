"""Inicia o app.

    python -m app                 terminal (log na tela), editor em http://127.0.0.1:8765
    python -m app --tray          ícone na bandeja, sem janela (use pythonw para não abrir console)
    python -m app --debug         mostra teclas, estados e tempos de desenho
    python -m app --check         só valida o config
    python -m app --autostart on|off   liga/desliga iniciar com o Windows (modo bandeja)
"""
from __future__ import annotations

import argparse
import shutil
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Rodando como script (autostart), a pasta app/ vira sys.path[0] e módulos como
# app/config.py poderiam ser importados como "config"; tira ela do caminho.
if sys.path and Path(sys.path[0] or ".").resolve() == Path(__file__).resolve().parent:
    sys.path.pop(0)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    from app.i18n import tr
    ap = argparse.ArgumentParser(prog="python -m app")
    ap.add_argument("--config", type=Path, default=ROOT / "config.yaml")
    ap.add_argument("--debug", action="store_true", help="mostra teclas, estados e tempos de desenho")
    ap.add_argument("--check", action="store_true", help="só valida o config e sai")
    ap.add_argument("--tray", action="store_true", help="roda na bandeja do Windows")
    ap.add_argument("--editor", action="store_true", help="abre o editor no navegador ao iniciar")
    ap.add_argument("--port", type=int, default=8765, help="porta do editor (padrão 8765)")
    ap.add_argument("--autostart", choices=["on", "off"], help="liga/desliga iniciar com o Windows")
    args = ap.parse_args()

    from app import winutil

    if args.tray and (sys.stdout is None or "pythonw" in Path(sys.executable).name.lower()):
        winutil.redirect_output_to_log()
    else:
        sys.stdout.reconfigure(line_buffering=True)

    config = args.config.resolve()
    if args.autostart:
        winutil.set_autostart(args.autostart == "on", config)
        print("Iniciar com o Windows:", "ligado" if args.autostart == "on" else "desligado")
        return 0

    if not config.exists():
        shutil.copy(ROOT / "config.example.yaml", config)
        print(f"Criei {config} a partir do exemplo. Edite à vontade (recarrega sozinho).")

    from app.config import ConfigError, load_config
    try:
        cfg = load_config(config)
    except ConfigError as e:
        print(e)
        if args.tray:
            winutil.message_box(tr("Error in config.yaml:") + f"\n\n{e}", tr("Deck — config error"))
        return 1
    if args.check:
        n = sum(len(k) for k in cfg.pages.values())
        print(f"Config OK: {len(cfg.pages)} páginas, {n} teclas, estados: {sorted(cfg.all_states())}")
        return 0

    if not winutil.single_instance():
        msg = tr("The Deck app is already running (see the icon in the tray).")
        print(msg)
        if args.tray:
            winutil.message_box(msg)
        return 1

    from app.editor.server import EditorServer
    from app.engine import Engine

    engine = Engine(config, debug=args.debug)
    editor = EditorServer(config, engine, port=args.port)
    editor.start()
    if args.editor:
        webbrowser.open(editor.url)

    if args.tray:
        from app.tray import run_tray
        run_tray(engine, editor, config)
        return 0

    print("Ctrl+C para sair.")
    try:
        engine.run()
    except KeyboardInterrupt:
        engine.stop()
    finally:
        editor.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
