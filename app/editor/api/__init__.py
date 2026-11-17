"""As rotas da API do editor: cada uma é uma função `(ctx, body) -> dict`, num módulo por assunto.

Cada rota diz o tipo do pedido e o da resposta (app/editor/contract.py); o contrato em JSON sai daqui.

O servidor (app/editor/server.py) só cuida do HTTP: token, Host, corpo, erros e arquivos estáticos.
Num GET, os parâmetros da URL (?after=12) chegam como o `body`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.editor.api import config, device, logs, plugins, preview
from app.editor import contract as c
from app.editor.api.context import MAX_BODY, Context

__all__ = ["MAX_BODY", "ROUTES", "Context", "Route"]


@dataclass(frozen=True, slots=True)
class Route:
    fn: Callable[[Context, dict[str, Any]], Any]
    response: Any  # tipo da resposta (TypedDict ou união deles)
    request: Any = None  # tipo do pedido; None = sem corpo (GET sem parâmetros)


ROUTES: dict[tuple[str, str], Route] = {
    # config
    ("GET", "/api/config"): Route(config.get_config, c.ConfigResponse),
    ("POST", "/api/config"): Route(config.save_config, c.Ok | c.Errors, c.SaveConfigRequest),
    ("POST", "/api/validate"): Route(config.validate, c.ValidateOk | c.ValidateErrors, c.ValidateRequest),
    ("GET", "/api/history"): Route(config.history_list, c.HistoryResponse),
    ("POST", "/api/history/restore"): Route(config.history_restore, c.HistoryRestoreResponse, c.HistoryRestoreRequest),
    ("POST", "/api/export"): Route(config.export, c.FileDownload, c.ExportRequest),
    ("POST", "/api/import"): Route(config.import_config, c.ImportPreview | c.ImportDone | c.Errors, c.ImportRequest),
    # prévias
    ("POST", "/api/preview"): Route(preview.preview, c.PreviewResponse, c.PreviewRequest),
    ("POST", "/api/widget/expand"): Route(preview.widget_expand, c.WidgetExpanded, c.WidgetExpandRequest),
    ("GET", "/api/values"): Route(preview.values_now, c.ValuesResponse),
    ("POST", "/api/upload"): Route(preview.upload, c.UploadResponse, c.UploadRequest),
    ("POST", "/api/image_info"): Route(preview.image_info, c.ImageInfo | c.ImageMissing, c.ImageInfoRequest),
    # schema e plugins
    ("GET", "/api/schema"): Route(plugins.get_schema, c.EditorSchema),
    ("POST", "/api/plugins/inspect"): Route(plugins.plugin_inspect, c.PluginInspect, c.PluginZipRequest),
    ("POST", "/api/plugins/install"): Route(plugins.plugin_install, c.PluginInstalled, c.PluginZipRequest),
    ("POST", "/api/plugins/remove"): Route(plugins.plugin_remove, c.PluginRemoved, c.PluginRemoveRequest),
    # logs
    ("GET", "/api/logs"): Route(logs.get_logs, c.LogsResponse, c.LogsQuery),
    ("POST", "/api/logs/seen"): Route(logs.logs_seen, c.Ok, c.LogsSeenRequest),
    ("POST", "/api/logs/diagnostics"): Route(logs.logs_diagnostics, c.FileDownload, c.Empty),
    # o app e o aparelho
    ("GET", "/api/status"): Route(device.status, c.StatusOffline | c.StatusOnline),
    ("GET", "/api/about"): Route(device.about, c.About),
    ("POST", "/api/autostart"): Route(device.autostart, c.AutostartResponse, c.AutostartRequest),
    ("POST", "/api/open"): Route(device.open_path, c.Ok, c.OpenRequest),
    ("GET", "/api/obs"): Route(device.obs, c.ObsOffline | c.ObsLists),
    ("POST", "/api/press"): Route(device.press, c.Ok, c.PressRequest),
    ("POST", "/api/show"): Route(device.show, c.Ok, c.ShowRequest),
    ("POST", "/api/free_bind"): Route(device.free_bind, c.FreeBindResponse, c.FreeBindRequest),
    ("POST", "/api/send_combo"): Route(device.send_combo, c.Ok, c.SendComboRequest),
    ("POST", "/api/record"): Route(device.record, c.Ok, c.RecordArm | c.RecordCancel),
    ("GET", "/api/record"): Route(device.record_state, c.RecordState),
}
