# PyInstaller: o Deck.exe em modo pasta, sem console (Fase 7 do plano).
#
#   cd editor && npm ci && npm run build     (o editor entra pronto, do editor/dist)
#   python -m pip install -r packaging/requirements-build.txt
#   python -m PyInstaller packaging/deck.spec --noconfirm
#
# Sai em dist/Deck/ (Deck.exe e a pasta _internal). Modo pasta e não arquivo único: abre mais rápido e o antivírus
# implica menos. Sem console: o app roda na bandeja (app/__main__.py).
#
# O que vai junto, além do código (o app inteiro e o d6):
# - os recursos que o app lê enquanto roda, um por um (app/paths.py: RESOURCES), nunca uma pasta do projeto
#   inteira: um build feito de uma cópia com o config.yaml de alguém não pode levar o arquivo (tem a senha do OBS);
# - os plugins embutidos como arquivos (o PluginManager carrega pelo caminho, não pelo import), e as bibliotecas
#   que eles usam (obsws_python) como import escondido;
# - a biblioteca padrão do Python inteira (menos interface gráfica, testes e afins): os plugins de terceiros em
#   Python (runtime "deck-python") rodam com o Python do Deck.exe e podem importar qualquer módulo dela.
#
# A versão sai de app/__init__.py (__version__): o Deck.exe leva nas propriedades do arquivo.

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.win32 import versioninfo as vi

ROOT = Path(SPECPATH).resolve().parent  # noqa: F821 (o PyInstaller define SPECPATH)
sys.path.insert(0, str(ROOT))

from app import __version__, brand, paths  # noqa: E402

if not (paths.EDITOR_DIST / "index.html").is_file():
    raise SystemExit("editor/dist is missing: run `npm ci && npm run build` in editor first")


# ---------------------------------------------------------------------------- arquivos


def _rel(p: Path) -> str:
    return str(p.parent.relative_to(ROOT))  # a pasta de destino dentro do _internal (igual à do projeto)


def _tree(folder: Path, skip: tuple[str, ...] = (".pyc", ".pyo")) -> list[tuple[str, str]]:
    return [
        (str(f), _rel(f))
        for f in sorted(folder.rglob("*"))
        if f.is_file() and "__pycache__" not in f.parts and f.suffix not in skip
    ]


datas = [
    *_tree(paths.EDITOR_DIST, skip=(".map",)),  # sem os source maps
    *_tree(paths.BUILTIN_PLUGINS),
    *[(str(f), _rel(f)) for f in sorted(paths.LOCALES.glob("*.json"))],
    (str(paths.STATIC / "lucide-index.json"), _rel(paths.STATIC / "lucide-index.json")),
    (str(paths.STATIC / "fonts" / "lucide.ttf"), _rel(paths.STATIC / "fonts" / "lucide.ttf")),
    (str(paths.STATIC / "fonts" / "lucide-LICENSE.txt"), _rel(paths.STATIC / "fonts" / "lucide-LICENSE.txt")),
    (str(paths.EXAMPLE_CONFIG), "."),
    (str(paths.EXAMPLE_CONFIG_EN), "."),
]
for name, p in paths.RESOURCES.items():  # o que o app lê tem de estar na lista (o --check do exe confere de novo)
    if not any(Path(src) == p for src, _ in datas):
        raise SystemExit(f"packaging/deck.spec doesn't bundle the resource {name}: {p}")


# ---------------------------------------------------------------------------- imports

# a biblioteca padrão para os plugins deck-python; fora: interface gráfica (tkinter e o que depende dele), testes,
# instaladores e módulos que fazem algo ao serem importados
NOT_FOR_PLUGINS = {
    "tkinter", "turtle", "turtledemo", "idlelib", "test", "lib2to3", "ensurepip", "venv", "pydoc_data",
    "distutils", "msilib", "curses", "antigravity", "this", "__hello__", "__phello__", "_testcapi", "_testinternalcapi",
    "_testbuffer", "_testimportmultiple", "_testmultiphase", "_testsinglephase", "_testclinic", "_ctypes_test",
    "_xxinterpchannels", "_xxsubinterpreters", "xxsubtype", "_tkinter",
}  # fmt: skip


def _stdlib() -> list[str]:
    import importlib.util

    out: list[str] = []
    for name in sorted(sys.stdlib_module_names - NOT_FOR_PLUGINS):
        try:
            spec = importlib.util.find_spec(name)
        except (ImportError, ValueError):
            continue
        if spec is None:
            continue  # só existe em outro sistema (posix, fcntl...)
        if spec.submodule_search_locations:  # pacote: os submódulos também (email.mime, urllib.request...)
            out += collect_submodules(
                name, filter=lambda m: not any(p in NOT_FOR_PLUGINS for p in m.split(".")), on_error="ignore"
            )
        else:
            out.append(name)
    return out


hiddenimports = [
    *collect_submodules("app"),  # alguns módulos do app só são importados pelos plugins embutidos ou na hora
    *collect_submodules("d6"),
    *collect_submodules("obsws_python"),  # plugin embutido do OBS
    "pystray._win32",  # o pystray escolhe a parte do Windows na hora
    *_stdlib(),
]


# ---------------------------------------------------------------------------- ícone e versão

BUILD = Path(workpath)  # noqa: F821 (pasta de trabalho do PyInstaller)
BUILD.mkdir(parents=True, exist_ok=True)
ICON = BUILD / "deck.ico"
ICON.write_bytes(brand.ico(True))  # a mesma marca da bandeja e do favicon

_nums = tuple(int(x) for x in __version__.split(".")[:3]) + (0,)
_info = [
    vi.StringStruct("CompanyName", "Deck"),
    vi.StringStruct("FileDescription", "Deck (Fifine AmpliGame D6)"),
    vi.StringStruct("FileVersion", __version__),
    vi.StringStruct("InternalName", "Deck"),
    vi.StringStruct("OriginalFilename", "Deck.exe"),
    vi.StringStruct("ProductName", "Deck"),
    vi.StringStruct("ProductVersion", __version__),
]
VERSION = vi.VSVersionInfo(
    ffi=vi.FixedFileInfo(filevers=_nums, prodvers=_nums),
    kids=[
        vi.StringFileInfo([vi.StringTable("040904B0", _info)]),
        vi.VarFileInfo([vi.VarStruct("Translation", [0x0409, 1200])]),
    ],
)


# ---------------------------------------------------------------------------- o executável

a = Analysis(  # noqa: F821
    [str(ROOT / "app" / "__main__.py")],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=hiddenimports,
    # tkinter: interface gráfica que o app não usa (e o Tcl/Tk pesa); setuptools: entraria com um gancho que
    # carrega ele (e mais 100 módulos) em todo processo, inclusive no de cada plugin
    excludes=[
        "tkinter", "_tkinter", "PIL.ImageTk", "PIL._tkinter_finder", "test", "idlelib", "turtle",
        "setuptools", "pkg_resources", "_distutils_hack", "distutils",
    ],  # fmt: skip
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Deck",
    console=False,  # sem janela de console; os plugins conversam pelos pipes (conferido no build)
    icon=str(ICON),
    version=VERSION,
    upx=False,  # o UPX faz o antivírus implicar mais
)
coll = COLLECT(exe, a.binaries, a.datas, name="Deck", upx=False)  # noqa: F821
