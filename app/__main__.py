"""Inicia o app.

python -m app                 terminal (log na tela), editor em http://127.0.0.1:8765
python -m app --tray          ícone na bandeja, sem janela (use pythonw para não abrir console)
python -m app --debug         log detalhado de tudo (teclas, estados, desenho, plugins, editor)
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
    ap.add_argument(
        "--debug", action="store_true", help="log detalhado de tudo (teclas, valores, desenho, plugins, editor)"
    )
    ap.add_argument("--check", action="store_true", help="só valida o config e sai")
    ap.add_argument("--tray", action="store_true", help="roda na bandeja do Windows")
    ap.add_argument("--editor", action="store_true", help="abre o editor no navegador ao iniciar")
    ap.add_argument("--port", type=int, default=8765, help="porta do editor (padrão 8765)")
    ap.add_argument("--autostart", choices=["on", "off"], help="liga/desliga iniciar com o Windows")
    args = ap.parse_args()

    from app import logs, winutil

    config = args.config.resolve()
    cli = bool(args.check or args.autostart)  # só responde no terminal e sai: sem arquivo de log
    if cli:
        if sys.stdout is not None:
            sys.stdout.reconfigure(line_buffering=True)
    else:
        # antes do log: uma segunda cópia do app não pode mexer no app.log (rotação) da que já roda
        if not winutil.single_instance():
            msg = tr("The Deck app is already running (see the icon in the tray).")
            if sys.stdout is not None:
                print(msg)
            if args.tray:
                winutil.message_box(msg)
            return 1
        no_console = sys.stdout is None or (args.tray and "pythonw" in Path(sys.executable).name.lower())
        logs.setup(console=not no_console, debug=args.debug)
        logs.startup(config, args.debug)
    log = logs.get("app")

    if args.autostart:
        winutil.set_autostart(args.autostart == "on", config)
        print("Start with Windows:", "on" if args.autostart == "on" else "off")
        return 0

    if not config.exists():
        shutil.copy(ROOT / "config.example.yaml", config)
        msg = f"Created {config} from the example. Edit it as you like (it reloads by itself)."
        if cli:
            print(msg)
        else:
            log.info("%s", msg)

    from app.config import ConfigError, load_config

    try:
        cfg = load_config(config)
    except ConfigError as e:
        if cli:
            print(e)
        else:
            log.error("The config has problems; not starting: %s", e)
        if args.tray:
            winutil.message_box(tr("Error in config.yaml:") + f"\n\n{e}", tr("Deck — config error"))
        return 1
    if args.check:
        n = sum(len(k) for k in cfg.pages.values())
        print(f"Config OK: {len(cfg.pages)} pages, {n} keys, states: {sorted(cfg.all_states())}")
        return 0

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

    if sys.__stdout__ is not None:
        # o endereço completo (com o token) só na tela: no log ele sai como ****
        sys.__stdout__.write(f"Editor: {editor.url}\nCtrl+C to quit.\n")
        sys.__stdout__.flush()
    try:
        engine.run()
    except KeyboardInterrupt:
        engine.stop()
    finally:
        editor.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
