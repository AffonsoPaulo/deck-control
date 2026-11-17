// Gerado por scripts/gen-api.mjs a partir de app/editor/contract.schema.json. Não edite à mão:
// mude app/editor/contract.py, rode `python -m app.editor.contract` e depois `npm run gen:api`.

/**
 * Contrato da API do editor do Deck. Gerado por app/editor/contract.py; não edite à mão.
 */
export interface DeckEditorApi {
  About?: About;
  AutostartRequest?: AutostartRequest;
  AutostartResponse?: AutostartResponse;
  ConfigResponse?: ConfigResponse;
  Conflict?: Conflict;
  EditorSchema?: EditorSchema;
  Empty?: Empty;
  ErrorResponse?: ErrorResponse;
  Errors?: Errors;
  ExportRequest?: ExportRequest;
  FileDownload?: FileDownload;
  FreeBindRequest?: FreeBindRequest;
  FreeBindResponse?: FreeBindResponse;
  HistoryEntry?: HistoryEntry;
  HistoryResponse?: HistoryResponse;
  HistoryRestoreRequest?: HistoryRestoreRequest;
  HistoryRestoreResponse?: HistoryRestoreResponse;
  ImageInfo?: ImageInfo;
  ImageInfoRequest?: ImageInfoRequest;
  ImageMissing?: ImageMissing;
  ImportDone?: ImportDone;
  ImportPreview?: ImportPreview;
  ImportRequest?: ImportRequest;
  ImportSummary?: ImportSummary;
  KeyShortcutPlace?: KeyShortcutPlace;
  LogDetail?: LogDetail;
  LogFiles?: LogFiles;
  LogRecord?: LogRecord;
  LogSummary?: LogSummary;
  LogsBadge?: LogsBadge;
  LogsQuery?: LogsQuery;
  LogsResponse?: LogsResponse;
  LogsSeenRequest?: LogsSeenRequest;
  ObsLists?: ObsLists;
  ObsOffline?: ObsOffline;
  Ok?: Ok;
  OpenRequest?: OpenRequest;
  PluginGroup?: PluginGroup;
  PluginInspect?: PluginInspect;
  PluginInstalled?: PluginInstalled;
  PluginLoadError?: PluginLoadError;
  PluginManifestSummary?: PluginManifestSummary;
  PluginRemoveRequest?: PluginRemoveRequest;
  PluginRemoved?: PluginRemoved;
  PluginShortcutPlace?: PluginShortcutPlace;
  PluginStatus?: PluginStatus;
  PluginZipRequest?: PluginZipRequest;
  PressRequest?: PressRequest;
  PreviewCells?: PreviewCells;
  PreviewRequest?: PreviewRequest;
  PreviewResponse?: PreviewResponse;
  PreviewSingle?: PreviewSingle;
  Problem?: Problem;
  RecordArm?: RecordArm;
  RecordCancel?: RecordCancel;
  RecordSent?: RecordSent;
  RecordState?: RecordState;
  SaveConfigRequest?: SaveConfigRequest;
  Saved?: Saved;
  SendComboRequest?: SendComboRequest;
  ShortcutConflict?: ShortcutConflict;
  ShowRequest?: ShowRequest;
  StatusOffline?: StatusOffline;
  StatusOnline?: StatusOnline;
  UploadRequest?: UploadRequest;
  UploadResponse?: UploadResponse;
  ValidateErrors?: ValidateErrors;
  ValidateOk?: ValidateOk;
  ValidateRequest?: ValidateRequest;
  ValuesResponse?: ValuesResponse;
  WidgetCategory?: WidgetCategory;
  WidgetExpandRequest?: WidgetExpandRequest;
  WidgetExpanded?: WidgetExpanded;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "About".
 */
export interface About {
  firmware: string | null;
  device: boolean;
  autostart: boolean | null;
  config: string;
  log: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "AutostartRequest".
 */
export interface AutostartRequest {
  enabled: boolean;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "AutostartResponse".
 */
export interface AutostartResponse {
  autostart: boolean;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ConfigResponse".
 */
export interface ConfigResponse {
  config: {
    [k: string]: unknown;
  };
  file: string;
  rev: string;
}
/**
 * O arquivo mudou desde a versão que o editor tem (outra aba, o histórico, edição à mão): nada foi gravado.
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "Conflict".
 */
export interface Conflict {
  ok: false;
  conflict: true;
  rev: string;
}
/**
 * Tudo que o editor precisa para montar os formulários. As descrições de ações, campos, widgets e plugins ficam abertas: vêm também dos plugins.
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "EditorSchema".
 */
export interface EditorSchema {
  actions: {
    [k: string]: {
      [k: string]: unknown;
    };
  };
  icon_fields: {
    [k: string]: unknown;
  }[];
  field_labels: {
    [k: string]: string;
  };
  segoe_to_lucide: {
    [k: string]: string;
  };
  plugins: {
    [k: string]: unknown;
  }[];
  plugin_groups: {
    [k: string]: PluginGroup;
  };
  plugin_errors: PluginLoadError[];
  default_language: string;
  values: {
    [k: string]: unknown;
  }[];
  widgets: {
    [k: string]: {
      [k: string]: unknown;
    };
  };
  widget_categories: WidgetCategory[];
  value_ops: string[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginGroup".
 */
export interface PluginGroup {
  color: unknown;
  icon: unknown;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginLoadError".
 */
export interface PluginLoadError {
  folder: string;
  error: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "WidgetCategory".
 */
export interface WidgetCategory {
  id: string;
  label: string;
  hue: string;
  color: string;
}
/**
 * Pedido sem campos (o editor manda {}).
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "Empty".
 */
export interface Empty {}
/**
 * Corpo de toda resposta que não é 200 (403 token/Host, 404, 400, 413, 500).
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ErrorResponse".
 */
export interface ErrorResponse {
  error: string;
  code?: "token";
}
/**
 * O config tem problemas: nada foi gravado. Cada item é uma mensagem para a pessoa.
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "Errors".
 */
export interface Errors {
  ok: false;
  errors: string[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ExportRequest".
 */
export interface ExportRequest {
  include_secrets?: boolean;
}
/**
 * Arquivo para baixar: nome e conteúdo em base64.
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "FileDownload".
 */
export interface FileDownload {
  name: string;
  data: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "FreeBindRequest".
 */
export interface FreeBindRequest {
  config?: {
    [k: string]: unknown;
  };
  count?: number;
  rules?: {
    [k: string]: unknown;
  } | null;
  taken?: string[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "FreeBindResponse".
 */
export interface FreeBindResponse {
  combos: string[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "HistoryEntry".
 */
export interface HistoryEntry {
  id: string;
  time: number;
  reason: string | null;
  summary: string[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "HistoryResponse".
 */
export interface HistoryResponse {
  entries: HistoryEntry[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "HistoryRestoreRequest".
 */
export interface HistoryRestoreRequest {
  id: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "HistoryRestoreResponse".
 */
export interface HistoryRestoreResponse {
  config: {
    [k: string]: unknown;
  };
  when: string;
  rev: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ImageInfo".
 */
export interface ImageInfo {
  name: string;
  width: number;
  height: number;
  frames: number;
  thumb: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ImageInfoRequest".
 */
export interface ImageInfoRequest {
  path: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ImageMissing".
 */
export interface ImageMissing {
  name: string;
  missing: true;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ImportDone".
 */
export interface ImportDone {
  ok: true;
  config: {
    [k: string]: unknown;
  };
  rev: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ImportPreview".
 */
export interface ImportPreview {
  summary: ImportSummary;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ImportSummary".
 */
export interface ImportSummary {
  pages: string[];
  keys: number;
  images: number;
  settings: string[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ImportRequest".
 */
export interface ImportRequest {
  name?: string;
  data: string;
  dry_run?: boolean;
  mode?: "replace" | "merge";
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "KeyShortcutPlace".
 */
export interface KeyShortcutPlace {
  page: string;
  key: string;
  type: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "LogDetail".
 */
export interface LogDetail {
  detail: boolean;
  areas: string[];
  force: boolean;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "LogFiles".
 */
export interface LogFiles {
  folder: string;
  file: string;
  count: number;
  bytes: number;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "LogRecord".
 */
export interface LogRecord {
  id: number;
  t: number;
  level: string;
  area: string;
  msg: string;
  ctx: {
    [k: string]: unknown;
  } | null;
  tb: string | null;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "LogSummary".
 */
export interface LogSummary {
  last: number;
  seen: number;
  new_errors: number;
  errors: number;
  warnings: number;
  since: number;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "LogsBadge".
 */
export interface LogsBadge {
  new_errors: number;
  last: number;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "LogsQuery".
 */
export interface LogsQuery {
  after?: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "LogsResponse".
 */
export interface LogsResponse {
  records: LogRecord[];
  summary: LogSummary;
  problems: Problem[];
  files: LogFiles;
  detail: LogDetail;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "Problem".
 */
export interface Problem {
  id: string;
  text: string;
  where: string | null;
  since: number;
  count: number;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "LogsSeenRequest".
 */
export interface LogsSeenRequest {
  upto?: number | null;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ObsLists".
 */
export interface ObsLists {
  connected: boolean;
  scenes: string[];
  inputs: string[];
  sources: {
    [k: string]: string[];
  };
}
/**
 * Sem o app rodando.
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ObsOffline".
 */
export interface ObsOffline {
  connected: false;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "Ok".
 */
export interface Ok {
  ok: true;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "OpenRequest".
 */
export interface OpenRequest {
  what: "log" | "logs" | "folder";
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginInspect".
 */
export interface PluginInspect {
  manifest: PluginManifestSummary;
  actions: unknown[];
  installed: string | null;
  builtin_conflict: boolean;
  runtime: "exe" | "deck-python";
  run: string[];
}
/**
 * Só o id é conferido pelo validador do manifesto; o resto vem como o plugin escreveu (normalmente texto ou null). Fica tipado quando a Fase 6 validar o manifesto.
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginManifestSummary".
 */
export interface PluginManifestSummary {
  id: string;
  name: unknown;
  version: unknown;
  author: unknown;
  description: unknown;
  icon: unknown;
  color: unknown;
  permissions: unknown;
  homepage: unknown;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginInstalled".
 */
export interface PluginInstalled {
  ok: true;
  id: string;
  schema: EditorSchema;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginRemoveRequest".
 */
export interface PluginRemoveRequest {
  id: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginRemoved".
 */
export interface PluginRemoved {
  ok: true;
  schema: EditorSchema;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginShortcutPlace".
 */
export interface PluginShortcutPlace {
  plugin: string;
  setting: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginStatus".
 */
export interface PluginStatus {
  state: string;
  label: string;
  error: string | null;
  [k: string]: unknown;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PluginZipRequest".
 */
export interface PluginZipRequest {
  data: string;
  replace?: boolean;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PressRequest".
 */
export interface PressRequest {
  page: string;
  key: number;
  which?: "action" | "hold" | "release";
}
/**
 * Bloco de várias teclas: uma imagem por tecla, em ordem de leitura.
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PreviewCells".
 */
export interface PreviewCells {
  normal: null;
  active: null;
  cells: string[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PreviewRequest".
 */
export interface PreviewRequest {
  keys: ({
    [k: string]: unknown;
  } | null)[];
  icons?: {
    [k: string]: unknown;
  } | null;
  widgets?: {
    [k: string]: unknown;
  } | null;
  device?: {
    [k: string]: unknown;
  } | null;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PreviewResponse".
 */
export interface PreviewResponse {
  images: (PreviewSingle | PreviewCells | null)[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "PreviewSingle".
 */
export interface PreviewSingle {
  normal: string;
  active: string | null;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "RecordArm".
 */
export interface RecordArm {
  keys: string;
  seconds?: number;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "RecordCancel".
 */
export interface RecordCancel {
  cancel: true;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "RecordSent".
 */
export interface RecordSent {
  combo: string;
  key: number;
  at: number;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "RecordState".
 */
export interface RecordState {
  armed: boolean;
  left: number;
  sent: RecordSent | null;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "SaveConfigRequest".
 */
export interface SaveConfigRequest {
  config: {
    [k: string]: unknown;
  };
  rev?: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "Saved".
 */
export interface Saved {
  ok: true;
  rev: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "SendComboRequest".
 */
export interface SendComboRequest {
  keys: string;
  delay?: number;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ShortcutConflict".
 */
export interface ShortcutConflict {
  combo: string;
  places: (KeyShortcutPlace | PluginShortcutPlace)[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ShowRequest".
 */
export interface ShowRequest {
  page: string;
}
/**
 * O editor sem o app rodando (aberto antes, ou o servidor de teste).
 *
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "StatusOffline".
 */
export interface StatusOffline {
  engine: false;
  logs: LogsBadge;
  problems: Problem[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "StatusOnline".
 */
export interface StatusOnline {
  engine: true;
  device: boolean;
  page: string;
  obs: boolean;
  plugins: {
    [k: string]: PluginStatus;
  };
  logs: LogsBadge;
  problems: Problem[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "UploadRequest".
 */
export interface UploadRequest {
  name?: string;
  data: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "UploadResponse".
 */
export interface UploadResponse {
  path: string;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ValidateErrors".
 */
export interface ValidateErrors {
  ok: false;
  errors: string[];
  conflicts: ShortcutConflict[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ValidateOk".
 */
export interface ValidateOk {
  ok: true;
  conflicts: ShortcutConflict[];
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ValidateRequest".
 */
export interface ValidateRequest {
  config?: {
    [k: string]: unknown;
  };
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "ValuesResponse".
 */
export interface ValuesResponse {
  values: {
    [k: string]: string | null;
  };
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "WidgetExpandRequest".
 */
export interface WidgetExpandRequest {
  key: {
    [k: string]: unknown;
  };
  widgets?: {
    [k: string]: unknown;
  } | null;
  id?: string | null;
}
/**
 * This interface was referenced by `DeckEditorApi`'s JSON-Schema
 * via the `definition` "WidgetExpanded".
 */
export interface WidgetExpanded {
  /**
   * @minItems 2
   * @maxItems 2
   */
  span: [number, number];
  cells: {
    [k: string]: unknown;
  }[];
  icon: {
    [k: string]: unknown;
  };
  action?: unknown;
  hold?: unknown;
  missing?: true;
}

/** Pedido e resposta de cada rota ("MÉTODO /caminho"). */
export interface ApiRoutes {
  "GET /api/about": { request: undefined; response: About };
  "POST /api/autostart": { request: AutostartRequest; response: AutostartResponse };
  "GET /api/config": { request: undefined; response: ConfigResponse };
  "POST /api/config": { request: SaveConfigRequest; response: Saved | Errors | Conflict };
  "POST /api/export": { request: ExportRequest; response: FileDownload };
  "POST /api/free_bind": { request: FreeBindRequest; response: FreeBindResponse };
  "GET /api/history": { request: undefined; response: HistoryResponse };
  "POST /api/history/restore": { request: HistoryRestoreRequest; response: HistoryRestoreResponse };
  "POST /api/image_info": { request: ImageInfoRequest; response: ImageInfo | ImageMissing };
  "POST /api/import": { request: ImportRequest; response: ImportPreview | ImportDone | Errors };
  "GET /api/logs": { request: LogsQuery; response: LogsResponse };
  "POST /api/logs/diagnostics": { request: Empty; response: FileDownload };
  "POST /api/logs/seen": { request: LogsSeenRequest; response: Ok };
  "GET /api/obs": { request: undefined; response: ObsOffline | ObsLists };
  "POST /api/open": { request: OpenRequest; response: Ok };
  "POST /api/plugins/inspect": { request: PluginZipRequest; response: PluginInspect };
  "POST /api/plugins/install": { request: PluginZipRequest; response: PluginInstalled };
  "POST /api/plugins/remove": { request: PluginRemoveRequest; response: PluginRemoved };
  "POST /api/press": { request: PressRequest; response: Ok };
  "POST /api/preview": { request: PreviewRequest; response: PreviewResponse };
  "GET /api/record": { request: undefined; response: RecordState };
  "POST /api/record": { request: RecordArm | RecordCancel; response: Ok };
  "GET /api/schema": { request: undefined; response: EditorSchema };
  "POST /api/send_combo": { request: SendComboRequest; response: Ok };
  "POST /api/show": { request: ShowRequest; response: Ok };
  "GET /api/status": { request: undefined; response: StatusOffline | StatusOnline };
  "POST /api/upload": { request: UploadRequest; response: UploadResponse };
  "POST /api/validate": { request: ValidateRequest; response: ValidateOk | ValidateErrors };
  "GET /api/values": { request: undefined; response: ValuesResponse };
  "POST /api/widget/expand": { request: WidgetExpandRequest; response: WidgetExpanded };
}

/** Corpo das respostas que não são 200. */
export type ApiError = ErrorResponse;
