"use strict";
// Editor do Deck. Conversa com o app via /api (token no #t= da URL).
//
// Modelo: cada tecla tem uma lista de PASSOS por momento (apertar, segurar, soltar).
// Um passo só = ação simples; vários = sequência; blocos "Se…" e "Liga/desliga" têm
// trilhas com seus próprios passos. Na hora de salvar, isso vira o formato do config.yaml
// (ação única, {type: multi}, {type: if, then, else}, {type: toggle, on, off}).

const TOKEN = new URLSearchParams(location.hash.slice(1)).get("t") || "";
const KEYS = Array.from({ length: 15 }, (_, i) => String(i + 1));
const MOMENTS = ["action", "double", "hold", "release"];

const GROUPS = {
  "Keyboard and text":   { color: "#3e63dd", bg: "#22336e" },
  "Programs and system": { color: "#2f9e6a", bg: "#1d4d37" },
  "OBS":                 { color: "#0f8f99", bg: "#134a4f" },
  "Discord":             { color: "#5865f2", bg: "#5865F2" },
  "Temporary responses": { color: "#8e4ec6", bg: "#2b2440" },
  "Pages and logic":     { color: "#e5701a", bg: "#3d3027" },
  "Other":               { color: "#868d99", bg: "#2b2f36" },
};
const GROUP_ORDER = Object.keys(GROUPS);
// categorias e cores que vêm dos plugins (OBS, Discord e os de terceiros)
function applySchema(schema) {
  // os textos do schema vêm em inglês (a chave); aqui viram o idioma do editor
  const tr = (v) => (typeof v === "string" ? t(v) : v);
  for (const d of Object.values(schema.actions || {})) {
    d.label = tr(d.label); d.help = tr(d.help);
    for (const f of d.fields || []) {
      f.label = tr(f.label); f.help = tr(f.help);
      if (typeof f.placeholder === "string") f.placeholder = tr(f.placeholder);
      if (Array.isArray(f.options)) f.options = f.options.map(([v, l]) => [v, tr(l)]);
    }
  }
  for (const f of schema.icon_fields || []) f.label = tr(f.label);
  for (const k of Object.keys(schema.field_labels || {})) schema.field_labels[k] = tr(schema.field_labels[k]);
  S.schema = schema;
  for (const [gname, g] of Object.entries(schema.plugin_groups || {})) {
    if (!GROUPS[gname]) GROUPS[gname] = { color: g.color, bg: darker(g.color, 0.5) };
    if (!GROUP_ORDER.includes(gname)) GROUP_ORDER.splice(GROUP_ORDER.indexOf("Other"), 0, gname);
  }
}

// ícones da interface (Lucide). Os glifos acima são os que vão para as teclas do Deck.
const ACTION_ICON = {
  hotkey: "keyboard", bind: "command", text: "text-cursor-input", media: "music", launch: "app-window", command: "terminal",
  http: "webhook", delay: "timer", multi: "list-ordered", toggle: "toggle-right", if: "split", set_state: "flag",
  page: "layers", brightness: "sun", none: "ban", "obs.scene": "monitor", "obs.record": "circle-dot", "obs.stream": "radio",
  "obs.replay": "rewind", "obs.virtualcam": "video", "obs.mute": "volume-x", "obs.source": "eye", "obs.request": "code",
  "discord.mute": "mic", "discord.deafen": "headphones", "discord.keybind": "keyboard",
};
const QUICK = ["hotkey", "launch", "obs.scene", "discord.mute", "page", "media"];

const S = {
  cfg: null, saved: "", schema: null,
  obs: { scenes: [], inputs: [], sources: {} },
  status: {},
  page: null,
  key: null,            // "1".."15" ou null
  view: "normal",       // grade: ícones normais ou ativos
  tab: "do",            // "do" (o que faz) | "look" (aparência)
  lookMode: "normal",
  previews: {},
  clipboard: null,
  model: null,          // passos da tecla selecionada
  drag: null,           // { kind: "new", type } | { kind: "move", list, index }
  expanded: false,      // lógica da tecla aberta no lugar do Deck
  section: "keys",      // trilho da esquerda: "keys" (teclas) | "light" (luz)
  lightMoment: "press", // aba Luz da tecla: momento escolhido
};
const H = { stack: [], idx: -1 };

// ---------------------------------------------------------------------------- utilidades

const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith("--")) el.style.setProperty(prop, val); else el.style[prop] = val;
      }
    }
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const glyphChar = (code) => { const c = String(code || "").trim(); return /^[0-9a-f]{4,5}$/i.test(c) ? String.fromCodePoint(parseInt(c, 16)) : c; };
const g = (code) => h("span", { class: "g", "aria-hidden": "true" }, glyphChar(code));
const ic = (name) => lu(name);
const iconOf = (type) => ACTION_ICON[type] || (S.schema && S.schema.actions[type] && S.schema.actions[type].icon) || "settings";
const actionIc = (type) => ic(iconOf(type));
document.querySelectorAll("[data-lu]").forEach((el) => el.replaceWith(lu(el.dataset.lu)));
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function api(path, body) {
  const opts = { method: body === undefined ? "GET" : "POST", headers: { "X-Token": TOKEN } };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(path, opts);
  let j = {};
  try { j = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) { const err = new Error(j.error || `HTTP ${r.status}`); err.code = j.code; throw err; }
  return j;
}

let toastTimer;
function toast(msg, { bad = false, undo = false, action = null, sticky = false } = {}) {
  const el = $("#toast");
  const btns = [action, undo ? { label: t("Undo"), fn: () => travel(-1) } : null].filter(Boolean);
  el.replaceChildren(h("span", {}, msg), ...btns.map((b) => h("button", { onclick: () => { hideToast(); b.fn(); } }, b.label)));
  action = btns[0] || null;
  el.className = "toast" + (bad ? " bad" : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(hideToast, bad || action ? 6000 : 2600);
}
function hideToast() {
  const el = $("#toast");
  clearTimeout(toastTimer);
  if (!el.hidden) M.leave(el, () => { el.hidden = true; }, 160);
}

function normalizeAction(spec) {   // mesmas regras de app/actions.normalize
  if (spec === null || spec === undefined || spec === "") return null;
  if (Array.isArray(spec)) return { type: "multi", actions: spec };
  if (typeof spec === "string") {
    const i = spec.indexOf(":");
    const kind = i < 0 ? spec : spec.slice(0, i);
    const arg = i < 0 ? "" : spec.slice(i + 1);
    const field = { page: "page", hotkey: "keys", launch: "target", text: "text", media: "key",
      command: "command", "obs.scene": "scene" }[kind] || "value";
    return arg ? { type: kind, [field]: arg } : { type: kind };
  }
  return spec;
}
const normalizeIcon = (v) => (typeof v === "string" ? { text: v } : isObj(v) ? v : {});
const pages = () => (S.cfg.pages = S.cfg.pages || {});
const pageKeys = (p = S.page) => (pages()[p] = pages()[p] || {});
const isDirty = () => JSON.stringify(S.cfg) !== S.saved;
const actionDef = (type) => (S.schema && S.schema.actions[type]) || null;
const groupOf = (type) => GROUPS[(actionDef(type) || {}).group] || GROUPS.Other;
const catStyle = (type) => ({ "--cat": groupOf(type).color });

function setOrDelete(obj, key, v) {
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete obj[key];
  else obj[key] = v;
}

function optionLabel(type, field, value) {
  const d = actionDef(type);
  const f = d && (d.fields || []).find((x) => x.name === field);
  const o = f && f.options && f.options.find(([v]) => JSON.stringify(v) === JSON.stringify(value));
  return o ? o[1] : value;
}

// ---------------------------------------------------------------------------- textos automáticos

function summarize(a) {
  a = normalizeAction(a);
  if (!a) return t("nothing");
  const d = actionDef(a.type);
  const label = d ? d.label : a.type;
  switch (a.type) {
    case "media": return optionLabel("media", "key", a.key) + (a.repeat > 1 ? t(" ({0}×)", [a.repeat]) : "");
    case "hotkey": return a.keys ? (Array.isArray(a.keys) ? a.keys.join(", ") : a.keys) : t("missing the shortcut");
    case "bind": return a.keys ? t("Shortcut {0}", [a.keys]) : label;
    case "text": return a.text ? `"${String(a.text).slice(0, 24)}"` : t("missing the text");
    case "launch": return a.target ? String(a.target).split(/[\\/]/).pop() : t("missing the program");
    case "page": return a.page === "back" ? t("Back one page") : a.page === "home" ? t("Home page") : t("Page {0}", [a.page]);
    case "obs.scene": return a.scene ? t("Scene {0}", [a.scene]) : t("missing the scene");
    case "obs.mute": return a.input || t("missing the audio source");
    case "obs.source": return a.source ? t("{0} in {1}", [a.source, a.scene || "?"]) : t("missing the source");
    case "delay": return a.ms ? `${a.ms} ms` : t("missing the time");
    case "multi": return t("{0} steps", [(a.actions || []).length]);
    case "if": return a.value ? t("If {0}", [valueLabel(a.value)]) : a.state ? (a.is === false ? t("If not: {0}", [stateLabel(a.state)]) : t("If {0}", [stateLabel(a.state)])) : t("missing the condition");
    case "light.flash": return t("Light {0} for {1} s", [colorName(a.color), a.seconds ?? 3]);
    case "screens.paint": return t("Screens {0} for {1} s", [colorName(a.color), a.seconds ?? 3]);
    case "page.temp": return t("Page {0} for {1} s", [a.page || "?", a.seconds ?? 10]);
    case "timer.toggle": return t("Countdown {0}", [a.id || "?"]);
    case "timer.reset": return t("Reset countdown {0}", [a.id || "?"]);
    case "obs.record": case "obs.stream": case "obs.replay": case "obs.virtualcam":
      return a.mode && a.mode !== "toggle" ? String(optionLabel(a.type, "mode", a.mode)) : t("Toggle");
    default: return d && d.help ? d.help.split(".")[0] : label;
  }
}

function autoText(a) {
  a = normalizeAction(a);
  if (!a) return "";
  const base = (p) => String(p || "").split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd)$/i, "");
  return ({
    hotkey: t("Shortcut"), bind: t("Shortcut"), text: t("Text"), command: t("Command"), http: t("Webhook"), delay: t("Wait"),
    multi: t("Sequence"), toggle: t("On/off"), if: t("If…"), set_state: t("State"), brightness: t("Brightness"), none: "",
    media: { play_pause: t("Play"), next: t("Next"), prev: t("Previous"), stop: t("Stop"), vol_up: t("Vol +"), vol_down: t("Vol −"), mute: t("Mute") }[a.key] || t("Media"),
    launch: a.target ? base(a.target) || t("Open") : t("Open"),
    page: a.page === "back" ? t("Back") : a.page === "home" ? t("Home") : a.page || t("Page"),
    "obs.scene": a.scene || t("Scene"), "obs.record": t("Record"), "obs.stream": t("Live"),
    "obs.replay": a.mode === "save" ? t("Save replay") : t("Replay"), "obs.virtualcam": t("Camera"),
    "obs.mute": a.input || t("Mute##2"), "obs.source": a.source || t("Source"), "obs.request": "OBS",
    "discord.mute": t("Mic"), "discord.deafen": t("Audio"), "discord.keybind": "Discord",
  })[a.type] ?? ((actionDef(a.type) || {}).short || (actionDef(a.type) || {}).label || a.type);   // plugins: nome curto do plugin.json
}

function autoIcon(a) {
  a = normalizeAction(a);
  const icon = { lucide: iconOf(a.type), text: autoText(a), bg: groupOf(a.type).bg };
  if (a.type === "page" && a.page === "back") icon.lucide = "arrow-left";
  return icon;
}
function autoActive(a) {
  a = normalizeAction(a);
  return ({
    "discord.mute": { lucide: "mic-off", text: t("Muted"), bg: "#e5484d" },
    "discord.deafen": { text: t("No audio"), bg: "#e5484d" },
    "obs.scene": { bg: "#2f9e6a" }, "obs.source": { bg: "#2f9e6a" },
    "obs.record": { text: t("Recording"), bg: "#e5484d" }, "obs.stream": { text: t("LIVE"), bg: "#e5484d" },
    "obs.mute": { lucide: "volume-x", bg: "#e5484d" }, toggle: { bg: "#2f9e6a" },
  })[a.type] || null;
}

// ---------------------------------------------------------------------------- estados (condições)

function stateOptions() {
  const out = [];
  for (const pl of (S.schema && S.schema.plugins) || []) for (const st of pl.states || []) out.push([st[0], st[1]]);
  const scenes = new Set(S.obs.scenes), inputs = new Set(S.obs.inputs);
  const walk = (a, page, key, spec) => {
    a = normalizeAction(a);
    if (!isObj(a)) return;
    if (a.type === "obs.scene" && a.scene) scenes.add(a.scene);
    if (a.type === "obs.mute" && a.input) inputs.add(a.input);
    if (a.type === "toggle") {
      const st = a.state || `toggle:${page}:${key}`;
      const name = normalizeIcon(spec.icon).text || t("key {0}", [key]);
      out.push([st, t("\"{0}\" ({1}) is on", [String(name).replace(/\n/g, " "), page])]);
    }
    for (const c of [...(a.actions || []), ...(a.then || []), ...(a.else || []), a.on, a.off]) if (c) walk(c, page, key, spec);
  };
  for (const [p, keys] of Object.entries(pages())) for (const [k, spec] of Object.entries(keys || {}))
    if (spec) for (const m of MOMENTS) walk(spec[m], p, k, spec);
  for (const s of scenes) out.push([`obs.scene:${s}`, t("The current scene is {0}", [s])]);
  for (const i of inputs) out.push([`obs.muted:${i}`, t("{0} is muted in OBS", [i])]);
  const seen = new Set();
  return out.filter(([v]) => (seen.has(v) ? false : seen.add(v)));
}
function stateLabel(v) {
  const o = stateOptions().find(([s]) => s === v);
  return o ? o[1].charAt(0).toLowerCase() + o[1].slice(1) : v;
}

// ---------------------------------------------------------------------------- modelo de passos

function fromSpec(a) {
  const n = clone(normalizeAction(a)) || { type: "none" };
  if (n.type === "if") { n.then = (n.then || []).map(fromSpec); n.else = (n.else || []).map(fromSpec); }
  else if (n.type === "toggle") { n.on = toList(n.on); n.off = toList(n.off); }
  else if (n.type === "multi") n.actions = (n.actions || []).map(fromSpec);
  return n;
}
function toList(a) {
  const n = normalizeAction(a);
  if (!n) return [];
  return n.type === "multi" ? (n.actions || []).map(fromSpec) : [fromSpec(n)];
}
function toSpec(step) {
  const s = { ...step };
  if (s.type === "if") {
    s.then = s.then.map(toSpec); s.else = s.else.map(toSpec);
    if (!s.then.length) delete s.then;
    if (!s.else.length) delete s.else;
  } else if (s.type === "toggle") {
    const on = collapse(s.on), off = collapse(s.off);
    if (on) s.on = on; else delete s.on;
    if (off) s.off = off; else delete s.off;
  } else if (s.type === "multi") s.actions = s.actions.map(toSpec);
  return s;
}
function collapse(list) {
  const l = (list || []).map(toSpec);
  return !l.length ? null : l.length === 1 ? l[0] : { type: "multi", actions: l };
}

function buildModel() {
  const spec = S.key && pageKeys()[S.key];
  if (!spec) { S.model = null; return; }
  const m = { id: `${S.page}:${S.key}`, show: {
    action: spec.action !== undefined || (!spec.hold && !spec.release),   // tecla sem nada: começa por "Ao apertar"
    hold: !!spec.hold,
    release: !!spec.release,
  } };
  for (const f of MOMENTS) m[f] = toList(spec[f]);
  const icon = normalizeIcon(spec.icon);
  m.autoText = m.action[0] && icon.text === autoText(m.action[0]) ? icon.text : null;
  S.model = m;
}

function commitModel() {
  if (S.section === "auto") return autoCommit();
  const spec = pageKeys()[S.key];
  if (!spec || !S.model) return;
  for (const f of MOMENTS) setOrDelete(spec, f, collapse(S.model[f]));
  // repetição sem o que repetir (ou com algo que não dá para repetir) sai junto
  if (spec.repeat === "press" && !repeatable(S.model.action)) delete spec.repeat;
  if (spec.repeat === "hold" && !repeatable(S.model.hold)) delete spec.repeat;
  if (!spec.repeat) { delete spec.repeat_ms; delete spec.repeat_delay; }
  // nome automático acompanha a ação (ex.: escolheu a cena "Pausa" -> a tecla vira "Pausa")
  const first = S.model.action[0];
  if (first && S.model.autoText !== null) {
    const icon = normalizeIcon(spec.icon);
    if (icon.text === S.model.autoText || icon.text === undefined) {
      const t = autoText(first);
      if (t !== icon.text) { spec.icon = { ...icon, text: t }; const inp = $("#keyName"); if (inp) inp.value = t; }
      S.model.autoText = t;
    }
  }
  changed();
}

function newStep(type) {
  const s = { type };
  const d = actionDef(type);
  if (type === "if") return { type, value: "", op: "eq", to: true, then: [], else: [] };
  if (type === "toggle") return { type, on: [], off: [] };
  if (type === "multi") return { type, actions: [] };
  if (type === "delay") s.ms = 500;
  for (const f of (d && d.fields) || []) {
    if (f.required && f.kind === "enum" && f.options.length) s[f.name] = f.options[0][0];
    if (f.kind === "page") s[f.name] = Object.keys(pages()).find((p) => p !== S.page) || "back";
    if (f.kind === "scene" && S.obs.scenes.length) s[f.name] = S.obs.scenes[0];
  }
  return s;
}

// Atalhos gerados: F13–F24, dentro das regras do programa (rules, do plugin.json) e sem bater
// com nenhum atalho do config nem com os já escolhidos agora (taken)
async function freeBinds(count, rules = null, taken = []) {
  try { return (await api("/api/free_bind", { config: S.cfg, count, rules, taken })).combos; }
  catch (e) { toast(t("No free shortcuts left: ") + e.message, { bad: true }); return Array(count).fill(""); }
}
const rulePrograms = () => ((S.schema && S.schema.plugins) || []).filter((pl) => pl.shortcut_rules);
function bindRules(spec) {
  if (spec.type === "bind") { const pl = rulePrograms().find((x) => x.id === spec.for); return pl ? pl.shortcut_rules : null; }
  return (actionDef(spec.type) || {}).shortcut_rules || null;
}
// 'Shift+Ctrl+F13' -> 'ctrl+shift+f13' (igual ao binds.canonical do Python)
function canonCombo(c) {
  const rank = { ctrl: 0, control: 0, lctrl: 0, rctrl: 0, shift: 1, lshift: 1, rshift: 1, alt: 2, lalt: 2, ralt: 2, altgr: 2, win: 3, lwin: 3, rwin: 3 };
  const parts = String(c || "").toLowerCase().replace(/\s/g, "").split("+").filter(Boolean);
  const mods = [...new Set(parts.filter((x) => x in rank).map((x) => rank[x]))].sort();
  return [...mods.map((m) => ["ctrl", "shift", "alt", "win"][m]), ...parts.filter((x) => !(x in rank))].join("+");
}
async function fillBinds(steps) {  // dá combinações novas a todas as ações "bind" da lista
  const found = [];
  // "bind" sempre ganha uma nova (duas teclas não podem mandar a mesma); as ações com atalho
  // próprio (Discord) só quando ainda não têm, porque duas teclas de "apertar para falar" podem dividir
  const ownBind = (s) => ((actionDef(s.type) || {}).fields || []).some((f) => f.kind === "bind" && f.name === "keys");
  const walk = (s) => { if (!isObj(s)) return; if (s.type === "bind" || (ownBind(s) && !s.keys)) found.push(s);
    for (const c of [...(s.actions || []), ...(s.then || []), ...(s.else || []), ...(s.on || []), ...(s.off || [])]) walk(c); };
  steps.forEach(walk);
  const taken = [];
  for (const s of found) {                    // um por vez: cada programa tem as suas regras
    const [c] = await freeBinds(1, bindRules(s), taken);
    if (c) { s.keys = c; taken.push(c); }
  }
  return found.length;
}

// ---------------------------------------------------------------------------- histórico

function snapshot() {
  const s = JSON.stringify(S.cfg);
  if (H.stack[H.idx] === s) return;
  H.stack = H.stack.slice(0, H.idx + 1);
  H.stack.push(s);
  if (H.stack.length > 200) H.stack.shift();
  H.idx = H.stack.length - 1;
  renderTopButtons();
}
const snapshotSoon = debounce(snapshot, 350);

function travel(delta) {
  snapshot();
  const to = H.idx + delta;
  if (to < 0 || to >= H.stack.length) return;
  H.idx = to;
  S.cfg = JSON.parse(H.stack[H.idx]);
  if (!pages()[S.page]) S.page = Object.keys(pages())[0];
  S.previews = {};
  buildModel();
  renderAll();
  scheduleValidate();
}

// ---------------------------------------------------------------------------- carregar

async function load() {
  if (!TOKEN) return fatal(t("Open the editor from the Deck icon in the tray (or from the link shown in the terminal)."));
  const [cfg, schema] = await Promise.all([api("/api/config"), api("/api/schema")]);
  S.cfg = cfg.config; S.saved = JSON.stringify(S.cfg);
  const wanted = S.cfg.language || schema.default_language;
  if ((wanted === "en" || wanted === "pt-BR") && wanted !== LANG) return I18N.switchTo(wanted);
  applySchema(schema);
  setSaveState("saved");
  // a URL guarda onde a pessoa estava (ver syncHash): o F5 volta para o mesmo lugar
  const hp = new URLSearchParams(location.hash.slice(1));   // #t=..&s=keys&p=pagina&k=3&tab=look
  S.page = pages()[hp.get("p")] ? hp.get("p") : pages()[S.cfg.home] ? S.cfg.home : Object.keys(pages())[0];
  S.key = KEYS.includes(hp.get("k")) ? hp.get("k") : null;
  if (["look", "light"].includes(hp.get("tab"))) S.tab = hp.get("tab");
  if (["light", "settings", "auto"].includes(hp.get("s"))) S.section = hp.get("s");
  if (SET_SECTIONS.some(([k]) => k === hp.get("set"))) S.setSection = hp.get("set");
  if (hp.get("open") === "settings") S.section = "settings";
  if (hp.get("v") === "active") S.view = "active";
  if (hp.get("lm") === "active") S.lookMode = "active";
  if (["hold", "release"].includes(hp.get("lt"))) S.lightMoment = hp.get("lt");
  S.expanded = hp.get("x") === "1" && !!S.key;
  S.previews = {};
  H.stack = []; H.idx = -1; snapshot();
  buildModel();
  renderAll();
  refreshObs();
  pollStatus();
  refreshValues();
  scheduleValidate();        // já mostra atalhos repetidos ao abrir
  offerPending();
}
function fatal(msg) { document.body.replaceChildren(h("p", { style: "padding:48px;font-size:17px" }, msg)); }

async function refreshObs() {
  try {
    const o = await api("/api/obs");
    S.obs = { scenes: o.scenes || [], inputs: o.inputs || [], sources: o.sources || {} };
    updateDatalists();
  } catch { /* OBS é opcional */ }
}

let lastStatus = "";
async function pollStatus() {
  try { S.status = await api("/api/status"); } catch { S.status = { engine: false }; }
  const k = JSON.stringify(S.status);
  if (k !== lastStatus) {
    lastStatus = k; renderStatus(); renderPages(); if (!S.expanded) renderStageBar();
    // não redesenha com a pessoa digitando num campo da tela
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest("#settingsView input, #settingsView select");
    if (S.section === "settings" && S.setSection === "integrations" && !typing) renderSettingsView();
  }
  setTimeout(pollStatus, 2000);
}

// ---------------------------------------------------------------------------- render geral

const SECTION_TITLES = { keys: t("Keys"), light: t("Light"), auto: t("Automations"), settings: t("Settings") };
function renderSection() {
  document.body.dataset.section = S.section;
  $("#sectionTitle").textContent = SECTION_TITLES[S.section] || t("Keys");
  $("#workspace").hidden = S.section !== "keys";
  $("#lightView").hidden = S.section !== "light";
  $("#settingsView").hidden = S.section !== "settings";
  $("#autoView").hidden = S.section !== "auto";
  document.querySelectorAll(".rail-btn").forEach((b) => b.setAttribute("aria-current", b.dataset.section === S.section ? "page" : "false"));
}
document.querySelectorAll(".rail-btn").forEach((b) => b.addEventListener("click", () => { S.section = b.dataset.section; renderAll(); }));

// Escreve na URL (sem criar entrada no histórico) a seção, página, tecla e aba abertas.
function syncHash() {
  if (!S.cfg) return;
  const q = new URLSearchParams({ t: TOKEN });
  if (S.section !== "keys") q.set("s", S.section);
  if (S.section === "settings" && S.setSection && S.setSection !== "general") q.set("set", S.setSection);
  if (S.page) q.set("p", S.page);
  if (S.key) {
    q.set("k", S.key);
    if (S.tab !== "do") q.set("tab", S.tab);
    if (S.tab === "look" && S.lookMode === "active") q.set("lm", "active");
    if (S.tab === "light" && S.lightMoment !== "press") q.set("lt", S.lightMoment);
    if (S.expanded) q.set("x", "1");
  }
  if (S.view === "active") q.set("v", "active");
  const hash = "#" + q.toString();
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function renderAll() {
  renderSection();
  syncHash();
  if (S.section === "light") { renderStatus(); renderTopButtons(); renderLightView(); return; }
  if (S.section === "settings") { renderStatus(); renderTopButtons(); renderSettingsView(); return; }
  if (S.section === "auto") { renderStatus(); renderTopButtons(); renderAutomationsView(); return; }
  if (S.expanded && !(S.key && pageKeys()[S.key])) S.expanded = false;
  document.body.classList.toggle("expanded", S.expanded);
  $("#expandView").hidden = !S.expanded;
  for (const id of ["#stageTop", "#deckWrap", "#stageBar"]) $(id).hidden = S.expanded;
  renderPages(); renderStatus(); renderTopButtons(); renderLibrary(); renderKeys(); renderStageBar();
  if (S.expanded) renderExpanded(); else renderInspector();
}

function changed({ keys = true } = {}) {
  if (keys) schedulePreview();
  snapshotSoon();
  scheduleValidate();
  if (isDirty()) { setSaveState("pending"); autosave(); keepPending(); }
  else if (!saving) setSaveState("saved");   // voltou a ser igual ao salvo (ex.: desfez o erro)
  renderTopButtons();
}

function renderTopButtons() {
  $("#btnUndo").disabled = H.idx <= 0;
  $("#btnRedo").disabled = H.idx >= H.stack.length - 1;
  document.title = (S.cfg && isDirty() ? "• " : "") + "Deck";
}

// -- salvamento automático

let saveState = "saved";
function setSaveState(state) {
  saveState = state;
  const el = $("#saveState");
  const map = {
    saved: [ic("check"), t("Saved")],
    pending: [ic("refresh-cw"), "Salvando…"],
    saving: [ic("refresh-cw"), "Salvando…"],
    error: [ic("circle-alert"), t("Not saved")],
  };
  el.className = "save-state " + state;
  el.replaceChildren(...map[state].filter(Boolean));
  el.title = state === "error" ? t("Click to see what needs fixing") : state === "saved" ? t("All saved. The Deck already has this version.") : "";
}
$("#saveState").addEventListener("click", () => { if (saveState === "error") $("#problems").scrollIntoView({ behavior: "smooth", block: "center" }); });

let saving = null;
async function flushSave() {
  if (saving) await saving;
  if (!isDirty()) { setSaveState("saved"); return true; }
  const sent = JSON.stringify(S.cfg);
  setSaveState("saving");
  saving = (async () => {
    try {
      const r = await api("/api/config", { config: JSON.parse(sent) });
      if (!r.ok) { showProblems(r.errors); setSaveState("error"); return false; }
      S.saved = sent;
      if (!isDirty()) dropPending();
      showProblems([]);
      setSaveState(isDirty() ? "pending" : "saved");
      if (isDirty()) autosave();
      return true;
    } catch (e) {
      setSaveState("error");
      if (e.code === "token") toast(t("The app restarted and this tab is out of date. Reload the page: anything not saved will be recovered."),
        { bad: true, sticky: true, action: { label: t("Reload"), fn: () => location.reload() } });
      else toast(t("Error saving: ") + e.message, { bad: true });
      return false;
    } finally { saving = null; renderTopButtons(); }
  })();
  return saving;
}
const autosave = debounce(flushSave, 900);

// rede de segurança: o que ainda não foi salvo fica guardado nesta aba do navegador
const PENDING = "d6-pendente";
function keepPending() { try { localStorage.setItem(PENDING, JSON.stringify({ cfg: S.cfg, t: Date.now() })); } catch { /* sem storage */ } }
function dropPending() { try { localStorage.removeItem(PENDING); } catch { /* sem storage */ } }
function offerPending() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PENDING) || "null"); } catch { /* ignora */ }
  if (!p || !p.cfg || JSON.stringify(p.cfg) === S.saved) return dropPending();
  const when = new Date(p.t).toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
  toast(t("There are changes from {0} that were not saved.", [when]), { sticky: true, action: { label: t("Recover"), fn: () => {
    S.cfg = p.cfg; S.previews = {}; buildModel(); renderAll(); changed();
  } } });
}

function renderStatus() {
  const st = S.status, el = $("#status");
  el.replaceChildren();
  // favicon e marca do topo: tecla acesa = Deck conectado (igual ao ícone da bandeja)
  const mark = st.engine && st.device ? "favicon.svg" : "favicon-off.svg";
  const fav = $("#favicon");
  if (fav.getAttribute("href") !== mark) { fav.setAttribute("href", mark); $(".brand-mark").setAttribute("src", mark); }
  // cada parte: ícone, nome e estado; cor só quando precisa de atenção
  const item = (glyph, name, state, bad, title) =>
    h("span", { class: "stat" + (bad ? " bad" : ""), title }, ic(glyph), h("b", {}, name), h("span", { class: "st" }, state));
  if (!st.engine) return el.append(item("usb", "Deck", t("app closed"), true, t("The Deck app is not running: you can edit, but the Deck won't update.")));
  el.append(item("usb", "Deck", st.device ? t("connected") : t("disconnected"), !st.device, st.device ? t("The Deck is connected.") : t("Check the Deck USB cable.")));
  if (S.cfg && isObj(S.cfg.obs) && S.cfg.obs.enabled !== false) {
    el.append(item("radio", "OBS", st.obs ? t("connected") : t("closed"), false, st.obs ? t("Connected to OBS.") : t("The app connects on its own when OBS opens.")));
  }
}

let renaming = null;   // página com a aba virando campo de texto

function renderPages() {
  const el = $("#pages");
  el.replaceChildren();
  for (const name of Object.keys(pages())) {
    if (renaming === name) {
      const input = h("input", { class: "page-rename", type: "text", value: name, "aria-label": t("New page name"),
        size: Math.max(4, name.length + 1) });
      let done = false;
      const finish = (ok) => { if (done) return; done = true; renaming = null; if (ok) renamePage(input.value.trim()); else renderPages(); };
      input.addEventListener("input", () => { input.size = Math.max(4, input.value.length + 1); });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
      input.addEventListener("blur", () => finish(true));
      el.append(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
      continue;
    }
    const b = h("button", { class: "page-tab", "data-page": name, "aria-current": name === S.page ? "true" : "false",
      title: (name === S.cfg.home ? t("Home page. ") : "") + t("Double-click to rename"),
      onclick: () => { if (S.page === name) return; S.page = name; S.key = null; buildModel(); renderAll(); },
      ondblclick: () => { startRename(name); } },
      name);
    b.addEventListener("dragover", (e) => { if (dragKey && name !== S.page) { e.preventDefault(); b.classList.add("drop-target"); } });
    b.addEventListener("dragleave", () => b.classList.remove("drop-target"));
    b.addEventListener("drop", (e) => { e.preventDefault(); b.classList.remove("drop-target"); moveKeyToPage(dragKey, name); });
    el.append(b);
  }
  el.append(
    h("button", { class: "page-tab page-more", hidden: true, title: t("Other pages"), "aria-haspopup": "menu",
      onclick: (e) => { e.stopPropagation(); $("#pagesMenu") ? closePagesMenu() : openPagesMenu(e.currentTarget); },
      ondragenter: (e) => { if (dragKey && !$("#pagesMenu")) openPagesMenu(e.currentTarget); } },
      h("span", { class: "n" }), ic("chevron-down")),
    h("button", { class: "page-tab add", onclick: addPage, title: t("Create page") }, ic("plus"), t("Page")));
  requestAnimationFrame(fitPages);
}

// mostra as abas que cabem; as demais vão para o menu "+N" (a página aberta fica sempre visível)
function fitPages() {
  const el = $("#pages");
  const tabs = [...el.querySelectorAll(".page-tab[data-page]")];
  const more = el.querySelector(".page-more"), add = el.querySelector(".page-tab.add");
  if (!more || !add) return;
  tabs.forEach((t) => (t.hidden = false));
  more.hidden = true;
  const gap = 2, width = (t) => t.offsetWidth + gap;
  const avail = el.parentElement.clientWidth - $("#viewToggle").offsetWidth - 12 - 8;
  if (tabs.reduce((w, t) => w + width(t), 0) + width(add) <= avail) return;
  more.hidden = false;
  more.querySelector(".n").textContent = "+00";       // reserva espaço para o número
  const room = avail - width(add) - width(more);
  const visible = [];
  let used = 0;
  for (const t of tabs) { if (used + width(t) > room) break; used += width(t); visible.push(t); }
  const cur = tabs.find((t) => t.dataset.page === S.page);
  if (cur && !visible.includes(cur)) {
    while (visible.length && used + width(cur) > room) used -= width(visible.pop());
    visible.push(cur);
  }
  const rest = tabs.filter((t) => !visible.includes(t));
  rest.forEach((t) => (t.hidden = true));
  more.querySelector(".n").textContent = `+${rest.length}`;
  more.dataset.pages = JSON.stringify(rest.map((t) => t.dataset.page));
}
window.addEventListener("resize", debounce(fitPages, 80));

function openPagesMenu(btn) {
  closePagesMenu();
  const names = JSON.parse(btn.dataset.pages || "[]");
  const r = btn.getBoundingClientRect();
  const menu = h("div", { class: "menu", id: "pagesMenu", role: "menu", style: { left: `${r.left}px`, top: `${r.bottom + 6}px` } },
    ...names.map((name) => {
      const item = h("button", { role: "menuitem", class: "menu-item", onclick: () => { closePagesMenu(); S.page = name; S.key = null; buildModel(); renderAll(); } },
        h("span", { class: "grow" }, name));
      item.addEventListener("dragover", (e) => { if (dragKey) e.preventDefault(); });
      item.addEventListener("drop", (e) => { e.preventDefault(); closePagesMenu(); moveKeyToPage(dragKey, name); });
      return item;
    }));
  document.body.append(menu);
  setTimeout(() => document.addEventListener("click", closePagesMenu, { once: true }), 0);
}
function closePagesMenu() { const m = $("#pagesMenu"); if (m) m.remove(); }

function startRename(name) {
  if (S.page !== name) { S.page = name; S.key = null; buildModel(); renderAll(); }
  renaming = name;
  renderPages();
}

function renderViewToggle() {
  syncHash();
  $("#viewToggle").replaceChildren(h("div", { class: "segmented", role: "group", "aria-label": t("Show keys") },
    ...[["normal", t("Normal")], ["active", t("Active")]].map(([v, l]) => h("button", {
      "aria-pressed": S.view === v ? "true" : "false",
      title: v === "active" ? t("How keys look when active (recording, scene on air…)") : t("How keys look normally"),
      onclick: () => { S.view = v; renderViewToggle(); paintKeyImages(); } }, l))));
}

// ---------------------------------------------------------------------------- biblioteca

function groupedActions(filter) {
  const nq = norm(filter);
  const groups = {};
  for (const [type, d] of Object.entries(S.schema.actions)) {
    if (type === "multi" || type === "none") continue;   // sequência = adicionar passos; nada = esvaziar
    if (nq && ![d.label, type, d.group, d.help].some((t) => norm(t).includes(nq))) continue;
    (groups[d.group || "Other"] ||= []).push([type, d]);
  }
  return GROUP_ORDER.filter((gname) => groups[gname]).map((gname) => [gname, groups[gname]]);
}

const LIB_OPEN = "d6-lib-open";
let libOpen = (() => { try { return new Set(JSON.parse(localStorage.getItem(LIB_OPEN)) || ["Keyboard and text"]); } catch { return new Set(["Keyboard and text"]); } })();
function toggleLibGroup(gname) {
  if (libOpen.has(gname)) libOpen.delete(gname); else libOpen.add(gname);
  try { localStorage.setItem(LIB_OPEN, JSON.stringify([...libOpen])); } catch { /* sem storage */ }
  renderLibrary();
}

function renderLibrary() {
  const list = $("#libList");
  const query = $("#libSearch").value;
  const groups = groupedActions(query);
  list.replaceChildren(...groups.map(([gname, items]) => {
    const open = !!query || libOpen.has(gname);          // buscando: tudo aberto
    const head = h("button", { class: "lib-head", "aria-expanded": open ? "true" : "false", onclick: () => toggleLibGroup(gname) },
      h("i", { class: "lib-dot", "aria-hidden": "true" }), h("span", { class: "grow" }, t(gname)),
      h("span", { class: "lib-count" }, String(items.length)), ic("chevron-right"));
    const sec = h("section", { class: "lib-group", style: { "--cat": GROUPS[gname].color } }, head);
    if (open) sec.append(...items.map(([type, d]) => {
      const item = h("button", { class: "lib-item", draggable: "true", title: d.help || d.label, style: catStyle(type),
        onclick: () => {
          if (!S.key) return toast(t("Click a key first, or drag the action onto it."));
          if (S.expanded) return insertStep(S.model.action, S.model.action.length, type);
          assignAction(S.key, type);
          document.body.classList.remove("lib-open");
        } }, h("span", { class: "chip" }, actionIc(type)), h("span", { class: "label" }, d.label));
      item.addEventListener("dragstart", (e) => {
        S.drag = { kind: "new", type, cols: 1, rows: 1, label: d.label };
        e.dataTransfer.setData("text/plain", type);
        e.dataTransfer.effectAllowed = "copy";
        if (S.section === "keys" && !S.expanded) {           // na grade, a peça tem o tamanho da tecla
          const icon = autoIcon(newStep(type));
          const g = dragGhost(1, 1, [ghostCell([h("span", { class: "lu-ch" }, luChar(icon.lucide || iconOf(type))), h("small", {}, icon.text || d.label)], icon.bg)]);
          const m = keyMetrics();
          e.dataTransfer.setDragImage(g, m.size / 2, m.size / 2);
        }
      });
      item.addEventListener("dragend", () => { S.drag = null; clearDropMarks(); endFoot(); });
      return item;
    }));
    return sec;
  }));
  // "Mostrar informação" (painéis em peças de cada tamanho) antes de Páginas e lógica; guardadas no fim
  const [info, saved] = [infoLibraryGroups(query), null];
  const logic = [...list.children].find((sec) => sec.querySelector(".lib-head .grow") && sec.querySelector(".lib-head .grow").textContent === t("Pages and logic"));
  for (const sec of info) {
    if (sec.querySelector(".lib-head .grow").textContent === t("Saved keys")) list.append(sec);
    else list.insertBefore(sec, logic || null);
  }
  if (!groups.length && !info.length) list.append(h("p", { class: "fine", style: { padding: "0 8px" } }, t("No actions found.")));
}
$("#libSearch").addEventListener("input", renderLibrary);
$("#libToggle").addEventListener("click", () => document.body.classList.toggle("lib-open"));

// ---------------------------------------------------------------------------- o aparelho

let dragKey = null;

function renderKeys() {
  const grid = $("#keys");
  grid.replaceChildren();
  const keys = pageKeys();
  const prev = S.previews[S.page] || [];
  const cov = coverMap();
  KEYS.forEach((k, i) => {
    if (cov[k]) return;                                    // dentro de um bloco: a tecla do canto desenha
    const spec = keys[k], p = prev[i];
    const [cols, rows] = spanOf(spec);
    const src = p && (S.view === "active" && p.active ? p.active : p.normal);
    const [c0, r0] = kpos(k);
    const el = h("button", {
      class: "key" + (spec ? "" : " empty") + (cols * rows > 1 ? " block" : ""), role: "gridcell", "data-key": k,
      style: { gridColumn: `${c0 + 1} / span ${cols}`, gridRow: `${r0 + 1} / span ${rows}`, "--bc": cols, "--br": rows },
      "aria-selected": S.key === k ? "true" : "false",
      "aria-label": spec ? t("Key {0}: {1}", [k, summarize(spec.action)]) : t("Key {0}, empty", [k]),
      title: spec ? summarize(spec.action) : t("Empty key: drag an action here"),
      draggable: spec ? "true" : null,
      onclick: (e) => { if (e.shiftKey) return toggleMulti(k); if (S.multi && S.multi.size) { S.multi = new Set(); renderJoinBar(); markMulti(); } selectKey(k); },
    }, ...(cols * rows > 1 ? Array.from({ length: cols * rows }, (_, j) => h("span", { class: "cellbox" }, p && p.cells && p.cells[j] ? h("img", { src: p.cells[j], alt: "" }) : null))
      : [spec && src ? h("img", { src, alt: "" }) : null]));
    el.addEventListener("dragstart", (e) => { dragKey = k; e.dataTransfer.setData("text/plain", "key"); e.dataTransfer.effectAllowed = "move"; });
    el.addEventListener("dragend", () => { dragKey = null; });
    el.addEventListener("dragover", (e) => {
      const files = [...e.dataTransfer.types].includes("Files");
      if (S.drag && (S.drag.kind === "piece" || S.drag.kind === "saved" || S.drag.kind === "new")) {
        e.preventDefault();
        const d = S.drag.kind === "new" ? Object.assign(S.drag, { cols: 1, rows: 1 }) : S.drag;
        const target = d.cols * d.rows > 1 ? cellUnder(e, k) : k;
        if (S.drag.lastOver !== target) { S.drag.lastOver = target; pieceOver(target); }
        return;
      }
      if ((dragKey && dragKey !== k) || files) { e.preventDefault(); el.classList.add("drop"); }
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drop");
      if (S.drag && (S.drag.kind === "piece" || S.drag.kind === "saved")) return pieceDrop(S.drag.lastOver || k);
      if (S.drag && S.drag.kind === "new") { const at = S.drag.lastOver || k; endFoot(); return assignAction(at, S.drag.type); }
      if (dragKey) return swapKeys(dragKey, k);
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith("image/")) uploadImage(f, (path) => setKeyImage(k, path));
    });
    grid.append(el);
  });
  markMulti();
  if (!S.previews[S.page]) updatePreviews();
}

// a tecla debaixo do cursor dentro de um bloco (para a peça encaixar onde o mouse está)
function cellUnder(e, k) {
  const el = document.querySelector(`#keys .key[data-key="${k}"]`);
  const [cols, rows] = spanOf(pageKeys()[k]);
  if (!el || cols * rows === 1) return k;
  const r = el.getBoundingClientRect();
  const c = Math.min(cols - 1, Math.floor((e.clientX - r.left) / (r.width / cols)));
  const rr = Math.min(rows - 1, Math.floor((e.clientY - r.top) / (r.height / rows)));
  const [c0, r0] = kpos(k);
  return kat(c0 + c, r0 + rr);
}

function selectKey(k, focus = false) {
  S.key = k; S.lookMode = "normal";
  buildModel();
  document.querySelectorAll(".key").forEach((el) => el.setAttribute("aria-selected", el.dataset.key === k ? "true" : "false"));
  const el = document.querySelector(`.key[data-key="${k}"]`);
  if (el) { el.classList.add("pressed"); setTimeout(() => el.classList.remove("pressed"), 110); if (focus) el.focus(); }
  renderInspector();
}

async function assignAction(k, type) {
  const keys = pageKeys();
  const old = keys[k];
  const step = newStep(type);
  await fillBinds([step]);
  if (!old) {
    keys[k] = { icon: autoIcon(step), action: toSpec(step) };
    const act = autoActive(step);
    if (act) keys[k].active_icon = act;
  } else {
    const oldFirst = toList(old.action)[0];
    const icon = normalizeIcon(old.icon);
    const wasAuto = !oldFirst || icon.text === autoText(oldFirst) || !icon.text;
    old.action = toSpec(step);
    if (wasAuto) {
      old.icon = { ...icon, ...autoIcon(step) };
      delete old.icon.glyph;                       // o ícone automático é do Lucide; tira o Segoe antigo
      const act = autoActive(step);
      if (act) old.active_icon = act; else delete old.active_icon;
    }
  }
  S.previews[S.page] = null;
  S.key = k; S.tab = "do";
  buildModel();
  changed();
  renderKeys(); renderInspector();
  const label = actionDef(type) ? actionDef(type).label : type;
  toast(old ? t("Key {0} now does: {1}.", [k, label]) : t("Key {0} created: {1}.", [k, label]), { undo: true });
}

function swapKeys(a, b) {
  if (!a || a === b) return;
  const keys = pageKeys();
  const va = keys[a], vb = keys[b];
  if (vb === undefined) delete keys[a]; else keys[a] = vb;
  keys[b] = va;
  if (S.key === a) S.key = b; else if (S.key === b) S.key = a;
  S.previews[S.page] = null;
  buildModel();
  changed(); renderKeys(); renderInspector();
}

function moveKeyToPage(fromKey, target) {
  if (!fromKey) return;
  const dst = pageKeys(target);
  const free = KEYS.find((k) => !dst[k]);
  if (!free) return toast(t("Page {0} is full.", [target]), { bad: true });
  dst[free] = pageKeys()[fromKey];
  delete pageKeys()[fromKey];
  S.key = null; S.previews[S.page] = null; S.previews[target] = null;
  buildModel();
  changed(); renderKeys(); renderInspector();
  toast(t("Key moved to page {0}.", [target]), { undo: true });
}

function setKeyImage(k, path) {
  const keys = pageKeys();
  if (!keys[k]) keys[k] = { icon: { image: path, bg: "#000000" } };
  else keys[k].icon = { ...normalizeIcon(keys[k].icon), image: path };
  S.previews[S.page] = null;
  S.key = k; buildModel();
  changed(); renderKeys(); renderInspector();
  toast(t("Image applied to the key."), { undo: true });
}

function renderStageBar() {
  const el = $("#stageBar");
  const onDeck = S.status.engine && S.status.page === S.page;
  const isHome = S.cfg.home === S.page;
  el.replaceChildren(...[
    onDeck
      ? h("span", { class: "page-fact" }, ic("monitor-check"), t("Showing on the Deck"))
      : h("button", { class: "btn small ghost", onclick: showPageOnDeck, title: t("Show this page on the Deck") }, ic("monitor-up"), t("Show on Deck")),
    isHome
      ? h("span", { class: "page-fact" }, ic("house"), t("Home page"))
      : h("button", { class: "btn small ghost", onclick: () => { S.cfg.home = S.page; changed({ keys: false }); renderPages(); renderStageBar(); } }, ic("house"), t("Set as home")),
    h("span", { class: "grow" }),
    h("button", { class: "btn small ghost", onclick: () => startRename(S.page) }, ic("pencil"), t("Rename")),
    Object.keys(pages()).length > 1 ? h("button", { class: "btn small ghost danger", onclick: deletePage }, ic("trash-2"), t("Delete page")) : null,
  ].filter(Boolean));
  renderViewToggle();
}

// ---------------------------------------------------------------------------- prévias e validação

let previewSeq = 0;
async function updatePreviews(page = S.page) {
  const keys = pageKeys(page);
  const seq = ++previewSeq;
  const list = KEYS.map((k) => {
    const s = keys[k];
    return s ? { icon: normalizeIcon(s.icon), active_icon: s.active_icon ? normalizeIcon(s.active_icon) : null,
      action: s.action ?? null, state: s.state || null, span: s.span || null, cells: s.cells || null, mode: s.mode || null } : null;
  });
  try {
    const r = await api("/api/preview", { keys: list, icons: isObj(S.cfg.icons) ? S.cfg.icons : null, device: S.cfg.device || null });
    if (seq !== previewSeq) return;
    S.previews[page] = r.images;
    if (page === S.page) { paintKeyImages(); paintInspectorImages(); }
  } catch (e) { toast(t("Error generating the preview: ") + e.message, { bad: true }); }
}
const schedulePreview = debounce(() => updatePreviews(), 140);

function paintKeyImages() {
  const prev = S.previews[S.page] || [];
  document.querySelectorAll("#keys .key").forEach((el) => {
    const p = prev[Number(el.dataset.key) - 1];
    if (el.classList.contains("block")) {                    // bloco: uma imagem por tecla
      const imgs = (p && p.cells) || [];
      el.querySelectorAll(".cellbox").forEach((box, j) => box.replaceChildren(...(imgs[j] ? [h("img", { src: imgs[j], alt: "" })] : [])));
      return;
    }
    let img = el.querySelector("img");
    if (!p) { if (img) img.remove(); el.classList.add("empty"); return; }
    if (!img) { img = h("img", { alt: "" }); el.append(img); }
    img.src = S.view === "active" && p.active ? p.active : p.normal;
    el.classList.remove("empty");
  });
}

const scheduleValidate = debounce(async () => {
  let r;
  try { r = await api("/api/validate", { config: S.cfg }); } catch { return; }
  const first = S.conflicts === undefined;      // ao abrir: só mostra, sem o aviso de "agora"
  const before = JSON.stringify(S.conflicts || []);
  S.conflicts = r.conflicts || [];
  showProblems(r.ok ? [] : r.errors);
  if (JSON.stringify(S.conflicts) !== before) {
    // os avisos aparecem ao lado dos campos de atalho; sem atrapalhar quem está digitando
    const typing = document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
    if (!typing) {
      if (S.section === "keys") renderInspector();
      else if (S.section === "settings" && S.setSection === "integrations") renderSettingsView();
    }
    if (!first && S.conflicts.length > JSON.parse(before).length) toast(t("Two different things now use the same shortcut. See the warning below the shortcut."), { bad: true });
  }
}, 400);

// "página main, tecla 3 (Apertar para falar)" ou "Discord › Mutar microfone"
function placeText(p) {
  if (p.plugin) {
    const pl = ((S.schema && S.schema.plugins) || []).find((x) => x.id === p.plugin);
    const st = pl && (pl.settings || []).find((x) => x.name === p.setting);
    return `${pl ? pl.name : p.plugin} › ${st ? st.label : p.setting}`;
  }
  const d = actionDef(p.type);
  return t("page {0}, key {1} ({2})", [p.page, p.key, d ? d.label : p.type]);
}
function conflictNote(combo, isSelf) {
  const c = (S.conflicts || []).find((x) => x.combo === canonCombo(combo));
  if (!c) return null;
  const others = c.places.filter((pl) => !isSelf(pl));
  if (!others.length) return null;
  return h("div", { class: "note-box bad short-warn" }, ic("triangle-alert"),
    h("span", {}, t("This shortcut is also used in {0}. Click ↻ to make another, so each one does only one thing.", [others.map(placeText).join("; ")])));
}

function showProblems(errors) {
  const el = $("#problems");
  const dup = S.conflicts || [];
  if (!errors.length && !dup.length) { el.hidden = true; return; }
  el.hidden = false;
  el.replaceChildren(
    ...(errors.length ? [h("p", {}, t("Fix before saving:")), h("ul", {}, errors.map((e) => h("li", {}, friendlyError(e))))] : []),
    ...(dup.length ? [h("p", {}, t("Repeated shortcuts (saving still works):")),
      h("ul", {}, dup.map((c) => h("li", {}, `${c.combo}: ${c.places.map(placeText).join("; ")}`)))] : []));
}

function friendlyError(e) {
  const labels = (S.schema && S.schema.field_labels) || {};
  return e
    .replace(/^pages\.([^.]+)\.(\d+)(\.(action|hold|release))?[^:]*:\s*/, (_, p, k, _2, w) =>
      (w === "hold" ? t("Page {0}, key {1} (on hold): ", [p, k]) : w === "release" ? t("Page {0}, key {1} (on release): ", [p, k]) : t("Page {0}, key {1}: ", [p, k])))
    .replace(/ação '[^']+' precisa do campo '(\w+)'/, (_, f) => t("fill in \"{0}\"", [labels[f] || f]))
    .replace(/ação 'page' aponta para '([^']+)', que não existe/, t("goes to page \"$1\", which doesn't exist"))
    .replace(/tipo de ação desconhecido '([^']+)'.*/, t("unknown action \"$1\""))
    .replace(/^home: página '([^']+)' não existe/, t("The home page \"$1\" doesn't exist"));
}

// ---------------------------------------------------------------------------- inspetor

function renderInspector() {
  syncHash();
  if (S.expanded) return renderExpanded();
  const el = $("#inspector");
  const keepScroll = el.scrollTop;
  el.replaceChildren();
  requestAnimationFrame(() => { el.scrollTop = keepScroll; });
  if (S.key === null) return renderGuide(el);
  const spec = pageKeys()[S.key];
  if (!spec) return renderEmptyKey(el);
  if (!S.model || S.model.id !== `${S.page}:${S.key}`) buildModel();

  const icon = normalizeIcon(spec.icon);
  const name = h("input", { id: "keyName", type: "text", value: (icon.text || "").replace(/\n/g, " "), placeholder: t("Unnamed"),
    "aria-label": t("Key name"),
    oninput: (e) => { spec.icon = { ...normalizeIcon(spec.icon), text: e.target.value || undefined }; if (!e.target.value) delete spec.icon.text;
      if (S.model) S.model.autoText = null; changed(); } });
  // tecla de informação: o texto tem valores; o título vira o nome do formato (editar o texto é na Aparência)
  const infoTitle = isInfoKey(spec) && spanOf(spec)[0] * spanOf(spec)[1] === 1
    ? h("span", { class: "insp-static", id: "keyName" }, (panelDefs()[spec.format] || {}).label || t("Information")) : null;
  const [bc, br] = spanOf(spec);
  el.append(h("div", { class: "insp-head" },
    h("img", { class: "insp-thumb", id: "inspThumb", alt: "" }),
    h("div", { class: "insp-title" }, infoTitle || name,
      h("small", {}, bc * br > 1 ? t("Block {0} from key {1}, page {2}", [`${br}×${bc}`, S.key, S.page]) : t("Key {0}, page {1}", [S.key, S.page]))),
    h("div", { class: "insp-tools" },
      ...keyTools())));
  el.append(h("div", { class: "tabs", role: "tablist" },
    ...[["do", t("What it does")], ["look", t("Appearance")], ["light", t("Light")]].map(([v, l]) =>
      h("button", { role: "tab", "aria-selected": S.tab === v ? "true" : "false", onclick: () => { S.tab = v; renderInspector(); } }, l)),
    h("span", { class: "grow" }),
    S.tab === "do" ? h("button", { class: "icon-btn expand-btn", title: t("Open the logic in a larger area"), "aria-label": t("Expand"),
      onclick: () => { S.expanded = true; S.tab = "do"; renderAll(); } }, ic("maximize-2")) : null));
  const block = spanOf(spec)[0] * spanOf(spec)[1] > 1;
  el.append(S.tab === "do" ? doTab(spec) : S.tab === "light" ? lightTab(spec)
    : block ? blockLook(spec) : isInfoKey(spec) ? infoLook(spec) : lookTab(spec));
  paintInspectorImages();
}

function keyTools() {
  return [
    h("button", { class: "icon-btn", title: t("Test (runs the saved version)"), "aria-label": t("Test"), onclick: testKey }, ic("play")),
    h("button", { class: "icon-btn", title: t("Copy (Ctrl+C)"), "aria-label": t("Copy"), onclick: copyKey }, ic("copy")),
    h("button", { class: "icon-btn", title: t("Save to use later (Saved keys)"), "aria-label": t("Save key"), onclick: saveCurrentKey }, ic("bookmark-plus")),
    h("button", { class: "icon-btn", title: t("Paste (Ctrl+V)"), "aria-label": t("Paste"), onclick: pasteKey, disabled: !S.clipboard }, ic("clipboard-paste")),
    h("button", { class: "icon-btn", title: t("Delete key (Delete)"), "aria-label": t("Delete key"), onclick: clearKey }, ic("trash-2")),
  ];
}

function paintInspectorImages() {
  const p = S.key && (S.previews[S.page] || [])[Number(S.key) - 1];
  const thumb = $("#inspThumb");
  const big = $("#lookImg");
  if (p && p.cells) {                                   // bloco: a miniatura é a 1ª tecla; a prévia, a tecla em edição
    if (thumb) thumb.src = p.cells[0] || "";
    if (big) big.src = p.cells[Math.min(S.cellIdx || 0, p.cells.length - 1)] || "";
    return;
  }
  if (thumb && p) thumb.src = p.normal;
  if (big && p) big.src = S.lookMode === "active" && p.active ? p.active : p.normal;
}

function renderGuide(el) {
  el.append(h("div", { class: "empty" },
    h("h2", {}, t("How to set up your Deck")),
    h("div", { class: "howto" },
      h("div", {}, h("span", { class: "chip lg" }, ic("mouse-pointer-2")), h("p", {}, h("b", {}, t("1. Drag an action onto a key")),
        h("span", {}, t("The list is on the left. The key gets a name and icon on its own.")))),
      h("div", {}, h("span", { class: "chip lg" }, ic("pencil")), h("p", {}, h("b", {}, t("2. Click the key to adjust it")),
        h("span", {}, t("Change the name, color, icon and what it does.")))),
      h("div", {}, h("span", { class: "chip lg" }, ic("check")), h("p", {}, h("b", {}, t("3. Done")),
        h("span", {}, t("Everything saves on its own, and the Deck updates right away.")))),
      h("div", {}, h("span", { class: "chip lg" }, ic("list-ordered")), h("p", {}, h("b", {}, t("Want more?")),
        h("span", {}, t("A key can do several things in sequence, or choose between two with the \"If… then… else\" block. All inside \"What it does\".")))))));
}

function renderEmptyKey(el) {
  el.append(h("div", { class: "empty" },
    h("h2", {}, t("Key {0} is empty", [S.key])),
    h("p", {}, t("Drag an action from the list onto it, or pick one of these:")),
    h("div", { class: "quick" },
      ...QUICK.filter(actionDef).map((type) => h("button", { style: catStyle(type), onclick: () => assignAction(S.key, type) },
        h("span", { class: "chip" }, actionIc(type)), actionDef(type).label)),
      h("button", { onclick: () => openActionPicker(null, (t) => t && assignAction(S.key, t)) },
        h("span", { class: "chip", style: { "--cat": "#868d99" } }, ic("layout-grid")), t("See all"))),
    S.clipboard ? h("button", { class: "btn small", style: { marginTop: "14px" }, onclick: pasteKey }, ic("clipboard-paste"), t("Paste the copied key")) : null));
}

// -- aba "O que faz" (a mesma no inspetor e no modo expandido)

// Ações que fazem sentido repetir enquanto a tecla está segura (volume, avançar faixa, atalho de
// teclado). Repetir "Gravar" ou "Mutar" ligaria e desligaria sem parar, então a opção nem aparece.
const REPEAT_MEDIA = ["vol_up", "vol_down", "next", "prev"];
function repeatable(list) {
  return list.length > 0 && list.every((s) => {
    const a = normalizeAction(s);
    if (!a) return false;
    if (a.type === "hotkey") return true;
    if (a.type === "media") return REPEAT_MEDIA.includes(a.key);
    return !!(actionDef(a.type) || {}).repeatable;          // plugins marcam no plugin.json
  });
}
function msInput(spec, field, placeholder, label) {
  return h("input", { class: "inl num", type: "number", value: spec[field] ?? "", placeholder, "aria-label": label,
    oninput: (e) => { setOrDelete(spec, field, e.target.value === "" ? null : Number(e.target.value)); changed({ keys: false }); } });
}
// "Repetir enquanto segurar": no "ao apertar" (começa depois de X ms) ou no "ao segurar"
function repeatRow(spec, which) {
  const on = spec.repeat === which;
  const cb = h("input", { type: "checkbox", onchange: () => {
    if (cb.checked) spec.repeat = which; else { delete spec.repeat; delete spec.repeat_ms; delete spec.repeat_delay; }
    changed({ keys: false }); rerenderLogic();
  } });
  cb.checked = on;
  const row = h("div", { class: "mrepeat" }, h("label", { class: "check" }, cb, t("Repeat while held")));
  if (on) {
    if (which === "press") row.append(h("span", { class: "msub" }, t("starts after")), msInput(spec, "repeat_delay", "400", t("Milliseconds")), h("span", { class: "msub" }, "ms,"));
    row.append(h("span", { class: "msub" }, t("every")), msInput(spec, "repeat_ms", "80", t("Milliseconds")), h("span", { class: "msub" }, "ms"));
  }
  return row;
}

function doTab(spec, opts = {}) {
  const body = h("div", { class: "insp-body logic" + (opts.wide ? " wide" : "") });
  const m = S.model;
  // os momentos são independentes: qualquer um pode ficar vazio
  const NAMES = { action: t("On press"), double: t("On double tap"), hold: t("On hold"), release: t("On release") };
  const pressRepeats = spec.repeat === "press";
  const doubleMs = (S.cfg && S.cfg.double_tap_ms) || 250;
  for (const id of MOMENTS) {
    const list = m[id];
    const head = [h("span", { class: "mtitle" + (list.length ? "" : " off") }, NAMES[id])];
    if (id === "action" && m.double.length) head.push(h("span", { class: "msub" }, t("single tap")));
    else if (id === "action" && m.hold.length) head.push(h("span", { class: "msub" }, t("quick tap")));
    if (id === "hold" && list.length) {
      const ms = h("input", { class: "inl num", type: "number", value: spec.hold_ms ?? "", placeholder: "500", "aria-label": t("Milliseconds"),
        oninput: (e) => { setOrDelete(spec, "hold_ms", e.target.value === "" ? null : Number(e.target.value)); changed({ keys: false }); } });
      head.push(h("span", { class: "msub" }, t("for")), ms, h("span", { class: "msub" }, "ms"));
    }
    head.push(h("span", { class: "grow" }),
      h("button", { class: "icon-btn small", title: t("Add step"), "aria-label": t("Add step to \"{0}\"", [NAMES[id].toLowerCase()]),
        onclick: () => pickAndInsert(list, list.length) }, ic("plus")),
      h("button", { class: "icon-btn small", title: list.length ? t("Remove everything in this moment") : t("Nothing to remove"),
        "aria-label": t("Remove \"{0}\"", [NAMES[id].toLowerCase()]), disabled: !list.length,
        onclick: () => { m[id] = []; if (id === "hold") delete spec.hold_ms; commitModel(); rerenderLogic(); } }, ic("trash-2")));
    // com "ao apertar" repetindo, segurar significa repetir: toque duplo e "ao segurar" ficam sem uso
    const unused = pressRepeats && (id === "double" || id === "hold");
    const extra = [];
    if (id === "action" && repeatable(list)) extra.push(repeatRow(spec, "press"));
    if (id === "hold" && !pressRepeats && repeatable(list)) extra.push(repeatRow(spec, "hold"));
    if (unused && list.length) extra.push(h("p", { class: "mnote" }, t("Not used: with “Repeat while held” on in On press, holding the key repeats it.")));
    else if (id === "double" && list.length)
      extra.push(h("p", { class: "mnote" }, t("To tell one tap from two, the keys of this page wait {0} ms before running “On press”. The light reacts right away.", [doubleMs])));
    body.append(h("section", { class: "moment" + (unused ? " unused" : "") }, h("div", { class: "mhead" }, ...head), ...extra, renderFlow(list, { top: true })));
  }
  return body;
}

function rerenderLogic() { if (S.section === "auto") renderAutomationsView(); else if (S.expanded) renderExpanded(); else renderInspector(); }

// -- lista de blocos

function renderFlow(list, opts = {}) {
  const wrap = h("div", { class: "flow" });
  if (!list.length) {
    // vazio: um aviso que também recebe a ação arrastada (e abre a lista ao clicar)
    const empty = h("button", { class: "empty-row" + (opts.top ? "" : " small"), onclick: () => pickAndInsert(list, 0) },
      opts.top ? t("No steps. Drag an action here.") : t("Empty. Drag an action here."));
    dropTarget(empty, list, () => 0);
    wrap.append(empty);
    return wrap;
  }
  list.forEach((step, i) => wrap.append(slot(list, i), block(list, i)));
  wrap.append(slot(list, list.length));
  return wrap;
}

function slot(list, index) {
  const el = h("div", { class: "slot" });
  dropTarget(el, list, () => index);
  return el;
}

function dropTarget(el, list, indexFn) {
  el.addEventListener("dragover", (e) => { if (!S.drag) return; e.preventDefault(); el.classList.add("active"); });
  el.addEventListener("dragleave", () => el.classList.remove("active"));
  el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("active"); handleFlowDrop(list, indexFn()); });
}
function clearDropMarks() { document.querySelectorAll(".slot.active, .empty-row.active").forEach((x) => x.classList.remove("active")); }

function containsList(step, list) {
  if (!isObj(step)) return false;
  for (const l of [step.actions, step.then, step.else, step.on, step.off]) {
    if (!l) continue;
    if (l === list) return true;
    if (l.some((s) => containsList(s, list))) return true;
  }
  return false;
}

async function handleFlowDrop(list, index) {
  const d = S.drag;
  S.drag = null;
  if (!d) return;
  if (d.kind === "new") return insertStep(list, index, d.type);
  const step = d.list[d.index];
  if (step === undefined) return;
  if (containsList(step, list)) return toast(t("A block can't go inside itself."), { bad: true });
  d.list.splice(d.index, 1);
  if (d.list === list && d.index < index) index--;
  list.splice(index, 0, step);
  commitModel();
  rerenderLogic();
}

function pickAndInsert(list, index) { openActionPicker(null, (t) => t && insertStep(list, index, t), false); }

async function insertStep(list, index, type) {
  const step = newStep(type);
  await fillBinds([step]);
  list.splice(index, 0, step);
  commitModel();
  rerenderLogic();
}

const openMore = new WeakSet();   // blocos com o "⋯" (mais opções) aberto

function grip(list, i, el) {
  const handle = h("span", { class: "grip", draggable: "true", title: t("Drag to reorder") }, ic("grip-vertical"));
  handle.addEventListener("dragstart", (e) => {
    S.drag = { kind: "move", list, index: i };
    e.dataTransfer.setData("text/plain", "step");
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => el.classList.add("dragging"), 0);
  });
  handle.addEventListener("dragend", () => { el.classList.remove("dragging"); S.drag = null; clearDropMarks(); });
  return handle;
}

function removeBtn(list, i) {
  return h("button", { class: "blk-btn", title: t("Remove step"), "aria-label": t("Remove step"),
    onclick: () => { list.splice(i, 1); commitModel(); rerenderLogic(); } }, ic("x"));
}

function block(list, i) {
  const step = list[i];
  if (step.type === "if" || step.type === "toggle" || step.type === "multi") return cBlock(list, i);
  const el = h("div", { class: "blk" + (groupOf(step.type) === GROUPS["Pages and logic"] ? " neutral" : ""), "data-m": M.id(step), style: { "--cat": groupOf(step.type).color } });
  const ed = () => commitModel();
  const d = actionDef(step.type);
  const extras = d && d.fields !== null ? (d.fields || []).filter((f) => !(SENTENCE_FIELDS[step.type] || []).includes(f.name) && f.kind !== "action" && f.kind !== "actions") : null;
  const moreNodes = [];
  if (extras === null) {
    moreNodes.push(field(t("Parameters (JSON)"), jsonInput(step, (v) => { if (isObj(v)) { Object.keys(step).forEach((k) => k !== "type" && delete step[k]); Object.assign(step, v, { type: step.type }); ed(); } })));
  } else {
    if (step.type === "bind") moreNodes.push(bindInput(step, (v) => { setOrDelete(step, "keys", v); ed(); rerenderLogic(); }));
    moreNodes.push(...extras.map((f) => fieldFor(f, step, ed)));
  }
  const hasValue = extras && extras.some((f) => step[f.name] !== undefined);
  // atalho repetido: abre as opções (onde está o aviso e o "Gerar outra") e marca a linha
  const clash = typeof step.keys === "string" && (S.conflicts || []).some((c) => c.combo === canonCombo(step.keys));
  if (hasValue || clash) openMore.add(step);
  const more = moreNodes.length ? h("div", { class: "blk-more", hidden: !openMore.has(step) }, ...moreNodes) : null;
  const moreBtn = more ? h("button", { class: "blk-btn", title: t("More options"), "aria-label": t("More options"), "aria-expanded": openMore.has(step) ? "true" : "false",
    onclick: (e) => {
      more.hidden = !more.hidden;
      if (more.hidden) openMore.delete(step); else { openMore.add(step); M.fadeIn([more], { y: -4, dur: 160 }); }
      e.currentTarget.setAttribute("aria-expanded", more.hidden ? "false" : "true");
    } }, ic("ellipsis")) : null;
  el.append(h("div", { class: "blk-line" },
    h("span", { class: "blk-icon" }, actionIc(step.type)),
    h("span", { class: "blk-words" }, ...sentence(step, ed)),
    clash ? h("span", { class: "blk-warn", title: t("Repeated shortcut"), "aria-label": t("Repeated shortcut") }, ic("triangle-alert")) : null,
    h("span", { class: "blk-tools" }, moreBtn, grip(list, i, el), removeBtn(list, i))));
  if (more) el.append(more);
  return el;
}

function cBlock(list, i) {
  const s = list[i];
  const el = h("div", { class: "cblk", "data-m": M.id(s), style: { "--cat": groupOf(s.type).color } });
  const ed = () => commitModel();
  const tools = h("span", { class: "blk-tools" }, grip(list, i, el), removeBtn(list, i));
  const body = (l) => h("div", { class: "cbody" }, renderFlow(l));
  const plus = (l, label) => h("button", { class: "icon-btn small", title: t("Add step"), "aria-label": label,
    onclick: () => pickAndInsert(l, l.length) }, ic("plus"));
  // cada trilha tem uma barra com o mesmo formato: ícone, rótulo, espaço, "+"
  const bar = (icon, words, l, label, extra) => h("div", { class: "cbar" + (extra ? " chead" : "") },
    h("span", { class: "blk-icon" }, ic(icon)), h("span", { class: "blk-words" }, ...words), plus(l, label),
    // barras sem as ferramentas guardam o mesmo espaço, para o "+" ficar alinhado entre elas
    extra || h("span", { class: "blk-tools ghost", "aria-hidden": "true" }, h("span", { class: "grip" }), h("span", { class: "blk-btn" })));
  const label = (t) => h("span", { class: "chiplabel" }, t);
  if (s.type === "if") {
    const neg = h("select", { class: "inl", "aria-label": t("If or if not") },
      h("option", { value: "" }, t("If")), h("option", { value: "not" }, t("If not")));
    neg.value = s.is === false ? "not" : "";
    neg.addEventListener("change", () => { if (neg.value) s.is = false; else delete s.is; ed(); });
    const cond = inlCond(s, ed);
    el.append(bar("split", [neg, cond], s.then, t("Add step to then"), tools), body(s.then),
      bar("corner-down-right", [label(t("else"))], s.else, t("Add step to else")), body(s.else), h("div", { class: "cfoot" }));
  } else if (s.type === "toggle") {
    const share = h("input", { class: "inl", type: "text", value: s.state || "", placeholder: t("name (optional)"), "aria-label": t("Turn on together with other keys"),
      title: t("Keys with the same name here turn on and off together"),
      oninput: (e) => { setOrDelete(s, "state", e.target.value || null); ed(); } });
    autosize(share, 10, 24);
    el.append(bar("toggle-right", [label(t("when on"))], s.on, t("Add step to when on"), tools), body(s.on),
      bar("corner-down-right", [label(t("when off")), h("span", { class: "cnote" }, t("empty = same as when on"))], s.off, t("Add step to when off")),
      body(s.off), h("div", { class: "cfoot share" }, w(t("Turn on together with")), share));
  } else {
    el.append(bar("list-ordered", [label(t("Sequence"))], s.actions, t("Add step to the sequence"), tools), body(s.actions), h("div", { class: "cfoot" }));
  }
  return el;
}

// -- frases: cada ação vira uma frase com os campos dentro dela

const SENTENCE_FIELDS = {
  hotkey: ["keys"], bind: ["keys"], text: ["text"], media: ["key"], launch: ["target"], command: ["command"],
  http: ["url"], delay: ["ms"], page: ["page"], brightness: ["value"], set_state: ["state", "value"],
  "light.flash": ["color", "seconds"], "screens.paint": ["color", "seconds"], "page.temp": ["page", "seconds"],
  "timer.toggle": ["id", "minutes"], "timer.reset": ["id"],
  "obs.scene": ["scene"], "obs.record": ["mode"], "obs.stream": ["mode"], "obs.replay": ["mode"],
  "obs.virtualcam": ["mode"], "obs.mute": ["mode", "input"], "obs.source": ["mode", "source", "scene"],
  "obs.request": ["request"], "discord.keybind": ["name"],
};
const MODE_WORDS = {
  "obs.record": [["toggle", t("Start or stop")], ["start", t("Start")], ["stop", t("Stop")], ["pause", t("Pause or resume")]],
  "obs.stream": [["toggle", t("Start or stop")], ["start", t("Start")], ["stop", t("Stop")]],
  "obs.replay": [["toggle", t("Turn on or off")], ["start", t("Turn on")], ["stop", t("Turn off")], ["save", t("Save")]],
  "obs.virtualcam": [["toggle", t("Turn on or off")], ["start", t("Turn on")], ["stop", t("Turn off")]],
  "obs.mute": [["toggle", t("Mute or unmute")], ["on", t("Mute##2")], ["off", t("Unmute")]],
  "obs.source": [["toggle", t("Show or hide")], ["show", t("Show")], ["hide", t("Hide")]],
};

function sentence(s, ed) {
  switch (s.type) {
    case "hotkey": return [w(t("Press")), inlCombo(s, ed)];
    case "bind": return [w(t("Unique shortcut")), h("span", { class: "inl-chip" }, s.keys || t("generating…"))];
    case "text": return [w(t("Type")), inlText(s, "text", t("text"), ed, { wide: true })];
    case "media": return [inlEnum(s, "key", ed)];
    case "launch": return [w(t("Open")), inlText(s, "target", t("program, file or website"), ed, { wide: true })];
    case "command": return [w(t("Run")), inlText(s, "command", t("command"), ed, { wide: true })];
    case "http": return [w(t("Call")), inlText(s, "url", "https://…", ed, { wide: true })];
    case "delay": return [w(t("Wait")), inlSeconds(s, ed), w(t("seconds"))];
    case "page": return [w(t("Go to page")), inlPage(s, ed)];
    case "brightness": return [w(t("Brightness to")), inlNum(s, "value", "100", ed), w("%")];
    case "set_state": return [w(t("Set")), inlState(s, ed), w(t("as")), inlEnum(s, "value", ed)];
    case "none": return [w(t("Do nothing"))];
    case "obs.scene": return [w(t("Switch to scene")), inlText(s, "scene", t("scene"), ed, { list: "dl-scenes" })];
    case "obs.record": return [inlMode(s, ed), w(t("recording"))];
    case "obs.stream": return [inlMode(s, ed), w(t("the live stream"))];
    case "obs.replay": return [inlMode(s, ed), w(t("the replay buffer"))];
    case "obs.virtualcam": return [inlMode(s, ed), w(t("the virtual camera"))];
    case "obs.mute": return [inlMode(s, ed), inlText(s, "input", t("audio source"), ed, { list: "dl-inputs" }), w(t("in OBS"))];
    case "obs.source": {
      const id = "dl-src-" + Math.random().toString(36).slice(2);
      const dl = h("datalist", { id }, ...(S.obs.sources[s.scene] || []).map((x) => h("option", { value: x })));
      return [inlMode(s, ed), inlText(s, "source", t("source"), ed, { list: id }), dl, w(t("in scene")), inlText(s, "scene", t("scene"), ed, { list: "dl-scenes" })];
    }
    case "obs.request": return [w(t("OBS command")), inlText(s, "request", t("command name"), ed)];
    case "discord.mute": return [w(t("Mute or unmute the Discord microphone"))];
    case "discord.deafen": return [w(t("Turn Discord audio on or off"))];
    case "discord.keybind": return [w(t("Discord shortcut")), inlText(s, "name", t("name"), ed)];
    case "light.flash": return [w(t("Light")), inlColor(s, "color", ed, "#22c55e"), w(t("for")), inlNum(s, "seconds", "3", ed), w("s")];
    case "screens.paint": return [w(t("Screens")), inlColor(s, "color", ed, "#b4232a"), w(t("for")), inlNum(s, "seconds", "3", ed), w("s")];
    case "page.temp": return [w(t("Show the page")), inlPage(s, ed), w(t("for")), inlNum(s, "seconds", "10", ed), w("s")];
    case "timer.toggle": return [w(t("Start or pause the countdown")), inlText(s, "id", t("name"), ed), w(t("of")), inlNum(s, "minutes", "5", ed), w("min")];
    case "timer.reset": return [w(t("Reset the countdown")), inlText(s, "id", t("name"), ed)];
    default: return [w((actionDef(s.type) || {}).label || s.type)];
  }
}

const w = (text) => h("span", { class: "w" }, text);

function autosize(inp, min = 6, max = 30) {
  const fit = () => { inp.size = Math.max(min, Math.min(max, (inp.value || inp.placeholder || "").length + 1)); };
  fit();
  inp.addEventListener("input", fit);
}

function inlText(s, f, placeholder, ed, o = {}) {
  const inp = h("input", { class: "inl", type: "text", value: s[f] ?? "", placeholder, list: o.list, "aria-label": placeholder,
    oninput: (e) => { setOrDelete(s, f, e.target.value || null); ed(); } });
  autosize(inp, o.wide ? 14 : 8, o.wide ? 40 : 26);
  return inp;
}

function inlNum(s, f, placeholder, ed) {
  return h("input", { class: "inl num", type: "number", value: s[f] ?? "", placeholder, "aria-label": placeholder,
    oninput: (e) => { setOrDelete(s, f, e.target.value === "" ? null : Number(e.target.value)); ed(); } });
}

function inlSeconds(s, ed) {   // guardado em ms, mostrado em segundos
  return h("input", { class: "inl num", type: "number", step: "0.1", min: "0", value: s.ms != null ? s.ms / 1000 : "", placeholder: "1",
    "aria-label": t("Seconds"),
    oninput: (e) => { setOrDelete(s, "ms", e.target.value === "" ? null : Math.round(Number(e.target.value) * 1000)); ed(); } });
}

function inlSelect(options, value, onPick, label) {
  const sel = h("select", { class: "inl", "aria-label": label });
  options.forEach(([, l], i) => sel.append(h("option", { value: String(i) }, l)));
  const idx = options.findIndex(([v]) => JSON.stringify(v) === JSON.stringify(value));
  sel.value = String(idx >= 0 ? idx : 0);
  sel.addEventListener("change", () => onPick(Number(sel.value)));
  return sel;
}

function inlEnum(s, f, ed) {
  const fd = ((actionDef(s.type) || {}).fields || []).find((x) => x.name === f);
  if (!fd) return w("?");
  return inlSelect(fd.options, s[f], (i) => { if (!fd.required && i === 0) delete s[f]; else s[f] = fd.options[i][0]; ed(); }, fd.label);
}

function inlMode(s, ed) {
  const opts = MODE_WORDS[s.type];
  return inlSelect(opts, s.mode, (i) => { if (i === 0) delete s.mode; else s.mode = opts[i][0]; ed(); }, t("What to do"));
}

function inlPage(s, ed) {
  const opts = [["back", t("previous (go back)")], ["home", t("home page##2")], ...Object.keys(pages()).map((p) => [p, p])];
  if (s.page && !opts.some(([o]) => o === s.page)) opts.push([s.page, t("{0} (doesn't exist)", [s.page])]);
  return inlSelect(opts, s.page || "back", (i) => { s.page = opts[i][0]; ed(); }, t("Page"));
}

function inlColor(s, f, ed, def) {
  const inp = h("input", { type: "color", class: "inl-color", value: /^#[0-9a-f]{6}$/i.test(s[f] || "") ? s[f] : def, "aria-label": t("Color"),
    oninput: (e) => { s[f] = e.target.value; ed(); } });
  if (!s[f]) s[f] = def;
  return inp;
}

function inlState(s, ed) {
  const opts = stateOptions().map(([v, l]) => [v, l.charAt(0).toLowerCase() + l.slice(1)]);
  if (s.state && !opts.some(([v]) => v === s.state)) opts.push([s.state, s.state]);
  if (!s.state && opts.length) { s.state = opts[0][0]; }
  return inlSelect(opts, s.state, (i) => { s.state = opts[i][0]; ed(); }, t("Condition"));
}

function inlCombo(s, ed) {
  const val = Array.isArray(s.keys) ? s.keys.join(", ") : s.keys ?? "";
  const inp = h("input", { class: "inl", type: "text", value: val, placeholder: "ctrl+shift+m", "aria-label": t("Shortcut##2"),
    title: t("Several in sequence: separate with commas"),
    oninput: (e) => {
      const parts = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
      setOrDelete(s, "keys", parts.length === 0 ? null : parts.length === 1 ? parts[0] : parts);
      ed();
    } });
  autosize(inp, 12, 34);
  const rec = h("button", { class: "blk-btn", title: t("Capture: click and press the shortcut"), "aria-label": t("Capture shortcut") }, ic("circle-dot"));
  rec.addEventListener("click", () => {
    rec.classList.add("rec");
    const stop = () => { window.removeEventListener("keydown", onKey, true); rec.classList.remove("rec"); };
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === "Escape") return stop();
      const name = keyName(e);
      if (!name) return;
      inp.value = [e.ctrlKey && "ctrl", e.shiftKey && "shift", e.altKey && "alt", e.metaKey && "win", name].filter(Boolean).join("+");
      inp.dispatchEvent(new Event("input"));
      stop();
    };
    window.addEventListener("keydown", onKey, true);
  });
  return h("span", { class: "inl-group" }, inp, rec);
}

// -- modo expandido: a lógica da tecla no lugar do Deck

function renderExpanded() {
  const view = $("#expandView");
  const spec = S.key && pageKeys()[S.key];
  if (!spec) { S.expanded = false; return renderAll(); }
  if (!S.model || S.model.id !== `${S.page}:${S.key}`) buildModel();
  const icon = normalizeIcon(spec.icon);
  const scroll = view.querySelector(".expand-scroll");
  const top = scroll ? scroll.scrollTop : 0;
  view.replaceChildren(
    h("div", { class: "expand-head" },
      h("button", { class: "btn small ghost", onclick: () => { S.expanded = false; renderAll(); } }, ic("arrow-left"), t("Back to Deck")),
      h("span", { class: "vsep" }),
      h("img", { class: "insp-thumb", id: "expThumb", alt: "" }),
      h("div", {}, h("div", { class: "expand-title" }, (icon.text || t("Key {0}", [S.key])).replace(/\n/g, " ")),
        h("small", { class: "expand-sub" }, t("Key {0}, page {1}", [S.key, S.page]))),
      h("span", { class: "grow" }),
      h("div", { class: "insp-tools" }, ...keyTools())),
    h("div", { class: "expand-scroll" }, doTab(spec, { wide: true })));
  view.querySelector(".expand-scroll").scrollTop = top;
  const p = (S.previews[S.page] || [])[Number(S.key) - 1];
  if (p) $("#expThumb").src = p.normal;
}

// -- campos das ações

function fieldFor(f, spec, emit) {
  const set = (v) => { setOrDelete(spec, f.name, v); emit(); };
  const v = spec[f.name];
  switch (f.kind) {
    case "textarea": return field(f.label, h("textarea", { rows: 2, oninput: (e) => set(e.target.value || null) }, v ?? ""), f.help);
    case "number": return field(f.label, num(v, set, f.placeholder, f.step), f.help);
    case "bool": {
      const cb = h("input", { type: "checkbox" });
      cb.checked = v === undefined ? !!f.default : !!v;
      cb.addEventListener("change", () => set(cb.checked === !!f.default ? null : cb.checked));
      return h("div", { class: "field" }, h("label", { class: "check" }, cb, f.label), f.help ? h("span", { class: "hint" }, f.help) : null);
    }
    case "enum": {
      const sel = h("select", {});
      f.options.forEach(([, lab], i) => sel.append(h("option", { value: String(i) }, lab)));
      const idx = f.options.findIndex(([val]) => JSON.stringify(val) === JSON.stringify(v));
      sel.value = String(idx >= 0 ? idx : 0);
      // opcional: a 1ª opção é o padrão do app, então nem grava no config
      sel.addEventListener("change", () => set(!f.required && sel.value === "0" ? null : f.options[Number(sel.value)][0]));
      return field(f.label, sel, f.help);
    }
    case "combo": return field(f.label, comboInput(v, set), f.help);
    case "bind": return field(f.label, bindInput(spec, set, f.hint), f.help);
    case "json": return field(f.label, jsonInput(v, set), f.help);
    case "color": return field(f.label, swatchRow(v || null, (c) => set(c), !f.default, INFO_SWATCHES.concat([["#22c55e", t("Green")], ["#ef4444", t("Red")]]), t("None")), f.help);
    case "icon": return field(f.label, v ? glyphCard({ lucide: v }, (c) => { set(c); rerenderLogic(); }, () => { set(null); rerenderLogic(); })
      : h("button", { class: "btn small", onclick: () => openGlyphPicker((c) => { if (c) { set(c); rerenderLogic(); } }) }, ic("search"), t("Choose icon")), f.help);
    case "page": {
      const sel = h("select", {});
      const opts = [["back", t("Back (previous page)")], ["home", t("Home page")], ...Object.keys(pages()).map((p) => [p, p])];
      if (v && !opts.some(([o]) => o === v)) opts.push([v, t("{0} (doesn't exist)", [v])]);
      for (const [o, l] of opts) sel.append(h("option", { value: o }, l));
      sel.value = v || "back";
      sel.addEventListener("change", () => set(sel.value));
      return field(f.label, sel, f.help);
    }
    case "scene": return field(f.label, txt(v, set, S.obs.scenes.length ? t("choose or type") : t("scene name"), "dl-scenes"), f.help);
    case "input": return field(f.label, txt(v, set, S.obs.inputs.length ? t("choose or type") : t("audio source name"), "dl-inputs"), f.help);
    case "source": {
      const id = "dl-src-" + Math.random().toString(36).slice(2);
      const dl = h("datalist", { id });
      const fill = () => dl.replaceChildren(...(S.obs.sources[spec.scene] || []).map((s) => h("option", { value: s })));
      fill();
      const inp = txt(v, set, t("source name"), id);
      inp.addEventListener("focus", fill);
      return field(f.label, h("div", {}, inp, dl), f.help);
    }
    default: return field(f.label, txt(v, set, f.placeholder), f.help);
  }
}

function field(label, input, hint) {
  return h("div", { class: "field" }, h("span", { class: "label" }, label), input, hint ? h("span", { class: "hint" }, hint) : null);
}
function txt(value, onChange, placeholder, list) {
  return h("input", { type: "text", value: value ?? "", placeholder, list, oninput: (e) => onChange(e.target.value || null) });
}
function num(value, onChange, placeholder, step) {
  return h("input", { type: "number", value: value ?? "", placeholder, step: step || "any",
    oninput: (e) => onChange(e.target.value === "" ? null : Number(e.target.value)) });
}
function jsonInput(value, onChange) {
  const ta = h("textarea", { class: "code", placeholder: "{ }" }, value == null ? "" : JSON.stringify(value, null, 2));
  ta.addEventListener("input", () => {
    if (!ta.value.trim()) { ta.classList.remove("invalid"); return onChange(null); }
    try { const v = JSON.parse(ta.value); ta.classList.remove("invalid"); onChange(v); } catch { ta.classList.add("invalid"); }
  });
  return ta;
}

function comboInput(value, onChange) {
  const ta = h("textarea", { rows: 1, placeholder: "ctrl+shift+m" }, Array.isArray(value) ? value.join("\n") : value ?? "");
  const emit = () => {
    const lines = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
    onChange(lines.length === 0 ? null : lines.length === 1 ? lines[0] : lines);
  };
  ta.addEventListener("input", emit);
  const rec = h("button", { class: "btn small", title: t("Click and press the shortcut on the keyboard") }, ic("circle-dot"), h("span", {}, t("Capture")));
  rec.addEventListener("click", () => {
    rec.lastChild.textContent = t("Press the keys…");
    const stop = () => { window.removeEventListener("keydown", onKey, true); rec.lastChild.textContent = t("Capture"); };
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === "Escape") return stop();
      const name = keyName(e);
      if (!name) return;
      ta.value = [e.ctrlKey && "ctrl", e.shiftKey && "shift", e.altKey && "alt", e.metaKey && "win", name].filter(Boolean).join("+");
      emit(); stop();
    };
    window.addEventListener("keydown", onKey, true);
  });
  return h("div", { class: "row" }, h("div", { class: "grow" }, ta), rec);
}

function keyName(e) {
  const c = e.code;
  if (/^(Control|Shift|Alt|Meta|OS)/.test(c)) return null;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return c.toLowerCase();
  if (/^Numpad\d$/.test(c)) return "num" + c.slice(6);
  return { Space: "space", Enter: "enter", Tab: "tab", Backspace: "backspace", Delete: "delete", Insert: "insert",
    Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown", ArrowLeft: "left", ArrowRight: "right",
    ArrowUp: "up", ArrowDown: "down", PrintScreen: "printscreen", Pause: "pause", Minus: "-", Equal: "=",
    Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]",
    Backslash: "\\", Backquote: "`", NumpadAdd: "add", NumpadSubtract: "subtract", NumpadMultiply: "multiply",
    NumpadDivide: "divide", NumpadDecimal: "decimal", CapsLock: "capslock", MediaPlayPause: "play_pause",
    MediaTrackNext: "next", MediaTrackPrevious: "prev", AudioVolumeUp: "vol_up", AudioVolumeDown: "vol_down",
    AudioVolumeMute: "mute" }[c] || null;
}

function sendComboButton(getCombo) {
  const send = h("button", { class: "btn small", title: t("Click here, then on the shortcut field of the other program") }, ic("send"), h("span", {}, t("Send in 5 s")));
  send.addEventListener("click", async () => {
    const combo = getCombo();
    if (!combo) return;
    try { await api("/api/send_combo", { keys: combo, delay: 5 }); } catch (e) { return toast(e.message, { bad: true }); }
    let left = 5;
    send.disabled = true;
    const tick = () => {
      send.lastChild.textContent = left > 0 ? t("Sending in {0}…", [left]) : t("Sent");
      if (left-- > 0) setTimeout(tick, 1000);
      else setTimeout(() => { send.lastChild.textContent = t("Send in 5 s"); send.disabled = false; }, 1500);
    };
    tick();
  });
  return send;
}
// "Enviar pelo Deck": a próxima tecla do Deck apertada manda só este atalho (sem rodar a ação dela,
// sem trocar ícone), para o programa que está gravando um atalho registrar. Vale para qualquer ação
// ou plugin. Enquanto espera, uma nota embaixo do campo explica o que fazer.
function recordButton(getCombo) {
  const label = t("Send with the Deck");
  const b = h("button", { class: "btn small", title: t("For the other program to record this shortcut without hurrying: the next Deck key you press sends only this shortcut. No key action runs.") },
    ic("keyboard"), h("span", {}, label));
  let timer = null, note = null;
  const reset = () => {
    clearInterval(timer); timer = null;
    b.lastChild.textContent = label; b.classList.remove("listening");
    if (note) { note.remove(); note = null; }
  };
  const explain = (combo, left) => t("Now go to the other program, click to record a shortcut and press any Deck key. It will send only {0}: no action runs and nothing changes on the Deck. {1} s left.", [combo, left]);
  b.addEventListener("click", async () => {
    if (timer) { reset(); try { await api("/api/record", { cancel: true }); } catch { /* já parou */ } return; }
    const combo = getCombo();
    if (!combo) return;
    try { await api("/api/record", { keys: combo, seconds: 30 }); } catch (e) { return toast(e.message, { bad: true }); }
    const started = Date.now() / 1000 - 1;
    b.classList.add("listening");
    b.lastChild.textContent = t("Cancel");
    note = h("div", { class: "note-box rec-note", role: "status" }, ic("keyboard"), h("span", {}, explain(combo, 30)));
    (b.closest(".send-row") || b).after(note);
    timer = setInterval(async () => {
      let r;
      try { r = await api("/api/record"); } catch { return reset(); }
      if (r.sent && r.sent.at >= started) { reset(); toast(t("Sent {0} through key {1}.", [r.sent.combo, r.sent.key])); }
      else if (!r.armed) reset();
      else if (note) note.lastChild.textContent = explain(combo, r.left);
    }, 500);
  });
  return b;
}
function shortcutTools(getCombo) {
  return [sendComboButton(getCombo), recordButton(getCombo)];
}

function bindInput(spec, set, hint) {
  const shown = h("span", { class: "bind-combo" }, spec.keys || t("generating…"));
  const regen = h("button", { class: "icon-btn combo-regen", title: t("Make another") + ": " + t("A new combination with F13–F24, which no keyboard has"),
    "aria-label": t("Make another"), onclick: async () => {
    const [c] = await freeBinds(1, bindRules(spec)); if (c) { shown.textContent = c; set(c); } } }, ic("refresh-cw"));
  // "Atalho para outro programa": para qual programa (cada um aceita combinações diferentes)
  let forSel = null;
  if (spec.type === "bind" && rulePrograms().length) {
    forSel = field(t("Made for"), h("select", { onchange: async (e) => {
      setOrDelete(spec, "for", e.target.value || null);
      const [c] = await freeBinds(1, bindRules(spec)); if (c) { shown.textContent = c; set(c); }
    } }, h("option", { value: "" }, t("Any program")),
      ...rulePrograms().map((pl) => h("option", { value: pl.id, selected: spec.for === pl.id }, pl.name))),
    t("Some programs don't accept every combination: the shortcut is made with what this one accepts."));
  }
  const warn = spec.keys ? conflictNote(spec.keys, (pl) => pl.page === S.page && pl.key === String(S.key) && pl.type === spec.type) : null;
  return h("div", { class: "field" },
    forSel,
    h("div", { class: "combo-box" }, shown, regen),
    h("div", { class: "send-row" }, ...shortcutTools(() => spec.keys)),
    warn,
    h("ol", { class: "steps-list" }, h("li", {}, t("Save.")), h("li", {}, hint ? hint + "." : t("In the other program, click the record-shortcut field.")), h("li", {}, t("Press this Deck key (or use Send with the Deck)."))));
}

// -- aba Aparência

function keyHasState(spec) {
  if (!spec) return false;
  if (spec.state) return true;
  const a = normalizeAction(spec.action);
  if (!a) return false;
  const d = actionDef(a.type);
  return !!(d && d.state) && !(a.type === "obs.replay" && a.mode === "save");
}

function lookTab(spec) {
  const body = h("div", { class: "insp-body look" });
  const hasState = keyHasState(spec);
  if (!hasState) S.lookMode = "normal";
  const side = h("div", { class: "look-side" });
  if (hasState) {
    side.append(h("div", { class: "lfield" }, h("span", { class: "msub" }, t("Editing the appearance")),
      h("div", { class: "segmented full", role: "group", "aria-label": t("Which appearance to edit") },
        ...[["normal", t("Normal")], ["active", t("When active")]].map(([v, l]) => h("button", {
          "aria-pressed": S.lookMode === v ? "true" : "false", onclick: () => { S.lookMode = v; renderInspector(); } }, l)))));
  }
  side.append(h("label", { class: "lfield" }, h("span", { class: "msub" }, t("Active when")), activeWhenSelect(spec)));
  body.append(h("div", { class: "look-top" }, h("img", { id: "lookImg", class: "look-img", alt: t("Key preview") }), side));

  if (S.lookMode === "active") {
    body.append(iconEditor(spec.active_icon ? normalizeIcon(spec.active_icon) : {}, (v) => {
      if (Object.keys(v).length) spec.active_icon = v; else delete spec.active_icon;
      changed();
    }, { override: true, base: normalizeIcon(spec.icon) }));
  } else {
    body.append(iconEditor(normalizeIcon(spec.icon), (v) => {
      spec.icon = v;
      const n = $("#keyName"); if (n) n.value = (v.text || "").replace(/\n/g, " ");
      if (S.model) S.model.autoText = null;
      changed();
    }));
  }
  return body;
}

// "Ativa quando": automático (pela ação) ou uma condição escolhida
function activeWhenSelect(spec) {
  const a = normalizeAction(spec.action);
  const d = a && actionDef(a.type);
  const auto = !!(d && d.state) && !(a.type === "obs.replay" && a.mode === "save");
  const opts = [["", auto ? t("automatic (from the action)") : t("never")],
    ...stateOptions().map(([v, l]) => [v, l.charAt(0).toLowerCase() + l.slice(1)])];
  if (spec.state && !opts.some(([v]) => v === spec.state)) opts.push([spec.state, spec.state]);
  const sel = h("select", { class: "full", "aria-label": t("When the key becomes active") }, ...opts.map(([v, l]) => h("option", { value: v }, l)));
  sel.value = spec.state || "";
  sel.addEventListener("change", () => { setOrDelete(spec, "state", sel.value || null); S.previews[S.page] = null; changed(); renderInspector(); });
  return sel;
}

const SWATCHES = [["#2B2F36", t("Graphite")], ["#22336E", t("Blue")], ["#5865F2", "Discord"], ["#1D4D37", t("Green")],
  ["#C62828", t("Red")], ["#F5A524", t("Amber")], ["#8E4EC6", t("Purple")], ["#000000", t("Black")]];
const FG_SWATCHES = [["#FFFFFF", t("White")], ["#16181D", t("Near black")], ["#F5A524", t("Amber")], ["#E5484D", t("Red")], ["#30A46C", t("Green")]];
const BORDER_SWATCHES = [["#F5A524", t("Amber")], ["#E5484D", t("Red")], ["#30A46C", t("Green")], ["#FFFFFF", t("White")]];
const GRAD_DIRS = [["down", "arrow-down", t("Top to bottom")], ["right", "arrow-right", t("Left to right")],
  ["diagonal", "arrow-down-right", t("Diagonal")], ["radial", "circle-dot", t("From the center out")]];
const lookMem = {};   // ícone/imagem de antes de trocar o que vai no centro (para voltar sem perder)

function darker(hex, f = 0.45) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#000000";
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - f)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function sectionHead(title, sub) {
  return h("div", { class: "lhead" }, h("span", { class: "mtitle" }, title), sub ? h("span", { class: "msub" }, sub) : null);
}

function iconEditor(icon, onChange, opts = {}) {
  icon = clone(icon) || {};
  const ov = !!opts.override, base = opts.base || {};
  const emit = () => onChange(clone(icon));
  const set = (k, v) => { setOrDelete(icon, k, v); emit(); };
  const setMany = (obj) => { for (const [k, v] of Object.entries(obj)) setOrDelete(icon, k, v); emit(); renderInspector(); };
  const memKey = `${S.page}:${S.key}`;
  const mem = (lookMem[memKey] ||= {});
  const mode = ov ? null : icon.image ? "image" : icon.lucide || icon.glyph ? "icon" : "text";
  const filled = !ov && icon.image && icon.image_fill;
  const box = h("div", { class: "look-sections" });

  if (ov) box.append(h("p", { class: "hint" }, t("Fill in only what changes when the key is active. Everything else stays the same as normal.")));

  // -- o que vai no centro da tecla
  if (!ov) {
    const pickMode = (m) => {
      if (m === mode) return;
      if (icon.lucide || icon.glyph) mem.icon = { lucide: icon.lucide || null, glyph: icon.glyph || null };
      if (icon.image) { mem.image = icon.image; mem.fill = icon.image_fill; }
      if (m === "text") return setMany({ lucide: null, glyph: null, image: null, image_fill: null });
      if (m === "icon") {
        if (mem.icon) return setMany({ image: null, image_fill: null, ...mem.icon });
        return openGlyphPicker((c) => c && setMany({ image: null, image_fill: null, lucide: c, glyph: null }));
      }
      if (mem.image) return setMany({ lucide: null, glyph: null, image: mem.image, image_fill: mem.fill || null });
      pickImage((p) => setMany({ lucide: null, glyph: null, image: p }));
    };
    const sec = h("section", { class: "lsec" }, sectionHead(t("In the center of the key")),
      h("div", { class: "segmented full", role: "group", "aria-label": t("What goes in the center of the key") },
        ...[["icon", "shapes", t("Icon")], ["image", "image", t("Image")], ["text", "type", t("Text only")]].map(([v, i, l]) =>
          h("button", { "aria-pressed": mode === v ? "true" : "false", onclick: () => pickMode(v) }, ic(i), l))));
    if (mode === "icon") sec.append(glyphCard(icon, (c) => setMany({ lucide: c, glyph: null })));
    else if (mode === "image") {
      sec.append(imageCard(icon.image, (p) => setMany({ image: p }), () => { mem.image = null; setMany({ image: null, image_fill: null }); }));
      sec.append(toggleRow(t("Fill the whole key"), !!icon.image_fill, (on) => setMany({ image_fill: on || null })));
      if (icon.image_fill) sec.append(h("p", { class: "hint" }, t("The image covers the whole key, so text, background and sizes don't show. Turn this off to use the image as an icon, with text below.")));
    } else sec.append(h("p", { class: "hint" }, t("Without an icon, the text sits in the center of the key, larger, in up to 3 lines.")));
    box.append(sec);
  } else {
    box.append(h("section", { class: "lsec" }, sectionHead(t("Icon")),
      icon.lucide || icon.glyph ? glyphCard(icon, (c) => setMany({ lucide: c, glyph: null }), () => setMany({ lucide: null, glyph: null }))
        : h("button", { class: "card", onclick: () => openGlyphPicker((c) => c && setMany({ lucide: c, glyph: null })) },
          h("span", { class: "card-thumb" }, ic("shapes")),
          h("span", { class: "card-text" }, h("b", {}, t("Same as normal")), h("small", {}, t("Click to use a different one when active"))),
          h("span", { class: "icon-btn small", "aria-hidden": "true" }, ic("search")))));
  }

  // -- texto
  if (!filled) {
    const sec = h("section", { class: "lsec" }, sectionHead(t("Text")),
      h("textarea", { rows: mode === "text" ? 3 : 2, "aria-label": t("Key text"),
        placeholder: ov ? t("same as normal{0}", [base.text ? ` (${String(base.text).replace(/\n/g, " ")})` : ""]) : t("Enter adds a line"),
        oninput: (e) => set("text", e.target.value || null) }, icon.text ?? ""));
    if (!ov && mode !== "text") sec.append(positionPicker(icon.style, (v) => setMany({ style: v })));
    box.append(sec);
  }

  // -- cores
  const colors = h("section", { class: "lsec" }, sectionHead(filled ? t("Border") : t("Colors")));
  if (filled) colors.append(swatchRow(icon.border, (v) => set("border", v), true, BORDER_SWATCHES, t("None")));
  else {
    colors.append(
      colorRow(t("Background"), backgroundEditor(icon, base, ov, setMany, set)),
      colorRow(mode === "text" ? t("Text") : t("Text and icon"), swatchRow(icon.fg, (v) => set("fg", v), true, FG_SWATCHES, ov ? t("Same as normal") : t("White (default)"))),
      colorRow(t("Border"), swatchRow(icon.border, (v) => set("border", v), true, BORDER_SWATCHES, ov ? t("Same as normal") : t("None"))));
  }
  box.append(colors);

  // -- tamanhos
  if (!ov && !filled) box.append(sizesSection(icon, mode, set, setMany));
  return box;
}

function colorRow(label, control) {
  return h("div", { class: "crow" }, h("span", { class: "clabel" }, label), h("div", { class: "cctl" }, control));
}

function glyphCard(icon, onPick, onRemove) {
  if (!POPULAR.length) buildPopular();
  const choose = () => openGlyphPicker((c) => c && onPick(c));
  const legacy = !icon.lucide && icon.glyph;     // formato antigo (Segoe): ainda aparece, até trocar
  const name = icon.lucide ? (POPULAR_NAMES[icon.lucide] || icon.lucide.replace(/-/g, " ")) : t("Old icon");
  return h("div", { class: "card" },
    h("button", { class: "card-thumb " + (legacy ? "g" : "lu-ch"), title: t("Choose another icon"), "aria-label": t("Choose another icon"), onclick: choose },
      legacy ? glyphChar(icon.glyph) : luChar(icon.lucide)),
    h("span", { class: "card-text" }, h("b", {}, name),
      h("small", {}, legacy ? t("Segoe {0}: replace it with a Lucide one", [String(icon.glyph).toUpperCase()]) : icon.lucide)),
    h("button", { class: "icon-btn small", title: t("Choose another icon"), "aria-label": t("Choose another icon"), onclick: choose }, ic("search")),
    onRemove ? h("button", { class: "icon-btn small", title: t("Remove icon"), "aria-label": t("Remove icon"), onclick: onRemove }, ic("trash-2")) : null);
}

const imageInfoCache = {};
function imageCard(path, onPick, onRemove) {
  const thumb = h("span", { class: "card-thumb" }, ic("image"));
  const name = h("b", {}, String(path).split(/[\\/]/).pop());
  const sub = h("small", {}, "");
  const fill = (info) => {
    if (info.thumb) thumb.replaceChildren(h("img", { src: info.thumb, alt: "" }));
    sub.textContent = info.missing ? t("File not found") : info.frames > 1 ? t("Animated GIF, {0} frames", [info.frames]) : t("{0} × {1} px", [info.width, info.height]);
    if (info.missing) sub.classList.add("bad");
  };
  if (imageInfoCache[path]) fill(imageInfoCache[path]);
  else api("/api/image_info", { path }).then((info) => { imageInfoCache[path] = info; fill(info); }).catch(() => {});
  return h("div", { class: "card" }, thumb, h("span", { class: "card-text" }, name, sub),
    h("button", { class: "icon-btn small", title: t("Change image"), "aria-label": t("Change image"), onclick: () => pickImage(onPick) }, ic("upload")),
    h("button", { class: "icon-btn small", title: t("Remove image"), "aria-label": t("Remove image"), onclick: onRemove }, ic("trash-2")));
}

function toggleRow(label, on, onChange) {
  const sw = h("button", { class: "switch", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label,
    onclick: () => onChange(!on) });
  return h("div", { class: "toggle-row" }, h("span", { class: "grow" }, label), sw);
}

function positionPicker(value, onPick) {
  const def = (isObj(S.cfg.icons) && S.cfg.icons.style) || "below";
  const cur = value || def;
  const art = {
    below: [h("i", { class: "dot" }), h("i", { class: "bar" })],
    top: [h("i", { class: "bar" }), h("i", { class: "dot" })],
    big: [h("i", { class: "dot big" })],
  };
  return h("div", { class: "positions", role: "group", "aria-label": t("Text position") },
    ...[["below", t("Below")], ["top", t("Above")], ["big", t("Hide")]].map(([v, l]) =>
      h("button", { "aria-pressed": cur === v ? "true" : "false", title: v === "big" ? t("Hides the text and enlarges the icon") : t("Text {0}", [l.toLowerCase()]),
        onclick: () => onPick(v === def ? null : v) }, h("span", { class: "mini" }, ...art[v]), l)));
}

function backgroundEditor(icon, base, ov, setMany, set) {
  const grad = !!icon.bg_to || (ov && icon.bg_to === undefined && !!base.bg_to && icon.bg === undefined);
  const wrap = h("div", { class: "bg-editor" });
  const seg = h("div", { class: "segmented small", role: "group", "aria-label": t("Background type") },
    h("button", { "aria-pressed": grad ? "false" : "true", onclick: () => grad && setMany({ bg_to: ov && base.bg_to ? "" : null, bg_dir: null }) }, t("Solid color")),
    h("button", { "aria-pressed": grad ? "true" : "false", onclick: () => {
      if (grad) return;
      const from = icon.bg || base.bg || "#2B2F36";
      setMany({ bg: from, bg_to: darker(from), bg_dir: icon.bg_dir || null });
    } }, t("Gradient")));
  wrap.append(seg);
  if (!grad) {
    wrap.append(swatchRow(icon.bg, (v) => set("bg", v), ov, SWATCHES, t("Same as normal")));
    return wrap;
  }
  const from = icon.bg || base.bg || "#2B2F36", to = icon.bg_to || base.bg_to || "#000000";
  const pill = (value, label, onPick) => {
    const dot = h("i", { style: { background: value } });
    const txt = h("span", {}, value.replace("#", "").toUpperCase());
    const inp = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(value) ? value : "#888888", "aria-label": label,
      oninput: (e) => { dot.style.background = e.target.value; txt.textContent = e.target.value.slice(1).toUpperCase(); onPick(e.target.value.toUpperCase()); } });
    return h("label", { class: "cpill", title: label }, dot, txt, inp);
  };
  const dir = icon.bg_dir || base.bg_dir || "down";
  wrap.append(
    h("div", { class: "row" },
      pill(from, t("Start color"), (v) => set("bg", v)),
      h("button", { class: "icon-btn small", title: t("Swap the colors"), "aria-label": t("Swap the colors"), onclick: () => setMany({ bg: to, bg_to: from }) }, ic("arrow-left-right")),
      pill(to, t("End color"), (v) => set("bg_to", v))),
    h("div", { class: "segmented small icons", role: "group", "aria-label": t("Gradient direction") },
      ...GRAD_DIRS.map(([v, i, l]) => h("button", { "aria-pressed": dir === v ? "true" : "false", title: l, "aria-label": l,
        onclick: () => setMany({ bg_dir: v === "down" ? null : v }) }, ic(i)))));
  return wrap;
}

const LAYOUT_DEFAULTS = { below: { glyph: 48, image: 0.5 }, top: { glyph: 46, image: 0.48 }, big: { glyph: 66, image: 0.79 } };
function sizesSection(icon, mode, set, setMany) {
  const style = icon.style || (isObj(S.cfg.icons) && S.cfg.icons.style) || "below";
  const textDef = Number((isObj(S.cfg.icons) && S.cfg.icons.text_size) || 16) * (mode === "text" ? 1.4 : 1);
  const custom = icon.text_size || icon.glyph_size || icon.image_scale;
  const open = S.sizesOpen ?? !!custom;
  const sec = h("section", { class: "lsec sizes" });
  sec.append(h("div", { class: "lhead" },
    h("button", { class: "lhead-btn", "aria-expanded": open ? "true" : "false", onclick: () => { S.sizesOpen = !open; renderInspector(); } },
      h("span", { class: "mtitle" }, t("Sizes")), h("span", { class: "msub" }, custom ? "ajustado" : t("automatic"))),
    h("span", { class: "grow" }),
    custom ? h("button", { class: "icon-btn small", title: t("Back to automatic"), "aria-label": t("Back to automatic"),
      onclick: () => setMany({ text_size: null, glyph_size: null, image_scale: null }) }, ic("rotate-ccw")) : null,
    h("button", { class: "icon-btn small chev" + (open ? " open" : ""), "aria-label": open ? t("Hide sizes") : t("Show sizes"),
      onclick: () => { S.sizesOpen = !open; renderInspector(); } }, ic("chevron-down"))));
  if (!open) return sec;
  const slider = (label, key, min, max, step, def, fmt) => {
    const val = icon[key] ?? def;
    const out = h("span", { class: "rv" }, icon[key] == null ? "auto" : fmt(val));
    const r = h("input", { type: "range", min, max, step, value: val, "aria-label": label,
      oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); set(key, v); } });
    return h("div", { class: "rrow" }, h("span", { class: "clabel" }, label), r, out);
  };
  if (icon.text || mode === "text") sec.append(slider(t("Text"), "text_size", 9, 40, 1, Math.round(textDef), (v) => String(v)));
  if (mode === "icon") sec.append(slider(t("Icon"), "glyph_size", 20, 96, 1, LAYOUT_DEFAULTS[style].glyph, (v) => String(v)));
  if (mode === "image") sec.append(slider(t("Image"), "image_scale", 0.2, 1, 0.05, LAYOUT_DEFAULTS[style].image, (v) => `${Math.round(v * 100)}%`));
  return sec;
}

function swatchRow(value, onChange, allowNone, colors, noneLabel) {
  const list = (colors || SWATCHES).map((c) => (Array.isArray(c) ? c : [c, c]));
  const row = h("div", { class: "swatches" });
  const up = (v) => (v || "").toUpperCase();
  const paint = () => row.querySelectorAll(".swatch").forEach((s) =>
    s.setAttribute("aria-pressed", (s.dataset.c === "" ? !value : up(s.dataset.c) === up(value)) ? "true" : "false"));
  const pick = (c) => { value = c; onChange(c); paint(); };
  const label = noneLabel || t("Default");
  if (allowNone) row.append(h("button", { class: "swatch none", "data-c": "", title: label, "aria-label": label, onclick: () => pick(null) }, ic("ban")));
  for (const [c, name] of list) row.append(h("button", { class: "swatch", "data-c": c, style: { background: c }, title: name, "aria-label": name, onclick: () => pick(c) }));
  const isCustom = value && !list.some(([c]) => up(c) === up(value));
  const custom = h("label", { class: "swatch custom", title: t("Other color"), "data-c": isCustom ? value : "#custom" }, ic("pipette"),
    h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#888888", "aria-label": t("Other color"),
      oninput: (e) => { custom.dataset.c = e.target.value; custom.style.background = e.target.value; custom.classList.add("set"); pick(e.target.value); } }));
  if (isCustom) { custom.style.background = value; custom.classList.add("set"); }
  row.append(custom);
  paint();
  return row;
}

function pickImage(done) {
  const input = $("#filePick");
  input.value = "";
  input.onchange = () => { const f = input.files[0]; if (f) uploadImage(f, done); };
  input.click();
}
function uploadImage(file, done) {
  const reader = new FileReader();
  reader.onload = async () => {
    try { done((await api("/api/upload", { name: file.name, data: reader.result })).path); }
    catch (e) { toast(t("Error sending the image: ") + e.message, { bad: true }); }
  };
  reader.readAsDataURL(file);
}


const STYLE_OPTIONS = [["below", t("Icon with text below")], ["top", t("Text above, icon below")], ["big", t("Icon only, large")]];

// select de estilo; perKey = mostra "usar o padrão" (o da seção icons: do config)
function styleSelect(value, onChange, perKey) {
  const sel = h("select", {});
  if (perKey) {
    const def = (isObj(S.cfg.icons) && S.cfg.icons.style) || "below";
    sel.append(h("option", { value: "" }, t("Same as the others ({0})", [STYLE_OPTIONS.find(([v]) => v === def)[1].toLowerCase()])));
  }
  for (const [v, l] of STYLE_OPTIONS) sel.append(h("option", { value: v }, l));
  sel.value = value || (perKey ? "" : "below");
  sel.addEventListener("change", () => onChange(!sel.value || (!perKey && sel.value === "below") ? null : sel.value));
  return sel;
}

let lookSample = [], lookSampleSeq = 0;   // última prévia do exemplo em Config › Aparência das teclas
function refreshAllPreviews() {
  S.previews = {};
  renderKeys();
  renderInspector();
}

// ---------------------------------------------------------------------------- configurações

// ---------------------------------------------------------------------------- configurações (seções à esquerda, uma por vez)

const SET_SECTIONS = [
  ["general", t("General"), "sliders-horizontal"],
  ["look", t("Key appearance"), "palette"],
  ["integrations", t("Integrations"), "plug"],
  ["advanced", t("Advanced"), "gauge"],
  ["backup", t("Backup"), "download"],
  ["about", t("About"), "info"],
];
let aboutInfo = null;

function openSettings() { S.section = "settings"; renderAll(); }

// controles
function pills(options, value, onPick, label) {
  return h("div", { class: "pills", role: "group", "aria-label": label },
    ...options.map(([v, l]) => h("button", { "aria-pressed": String(v) === String(value) ? "true" : "false", onclick: () => onPick(v) }, l)));
}
function stepper(value, { min, max, step, fmt, label, onChange }) {
  let v = Number(value);
  const out = h("span", { class: "stp-val", "aria-live": "polite" }, fmt(v));
  const round = (x) => Math.round(x / step) * step;
  const set = (d) => {
    const nv = Math.min(max, Math.max(min, round(v + d)));
    if (nv === v) return;
    v = Number(nv.toFixed(4)); out.textContent = fmt(v);
    minus.disabled = v <= min; plus.disabled = v >= max;
    onChange(v);
  };
  const minus = h("button", { class: "stp-btn", "aria-label": t("Decrease {0}", [label]), title: t("Decrease"), onclick: () => set(-step), disabled: v <= min }, ic("minus"));
  const plus = h("button", { class: "stp-btn", "aria-label": t("Increase {0}", [label]), title: t("Increase"), onclick: () => set(step), disabled: v >= max }, ic("plus"));
  return h("div", { class: "stepper", role: "group", "aria-label": label }, minus, out, plus);
}
function setRow(label, control, hint) {
  return h("div", { class: "set-row" }, h("span", { class: "set-label" }, label), control, hint ? h("p", { class: "hint" }, hint) : null);
}
function setSwitch(label, on, onChange, hint) {
  return h("div", { class: "set-row" }, toggleRow(label, on, onChange), hint ? h("p", { class: "hint" }, hint) : null);
}

function renderSettingsView() {
  syncHash();
  const view = $("#settingsView");
  const sec = S.setSection || "general";
  const nav = h("nav", { class: "set-nav", "aria-label": t("Settings sections") },
    ...SET_SECTIONS.map(([k, l, icon]) => h("button", { class: "set-nav-item", "aria-current": k === sec ? "page" : "false",
      onclick: () => { S.setSection = k; renderSettingsView(); } }, ic(icon), l)));
  const title = SET_SECTIONS.find(([k]) => k === sec)[1];
  const body = h("div", { class: "set-body" }, h("h2", { class: "set-title" }, title));
  ({ general: setGeneral, look: setLook, integrations: setIntegrations, advanced: setAdvanced, backup: setBackup, about: setAbout })[sec](body);
  view.replaceChildren(nav, body);
}

const cfgSub = (k) => (S.cfg[k] = isObj(S.cfg[k]) ? S.cfg[k] : {});
const cfgTop = (k, v) => { setOrDelete(S.cfg, k, v); changed({ keys: false }); };
const cfgIn = (sec, k, v) => { setOrDelete(cfgSub(sec), k, v); changed({ keys: false }); };

function loadAbout(then) {
  api("/api/about").then((a) => { aboutInfo = a; then(); }).catch(() => { aboutInfo = { autostart: null }; then(); });
}

function setGeneral(body) {
  const c = S.cfg;
  const names = Object.keys(pages());
  const home = c.home || names[0];
  body.append(
    setRow(t("Language"), pills([["pt-BR", "Português"], ["en", "English"]], LANG, async (v) => {
      if (v === LANG) return;
      cfgTop("language", v);
      await flushSave();              // salva antes de recarregar a página no idioma novo
      I18N.switchTo(v);
    }, t("Language")), t("The language of the editor, the tray menu and the plugins.")),
    setRow(t("Screen brightness"), stepper(c.brightness ?? 100, { min: 0, max: 100, step: 10, label: t("screen brightness"), fmt: (v) => `${v}%`,
      onChange: (v) => cfgTop("brightness", v) }), t("The brightness of the 15 screens. The ring light has its own, in Light.")),
    setRow(t("Home page"), names.length <= 8
      ? pills(names.map((p) => [p, p]), home, (v) => { cfgTop("home", v); renderSettingsView(); renderPages(); }, t("Home page"))
      : (() => { const sel = h("select", { "aria-label": t("Home page"), onchange: (e) => { cfgTop("home", e.target.value); renderPages(); } },
          ...names.map((p) => h("option", { value: p, selected: p === home }, p))); return sel; })(),
      t("The one shown when the app opens.")));
  if (!aboutInfo) return loadAbout(() => { if (S.section === "settings" && (S.setSection || "general") === "general") renderSettingsView(); });
  if (aboutInfo.autostart !== null && aboutInfo.autostart !== undefined) {
    body.append(setSwitch(t("Start with Windows"), !!aboutInfo.autostart, (on) => {
      api("/api/autostart", { enabled: on }).then((r) => { aboutInfo.autostart = r.autostart; renderSettingsView(); })
        .catch((e) => toast(friendlyError(e), { bad: true }));
    }, t("The app opens on its own when you turn on the PC, straight to the tray.")));
  }
}

function setLook(body) {
  const c = S.cfg;
  const icons = c.icons || {};
  const style = icons.style || "below";
  const size = Number(icons.text_size || 16);
  // tecla de exemplo: as três primeiras teclas da página, já com o estilo e o tamanho escolhidos
  // começa com as imagens da última vez: enquanto a nova prévia não chega, nada some (antes piscava)
  const sample = h("div", { class: "set-sample", "aria-label": t("Example") }, ...lookSample.map((src) => h("img", { src, alt: "" })));
  const keys = Object.entries(pageKeys()).sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 3).map(([, k]) => k);
  const paint = () => {
    const list = (keys.length ? keys : [{ icon: { lucide: "mic", text: t("Example"), bg: "#5865F2" } }]).map((k) => ({ icon: normalizeIcon(k.icon) }));
    const seq = ++lookSampleSeq;
    api("/api/preview", { keys: list, icons: S.cfg.icons || null }).then((r) => {
      if (seq !== lookSampleSeq) return;                 // chegou uma resposta mais nova antes
      const srcs = r.images.filter(Boolean).map((x) => x.normal);
      const imgs = sample.querySelectorAll("img");
      if (imgs.length === srcs.length) imgs.forEach((img, i) => { img.src = srcs[i]; });   // troca no lugar, sem redesenhar
      else sample.replaceChildren(...srcs.map((src) => h("img", { src, alt: "" })));
      lookSample = srcs;
    }).catch(() => {});
  };
  paint();
  body.append(
    h("div", { class: "set-row" }, h("span", { class: "set-label" }, t("Example")), sample,
      h("p", { class: "hint" }, t("The first keys of this page, the way they'll look on the Deck."))),
    setRow(t("Style"), pills([["below", t("Icon and text below")], ["top", t("Text above")], ["big", t("Icon only")]], style,
      (v) => { cfgIn("icons", "style", v === "below" ? null : v); refreshAllPreviews(); renderSettingsView(); }, t("Style")),
      t("Applies to all keys. You can change it for a specific key in the Appearance tab.")),
    setRow(t("Text size"), stepper(size, { min: 10, max: 28, step: 1, label: t("text size"), fmt: (v) => String(v),
      onChange: (v) => { cfgIn("icons", "text_size", v === 16 ? null : v); refreshAllPreviews(); paint(); } }),
      t("The same on every key. Long text wraps onto two lines before shrinking.")));
}

// Integrações: uma por plugin (OBS, Discord e os de terceiros), todas no mesmo formato.
// Liga/desliga no topo (os dados ficam guardados quando desliga), "Como configurar" em passos
// e as configurações que o plugin declara no plugin.json.
const intHelpOpen = {};
let pluginInstall = null;          // .zip escolhido, esperando confirmar: { name, data, info }
let pluginRemoving = null;         // id do plugin com a remoção esperando confirmar

function cfgAt(path, create) {
  let node = S.cfg;
  for (const k of path) {
    if (!isObj(node[k])) { if (!create) return null; node[k] = {}; }
    node = node[k];
  }
  return node;
}
function pluginOn(pl) {
  const sec = cfgAt(pl.config_path, false);
  return sec ? sec.enabled !== false : !!pl.default_enabled;
}
function setPluginOn(pl, on) {
  const sec = cfgAt(pl.config_path, true);
  if (on) {
    for (const st of pl.settings || []) if (!(st.name in sec) && st.default !== undefined) sec[st.name] = st.default;
    delete sec.enabled;
  } else sec.enabled = false;
  changed({ keys: false }); renderStatus(); renderSettingsView();
}
function setPluginValue(pl, name, v) {
  const sec = cfgAt(pl.config_path, true);
  setOrDelete(sec, name, v);
  changed({ keys: false });
}
function pluginValue(pl, st) {
  const sec = cfgAt(pl.config_path, false) || {};
  return sec[st.name] ?? st.default;
}
// "when": {"mode": "rpc"} mostra o campo (ou passo) só quando a configuração mode for rpc
function pluginWhen(pl, when) {
  if (!isObj(when)) return true;
  return Object.entries(when).every(([name, want]) => {
    const st = (pl.settings || []).find((x) => x.name === name) || { name };
    const v = pluginValue(pl, st);
    return Array.isArray(want) ? want.map(String).includes(String(v)) : String(v) === String(want);
  });
}
function pluginSteps(pl) {
  return (pl.steps || []).map((x) => (isObj(x) ? x : { text: x })).filter((x) => pluginWhen(pl, x.when)).map((x) => x.text);
}
// texto dos passos: **assim** vira destaque e {nome} vira o valor da configuração
function richStep(text, pl) {
  const out = [];
  const filled = String(text).replace(/\{(\w+)\}/g, (m, n) => {
    const st = (pl.settings || []).find((x) => x.name === n);
    return st ? String(pluginValue(pl, st) ?? "") : m;
  });
  filled.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (part.startsWith("**") && part.endsWith("**")) out.push(h("b", { class: "int-key" }, part.slice(2, -2)));
    else if (part) out.push(part);
  });
  return out;
}
function pluginField(pl, st) {
  const v = pluginValue(pl, st);
  const set = (x) => setPluginValue(pl, st.name, x);
  if (st.kind === "bool") return setSwitch(st.label || st.name, !!v, (on) => { set(on); renderSettingsView(); }, st.help);
  if (st.kind === "enum" && st.style === "pills")       // escolha que muda o resto do bloco: redesenha
    return setRow(st.label || st.name, pills(st.options || [], v, (x) => { set(x); renderSettingsView(); }, st.label || st.name), st.help);
  let input;
  if (st.kind === "shortcut") {
    const box = txt(v, set, st.placeholder ?? "");
    const regen = h("button", { class: "icon-btn combo-regen", title: t("Make another") + ": " + t("A new combination with F13–F24, which no keyboard has"),
      "aria-label": t("Make another"), onclick: async () => {
      const sec = cfgAt(pl.config_path, true);
      const old = sec[st.name];
      delete sec[st.name];                  // a atual não conta como ocupada na hora de gerar outra
      const [c] = await freeBinds(1, pl.shortcut_rules || null);
      if (c) { set(c); box.value = c; } else if (old !== undefined) sec[st.name] = old;
    } }, ic("refresh-cw"));
    input = h("div", { class: "short-field" }, h("div", { class: "combo-box" }, box, regen),
      h("div", { class: "send-row" }, ...shortcutTools(() => box.value.trim() || st.default)));
    const row = setRow(st.label || st.name, input, st.help);
    const warn = conflictNote(v || st.default, (x) => x.plugin === pl.id && x.setting === st.name);
    if (warn) row.append(warn);
    return row;
  }
  if (st.kind === "password") input = h("input", { type: "password", autocomplete: "off", value: v || "", "aria-label": st.label || st.name, oninput: (e) => set(e.target.value) });
  else if (st.kind === "number") input = num(v, set, st.placeholder ?? "", st.step);
  else if (st.kind === "enum") input = h("select", { "aria-label": st.label || st.name, onchange: (e) => set(e.target.value) },
    ...(st.options || []).map(([ov, ol]) => h("option", { value: ov, selected: String(ov) === String(v) }, ol)));
  else input = txt(v, set, st.placeholder ?? "");
  return setRow(st.label || st.name, input, st.help);
}
function pluginState(pl, on) {
  const st = S.status || {};
  if (!on) return h("span", { class: "int-state" }, t("Off"));
  if (!st.engine) return h("span", { class: "int-state wait", title: t("The Deck app is not running") }, ic("circle-alert"), t("App closed"));
  const ps = (st.plugins || {})[pl.id] || {};
  const cls = ps.state === "ok" ? " ok" : ps.state === "error" ? " bad" : ps.state === "wait" ? " wait" : "";
  const icon = ps.state === "ok" ? "check" : ps.state === "error" ? "circle-alert" : ps.state === "wait" ? "refresh-cw" : null;
  return h("span", { class: "int-state" + cls, title: ps.error || ps.detail || "" }, icon ? ic(icon) : null, ps.label || t("On"));
}

function pluginBlock(pl) {
  const on = pluginOn(pl);
  const open = intHelpOpen[pl.id] ?? !on;                 // desligada: o passo a passo já vem aberto
  const sw = h("button", { class: "switch", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": t("Enable {0}", [pl.name]),
    onclick: () => setPluginOn(pl, !on) });
  const meta = pl.builtin ? pl.description : [pl.description, h("span", { class: "int-by" }, (pl.author ? t("By {0}, version {1}", [pl.author, pl.version || "?"]) : t("Version {0}", [pl.version || "?"])))];
  const block = h("section", { class: "int-block" + (on ? "" : " off") },
    h("div", { class: "int-head", style: { "--cat": pl.color || "#868d99" } },
      h("span", { class: "int-logo" }, ic(pl.icon || "plug")),
      h("div", { class: "grow" }, h("h3", {}, pl.name), h("small", {}, meta)),
      pluginState(pl, on), sw));
  const steps = pluginSteps(pl);
  if (steps.length) block.append(h("div", { class: "int-help" },
    h("button", { class: "int-help-btn", "aria-expanded": open ? "true" : "false",
      onclick: () => { intHelpOpen[pl.id] = !open; renderSettingsView(); } }, ic("chevron-right"), t("How to set up")),
    open ? h("ol", { class: "int-steps" }, ...steps.map((t) => h("li", {}, ...richStep(t, pl)))) : null));
  if (on && (pl.settings || []).length) {
    const fields = h("div", { class: "int-fields" });
    const list = pl.settings.filter((x) => pluginWhen(pl, x.when));
    for (let i = 0; i < list.length; i++) {
      if (list[i].half && list[i + 1] && list[i + 1].half) { fields.append(h("div", { class: "pair" }, pluginField(pl, list[i]), pluginField(pl, list[i + 1]))); i++; }
      else fields.append(pluginField(pl, list[i]));
    }
    if (pl.id === "obs" && (S.status || {}).obs && (S.obs.scenes || []).length) {
      const n = S.obs.scenes.length;
      fields.append(h("p", { class: "hint" }, (n === 1 ? t("1 scene found. It shows up in the OBS actions.") : t("{0} scenes found. They show up in the OBS actions.", [n]))));
    }
    block.append(fields);
  }
  if (!pl.builtin) {
    const perms = pl.permissions || [];
    block.append(h("div", { class: "int-foot" },
      perms.length ? h("p", { class: "hint" }, t("This plugin can: ") + perms.join("; ") + ".") : h("span", {}),
      pluginRemoving === pl.id
        ? h("div", { class: "row" },
            h("button", { class: "btn small", onclick: () => { pluginRemoving = null; renderSettingsView(); } }, t("Cancel")),
            h("button", { class: "btn small danger", onclick: () => removePlugin(pl) }, ic("trash-2"), t("Remove for good")))
        : h("button", { class: "btn small ghost", onclick: () => { pluginRemoving = pl.id; renderSettingsView(); } }, ic("trash-2"), t("Remove plugin"))));
  }
  return block;
}

function setIntegrations(body) {
  const plugins = (S.schema && S.schema.plugins) || [];
  const builtin = plugins.filter((p) => p.builtin), third = plugins.filter((p) => !p.builtin);
  body.append(...builtin.map(pluginBlock));

  // plugins de terceiros
  body.append(h("div", { class: "int-section" }, h("h3", {}, t("Third-party plugins")),
    h("p", { class: "hint" }, t("Plugins add actions and integrations with other programs. Each one runs as a separate program: if it freezes, the Deck keeps working. Only install plugins from people you trust."))));
  body.append(...third.map(pluginBlock));
  for (const err of (S.schema && S.schema.plugin_errors) || []) {
    body.append(h("div", { class: "note-box bad" }, ic("circle-alert"), h("span", {}, t("The folder \"{0}\" didn't load: {1}", [err.folder, err.error]))));
  }
  if (pluginInstall) body.append(installConfirm());
  else body.append(h("div", { class: "row" }, h("button", { class: "btn", onclick: pickPlugin }, ic("upload"), t("Install plugin (.zip)"))));
}

function pickPlugin() {
  const input = h("input", { type: "file", accept: ".zip", hidden: true });
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const info = await api("/api/plugins/inspect", { data: rd.result });
        pluginInstall = { name: f.name, data: rd.result, info };
      } catch (e) { toast(friendlyError(e), { bad: true }); pluginInstall = null; }
      renderSettingsView();
    };
    rd.readAsDataURL(f);
  });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}

function installConfirm() {
  const { info } = pluginInstall;
  const m = info.manifest;
  const perms = m.permissions || [];
  const box = h("section", { class: "int-block install" },
    h("div", { class: "int-head", style: { "--cat": m.color || "#868d99" } },
      h("span", { class: "int-logo" }, ic(m.icon || "plug")),
      h("div", { class: "grow" }, h("h3", {}, m.name), h("small", {}, (m.author ? t("By {0}, version {1}", [m.author, m.version || "?"]) : t("Version {0}", [m.version || "?"]))))),
    m.description ? h("p", { class: "set-lead" }, m.description) : null,
    info.actions.length ? setRow(t("Actions"), h("p", { class: "set-lead" }, info.actions.join(", "))) : null,
    setRow(t("What it can do"), h("p", { class: "set-lead" }, perms.length ? perms.join("; ") + "." : t("The plugin didn't say.")),
      t("The plugin runs as a program on your PC. Only install it if you trust whoever made it.")),
    info.builtin_conflict ? h("p", { class: "hint bad" }, t("There's already a built-in plugin with this name. It can't be installed.")) : null,
    info.installed ? h("p", { class: "hint" }, t("Version {0} is already installed; installing replaces it with {1}.", [info.installed, m.version || t("the new one")])) : null,
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => { pluginInstall = null; renderSettingsView(); } }, t("Cancel")),
      h("button", { class: "btn primary", disabled: info.builtin_conflict, onclick: installPlugin }, ic("download"), info.installed ? t("Update") : t("Install"))));
  return box;
}

async function installPlugin() {
  try {
    const r = await api("/api/plugins/install", { data: pluginInstall.data, replace: !!pluginInstall.info.installed });
    applySchema(r.schema);
    const name = pluginInstall.info.manifest.name;
    pluginInstall = null;
    intHelpOpen[r.id] = true;
    toast(t("{0} installed. Enable the plugin to use it.", [name]));
    renderAll();
  } catch (e) { toast(friendlyError(e), { bad: true }); }
}

async function removePlugin(pl) {
  try {
    const r = await api("/api/plugins/remove", { id: pl.id });
    applySchema(r.schema);
    pluginRemoving = null;
    toast(`${pl.name} removido.`);
    renderAll();
  } catch (e) { toast(friendlyError(e), { bad: true }); }
}

function setAdvanced(body) {
  const dev = S.cfg.device || {};
  body.append(
    h("div", { class: "int-section" }, h("h3", {}, t("Keys"))),
    setRow(t("Double tap time"), stepper(S.cfg.double_tap_ms ?? 250, { min: 150, max: 600, step: 25, label: t("double tap time"),
      fmt: (v) => `${v} ms`, onChange: (v) => cfgTop("double_tap_ms", v === 250 ? null : v) }),
      t("How long the key waits for a second tap. Less = faster keys on pages with double tap; more = easier to double tap.")),
    h("div", { class: "int-section" }, h("h3", {}, t("Sending images"))),
    h("p", { class: "set-lead" }, t("Sending images to the screens. Only change this if some key stops updating.")),
    setRow(t("Pause between commands"), stepper(dev.settle ?? 1, { min: 0, max: 2, step: 0.05, label: t("pause between commands"),
      fmt: (v) => numFmt(v, 2), onChange: (v) => cfgIn("device", "settle", v) }), t("Higher = slower and safer.")),
    setRow(t("Pause per key"), stepper(dev.key_delay ?? 0.3, { min: 0, max: 1, step: 0.01, label: t("pause per key"),
      fmt: (v) => `${numFmt(v, 2)} s`, onChange: (v) => cfgIn("device", "key_delay", v) })),
    setSwitch(t("Send one image at a time"), dev.per_key_session !== false, (on) => { cfgIn("device", "per_key_session", on); renderSettingsView(); },
      t("Much slower, but the safest mode.")));
}

function setBackup(body) {
  // o interruptor só decide o que vai no arquivo exportado; não mexe no config
  let secrets = false;
  const label = t("Include the OBS password in the exported file");
  const sw = h("button", { class: "switch", role: "switch", "aria-checked": "false", "aria-label": label,
    onclick: () => { secrets = !secrets; sw.setAttribute("aria-checked", secrets ? "true" : "false"); } });
  const box = h("div", { class: "set-row" });
  body.append(
    h("p", { class: "set-lead" }, t("Take your setup to another PC or keep a copy. The .zip file includes the key images.")),
    h("div", { class: "set-row" }, h("div", { class: "row", style: { flexWrap: "wrap" } },
      h("button", { class: "btn", onclick: () => exportConfig(secrets) }, ic("download"), t("Export")),
      h("button", { class: "btn", onclick: () => importConfig(box) }, ic("upload"), t("Import…")))),
    h("div", { class: "set-row" }, h("div", { class: "toggle-row" }, h("span", { class: "grow" }, label), sw)),
    box);
}

function setAbout(body) {
  if (!aboutInfo) return loadAbout(() => { if (S.section === "settings" && S.setSection === "about") renderSettingsView(); });
  const a = aboutInfo;
  const st = S.status || {};
  const line = (label, value) => h("div", { class: "about-line" }, h("span", {}, label), h("b", {}, value));
  body.append(
    h("div", { class: "about-list" },
      line(t("Device"), t("Fifine AmpliGame D6")),
      line(t("Firmware"), a.firmware || (st.device ? "lendo…" : t("Deck disconnected"))),
      line(t("Settings file"), a.config || "?")),
    h("div", { class: "set-row" }, h("div", { class: "row", style: { flexWrap: "wrap" } },
      h("button", { class: "btn", onclick: () => api("/api/open", { what: "folder" }).catch((e) => toast(friendlyError(e), { bad: true })) }, ic("folder"), t("Open the app folder")),
      h("button", { class: "btn", onclick: () => api("/api/open", { what: "log" }).catch((e) => toast(friendlyError(e), { bad: true })) }, ic("file-text"), t("View the log")))),
    h("p", { class: "hint" }, t("Icons: Lucide (lucide.dev), ISC license. Font: Figtree.")));
}

// ---------------------------------------------------------------------------- páginas e teclas

function addPage() {
  let n = 1, name;
  do { name = n === 1 ? t("new") : `${t("new")} ${n}`; n++; } while (pages()[name]);
  pages()[name] = {};
  S.page = name; S.key = null; buildModel();
  changed({ keys: false });
  renderAll();
  startRename(name);   // já abre o nome para editar
}

function renamePage(name) {
  const old = S.page;
  if (!name || name === old) return renderPages();
  if (pages()[name]) { toast(t("There's already a page called {0}.", [name]), { bad: true }); return renderPages(); }
  S.cfg.pages = Object.fromEntries(Object.entries(pages()).map(([k, v]) => [k === old ? name : k, v]));
  if (S.cfg.home === old) S.cfg.home = name;
  const fix = (a) => {
    if (typeof a === "string") return a === `page:${old}` ? `page:${name}` : a;
    if (Array.isArray(a)) return a.map(fix);
    if (isObj(a)) return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k === "page" && v === old && a.type === "page" ? name : fix(v)]));
    return a;
  };
  for (const keys of Object.values(S.cfg.pages)) for (const spec of Object.values(keys))
    for (const f of MOMENTS) if (spec && spec[f] !== undefined) spec[f] = fix(spec[f]);
  S.previews[name] = S.previews[old];
  S.page = name; buildModel();
  changed({ keys: false });
  renderAll();
  toast(t("Page renamed to {0}. The buttons that led to it were updated.", [name]));
}

function deletePage() {
  const name = S.page;
  delete pages()[name];
  if (S.cfg.home === name) S.cfg.home = Object.keys(pages())[0];
  S.page = Object.keys(pages())[0]; S.key = null; buildModel();
  changed();
  renderAll();
  toast(t("Page {0} deleted.", [name]), { undo: true });
}

async function showPageOnDeck() {
  if (!(await flushSave())) return toast(t("Fix the errors first: the page hasn't been saved yet."), { bad: true });
  await new Promise((r) => setTimeout(r, 1200));   // o app recarrega o config em até 1 s
  try { await api("/api/show", { page: S.page }); toast(t("Showing {0} on the Deck.", [S.page])); }
  catch (e) { toast(e.message, { bad: true }); }
}

async function testKey() {
  const wasDirty = isDirty();
  if (!(await flushSave())) return toast(t("Fix the errors first: the key hasn't been saved yet."), { bad: true });
  if (wasDirty) await new Promise((r) => setTimeout(r, 1200));
  try { await api("/api/press", { page: S.page, key: Number(S.key) }); toast(t("Action run.")); }
  catch (e) { toast(e.message, { bad: true }); }
}

function copyKey() {
  const spec = pageKeys()[S.key];
  if (!spec) return;
  S.clipboard = clone(spec);
  toast(t("Key {0} copied.", [S.key]));
  renderInspector();
}

async function pasteKey() {
  if (!S.clipboard || S.key === null) return;
  const spec = clone(S.clipboard);
  const lists = MOMENTS.map((f) => toList(spec[f]));
  const n = await fillBinds(lists.flat());   // duas teclas não podem mandar a mesma combinação
  if (n) MOMENTS.forEach((f, i) => setOrDelete(spec, f, collapse(lists[i])));
  pageKeys()[S.key] = spec;
  S.previews[S.page] = null; buildModel();
  changed(); renderKeys(); renderInspector();
  toast(n ? t("Key pasted with a new shortcut: link it again in the other program.") : t("Key pasted."), { undo: true });
}

function clearKey() {
  if (!pageKeys()[S.key]) return;
  delete pageKeys()[S.key];
  S.previews[S.page] = null; buildModel();
  changed(); renderKeys(); renderInspector();
  toast(t("Key {0} deleted.", [S.key]), { undo: true });
}

// ---------------------------------------------------------------------------- histórico de versões

function replaceConfig(cfg) {   // depois de restaurar/importar: o servidor já gravou
  S.cfg = cfg;
  S.saved = JSON.stringify(cfg);
  if (!pages()[S.page]) S.page = pages()[S.cfg.home] ? S.cfg.home : Object.keys(pages())[0];
  S.key = null; S.previews = {};
  H.stack = []; H.idx = -1; snapshot();
  buildModel(); renderAll(); showProblems([]); setSaveState("saved"); dropPending();
}

function dayLabel(ts) {
  const d = new Date(ts * 1000), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t("Today");
  if (d.toDateString() === y.toDateString()) return t("Yesterday");
  return d.toLocaleDateString(LANG, { weekday: "long", day: "numeric", month: "long" });
}
function agoLabel(ts) {
  const s = Math.round(Date.now() / 1000 - ts);
  if (s < 60) return t("just now");
  if (s < 3600) return t("{0} min ago", [Math.round(s / 60)]);
  if (s < 86400) return t("{0} h ago", [Math.round(s / 3600)]);
  return "";
}

async function openHistory() {
  await flushSave();
  const card = $("#historyCard");
  card.replaceChildren(h("p", { class: "fine" }, "Carregando…"));
  $("#historySheet").hidden = false;
  let entries;
  try { entries = (await api("/api/history")).entries; }
  catch (e) { card.replaceChildren(h("p", {}, t("Error loading the history: ") + e.message)); return; }
  const list = h("div", { class: "history" });
  let lastDay = null;
  entries.forEach((e, i) => {
    const day = dayLabel(e.time);
    if (day !== lastDay) { list.append(h("h3", { class: "history-day" }, day)); lastDay = day; }
    const time = new Date(e.time * 1000).toLocaleTimeString(LANG, { hour: "2-digit", minute: "2-digit" });
    const items = e.summary.slice(0, 4);
    const restore = i === 0 ? h("span", { class: "history-now" }, t("Current version")) : h("button", { class: "btn small" }, t("Go back to this one"));
    if (i > 0) {
      let armed = false;
      restore.addEventListener("click", async () => {
        if (!armed) { armed = true; restore.textContent = t("Click again to confirm"); restore.classList.add("armed"); return; }
        try {
          const r = await api("/api/history/restore", { id: e.id });
          replaceConfig(r.config);
          closeSheets();
          toast(t("Went back to the version from {0}. Changed your mind? Just open the history again.", [r.when]));
        } catch (err) { toast(t("Couldn't go back: ") + err.message, { bad: true }); }
      });
    }
    list.append(h("div", { class: "history-item" + (i === 0 ? " current" : "") },
      h("div", { class: "history-time" }, h("b", {}, time), h("small", {}, agoLabel(e.time))),
      h("div", { class: "history-what" },
        e.reason ? h("b", {}, e.reason) : null,
        h("ul", {}, ...items.map((s) => h("li", {}, s)), e.summary.length > 4 ? h("li", { class: "fine" }, t("and {0} more", [e.summary.length - 4])) : null)),
      restore));
  });
  card.replaceChildren(
    h("div", { class: "row" }, h("h2", {}, t("History")), h("span", { class: "grow" }),
      h("button", { class: "icon-btn", "aria-label": t("Close"), onclick: closeSheets }, ic("x"))),
    h("p", { class: "fine", style: { margin: "4px 0 14px" } }, t("Every time something is saved, a version is kept here. Changes made in a row go into the same version.")),
    entries.length ? list : h("p", {}, t("No versions saved yet.")));
}
$("#btnHistory").addEventListener("click", openHistory);

// ---------------------------------------------------------------------------- exportar / importar

async function exportConfig(includeSecrets) {
  await flushSave();
  try {
    const r = await api("/api/export", { include_secrets: includeSecrets });
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = h("a", { href: url, download: r.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(t("File {0} downloaded.", [r.name]));
  } catch (e) { toast(t("Error exporting: ") + e.message, { bad: true }); }
}

function importConfig(box) {
  const input = $("#importPick");
  input.value = "";
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const payload = { name: f.name, data: reader.result };
      let summary;
      try { summary = (await api("/api/import", { ...payload, dry_run: true })).summary; }
      catch (e) { box.replaceChildren(h("p", { class: "import-error" }, t("Couldn't read the file: ") + e.message)); return; }
      const run = async (mode) => {
        await flushSave();
        try {
          const r = await api("/api/import", { ...payload, mode });
          if (!r.ok) { box.replaceChildren(h("p", { class: "import-error" }, t("The file has problems:")), h("ul", {}, r.errors.map((e) => h("li", {}, friendlyError(e))))); return; }
          replaceConfig(r.config);
          closeSheets();
          toast(mode === "replace" ? t("Setup imported. If you don't like it, go back through the history.") : t("Pages added. If you don't like it, go back through the history."));
        } catch (e) { toast(t("Error importing: ") + e.message, { bad: true }); }
      };
      const n = summary.pages.length;
      box.replaceChildren(h("div", { class: "import-box" },
        h("b", {}, f.name),
        h("p", {}, (n === 1 ? t("1 page ({0}), {1} keys", [summary.pages.join(", "), summary.keys]) : t("{0} pages ({1}), {2} keys", [n, summary.pages.join(", "), summary.keys])) + (summary.images ? t(", {0} images", [summary.images]) : "") + "."),
        h("div", { class: "row", style: { flexWrap: "wrap" } },
          h("button", { class: "btn small primary", onclick: () => run("replace") }, t("Replace everything")),
          h("button", { class: "btn small", onclick: () => run("merge") }, t("Only add the pages")),
          h("button", { class: "btn small ghost", onclick: () => box.replaceChildren() }, t("Cancel"))),
        h("p", { class: "fine", style: { margin: 0 } }, t("The current version stays in the history, so you can go back."))));
    };
    reader.readAsDataURL(f);
  };
  input.click();
}

// ---------------------------------------------------------------------------- atalhos de teclado

$("#btnUndo").addEventListener("click", () => travel(-1));
$("#btnRedo").addEventListener("click", () => travel(1));

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === "s") { e.preventDefault(); return flushSave(); }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  const sheetOpen = [...document.querySelectorAll(".sheet")].some((s) => !s.hidden);
  if (e.key === "Escape") {
    closePagesMenu();
    if (sheetOpen) return closeSheets();
    document.body.classList.remove("lib-open");
    if (S.expanded && !typing) { S.expanded = false; return renderAll(); }
  }
  if (typing || sheetOpen) return;
  if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); return travel(-1); }
  if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); return travel(1); }
  if (mod && k === "c" && S.key) return copyKey();
  if (mod && k === "v" && S.key) return pasteKey();
  if ((e.key === "Delete" || e.key === "Backspace") && S.key) { e.preventDefault(); return clearKey(); }
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 };
  if (moves[e.key] !== undefined) {
    e.preventDefault();
    const next = S.key ? Number(S.key) + moves[e.key] : 1;
    if (next >= 1 && next <= 15) selectKey(String(next), true);
  }
  if (e.key === "Escape" && S.key) { S.key = null; buildModel(); renderKeys(); renderInspector(); }
});
// fechando a aba com algo pendente: manda salvar mesmo assim (keepalive sobrevive ao fechamento)
window.addEventListener("pagehide", () => {
  if (!S.cfg || !isDirty()) return;
  fetch("/api/config", { method: "POST", keepalive: true, headers: { "X-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ config: S.cfg }) });
});
document.addEventListener("dragend", () => { S.drag = null; clearDropMarks(); });

// ---------------------------------------------------------------------------- listas do OBS

function updateDatalists() {
  for (const [id, items] of [["dl-scenes", S.obs.scenes], ["dl-inputs", S.obs.inputs]]) {
    let dl = document.getElementById(id);
    if (!dl) { dl = h("datalist", { id }); document.body.append(dl); }
    dl.replaceChildren(...items.map((s) => h("option", { value: s })));
  }
}

// ---------------------------------------------------------------------------- folhas

const GLYPHS = [
  ["E720", t("Microphone")], ["EC54", t("Microphone muted")], ["E7F6", t("Headphones")], ["E767", t("Volume")],
  ["E74F", t("Mute")], ["E993", t("Volume down")], ["E995", t("Volume up")], ["E768", t("Play")], ["E769", t("Pause")],
  ["E71A", t("Stop")], ["E892", t("Previous")], ["E893", t("Next")], ["E8B1", t("Shuffle")], ["E8EE", t("Repeat")],
  ["E8D6", t("Music")], ["E7C8", t("Record")], ["E93E", t("Broadcast")], ["E714", t("Video camera")],
  ["E722", t("Camera")], ["E7F4", t("Monitor")], ["E7FC", t("Game")], ["E8BD", t("Message")], ["E8F2", t("Chat")],
  ["E715", "E-mail"], ["E717", t("Phone")], ["E774", t("Internet")], ["E80F", t("Home")], ["E72B", t("Back")],
  ["E72A", t("Forward")], ["E8B7", t("Folder")], ["E8A5", t("Document")], ["E70B", t("Note")], ["E765", t("Keyboard")],
  ["E713", t("Settings")], ["E706", t("Brightness")], ["E708", t("Moon")], ["E7E8", t("Turn off")], ["E72E", t("Lock")],
  ["E785", t("Unlock")], ["E77B", t("Person")], ["E716", t("People")], ["E734", t("Star")], ["E735", t("Filled star")],
  ["EB51", t("Heart")], ["EB52", t("Filled heart")], ["E945", t("Lightning")], ["E968", t("Network")], ["E896", t("Download")],
  ["E898", t("Upload")], ["E74E", t("Save")], ["E74D", t("Trash")], ["E710", t("Plus")], ["E738", t("Minus")],
  ["E711", t("Close")], ["E73E", t("Confirm")], ["E7BA", t("Warning")], ["E946", t("Information")], ["E897", t("Help")],
  ["E8C8", t("Copy")], ["E77F", t("Paste")], ["E8C6", t("Cut")], ["E7A7", t("Undo")], ["E7A6", t("Redo")],
  ["E72C", t("Update")], ["E787", t("Calendar")], ["E823", t("Clock")], ["E916", t("Timer")], ["E7B3", t("Eye")],
  ["ED1A", t("Hide##2")], ["E8A7", t("Open in window")], ["E790", t("Color")], ["E771", t("Customize")], ["EA8F", t("Bell")],
  ["E7F8", t("Laptop")], ["E701", "Wi-Fi"], ["E702", t("Bluetooth")], ["E719", t("Store")], ["E7BF", t("Cart")],
  ["E8EC", t("Tag")], ["E718", t("Pin")], ["E71C", t("Filter")], ["E721", t("Search")], ["E8FD", t("List")],
  ["E700", t("Menu")], ["E81C", t("History")], ["E8F1", t("Library")], ["E756", t("Terminal")], ["E71B", t("Link")],
];

// ícones das teclas: Lucide (a mesma fonte que o app usa para desenhar). GLYPHS acima vira a lista dos mais usados.
let LUCIDE_IDX = {};                       // nome -> [código, etiquetas em inglês]
const luChar = (name) => { const v = LUCIDE_IDX[name]; return v ? String.fromCodePoint(v[0]) : ""; };
let POPULAR = [], POPULAR_NAMES = {};
fetch("lucide-index.json").then((r) => r.json()).then((d) => {
  LUCIDE_IDX = d;
  buildPopular();
  if (S.cfg && S.key && S.tab === "look") renderInspector();
}).catch(() => {});
function buildPopular() {
  const map = (S.schema && S.schema.segoe_to_lucide) || {};
  if (!Object.keys(map).length) return;
  const seen = new Set();
  POPULAR = [];
  for (const [code, label] of GLYPHS) {
    const n = map[code.toUpperCase()];
    if (n && !seen.has(n)) { seen.add(n); POPULAR.push([n, label]); POPULAR_NAMES[n] = label; }
  }
  for (const [n, label] of [["lightbulb", t("Light")], ["clapperboard", t("Scene")], ["layers", t("Pages")], ["mic-off", t("Microphone muted")]]) {
    if (!seen.has(n)) { seen.add(n); POPULAR.push([n, label]); POPULAR_NAMES[n] = label; }
  }
}
// busca em português: palavra -> termos em inglês do Lucide
const PT_ICON_WORDS = {
  microfone: "mic", mudo: "mute volume-x off", mutado: "mic-off mute", fone: "headphones", audio: "volume audio speaker",
  som: "volume speaker audio", tocar: "play", pausar: "pause", pausa: "pause", parar: "square stop", anterior: "skip-back previous",
  proxima: "skip-forward next", musica: "music", gravar: "circle-dot record", gravacao: "record circle-dot", transmitir: "radio broadcast",
  live: "radio broadcast", camera: "camera video webcam", video: "video film", tela: "monitor screen", monitor: "monitor",
  jogo: "gamepad game", controle: "gamepad", mensagem: "message", conversa: "messages chat", email: "mail", telefone: "phone",
  internet: "globe", navegador: "globe browser", site: "globe link", casa: "house home", inicio: "house home", voltar: "arrow-left back",
  avancar: "arrow-right forward", pasta: "folder", arquivo: "file", documento: "file-text", nota: "sticky-note note", teclado: "keyboard",
  configuracoes: "settings", ajustes: "settings sliders", brilho: "sun brightness", lua: "moon", desligar: "power", cadeado: "lock",
  pessoa: "user", pessoas: "users", estrela: "star", coracao: "heart", raio: "zap lightning", rede: "network", baixar: "download",
  enviar: "upload send", salvar: "save", lixeira: "trash", apagar: "trash eraser", mais: "plus", menos: "minus", fechar: "x close",
  confirmar: "check", aviso: "triangle-alert warning", informacao: "info", ajuda: "help", copiar: "copy", colar: "clipboard paste",
  recortar: "scissors cut", desfazer: "undo", refazer: "redo", atualizar: "refresh", calendario: "calendar", relogio: "clock",
  cronometro: "timer", olho: "eye", ocultar: "eye-off", janela: "app-window", cor: "palette color", pincel: "paintbrush",
  sino: "bell", notificacao: "bell", notebook: "laptop", loja: "store", carrinho: "shopping-cart", etiqueta: "tag", fixar: "pin",
  filtro: "filter", buscar: "search", lista: "list", historico: "history", biblioteca: "library", luz: "lightbulb lamp light",
  lampada: "lightbulb lamp", cena: "clapperboard scene film", foto: "image camera", imagem: "image", codigo: "code",
  dinheiro: "dollar coins", chat: "message chat", cafe: "coffee", comida: "utensils", carro: "car", aviao: "plane",
  mapa: "map", seta: "arrow", cima: "up", baixo: "down", esquerda: "left", direita: "right", livro: "book", escudo: "shield",
  fogo: "flame", agua: "droplet", nuvem: "cloud", chuva: "cloud-rain", sol: "sun", bateria: "battery", tempo: "timer clock",
};
let glyphCb = null, actionCb = null;
function closeSheets() { document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true)); glyphCb = actionCb = null; }

function openGlyphPicker(cb) {
  glyphCb = cb;
  if (!POPULAR.length) buildPopular();
  $("#glyphSheet").hidden = false;
  $("#glyphSearch").value = "";
  renderGlyphs("");
  $("#glyphSearch").focus();
}
function iconMatches(name, q) {
  const v = LUCIDE_IDX[name];
  const hay = name + " " + (v ? v[1] : "") + " " + norm(POPULAR_NAMES[name] || "");
  if (hay.includes(q)) return true;
  // palavras em português viram termos em inglês; aí vale a palavra inteira (senão "mic" acharia "atomic")
  const tokens = hay.split(/[\s-]+/);
  for (const [pt, en] of Object.entries(PT_ICON_WORDS)) {
    if (pt.startsWith(q) && en.split(" ").some((w) => tokens.some((t) => t === w || (w.length >= 4 && t.startsWith(w))))) return true;
  }
  return false;
}
function renderGlyphs(q) {
  const nq = norm(q).trim();
  const item = (name, label) => h("button", { class: "glyph-item", title: name,
    onclick: () => { const cb = glyphCb; closeSheets(); cb && cb(name); } },
    h("span", { class: "lu-ch", "aria-hidden": "true" }, luChar(name)), h("span", {}, label || name.replace(/-/g, " ")));
  const grid = $("#glyphGrid");
  if (!nq) {
    grid.replaceChildren(h("h3", { class: "glyph-sec" }, t("Most used")), ...POPULAR.map(([n, l]) => item(n, l)),
      h("h3", { class: "glyph-sec" }, t("All icons")),
      ...Object.keys(LUCIDE_IDX).filter((n) => !POPULAR_NAMES[n]).map((n) => item(n)));
    return;
  }
  const found = Object.keys(LUCIDE_IDX).filter((n) => iconMatches(n, nq));
  const rank = (n) => (n === nq || norm(POPULAR_NAMES[n] || "") === nq ? 0 : n.startsWith(nq) ? 1 : norm(POPULAR_NAMES[n] || "").startsWith(nq) ? 2 : POPULAR_NAMES[n] ? 3 : 4);
  found.sort((a, b) => rank(a) - rank(b));
  grid.replaceChildren(...found.map((n) => item(n, POPULAR_NAMES[n])));
  if (!found.length) grid.append(h("p", { class: "fine" }, t("No icon with that name. Try in English too, like mic, play or folder.")));
}
$("#glyphSearch").addEventListener("input", debounce((e) => renderGlyphs(e.target.value), 120));
$("#glyphClose").addEventListener("click", closeSheets);

function openActionPicker(current, cb) {
  actionCb = cb;
  $("#actionSheet").hidden = false;
  $("#actionSearch").value = "";
  renderActionOptions("", current);
  $("#actionSearch").oninput = (e) => renderActionOptions(e.target.value, current);
  $("#actionSearch").focus();
}
function renderActionOptions(q, current) {
  const pick = (t) => { const cb = actionCb; closeSheets(); cb && cb(t); };
  const groups = groupedActions(q);
  $("#actionGroups").replaceChildren(...groups.map(([gname, items]) => h("section", { style: { "--cat": GROUPS[gname].color } },
    h("h3", {}, t(gname)),
    h("div", { class: "picker-grid" }, ...items.map(([type, d]) => h("button", {
      class: "picker-item", style: catStyle(type), "aria-current": type === current ? "true" : "false", onclick: () => pick(type) },
      h("span", { class: "chip" }, actionIc(type)),
      h("span", { class: "label" }, d.label, d.help ? h("small", {}, d.help.split(".")[0] + ".") : null)))))));
  if (!groups.length) $("#actionGroups").append(h("p", { class: "fine" }, t("No actions found.")));
}
$("#actionClose").addEventListener("click", closeSheets);
document.querySelectorAll(".sheet").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s) closeSheets(); }));

// ----------------------------------------------------------------------------

load().catch((e) => fatal(t("Error loading the editor: ") + e.message));
