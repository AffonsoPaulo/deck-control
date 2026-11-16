"""Driver de baixo nível do Fifine AmpliGame D6 (VID 0x3142 / PID 0x0060).

Protocolo "CRT" (mesma família Mirabox/HOTSPOTEK). Referências:
  - github.com/akksmash/omarchy-fifine-deck  (docs/protocol.md)
  - github.com/micah1crandell/fifine-ampligame-d6

Resumo do que importa aqui:
  * Tudo acontece na interface 0 (usage page 0xFFA0). A interface 1 é um teclado genérico.
  * Comando: 00 'CRT' 00 00 <CMD ascii> [args], preenchido com zeros até o tamanho
    do output report (no Windows: 1025 bytes = 1 de report ID + 1024).
  * O D6 NUNCA confirma comandos. Silêncio não significa erro nem sucesso.
  * Uma sessão DIS/LIG/MOD 1/LIG/STP liga o envio de teclas (só 'MOD 1' não\n    basta neste firmware, V3.D6.1.009). Eventos chegam como
        41 43 4B 00 00 4F 4B 00 00 <tecla 1..15> <01 apertou | 00 soltou>
    com teclas em ordem de leitura (1 = canto superior esquerdo).
  * NÃO usar 'CONNECT': ele apaga as imagens das telas.
"""
from __future__ import annotations

import logging
import sys
import time
from dataclasses import dataclass
from typing import Iterator

import hid

log = logging.getLogger("deck.device")      # o mesmo que app.logs.get("device"), sem o d6 depender do app
VENDOR_ID = 0x3142
PRODUCT_ID = 0x0060
VENDOR_USAGE_PAGE = 0xFFA0

COLS, ROWS = 5, 3
KEY_COUNT = COLS * ROWS
LED_COUNT = 18          # anel de LEDs em volta do aparelho

ACK_PREFIX = b"ACK\x00\x00OK\x00\x00"

MODE_KEYS = 1      # envia eventos de tecla
MODE_DISPLAY = 2   # aceita upload de imagens (Fase 2)


@dataclass(frozen=True)
class KeyEvent:
    key: int          # 1..15, ordem de leitura
    pressed: bool
    timestamp: float

    @property
    def row(self) -> int:
        return (self.key - 1) // COLS

    @property
    def col(self) -> int:
        return (self.key - 1) % COLS


class DeviceNotFound(RuntimeError):
    pass


def find_vendor_interface() -> dict:
    """Acha a interface de controle (0 / usage page 0xFFA0) do D6."""
    devs = hid.enumerate(VENDOR_ID, PRODUCT_ID)
    for d in devs:
        if d.get("usage_page") == VENDOR_USAGE_PAGE or d.get("interface_number") == 0:
            return d
    raise DeviceNotFound(
        "Fifine D6 (3142:0060) not found. Is it plugged in? "
        f"Interfaces seen: {len(devs)}"
    )


def crt(cmd: str, *args: int) -> bytes:
    """Monta o payload 'CRT' (sem o byte de report ID)."""
    return b"CRT\x00\x00" + cmd.encode("ascii") + bytes(args)


class D6:
    def __init__(self, path: bytes | None = None):
        self._info = find_vendor_interface() if path is None else {"path": path}
        self._dev: hid.device | None = None
        self._out_size = 1024   # bytes de dados por output report (sem o report ID)
        self._in_size = 512
        self._buf = b""
        # Multiplica as pausas entre comandos de sessão. 1.0 = valores conservadores
        # dos projetos de referência; menor = atualiza ícones mais rápido.
        self.settle = 1.0

    # -- ciclo de vida ------------------------------------------------------

    def open(self) -> "D6":
        path = self._info["path"]
        if sys.platform == "win32":
            from .wincaps import report_sizes
            sizes = report_sizes(path)
            self._out_size = sizes["output"] - 1
            self._in_size = sizes["input"] - 1
        self._dev = hid.device()
        self._dev.open_path(path)
        return self

    def close(self) -> None:
        if self._dev is not None:
            self._dev.close()
            self._dev = None

    def __enter__(self) -> "D6":
        return self.open()

    def __exit__(self, *exc) -> None:
        self.close()

    @property
    def info(self) -> dict:
        return self._info

    # -- escrita ------------------------------------------------------------

    def send(self, payload: bytes) -> None:
        """Envia um output report: 0x00 (report ID) + payload preenchido com zeros."""
        if self._dev is None:
            raise RuntimeError("the device isn't open")
        if len(payload) > self._out_size:
            raise ValueError(f"payload of {len(payload)} bytes > {self._out_size}")
        report = b"\x00" + payload + b"\x00" * (self._out_size - len(payload))
        n = self._dev.write(report)
        if n < 0:
            raise OSError(f"writing to the D6 failed: {self._dev.error()}")

    def set_mode(self, mode: int) -> None:
        self.send(crt("MOD", 0, 0, 0x30 + mode))

    def set_brightness(self, pct: int) -> None:
        self.send(crt("LIG", 0, 0, max(0, min(100, int(pct)))))

    def wake_display(self) -> None:
        self.send(crt("DIS"))

    def enable_keys(self, brightness: int = 100) -> None:
        """Liga o envio de eventos de tecla. Não apaga as telas.

        Só 'MOD 1' NÃO basta neste aparelho (firmware V3.D6.1.009, testado em
        2026-11-14): é preciso abrir uma sessão completa DIS → LIG 0 → MOD 1 →
        LIG n → STP. Sem o CONNECT, que apagaria as telas.
        """
        w = self._wait
        self.wake_display();                     w(0.15)
        self.send(crt("LIG", 0, 0, 0, 0));       w(0.15)
        self.set_mode(MODE_KEYS);                w(0.15)
        self.set_brightness(brightness);         w(0.15)
        self.send(crt("STP"));                   w(0.15)

    def _wait(self, seconds: float) -> None:
        if self.settle > 0:
            time.sleep(seconds * self.settle)

    def firmware_version(self) -> str | None:
        """Ex.: 'V3.D6.1.009' (lido do input report 0)."""
        if self._dev is None:
            raise RuntimeError("the device isn't open")
        try:
            raw = bytes(self._dev.get_input_report(0, self._in_size + 1))
        except Exception:
            log.debug("Couldn't read the firmware version", exc_info=True)
            return None
        text = raw.strip(b"\x00").split(b"\x00")[0].decode("latin1", "ignore")
        return text or None

    # -- telas --------------------------------------------------------------

    @staticmethod
    def screen_for_key(key: int) -> int:
        """Tecla (ordem de leitura) -> índice da tela (linhas invertidas).

        Tecla 1-5 (topo) -> tela 11-15; 6-10 -> 6-10; 11-15 (baixo) -> 1-5.
        """
        row, col = divmod(key - 1, COLS)
        return (ROWS - 1 - row) * COLS + col + 1

    def _session(self, mode: int, brightness: int, clear: bool = False) -> None:
        """Abre uma sessão no modo pedido (DIS, LIG 0, MOD n, LIG n, [CLE], STP)."""
        w = self._wait
        self.wake_display();                     w(0.1)
        self.send(crt("LIG", 0, 0, 0, 0));       w(0.1)
        self.set_mode(mode);                     w(0.2)
        self.set_brightness(brightness);         w(0.2)
        if clear:
            self.send(crt("CLE", 0, 0, 0, 0xFF))
        self.send(crt("STP"));                   w(0.25)

    def _upload(self, screen: int, jpeg: bytes, chunk: int, pace: float) -> None:
        """BAT <tamanho> <tela>, dados em pedaços, STP."""
        n = len(jpeg)
        if n > 0xFFFF:
            raise ValueError("image too large")
        self.send(crt("BAT", 0, 0, (n >> 8) & 0xFF, n & 0xFF, screen))
        for off in range(0, n, chunk):
            self.send(jpeg[off:off + chunk])
            time.sleep(pace)
        self.send(crt("STP"))

    def push(self, key: int, jpeg: bytes) -> None:
        """Troca a imagem de uma tecla sem abrir sessão (só BAT, dados, STP).

        É assim que o app oficial anima GIFs: reenvia cada quadro como JPEG na
        hora certa, com o D6 no modo de teclas (capturado em 2026-11-15). O D6
        não toca GIF sozinho: GIF cru via BAT é ignorado.
        """
        self._upload(self.screen_for_key(key), jpeg, self._out_size, 0)

    def set_leds(self, colors) -> None:
        """Pinta o anel de LEDs: uma cor (r, g, b) por LED, LED_COUNT no total.

        Formato capturado do app oficial em 2026-11-15: 'CRTAd' + quantidade + RGB de cada LED,
        num output report comum (sem sessão). O LED 0 fica embaixo no meio e a ordem segue no
        sentido horário. A cor fica até o próximo envio. Só funciona com o D6 no modo de luz
        por software (dois cliques rápidos no botão de trás); fora dele o D6 ignora.
        """
        data = bytearray(b"CRTAd" + bytes([LED_COUNT]))
        for i in range(LED_COUNT):
            r, g, b = colors[i] if i < len(colors) else (0, 0, 0)
            data += bytes((max(0, min(255, int(r))), max(0, min(255, int(g))), max(0, min(255, int(b)))))
        self.send(bytes(data))

    def draw(self, tiles: dict[int, bytes], brightness: int = 100, chunk: int | None = None,
             pace: float = 0.005, key_delay: float = 0.3, per_key_session: bool = True,
             clear: bool = False) -> None:
        """Envia imagens JPEG, indexadas pela TECLA (1..15).

        Cuidados que vêm dos projetos de referência:
          * Telas em ordem crescente, STP depois de cada imagem.
          * Uma sessão por imagem (per_key_session): o D6 descarta as primeiras
            imagens de um lote grande.
          * O D6 aceita um número limitado de envios até ser religado; quem chama
            deve mandar só o que mudou.
        Ao final volta ao modo de teclas (as imagens continuam na tela).
        """
        chunk = chunk or self._out_size
        order = sorted(tiles, key=self.screen_for_key)
        if not per_key_session:
            self._session(MODE_DISPLAY, brightness, clear=clear)
        for i, key in enumerate(order):
            if per_key_session:
                self._session(MODE_DISPLAY, brightness, clear=clear and i == 0)
            self._upload(self.screen_for_key(key), tiles[key], chunk, pace)
            time.sleep(key_delay)
            if per_key_session:
                self.send(crt("STP"))
        if not per_key_session:
            self.send(crt("STP"))
        self._wait(0.2)
        self.enable_keys(brightness)

    # -- leitura ------------------------------------------------------------

    def read_raw(self, timeout_ms: int = 500) -> bytes:
        if self._dev is None:
            raise RuntimeError("the device isn't open")
        data = self._dev.read(self._out_size + 1, timeout_ms)
        return bytes(data) if data else b""

    def events(self, timeout_ms: int = 500) -> Iterator[KeyEvent]:
        """Lê um report (ou nada, após timeout) e devolve os eventos de tecla nele.

        Procura o prefixo ACK em vez de usar offset fixo, então funciona com ou
        sem o byte de report ID na frente.
        """
        data = self.read_raw(timeout_ms)
        return iter(self.parse(data)) if data else iter(())

    def parse(self, data: bytes) -> list[KeyEvent]:
        """Extrai eventos de tecla de bytes já lidos (tolera reports parciais)."""
        buf = self._buf + data
        out: list[KeyEvent] = []
        i = 0
        while True:
            j = buf.find(ACK_PREFIX, i)
            if j < 0 or j + len(ACK_PREFIX) + 1 >= len(buf):
                break
            key, state = buf[j + 9], buf[j + 10]
            i = j + 11
            if 1 <= key <= KEY_COUNT:
                out.append(KeyEvent(key=key, pressed=state == 1, timestamp=time.time()))
            # key 0 / 0xFF = ACK interno de pacote de imagem; ignorado aqui.
        self._buf = buf[max(i, len(buf) - len(ACK_PREFIX) - 1):]
        return out
