"""Lê os tamanhos de report HID (input/output/feature) direto da API do Windows."""

from __future__ import annotations

import ctypes
from ctypes import wintypes

_hid = ctypes.WinDLL("hid")
_k32 = ctypes.WinDLL("kernel32", use_last_error=True)


class _HIDP_CAPS(ctypes.Structure):
    _fields_ = [
        ("Usage", ctypes.c_ushort),
        ("UsagePage", ctypes.c_ushort),
        ("InputReportByteLength", ctypes.c_ushort),
        ("OutputReportByteLength", ctypes.c_ushort),
        ("FeatureReportByteLength", ctypes.c_ushort),
        ("Reserved", ctypes.c_ushort * 17),
        ("NumberLinkCollectionNodes", ctypes.c_ushort),
        ("NumberInputButtonCaps", ctypes.c_ushort),
        ("NumberInputValueCaps", ctypes.c_ushort),
        ("NumberInputDataIndices", ctypes.c_ushort),
        ("NumberOutputButtonCaps", ctypes.c_ushort),
        ("NumberOutputValueCaps", ctypes.c_ushort),
        ("NumberOutputDataIndices", ctypes.c_ushort),
        ("NumberFeatureButtonCaps", ctypes.c_ushort),
        ("NumberFeatureValueCaps", ctypes.c_ushort),
        ("NumberFeatureDataIndices", ctypes.c_ushort),
    ]


_k32.CreateFileW.restype = wintypes.HANDLE
_k32.CreateFileW.argtypes = [
    wintypes.LPCWSTR,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.LPVOID,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.HANDLE,
]
_k32.CloseHandle.argtypes = [wintypes.HANDLE]
_hid.HidD_GetPreparsedData.argtypes = [wintypes.HANDLE, ctypes.POINTER(ctypes.c_void_p)]
_hid.HidD_FreePreparsedData.argtypes = [ctypes.c_void_p]
_hid.HidP_GetCaps.argtypes = [ctypes.c_void_p, ctypes.POINTER(_HIDP_CAPS)]

FILE_SHARE_READ_WRITE = 0x3
OPEN_EXISTING = 3
INVALID_HANDLE = wintypes.HANDLE(-1).value


def report_sizes(path: str | bytes) -> dict[str, int]:
    """Tamanhos em bytes, já incluindo o byte de report ID (padrão do Windows)."""
    if isinstance(path, bytes):
        path = path.decode()
    # Acesso 0 = só consulta; não interfere com quem já tem o dispositivo aberto.
    h = _k32.CreateFileW(path, 0, FILE_SHARE_READ_WRITE, None, OPEN_EXISTING, 0, None)
    if h in (None, INVALID_HANDLE):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        pp = ctypes.c_void_p()
        if not _hid.HidD_GetPreparsedData(h, ctypes.byref(pp)):
            raise OSError("HidD_GetPreparsedData falhou")
        try:
            caps = _HIDP_CAPS()
            _hid.HidP_GetCaps(pp, ctypes.byref(caps))
        finally:
            _hid.HidD_FreePreparsedData(pp)
    finally:
        _k32.CloseHandle(h)
    return {
        "usage_page": caps.UsagePage,
        "usage": caps.Usage,
        "input": caps.InputReportByteLength,
        "output": caps.OutputReportByteLength,
        "feature": caps.FeatureReportByteLength,
    }
