"""Utilidades do Windows: instância única, iniciar com o Windows, tela e volume."""

from __future__ import annotations

import ctypes
import sys
import winreg
from pathlib import Path

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "D6Deck"
ERROR_ALREADY_EXISTS = 183

_mutex = None


def single_instance(name: str = "Local\\D6Deck-single-instance") -> bool:
    """True se esta é a única instância do app rodando."""
    global _mutex
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = ctypes.c_void_p
    _mutex = k32.CreateMutexW(None, False, name)
    return ctypes.get_last_error() != ERROR_ALREADY_EXISTS


def data_dir() -> Path:
    from app import paths

    return paths.data_dir()


def log_path() -> Path:
    """O arquivo de log atual (app/logs.py cuida da rotação e da pasta logs/)."""
    from app import logs

    return logs.log_file()


def _pythonw() -> str:
    exe = Path(sys.executable)
    w = exe.with_name("pythonw.exe")
    return str(w if w.exists() else exe)


def autostart_command(config: Path, *, frozen: bool | None = None, executable: str | None = None) -> str:
    """O que o Windows roda ao entrar. Em desenvolvimento, o pythonw com o __main__.py e o config; no executável,
    o Deck.exe na bandeja (o --config só quando não é o padrão, em %APPDATA%\\Deck). O instalador liga pelo
    `Deck.exe --autostart on`, para o texto ser sempre este."""
    from app import paths

    frozen = paths.FROZEN if frozen is None else frozen
    config = Path(config).resolve()
    if frozen:
        cmd = f'"{sys.executable if executable is None else executable}" --tray'
        return cmd if config == paths.default_config(frozen=True).resolve() else f'{cmd} --config "{config}"'
    main = paths.MAIN_SCRIPT
    return f'"{_pythonw()}" "{main}" --tray --config "{config}"'


def autostart_enabled() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, RUN_NAME)
            return True
    except OSError:
        return False


MSG = (
    "To start the Deck with Windows, run the installer again and check that option. (Windows Defender blocks a "
    "program that isn't digitally signed from turning this on by itself.)"
)


class AutostartBlocked(RuntimeError):
    """Ligar o "iniciar com o Windows" de dentro do executável: não (ver set_autostart)."""


def set_autostart(enabled: bool, config: Path, *, frozen: bool | None = None) -> None:
    """Liga ou desliga o "iniciar com o Windows" (a chave Run do usuário).

    No executável, LIGAR fica com o instalador: quando o próprio Deck.exe (sem assinatura digital) grava a chave
    Run, o Windows Defender o põe em quarentena (Behavior:Win32/Persistence.A!ml, visto no teste da Fase 7); gravada
    pelo instalador, não. Desligar continua daqui. Em desenvolvimento quem grava é o pythonw (assinado): sem mudança.
    Quando o Deck.exe for assinado, isto pode sair."""
    from app import paths
    from app.i18n import tr

    if enabled and (paths.FROZEN if frozen is None else frozen):
        raise AutostartBlocked(tr(MSG))
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, RUN_NAME, 0, winreg.REG_SZ, autostart_command(config))
        else:
            try:
                winreg.DeleteValue(k, RUN_NAME)
            except FileNotFoundError:
                pass


def reset_dll_directory() -> None:
    """Executável: tira a pasta _internal da busca de DLLs do processo.

    O PyInstaller aponta o SetDllDirectory para a _internal ao abrir, e todo programa que o app abre (ações de
    abrir programa e de comando, plugins "exe", o navegador) herda isso: poderia carregar o python312.dll, o
    libssl ou o VCRUNTIME do Deck no lugar dos dele. As DLLs do próprio app não dependem disso (o Python carrega
    os .pyd e as DLLs ao lado deles sem o SetDllDirectory). Conferido no build: tudo importa e desenha depois.

    Texto vazio, não None: o None volta a busca padrão, que inclui a pasta atual (uma DLL plantada na pasta de
    onde o programa foi aberto seria carregada); o "" tira a _internal e mantém a pasta atual de fora.
    """
    ctypes.windll.kernel32.SetDllDirectoryW("")


def message_box(text: str, title: str = "Deck") -> None:
    ctypes.windll.user32.MessageBoxW(None, text, title, 0x40)


# -- "apagar a luz com a tela do PC" -------------------------------------------------


def _idle_seconds() -> float:
    import ctypes

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

    info = LASTINPUTINFO(ctypes.sizeof(LASTINPUTINFO), 0)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    return ((ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000


def _display_timeout_seconds() -> int:
    """'Desligar a tela após' do plano de energia ativo (na tomada ou na bateria). 0 = nunca."""
    import ctypes
    import uuid
    from ctypes import wintypes

    class GUID(ctypes.Structure):
        _fields_ = [
            ("d1", ctypes.c_ulong),
            ("d2", ctypes.c_ushort),
            ("d3", ctypes.c_ushort),
            ("d4", ctypes.c_ubyte * 8),
        ]

    def guid(s):
        u = uuid.UUID(s)
        return GUID(u.time_low, u.time_mid, u.time_hi_version, (ctypes.c_ubyte * 8)(*u.bytes[8:]))

    class SPS(ctypes.Structure):
        _fields_ = [
            ("ACLineStatus", ctypes.c_byte),
            ("BatteryFlag", ctypes.c_byte),
            ("BatteryLifePercent", ctypes.c_byte),
            ("SystemStatusFlag", ctypes.c_byte),
            ("BatteryLifeTime", ctypes.c_ulong),
            ("BatteryFullLifeTime", ctypes.c_ulong),
        ]

    powrprof = ctypes.windll.powrprof
    scheme = ctypes.POINTER(GUID)()
    if powrprof.PowerGetActiveScheme(None, ctypes.byref(scheme)) != 0:
        return 0
    try:
        sub = guid("7516b95f-f776-4464-8c53-06167f40cc99")  # vídeo
        setting = guid("3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e")  # desligar a tela após
        sps = SPS()
        on_ac = not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(sps)) or sps.ACLineStatus != 0
        value = wintypes.DWORD()
        read = powrprof.PowerReadACValueIndex if on_ac else powrprof.PowerReadDCValueIndex
        if read(None, scheme, ctypes.byref(sub), ctypes.byref(setting), ctypes.byref(value)) != 0:
            return 0
        return int(value.value)
    finally:
        ctypes.windll.kernel32.LocalFree(scheme)


def _locked() -> bool:
    import ctypes

    user32 = ctypes.windll.user32
    user32.OpenInputDesktop.restype = ctypes.c_void_p
    h = user32.OpenInputDesktop(0, False, 0x0100)  # DESKTOP_SWITCHDESKTOP
    if not h:
        return True
    try:
        return not user32.SwitchDesktop(ctypes.c_void_p(h))
    finally:
        user32.CloseDesktop(ctypes.c_void_p(h))


_timeout_cache = [0.0, 0]


def screen_off() -> bool:
    """True se o Windows está bloqueado ou se a tela já desligou por falta de uso."""
    try:
        if _locked():
            return True
        import time

        if time.monotonic() - _timeout_cache[0] > 60:  # o plano de energia quase nunca muda
            _timeout_cache[:] = [time.monotonic(), _display_timeout_seconds()]
        timeout = _timeout_cache[1]
        return bool(timeout) and _idle_seconds() >= timeout
    except Exception:  # perguntado a cada 2 s pela luz; se a API falhar, a luz só não apaga (sem log)
        return False


# -- volume do Windows (COM "na mão" via ctypes, sem pycaw/comtypes) -----------------

_CLSID_MMDeviceEnumerator = "{BCDE0395-E52F-467C-8E3D-C4579291692E}"
_IID_IMMDeviceEnumerator = "{A95664D2-9614-4F35-A746-DE8DB63617E6}"
_IID_IAudioEndpointVolume = "{5CDF2C82-841E-4546-9722-0CF74078229A}"
_CLSCTX_ALL = 0x17
_COINIT_MULTITHREADED = 0x0
_RPC_E_CHANGED_MODE = -2147417850  # 0x80010106: a thread já tem COM em outro modo; serve
_com_tls = None  # threading.local(): COM iniciado + enumerador desta thread


def _guid(s: str):
    import uuid

    class GUID(ctypes.Structure):
        _fields_ = [
            ("d1", ctypes.c_ulong),
            ("d2", ctypes.c_ushort),
            ("d3", ctypes.c_ushort),
            ("d4", ctypes.c_ubyte * 8),
        ]

    u = uuid.UUID(s)
    return GUID(u.time_low, u.time_mid, u.time_hi_version, (ctypes.c_ubyte * 8)(*u.bytes[8:]))


def _vcall(obj: int, index: int, *args, argtypes=()):
    """Chama o método `index` da vtable da interface COM `obj`. Devolve o HRESULT."""
    vtbl = ctypes.cast(obj, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)))[0]
    fn = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *argtypes)(vtbl[index])
    return fn(obj, *args)


def _release(obj: int | None) -> None:
    if obj:
        _vcall(obj, 2)  # IUnknown::Release


def _device_enumerator() -> int | None:
    """IMMDeviceEnumerator desta thread (inicia o COM e cria o enumerador só na primeira vez)."""
    global _com_tls
    import threading

    if _com_tls is None:
        _com_tls = threading.local()
    tls = _com_tls
    if not getattr(tls, "com", False):
        ole32 = ctypes.windll.ole32
        ole32.CoInitializeEx.restype = ctypes.c_long
        hr = ole32.CoInitializeEx(None, _COINIT_MULTITHREADED)
        if hr < 0 and hr != _RPC_E_CHANGED_MODE:  # S_OK e S_FALSE são >= 0
            return None
        tls.com = True  # nunca chamamos CoUninitialize: vale pela vida da thread
    if not getattr(tls, "enumerator", None):
        ole32 = ctypes.windll.ole32
        ole32.CoCreateInstance.restype = ctypes.c_long
        ole32.CoCreateInstance.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.c_void_p,
            ctypes.c_void_p,
        ]
        ptr = ctypes.c_void_p()
        clsid, iid = _guid(_CLSID_MMDeviceEnumerator), _guid(_IID_IMMDeviceEnumerator)
        if (
            ole32.CoCreateInstance(ctypes.byref(clsid), None, _CLSCTX_ALL, ctypes.byref(iid), ctypes.byref(ptr)) < 0
            or not ptr.value
        ):
            return None
        tls.enumerator = ptr.value
    return tls.enumerator


def master_volume() -> tuple[int, bool] | None:
    """Volume do Windows (0–100) e se está mudo, do dispositivo de saída padrão. None se não der para ler."""
    device = endpoint = None
    try:
        enum = _device_enumerator()
        if not enum:
            return None
        vp = ctypes.c_void_p
        p = vp()
        # IMMDeviceEnumerator::GetDefaultAudioEndpoint(eRender, eConsole, &device) — índice 4
        if _vcall(enum, 4, 0, 0, ctypes.byref(p), argtypes=(ctypes.c_int, ctypes.c_int, vp)) < 0 or not p.value:
            _release(enum)  # pode ter estragado (ex.: serviço de áudio reiniciou): recria na próxima
            _com_tls.enumerator = None
            return None  # sem dispositivo de saída também cai aqui
        device = p.value
        # IMMDevice::Activate(IID_IAudioEndpointVolume, CLSCTX_ALL, NULL, &endpoint) — índice 3
        iid, p = _guid(_IID_IAudioEndpointVolume), vp()
        if (
            _vcall(
                device, 3, ctypes.byref(iid), _CLSCTX_ALL, None, ctypes.byref(p), argtypes=(vp, ctypes.c_ulong, vp, vp)
            )
            < 0
            or not p.value
        ):
            return None
        endpoint = p.value
        level, muted = ctypes.c_float(), ctypes.c_int()
        if _vcall(endpoint, 9, ctypes.byref(level), argtypes=(vp,)) < 0:  # GetMasterVolumeLevelScalar
            return None
        if _vcall(endpoint, 15, ctypes.byref(muted), argtypes=(vp,)) < 0:  # GetMute
            return None
        return max(0, min(100, round(level.value * 100))), bool(muted.value)
    except Exception:  # lido a cada segundo para as teclas; sem áudio = sem valor (sem log)
        return None
    finally:
        try:
            _release(endpoint)
            _release(device)
        except Exception:  # liberar uma interface COM que já caiu: nada a fazer
            pass
