"""O contrato da API do editor: o formato de cada pedido e de cada resposta.

Os tipos são `TypedDict`. Cada rota em app/editor/api/__init__.py diz qual é o do pedido e o da resposta.
Daqui sai um JSON Schema (app/editor/contract.schema.json), de onde o editor em React gera os tipos do TypeScript:

    python -m app.editor.contract        # regrava o arquivo (o teste avisa quando ele ficou velho)

Regras:
- Objetos fechados: chave a mais ou a menos é erro (o teste das rotas confere cada resposta de verdade).
  Chave que às vezes não vem: `NotRequired[...]`.
- Respostas de formatos diferentes são uniões (`SaveOk | Errors`), não um objeto com tudo opcional.
- Ficam abertos de propósito (`JSONObject`, ou marcados com `@open_object`): o config (o modelo tipado é da
  Fase 4), o que vem dos plugins (campos, valores, status) e as descrições do schema das ações.
- Os pedidos não são conferidos pelo servidor; o tipo documenta o que o editor manda.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict, Union, get_args, get_origin, get_type_hints

JSONObject = dict[str, Any]  # objeto JSON qualquer (aberto)

_OPEN: set[str] = set()


def open_object(cls: type) -> type:
    """Marca um TypedDict como aberto: as chaves listadas são garantidas, outras podem vir."""
    _OPEN.add(cls.__name__)
    return cls


# ---------------------------------------------------------------------------- comuns


class Ok(TypedDict):
    ok: Literal[True]


class Errors(TypedDict):
    """O config tem problemas: nada foi gravado. Cada item é uma mensagem para a pessoa."""

    ok: Literal[False]
    errors: list[str]


class ErrorResponse(TypedDict):
    """Corpo de toda resposta que não é 200 (403 token/Host, 404, 400, 413, 500)."""

    error: str
    code: NotRequired[Literal["token"]]  # 403 por token velho: o editor pede para recarregar


class Empty(TypedDict):
    """Pedido sem campos (o editor manda {})."""


class FileDownload(TypedDict):
    """Arquivo para baixar: nome e conteúdo em base64."""

    name: str
    data: str


# ---------------------------------------------------------------------------- config


class ConfigResponse(TypedDict):
    config: JSONObject
    file: str  # nome do arquivo (config.yaml)


class SaveConfigRequest(TypedDict):
    config: JSONObject


class ValidateRequest(TypedDict):
    config: NotRequired[JSONObject]


class KeyShortcutPlace(TypedDict):
    page: str
    key: str
    type: str  # tipo da ação (bind, hotkey, discord.ptt...)


class PluginShortcutPlace(TypedDict):
    plugin: str
    setting: str


class ShortcutConflict(TypedDict):
    combo: str
    places: list[KeyShortcutPlace | PluginShortcutPlace]


class ValidateOk(TypedDict):
    ok: Literal[True]
    conflicts: list[ShortcutConflict]


class ValidateErrors(TypedDict):
    ok: Literal[False]
    errors: list[str]
    conflicts: list[ShortcutConflict]


class HistoryEntry(TypedDict):
    id: str
    time: float
    reason: str | None
    summary: list[str]


class HistoryResponse(TypedDict):
    entries: list[HistoryEntry]


class HistoryRestoreRequest(TypedDict):
    id: str


class HistoryRestoreResponse(TypedDict):
    config: JSONObject
    when: str


class ExportRequest(TypedDict):
    include_secrets: NotRequired[bool]


class ImportRequest(TypedDict):
    name: NotRequired[str]
    data: str  # o arquivo em base64 (pode vir como data URL)
    dry_run: NotRequired[bool]
    mode: NotRequired[Literal["replace", "merge"]]


class ImportSummary(TypedDict):
    pages: list[str]
    keys: int
    images: int
    settings: list[str]


class ImportPreview(TypedDict):
    summary: ImportSummary


class ImportDone(TypedDict):
    ok: Literal[True]
    config: JSONObject


# ---------------------------------------------------------------------------- prévias


class PreviewRequest(TypedDict):
    keys: list[JSONObject | None]
    icons: NotRequired[JSONObject | None]  # a seção icons: do config (estilo, tamanho do texto)
    widgets: NotRequired[JSONObject | None]  # os widgets da pessoa (widgets: do config)
    device: NotRequired[JSONObject | None]


class PreviewSingle(TypedDict):
    normal: str  # data URL (PNG, ou WebP animado)
    active: str | None  # com o estado ligado, quando a tecla tem estado


class PreviewCells(TypedDict):
    """Bloco de várias teclas: uma imagem por tecla, em ordem de leitura."""

    normal: None
    active: None
    cells: list[str]


class PreviewResponse(TypedDict):
    images: list[PreviewSingle | PreviewCells | None]


class WidgetExpandRequest(TypedDict):
    key: JSONObject  # {widget, size, options, colors}
    widgets: NotRequired[JSONObject | None]
    id: NotRequired[str | None]  # o id das contagens; sem ele, "key"


class WidgetExpanded(TypedDict):
    span: tuple[int, int]  # (colunas, linhas)
    cells: list[JSONObject]
    icon: JSONObject
    action: NotRequired[Any]
    hold: NotRequired[Any]
    missing: NotRequired[Literal[True]]  # o widget não existe mais (plugin desligado): é um aviso


class ValuesResponse(TypedDict):
    values: dict[str, str | None]  # id -> valor já em texto (ou o exemplo, sem o app rodando)


class UploadRequest(TypedDict):
    name: NotRequired[str]
    data: str


class UploadResponse(TypedDict):
    path: str  # relativo ao config: icons/<nome>


class ImageInfoRequest(TypedDict):
    path: str


class ImageInfo(TypedDict):
    name: str
    width: int
    height: int
    frames: int
    thumb: str  # data URL (PNG, ou WebP animado)


class ImageMissing(TypedDict):
    name: str
    missing: Literal[True]


# ---------------------------------------------------------------------------- schema e plugins


class PluginGroup(TypedDict):
    # vêm do manifesto, que ainda não confere o tipo desses campos (Fase 6): normalmente texto, ou null
    color: Any
    icon: Any


class PluginLoadError(TypedDict):
    folder: str
    error: str


class WidgetCategory(TypedDict):
    id: str
    label: str
    hue: str
    color: str  # var(--cat-<matiz>)


class EditorSchema(TypedDict):
    """Tudo que o editor precisa para montar os formulários. As descrições de ações, campos, widgets e plugins
    ficam abertas: vêm também dos plugins."""

    actions: dict[str, JSONObject]
    icon_fields: list[JSONObject]
    field_labels: dict[str, str]
    segoe_to_lucide: dict[str, str]
    plugins: list[JSONObject]
    plugin_groups: dict[str, PluginGroup]
    plugin_errors: list[PluginLoadError]
    default_language: str
    values: list[JSONObject]
    widgets: dict[str, JSONObject]
    widget_categories: list[WidgetCategory]
    value_ops: list[str]


class PluginZipRequest(TypedDict):
    data: str  # o .zip em base64
    replace: NotRequired[bool]


class PluginManifestSummary(TypedDict):
    """Só o id é conferido pelo validador do manifesto; o resto vem como o plugin escreveu (normalmente texto
    ou null). Fica tipado quando a Fase 6 validar o manifesto."""

    id: str
    name: Any
    version: Any
    author: Any
    description: Any
    icon: Any
    color: Any
    permissions: Any
    homepage: Any


class PluginInspect(TypedDict):
    manifest: PluginManifestSummary
    actions: list[Any]  # o "label" de cada ação, como o manifesto escreveu
    installed: str | None  # versão já instalada
    builtin_conflict: bool  # o id é de um plugin que vem com o app


class PluginInstalled(TypedDict):
    ok: Literal[True]
    id: str
    schema: EditorSchema


class PluginRemoveRequest(TypedDict):
    id: str


class PluginRemoved(TypedDict):
    ok: Literal[True]
    schema: EditorSchema


# ---------------------------------------------------------------------------- logs


class LogsQuery(TypedDict):
    after: NotRequired[str]  # GET: vem da URL (?after=12)


class LogRecord(TypedDict):
    id: int
    t: float
    level: str
    area: str
    msg: str
    ctx: JSONObject | None
    tb: str | None


class LogSummary(TypedDict):
    last: int
    seen: int
    new_errors: int
    errors: int
    warnings: int
    since: float


class LogsBadge(TypedDict):
    new_errors: int
    last: int


class Problem(TypedDict):
    id: str
    text: str
    where: str | None
    since: float
    count: int


class LogFiles(TypedDict):
    folder: str
    file: str
    count: int
    bytes: int


class LogDetail(TypedDict):
    detail: bool
    areas: list[str]
    force: bool


class LogsResponse(TypedDict):
    records: list[LogRecord]
    summary: LogSummary
    problems: list[Problem]
    files: LogFiles
    detail: LogDetail


class LogsSeenRequest(TypedDict):
    upto: NotRequired[int | None]


# ---------------------------------------------------------------------------- o app e o aparelho


@open_object
class PluginStatus(TypedDict):
    state: str  # ok | wait | error | off
    label: str
    error: str | None


class StatusOffline(TypedDict):
    """O editor sem o app rodando (aberto antes, ou o servidor de teste)."""

    engine: Literal[False]
    logs: LogsBadge
    problems: list[Problem]


class StatusOnline(TypedDict):
    engine: Literal[True]
    device: bool
    page: str
    obs: bool
    plugins: dict[str, PluginStatus]
    logs: LogsBadge
    problems: list[Problem]


class About(TypedDict):
    firmware: str | None
    device: bool
    autostart: bool | None  # None: não deu para ler
    config: str
    log: str


class AutostartRequest(TypedDict):
    enabled: bool


class AutostartResponse(TypedDict):
    autostart: bool


class OpenRequest(TypedDict):
    what: Literal["log", "logs", "folder"]


class ObsOffline(TypedDict):
    """Sem o app rodando."""

    connected: Literal[False]


class ObsLists(TypedDict):
    connected: bool
    scenes: list[str]
    inputs: list[str]
    sources: dict[str, list[str]]  # cena -> fontes


class PressRequest(TypedDict):
    page: str
    key: int
    which: NotRequired[Literal["action", "hold", "release"]]


class ShowRequest(TypedDict):
    page: str


class FreeBindRequest(TypedDict):
    config: NotRequired[JSONObject]
    count: NotRequired[int]
    rules: NotRequired[JSONObject | None]
    taken: NotRequired[list[str]]


class FreeBindResponse(TypedDict):
    combos: list[str]


class SendComboRequest(TypedDict):
    keys: str
    delay: NotRequired[float]


class RecordArm(TypedDict):
    keys: str
    seconds: NotRequired[float]


class RecordCancel(TypedDict):
    cancel: Literal[True]


class RecordSent(TypedDict):
    combo: str
    key: int
    at: float


class RecordState(TypedDict):
    armed: bool
    left: int  # segundos
    sent: RecordSent | None


# ---------------------------------------------------------------------------- para JSON Schema


def _is_typeddict(tp: Any) -> bool:
    return isinstance(tp, type) and issubclass(tp, dict) and hasattr(tp, "__total__")


class _Builder:
    def __init__(self) -> None:
        self.defs: dict[str, dict[str, Any]] = {}

    def of(self, tp: Any) -> dict[str, Any]:
        if tp is Any:
            return {}
        if tp is None or tp is type(None):
            return {"type": "null"}
        if tp is bool:
            return {"type": "boolean"}
        if tp is int:
            return {"type": "integer"}
        if tp is float:
            return {"type": "number"}
        if tp is str:
            return {"type": "string"}
        if _is_typeddict(tp):
            name = tp.__name__
            if name not in self.defs:
                self.defs[name] = {}  # reserva (tipos que se referem a si mesmos)
                self.defs[name] = self._object(tp)
            return {"$ref": f"#/$defs/{name}"}
        origin, args = get_origin(tp), get_args(tp)
        if origin is Literal:
            return {"const": args[0]} if len(args) == 1 else {"enum": list(args)}
        if origin in (Union, types.UnionType):
            return {"anyOf": [self.of(a) for a in args]}
        if origin is list:
            return {"type": "array", "items": self.of(args[0])}
        if origin is tuple:
            # prefixItems confere cada posição; "items" (qualquer dos tipos) é o que os geradores de TypeScript
            # entendem (com items: false eles geram never[]). O tamanho fixo fica no min/maxItems.
            each = [self.of(a) for a in args]
            return {
                "type": "array",
                "prefixItems": each,
                "items": each[0] if all(e == each[0] for e in each) else {"anyOf": each},
                "minItems": len(args),
                "maxItems": len(args),
            }
        if origin is dict:
            return {"type": "object", "additionalProperties": self.of(args[1])}
        raise TypeError(f"tipo sem conversão para JSON Schema: {tp!r}")

    def _object(self, td: type) -> dict[str, Any]:
        hints = get_type_hints(td, include_extras=True)
        props, required = {}, []
        for key, tp in hints.items():
            # o __required_keys__ erra com "from __future__ import annotations": lê o NotRequired daqui
            if get_origin(tp) is NotRequired:
                tp = get_args(tp)[0]
            else:
                required.append(key)
            props[key] = self.of(tp)
        out: dict[str, Any] = {"type": "object", "properties": props, "required": required}
        out["additionalProperties"] = td.__name__ in _OPEN
        if td.__doc__ and td.__doc__ is not dict.__doc__:
            out["description"] = " ".join(td.__doc__.split())
        return out


def json_schema(routes: dict[tuple[str, str], Any]) -> dict[str, Any]:
    """O documento inteiro: um $defs com todos os tipos e, em x-routes, o pedido e a resposta de cada rota."""
    b = _Builder()
    table = {}
    for (method, path), r in sorted(routes.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        table[f"{method} {path}"] = {
            "request": b.of(r.request) if r.request is not None else None,
            "response": b.of(r.response),
        }
    error = b.of(ErrorResponse)
    defs = dict(sorted(b.defs.items()))
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "DeckEditorApi",
        "description": "Contrato da API do editor do Deck. Gerado por app/editor/contract.py; não edite à mão.",
        # raiz com uma propriedade por tipo: os geradores de TypeScript exportam todos
        "type": "object",
        "properties": {name: {"$ref": f"#/$defs/{name}"} for name in defs},
        "$defs": defs,
        "x-error": error,
        "x-routes": table,
    }


SCHEMA_FILE = Path(__file__).with_name("contract.schema.json")


def render(routes: dict[tuple[str, str], Any]) -> str:
    return json.dumps(json_schema(routes), ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def main() -> int:
    from app.editor.api import ROUTES

    SCHEMA_FILE.write_text(render(ROUTES), encoding="utf-8", newline="\n")
    sys.stdout.write(f"{SCHEMA_FILE} ({len(ROUTES)} rotas)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
