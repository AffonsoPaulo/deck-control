# Development

How to run Deck from source, work on the editor, build the installer, and how the D6 protocol works.

## Running from source

You need Windows and Python 3.12 or newer. In the project folder:

```
pip install -e .
```

```
pythonw -m app --tray    # everyday use: tray icon, no window (log in %LOCALAPPDATA%\D6Deck\logs\app.log)
python -m app            # in the terminal, with the log on screen
python -m app --debug    # logs keys, states and drawing times
python -m app --editor   # opens the editor in the browser right away
python -m app --check    # only validates the config
```

Other options: `--config <path>` (another settings file), `--port N` (editor port, default 8765),
`--autostart on|off` and `--version`. Only one instance runs at a time.

From source, the settings file is the `config.yaml` in the project folder. On first run it's copied from
`config.example.yaml` (Portuguese) or `config.example.en.yaml` (English), following the Windows language. Both
document every action, icon field and option at the top, and they must keep the same fields: a test checks it. The
app reloads `config.yaml` by itself when it changes, and the editor saves it preserving comments (the previous
version stays as `config.yaml.bak`).

The editor opens at `http://deck.localhost:8765/<token>/teclas` (browsers send any `*.localhost` name to this PC;
`127.0.0.1` and `localhost` work too). The token is stored in
`%LOCALAPPDATA%\D6Deck\editor-token`, and the server only accepts connections from this PC.

## Checks

```
pip install -e ".[dev]"    # the app plus pytest, ruff and mypy
python -m pytest           # tests (they don't need the D6 plugged in)
python -m ruff check .     # lint
python -m ruff format .    # formatting
python -m mypy             # types (only the modules listed in pyproject.toml, for now)
```

The GitHub CI (`.github/workflows/ci.yml`) runs all of them on every push, on Windows, together with the editor
checks below.

## The editor

The editor is a React + TypeScript + Tailwind app in `editor/` (Node 22 or newer). The Python app serves the build
(`editor/dist`) at the root, with the token in the path; without the build, the page asks for `npm run build`.

```
cd editor
npm ci
npm run dev           # http://127.0.0.1:5173/<token>/teclas (/api goes to the test server on port 8799)
npm run check         # lint (including the design system rules), types, API contract and tests
npm run build         # builds editor/dist, which the app serves
npm run gen:api       # API types, after changing app/editor/contract.py (run python -m app.editor.contract first)
npm run ref:capture   # screenshots of every screen (editor/reference/), served by tests/reference/serve.py
```

Design tokens live in `app/editor/static/tokens.css`; see [design-system.md](design-system.md) (in Portuguese).

**Translations.** The interface text is written in English inside `t("...")` (editor) and `tr("...")` (Python), and
translated in `app/editor/static/locales/pt-BR.json` and `app/locales/pt-BR.json`. Logs are always in English.

## Executable and installer

`Deck.exe` (PyInstaller, folder mode, no console) and `Deck-Setup.exe` (Inno Setup) are built from `packaging/`:

```
cd editor && npm ci && npm run build && cd ..                 # the editor goes into the package ready
python -m pip install -r packaging/requirements-build.txt     # in a build-only environment (exact versions)
python -m PyInstaller packaging/deck.spec --noconfirm         # dist/Deck/Deck.exe
python packaging/check_exe.py dist/Deck/Deck.exe              # --check, resources and a plugin, without the D6
iscc /DAppVersion=0.9.0 packaging/installer.iss               # packaging/Output/Deck-Setup.exe
```

The version lives only in `app/__init__.py`. Pushing a tag `v<version>` (or a pre-release like `v0.9.0-rc2`) makes
the release workflow (`.github/workflows/release.yml`) do all of the above and attach `Deck-Setup.exe` to a GitHub
release.

In the installed app, the settings, the version history and the `.bak` live in `%APPDATA%\Deck` (Program Files
isn't writable); logs and installed plugins stay in `%LOCALAPPDATA%\D6Deck`. On first run, a `config.yaml` next to
`Deck.exe` is copied there (the original stays where it was). To move a development setup to the installed app, use
Settings › Backup › Export in one editor and Import in the other.

`Deck.exe` isn't digitally signed yet. That's why "start with Windows" is turned on by the installer: when
`Deck.exe` writes the startup registry key itself, Windows Defender quarantines it
(`Behavior:Win32/Persistence.A!ml`). Turning it on from the tray or the settings explains this; turning it off works.
SmartScreen also warns when opening the downloaded installer. Both go away with a signature.

## Device tools

These talk to a real D6, so they're kept out of pytest:

```
python tools/listen.py          # press the D6 keys
python tools/listen.py --raw    # also prints the raw bytes received
python tools/draw_test.py       # a colored number on each key
python tools/calibrate.py       # a pattern to measure the visible area of the screens
```

Close Fifine's "fifine Control Deck" app (including from the tray) before testing.

## Protocol

See the comment at the top of `d6/device.py`. Based on
[akksmash/omarchy-fifine-deck](https://github.com/akksmash/omarchy-fifine-deck) and
[micah1crandell/fifine-ampligame-d6](https://github.com/micah1crandell/fifine-ampligame-d6).

- The D6 is USB `3142:0060`. On Windows the output report has 1025 bytes (1 for the report ID + 1024).
- **Images**: 112×112 JPEG rotated 180°, 4:4:4 color, up to 12 KB (the D6 handles ~16 KB), sent in 1024-byte chunks
  with only BAT + data + STP (no session, so the light doesn't blink). Animated GIFs: the app re-sends each frame at
  the right time.
- **Light**: a ring of 18 LEDs (LED 0 at the bottom center, clockwise), packet `CRTAd` + 18 + the RGB of each LED, no
  session. Effects and key reactions are animated by the app (~30 frames/s); the D6 only accepts them after two quick
  clicks on its back button.

## Project structure

```
d6/                 D6 driver (HID, CRT protocol, images)
app/
  __main__.py       app entry point (command-line options)
  bootstrap.py      builds the shared pieces and loads the plugins
  paths.py          where the bundled resources and the user's data live
  errors.py, i18n.py, logs.py
  engine/           main loop: keys, pages, states, redrawing only what changed (engine.py wires it up)
  config/           config.yaml
    load.py         reading and validation (build_config, load_config)
    model.py        the typed model (Config, KeySpec)
    pages.py        validation of pages:; sections.py the other sections
    yamlio.py       saving YAML while preserving comments
    storage.py      the file on disk, saved with a backup; history.py the saved versions
    transfer.py     export and import; firstrun.py first run of the executable
  actions/          actions (basic.py); a new action = a function with @action("name")
  plugins/          plugins: OBS, Discord and Weather (built in, in builtin/) and third-party ones; see plugins.md
  plugin_runner.py  the process of a third-party Python plugin (--run-plugin)
  editor/           editor server: api/ (one function per route), contract.py (the types), schema.py, static/
  windows/          tray (tray.py), simulated keyboard (keys.py), autostart, single instance, screen and volume (winutil.py)
  icons.py          drawing the key icons (text, Lucide, images); brand.py the logo
  lighting.py       the D6 light: effects and key reactions on the LED ring
  widgets.py, values.py, automations.py, binds.py   widgets, live values, automations and shortcuts
editor/             the visual editor (React + TypeScript + Tailwind); the build goes to editor/dist
tests/              automated tests (pytest)
tools/              tools that talk to a real D6 (outside pytest)
packaging/          executable (PyInstaller) and installer (Inno Setup)
examples/plugins/   example plugin (Pomodoro)
docs/               guide/ (user guide), plugins.md (making plugins), roadmap.md, design-system.md, this file
```
