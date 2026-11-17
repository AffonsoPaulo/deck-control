"""Inicia o app.

python -m app                 terminal (log na tela), editor em http://127.0.0.1:8765
python -m app --tray          ícone na bandeja, sem janela (use pythonw para não abrir console)
python -m app --debug         log detalhado de tudo (teclas, estados, desenho, plugins, editor)
python -m app --check         só valida o config
python -m app --autostart on|off   liga/desliga iniciar com o Windows (modo bandeja)
python app/__main__.py --run-plugin <pasta>   vira o processo de um plugin deck-python (quem usa é o próprio app)

No executável (Deck.exe, packaging/deck.spec) as opções são as mesmas. Ele não tem console: sem --check,
--autostart ou --version, roda sempre na bandeja (senão ficaria invisível e sem como sair), e o que essas três
escrevem só aparece com a saída redirecionada (`Deck.exe --check | more`). O config fica em %APPDATA%\\Deck
(app/paths.py); na primeira abertura, o config.yaml da pasta do Deck.exe é copiado para lá (app/firstrun.py).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_ADDED_TO_PATH: list[str] = []  # o que este arquivo pôs no sys.path (o --run-plugin tira antes de rodar o plugin)
# Rodando como script (autostart), a pasta app/ vira sys.path[0] e módulos como
# app/config.py poderiam ser importados como "config"; tira ela do caminho.
if sys.path and Path(sys.path[0] or ".").resolve() == Path(__file__).resolve().parent:
    sys.path.pop(0)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
    _ADDED_TO_PATH.append(str(ROOT))


def main() -> int:
    if "--run-plugin" in sys.argv[1:]:
        # antes de tudo: este processo é um plugin, não o app (sem log, sem "já está rodando", sem plugins). Fica
        # fora do argparse de propósito: lá, "--run-plugin=x" ou "--run-p x" passariam e abririam o app de verdade.
        # E os imports do app vêm depois daqui: o que fica carregado no processo do plugin é o mínimo.
        from app.plugin_runner import main as run_plugin

        return run_plugin(sys.argv[1:], _ADDED_TO_PATH)

    import argparse
    import webbrowser

    from app.i18n import tr

    ap = argparse.ArgumentParser(prog="python -m app")
    from app import __version__, paths

    ap.add_argument("--config", type=Path, default=paths.default_config())
    ap.add_argument(
        "--debug", action="store_true", help="log detalhado de tudo (teclas, valores, desenho, plugins, editor)"
    )
    ap.add_argument("--check", action="store_true", help="só valida o config e sai")
    ap.add_argument("--tray", action="store_true", help="roda na bandeja do Windows")
    ap.add_argument("--editor", action="store_true", help="abre o editor no navegador ao iniciar")
    ap.add_argument("--port", type=int, default=8765, help="porta do editor (padrão 8765)")
    ap.add_argument("--autostart", choices=["on", "off"], help="liga/desliga iniciar com o Windows")
    ap.add_argument("--version", action="version", version=f"Deck {__version__}")
    args = ap.parse_args()

    from app import logs, winutil

    if paths.FROZEN:
        winutil.reset_dll_directory()  # antes de tudo: o que o app abrir não herda a pasta _internal
    config = args.config.resolve()
    cli = bool(args.check or args.autostart)  # só responde no terminal e sai: sem arquivo de log
    if paths.FROZEN and not cli and sys.stdout is None:
        args.tray = True  # executável sem console: sem a bandeja, o app ficaria invisível e sem como sair
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
        if args.autostart == "on":
            _copy_old_config(config, cli, log)  # o instalador liga o "iniciar com o Windows" antes da 1ª abertura
        winutil.set_autostart(args.autostart == "on", config)
        print("Start with Windows:", "on" if args.autostart == "on" else "off")
        return 0

    if args.check and paths.FROZEN and (missing := paths.missing_resources()):
        print("Missing from the package:", *missing, sep="\n  ")
        return 1

    from app.storage import ConfigRepository

    _copy_old_config(config, cli, log)
    store = ConfigRepository(config)
    if store.create_from(paths.EXAMPLE_CONFIG):
        msg = f"Created {config} from the example. Edit it as you like (it reloads by itself)."
        if cli:
            print(msg)
        else:
            log.info("%s", msg)

    from app.bootstrap import services
    from app.config import ConfigError

    svc = services()  # carrega os plugins: as ações deles precisam existir para validar o config
    try:
        cfg = store.load()
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
        if paths.FROZEN:  # a CI de versão confere o pacote por aqui
            print(f"Package OK: Deck {__version__}, plugins: {sorted(svc.plugins.plugins)}")
        return 0

    from app.editor.server import EditorServer
    from app.engine import Engine

    engine = Engine(config, debug=args.debug, plugins=svc.plugins, values=svc.values)
    editor = EditorServer(config, engine, port=args.port, plugins=svc.plugins, values=svc.values)
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


def _copy_old_config(config: Path, cli: bool, log) -> None:
    """Primeira abertura do executável: copia o config.yaml antigo para %APPDATA%\\Deck e avisa (app/firstrun.py).
    Em desenvolvimento não faz nada."""
    from app import firstrun, winutil
    from app.i18n import tr

    try:
        copied = firstrun.copy_old_config(config)
    except OSError as e:
        log.error("Couldn't copy the old config to %s; starting with the example: %s", config, e)
        return
    if copied is None:
        return
    log.warning(
        "First start: copied the old config %s to %s (%d images, history: %s); the old file stays where it was",
        copied.old,
        copied.new,
        copied.images,
        "yes" if copied.history else "no",
    )
    msg = tr(
        "Your settings were copied from {old} to {new}. The old file stays where it was; from now on the Deck "
        "uses the new one.",
        old=copied.old,
        new=copied.new,
    )
    if sys.stdout is not None:
        print(msg)
    elif cli:
        winutil.message_box(msg)  # o instalador espera: é uma vez só
    else:
        import threading

        threading.Thread(target=winutil.message_box, args=(msg,), daemon=True, name="first-run").start()


if __name__ == "__main__":
    raise SystemExit(main())
