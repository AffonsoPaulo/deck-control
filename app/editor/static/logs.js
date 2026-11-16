"use strict";
// Aba Logs: só um visualizador do que o app grava em app.log (o arquivo é gravado com a aba ligada ou não).
// As mensagens do log ficam em inglês; a tela em volta segue o idioma do editor.
// Também: o número de erros novos (na aba ou, com ela escondida, no grupo de status) e a parte
// "Logs e diagnóstico" de Config › Avançado.

const LOG_AREAS = () => [
  ["keys", t("Keys"), t("press, release, double tap, repeat")],
  ["values", t("Values"), t("what changed, from what to what")],
  ["automations", t("Automations"), t("why it fired or not")],
  ["plugins", t("Plugins"), t("talking to OBS, Discord, Weather")],
  ["editor", t("Editor"), t("requests and response time")],
  ["device", t("Device"), t("USB, drawing the keys, light")],
];
const LV = { ERROR: ["circle-x", "err"], WARN: ["triangle-alert", "warn"], INFO: ["info", "info"], DEBUG: ["bug", "dbg"] };
const LOG_SHOW = 1000;          // linhas na tela; o arquivo tem tudo

const LOGS = { recs: [], last: 0, summary: null, problems: [], files: null, detail: null,
  level: "all", area: "", q: "", follow: true, open: new Set(), timer: null, loaded: false };

const logCfg = () => (isObj(S.cfg && S.cfg.logging) ? S.cfg.logging : {});
const logsTabOn = () => !!logCfg().show_tab;
const pad2 = (n) => String(n).padStart(2, "0");
function logTime(t, ms = true) {
  const d = new Date(t * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` + (ms ? `.${String(d.getMilliseconds()).padStart(3, "0")}` : "");
}
const fmtBytes = (b) => (b >= 1e6 ? `${numFmt(b / 1e6, 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// ---------------------------------------------------------------------------- buscar

async function fetchLogs() {
  const r = await api(`/api/logs?after=${LOGS.last}`);
  LOGS.summary = r.summary; LOGS.problems = r.problems || []; LOGS.files = r.files; LOGS.detail = r.detail;
  const fresh = r.records || [];
  if (fresh.length) {
    LOGS.recs.push(...fresh);
    if (LOGS.recs.length > 3000) LOGS.recs.splice(0, LOGS.recs.length - 3000);
    LOGS.last = fresh[fresh.length - 1].id;
  } else if (r.summary && r.summary.last < LOGS.last) {   // o app reiniciou: os ids recomeçaram
    LOGS.recs = []; LOGS.last = 0; LOGS.open.clear();
    return fetchLogs();
  }
  LOGS.loaded = true;
  return fresh;
}

function pollLogs() {
  clearTimeout(LOGS.timer);
  if (S.section !== "logs") return;
  LOGS.timer = setTimeout(async () => {
    try {
      const fresh = await fetchLogs();
      if (S.section !== "logs") return;
      markLogsSeen();
      renderLogProblems();
      if (fresh.length) appendLogRows(fresh);
      renderLogCounts();
    } catch { /* app fechado: tenta de novo */ }
    pollLogs();
  }, 1500);
}

function markLogsSeen() {
  if (!LOGS.summary || LOGS.summary.seen >= LOGS.last) return;
  api("/api/logs/seen", { upto: LOGS.last }).catch(() => {});
  LOGS.summary.seen = LOGS.last; LOGS.summary.new_errors = 0;
  if (S.status && S.status.logs) S.status.logs.new_errors = 0;
  renderLogsBadge();
}

// ---------------------------------------------------------------------------- a aba

function renderLogsView() {
  const view = $("#logsView");
  if (!LOGS.loaded) {
    view.replaceChildren(h("p", { class: "fine", style: { padding: "24px" } }, t("Loading…")));
    fetchLogs().then(() => { if (S.section === "logs") renderLogsView(); })
      .catch((e) => view.replaceChildren(h("p", { class: "fine", style: { padding: "24px" } }, t("Couldn't read the log: {0}", [e.message]))));
    return;
  }
  markLogsSeen();
  const d = LOGS.detail || {};
  const mode = d.force ? t("everything detailed (--debug)")
    : d.detail ? (d.areas && d.areas.length ? t("Detailed: {0}", [d.areas.map((a) => (LOG_AREAS().find((x) => x[0] === a) || [a, a])[1]).join(", ")]) : t("Detailed, no area chosen"))
    : t("Normal");
  const search = h("input", { type: "search", class: "log-search", value: LOGS.q, placeholder: t("Search the log"), "aria-label": t("Search the log"),
    oninput: debounce((e) => { LOGS.q = e.target.value; renderLogRows(); }, 150) });
  const areas = [...new Set(LOGS.recs.map((r) => r.area))].sort();
  const areaSel = h("select", { class: "log-area", "aria-label": t("Area"), onchange: (e) => { LOGS.area = e.target.value; renderLogRows(); } },
    h("option", { value: "" }, t("All areas")), ...areas.map((a) => h("option", { value: a, selected: a === LOGS.area }, a)));
  const follow = h("button", { class: "btn log-follow", "aria-pressed": LOGS.follow ? "true" : "false", title: t("Keep showing the newest lines"),
    onclick: () => { LOGS.follow = !LOGS.follow; follow.setAttribute("aria-pressed", String(LOGS.follow)); if (LOGS.follow) scrollLogsEnd(); } },
    ic("arrow-down-to-line"), t("Follow"));
  view.replaceChildren(
    h("div", { class: "logs-head" },
      h("span", { class: "msub" }, t("{0}, recording since {1} ({2})", ["app.log", logTime(LOGS.summary ? LOGS.summary.since : Date.now() / 1000, false).slice(0, 5), mode]))),
    h("div", { class: "logs-problems", id: "logProblems" }),
    h("div", { class: "logs-tools" },
      h("div", { class: "pills", role: "group", "aria-label": t("Level"), id: "logLevels" }),
      areaSel, h("label", { class: "log-search-wrap" }, ic("search"), search),
      h("span", { class: "grow" }), follow,
      h("button", { class: "btn", onclick: () => api("/api/open", { what: "log" }).catch((e) => toast(friendlyError(e.message), { bad: true })) }, ic("file-text"), t("Open file"))),
    h("div", { class: "log-table", role: "table", "aria-label": t("Log") },
      h("div", { class: "log-row log-cols", role: "row" }, ...[t("Time"), t("Level"), t("Area"), t("Message"), ""].map((x) => h("span", { role: "columnheader" }, x))),
      h("div", { id: "logRows", role: "rowgroup" })),
    h("p", { class: "hint" }, t("Log messages are in English. Passwords and tokens show as ****. Click a line to see the details.")));
  view.onscroll = () => {
    const atEnd = view.scrollTop + view.clientHeight >= view.scrollHeight - 40;
    if (!atEnd && LOGS.follow && !LOGS.autoScrolling) { LOGS.follow = false; follow.setAttribute("aria-pressed", "false"); }
  };
  renderLogProblems();
  renderLogRows();
  pollLogs();
}

function renderLogCounts() {
  const el = $("#logLevels");
  if (!el) return;
  const n = (lv) => LOGS.recs.filter((r) => r.level === lv).length;
  const opts = [["all", t("All")], ["ERROR", t("Errors"), "circle-x", n("ERROR"), "err"], ["WARN", t("Warnings"), "triangle-alert", n("WARN"), "warn"],
    ["INFO", t("Info"), "info"], ["DEBUG", t("Debug"), "bug"]];
  el.replaceChildren(...opts.map(([v, l, icn, count, cls]) => h("button", { "aria-pressed": LOGS.level === v ? "true" : "false",
    onclick: () => { LOGS.level = v; renderLogCounts(); renderLogRows(); } },
    icn ? ic(icn) : null, l, count ? h("span", { class: "log-n " + cls }, String(count)) : null)));
}

function logMatches(r) {
  if (LOGS.level !== "all" && r.level !== LOGS.level) return false;
  if (LOGS.area && r.area !== LOGS.area) return false;
  if (LOGS.q) {
    const q = norm(LOGS.q);
    if (!norm(`${r.msg} ${r.area} ${r.tb || ""} ${r.ctx ? JSON.stringify(r.ctx) : ""}`).includes(q)) return false;
  }
  return true;
}

function renderLogRows() {
  const box = $("#logRows");
  if (!box) return;
  renderLogCounts();
  const list = LOGS.recs.filter(logMatches);
  const shown = list.slice(-LOG_SHOW);
  box.replaceChildren(...[
    list.length > LOG_SHOW ? h("p", { class: "fine log-more" }, t("Showing the last {0} lines. The file has everything.", [LOG_SHOW])) : null,
    ...shown.map(logRow)].filter(Boolean));
  if (!list.length) box.append(h("p", { class: "fine log-empty" }, LOGS.recs.length ? t("No lines with these filters.") : t("Nothing here yet.")));
  if (LOGS.follow) scrollLogsEnd();
}

function appendLogRows(fresh) {
  const box = $("#logRows");
  if (!box) return;
  const add = fresh.filter(logMatches);
  if (!add.length) return;
  box.querySelectorAll(".log-empty").forEach((x) => x.remove());
  box.append(...add.map(logRow));
  while (box.querySelectorAll(".log-row").length > LOG_SHOW) box.querySelector(".log-row").remove();
  // a área nova aparece na lista de áreas
  const sel = document.querySelector("#logsView .log-area");
  if (sel) for (const a of new Set(add.map((r) => r.area))) if (![...sel.options].some((o) => o.value === a)) sel.append(h("option", { value: a }, a));
  if (LOGS.follow) scrollLogsEnd();
}

function scrollLogsEnd() {
  const view = $("#logsView");
  LOGS.autoScrolling = true;
  requestAnimationFrame(() => { view.scrollTop = view.scrollHeight; setTimeout(() => { LOGS.autoScrolling = false; }, 60); });
}

function logRow(r) {
  const [icn, cls] = LV[r.level] || LV.INFO;
  const more = !!(r.ctx || r.tb);
  const open = LOGS.open.has(r.id);
  const row = h(more ? "button" : "div", { class: "log-row" + (open ? " open" : "") + (more ? " more" : ""), role: "row",
    "aria-expanded": more ? String(open) : null,
    onclick: more ? () => {
      if (LOGS.open.has(r.id)) LOGS.open.delete(r.id); else LOGS.open.add(r.id);
      const fresh = logRow(r);
      wrap.replaceWith(fresh);
      if (LOGS.open.has(r.id)) M.fadeIn([fresh.querySelector(".log-detail")], { y: -4, dur: 160 });
    } : null },
    h("span", { class: "log-t" }, logTime(r.t)),
    h("span", { class: "lv " + cls }, ic(icn), r.level),
    h("span", { class: "log-a" }, r.area),
    h("span", { class: "log-m" }, r.msg),
    h("span", { class: "log-chev" }, more ? ic(open ? "chevron-down" : "chevron-right") : null));
  const wrap = h("div", { class: "log-item" + (open ? " open" : "") }, row, open ? logDetail(r) : null);
  return wrap;
}

const CTX_LABELS = () => ({ action: t("Action"), label: t("Name"), key: t("Key"), page: t("Page"), moment: t("Moment"),
  params: t("Parameters"), ms: t("Duration##log"), plugin: t("Plugin"), id: t("Problem") });
const MOMENT_WORDS = () => ({ press: t("on press"), action: t("on press"), double: t("on double tap"), hold: t("on hold"), release: t("on release") });

function logDetail(r) {
  const labels = CTX_LABELS();
  const val = (k, v) => {
    if (k === "ms") return `${v} ms`;
    if (k === "moment") return MOMENT_WORDS()[v] || v;
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  const ctx = r.ctx || {};
  const plugin = logPluginOf(r);
  const text = [`${logTime(r.t)} ${r.level} ${r.area} ${r.msg}`, ...Object.entries(ctx).map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`), r.tb || ""].join("\n").trim();
  return h("div", { class: "log-detail" },
    Object.keys(ctx).length ? h("dl", { class: "log-kv" }, ...Object.entries(ctx).flatMap(([k, v]) => [h("dt", {}, labels[k] || k), h("dd", {}, val(k, v))])) : null,
    r.tb ? h("pre", { class: "log-tb" }, r.tb) : null,
    h("div", { class: "row", style: { gap: "8px", flexWrap: "wrap" } },
      h("button", { class: "btn small", onclick: () => navigator.clipboard.writeText(text).then(() => toast(t("Copied."))).catch(() => toast(t("Couldn't copy."), { bad: true })) }, ic("copy"), t("Copy")),
      plugin ? h("button", { class: "btn small", onclick: () => openIntegration(plugin.id) }, ic("plug"), t("Open Integrations › {0}", [plugin.name])) : null));
}

function logPluginOf(r) {
  const id = (r.ctx && r.ctx.plugin) || r.area;
  return ((S.schema && S.schema.plugins) || []).find((p) => p.id === id) || null;
}

function openIntegration(id) {
  S.section = "settings"; S.setSection = "integrations";
  renderAll();
  requestAnimationFrame(() => {
    const el = document.querySelector(`#settingsView .int-block[data-plugin="${id}"]`);
    if (el) { el.scrollIntoView({ block: "start", behavior: "smooth" }); M.once(el, "m-flash"); }
  });
}

function renderLogProblems() {
  const el = $("#logProblems");
  if (!el) return;
  el.replaceChildren(...LOGS.problems.map(problemCard));
  el.hidden = !LOGS.problems.length;
}

function problemCard(p) {
  const id = p.where && p.where.startsWith("integrations:") ? p.where.slice(13) : null;
  const pl = id && ((S.schema && S.schema.plugins) || []).find((x) => x.id === id);
  return h("div", { class: "log-problem" },
    h("span", { class: "log-problem-ic" }, ic(p.id.startsWith("device") ? "usb" : "plug-zap")),
    h("div", { class: "grow" }, h("b", {}, p.text),
      h("span", { class: "hint" }, p.count > 1 ? t("Since {0}, {1} times.", [logTime(p.since, false).slice(0, 5), p.count]) : t("Since {0}.", [logTime(p.since, false).slice(0, 5)]))),
    pl ? h("button", { class: "btn small", onclick: () => openIntegration(pl.id) }, t("Open Integrations")) : null);
}

// ---------------------------------------------------------------------------- número de erros novos

function renderLogsBadge() {
  const st = S.status || {};
  const n = (st.logs && st.logs.new_errors) || 0;
  const btn = document.querySelector('.rail-btn[data-section="logs"]');
  if (btn) {
    btn.hidden = !logsTabOn();
    let b = btn.querySelector(".rail-badge");
    if (n && S.section !== "logs") {
      if (!b) { b = h("span", { class: "rail-badge" }); btn.append(b); }
      b.textContent = n > 99 ? "99+" : String(n);
      b.setAttribute("aria-label", t("{0} new errors", [n]));
    } else if (b) b.remove();
  }
}

// com a aba escondida, os erros novos e os problemas aparecem no grupo de status lá em cima
function logsStatusItem() {
  const st = S.status || {};
  const n = (st.logs && st.logs.new_errors) || 0;
  const probs = st.problems || [];
  if (logsTabOn() || (!n && !probs.length)) return null;
  const title = [...probs.map((p) => p.text), n ? t("{0} new errors in the log.", [n]) : null].filter(Boolean).join("\n");
  return h("button", { class: "stat bad stat-logs", title, onclick: () => api("/api/open", { what: "log" }).catch(() => {}) },
    ic(probs.length ? "triangle-alert" : "scroll-text"), h("b", {}, t("Log")),
    h("span", { class: "st" }, probs.length ? (probs.length === 1 ? t("1 problem") : t("{0} problems", [probs.length])) : (n === 1 ? t("1 error") : t("{0} errors", [n]))));
}

// ---------------------------------------------------------------------------- Config › Avançado

function setLogging(body) {
  const c = logCfg();
  const set = (k, v) => cfgIn("logging", k, v);
  const detail = !!c.detail;
  const areas = new Set(Array.isArray(c.areas) ? c.areas : []);
  const files = h("span", { class: "msub" });
  const path = h("span", { class: "log-path" }, "…");
  api(`/api/logs?after=999999999`).then((r) => {
    path.textContent = r.files.folder;
    files.textContent = r.files.count === 1 ? t("1 file, {0}", [fmtBytes(r.files.bytes)]) : t("{0} files, {1}", [r.files.count, fmtBytes(r.files.bytes)]);
    if (r.detail && r.detail.force) forced.hidden = false;
  }).catch(() => { path.textContent = t("couldn't read"); });
  const forced = h("p", { class: "note-box", hidden: true }, ic("bug"), h("span", {}, t("The app was started with --debug: everything is detailed, whatever is chosen here.")));
  const areaBoxes = h("div", { class: "log-areas" + (detail ? "" : " off") }, ...LOG_AREAS().map(([id, label, desc]) => {
    const cb = h("input", { type: "checkbox", checked: areas.has(id), disabled: !detail, onchange: () => {
      if (cb.checked) areas.add(id); else areas.delete(id);
      set("areas", areas.size ? AREA_ORDER().filter((a) => areas.has(a)) : null);
    } });
    return h("label", { class: "log-area-opt" }, cb, h("span", {}, h("b", {}, label), h("small", {}, desc)));
  }));
  body.append(
    h("div", { class: "int-section" }, h("h3", {}, t("Logs and diagnostics"))),
    forced,
    setSwitch(t("Show the Logs tab in the menu"), !!c.show_tab, (on) => { set("show_tab", on || null); renderLogsBadge(); renderStatus(); },
      t("The tab only shows what's already in the file. Hidden, the app keeps recording the same way.")),
    setRow(t("Detail"), pills([["normal", t("Normal")], ["detailed", t("Detailed")]], detail ? "detailed" : "normal",
      (v) => { set("detail", v === "detailed" || null); renderSettingsView(); }, t("Detail")),
      t("Errors, warnings and the main events (page, connections, saves) are always recorded. Detailed adds the step by step of the areas checked below.")),
    setRow(t("Detailed in"), areaBoxes, detail ? null : t("Choose Detailed to pick the areas.")),
    setSwitch(t("Show error on the key"), c.key_error !== false, (on) => set("key_error", on ? null : false),
      t("When an action fails, the key shows an ✕ for 1 second and goes back to normal.")),
    setSwitch(t("Notify in Windows"), !!c.notify, (on) => set("notify", on || null),
      t("Once per problem (OBS that doesn't connect, plugin that stopped, Deck disconnected). Off by default: the notification can show up on the live.")),
    setRow(t("Files"), h("div", { class: "row", style: { gap: "10px", flexWrap: "wrap", alignItems: "center" } }, path, files),
      t("Keeps up to 5 files of 2 MB. The package is a .zip with the logs, the config without passwords and the versions, to send when something goes wrong.")),
    h("div", { class: "set-row" }, h("div", { class: "row", style: { gap: "8px", flexWrap: "wrap" } },
      h("button", { class: "btn", onclick: () => api("/api/open", { what: "logs" }).catch((e) => toast(friendlyError(e.message), { bad: true })) }, ic("folder-open"), t("Open folder")),
      h("button", { class: "btn", onclick: downloadDiagnostics }, ic("package"), t("Create diagnostics package")))));
}
const AREA_ORDER = () => LOG_AREAS().map((a) => a[0]);

async function downloadDiagnostics() {
  await flushSave();
  try {
    const r = await api("/api/logs/diagnostics", {});
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = h("a", { href: url, download: r.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(t("File {0} downloaded.", [r.name]));
  } catch (e) { toast(t("Couldn't create the package: {0}", [e.message]), { bad: true }); }
}
