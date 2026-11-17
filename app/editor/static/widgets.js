// Widgets no editor: a aba Widgets da biblioteca, as miniaturas de cada tamanho, colocar no Deck, o inspetor
// (tamanho, opções, cores, "editar tecla por tecla") e "Salvar como widget". O desenho de um widget é montado
// pelo servidor (app/widgets.py): as miniaturas usam /api/preview e as ações padrão /api/widget/expand.
"use strict";

// ---------------------------------------------------------------------------- modelos

const MINE_COLOR = "var(--fg-muted)";
// todos os modelos: os do app e dos plugins (schema) e os da pessoa (config: widgets)
function widgetDefs() {
  const out = { ...((S.schema && S.schema.widgets) || {}) };
  for (const [id, d] of Object.entries(isObj(S.cfg.widgets) ? S.cfg.widgets : {})) {
    if (!isObj(d) || !isObj(d.sizes)) continue;
    out[id] = { label: d.label || id, icon: d.icon || "layout-grid", category: "mine", mine: true, plugin: null,
      options: [], sizes: d.sizes, action: d.action, hold: d.hold };
  }
  return out;
}
function widgetCategories() {
  return [...((S.schema && S.schema.widget_categories) || []), { id: "mine", label: t("My widgets"), color: MINE_COLOR }];
}
const isWidget = (spec) => !!(spec && spec.widget);
const sizeRC = (size) => { const [r, c] = String(size || "1x1").split("x").map(Number); return [r || 1, c || 1]; };
function widgetSpan(spec) { const [r, c] = sizeRC(spec.size); return [c, r]; }
const widgetOrigin = (d) => (d.mine ? "mine" : d.plugin || "app");
function originName(o) {
  if (o === "app") return t("App");
  if (o === "mine") return t("My widgets");
  const p = ((S.schema && S.schema.plugins) || []).find((x) => x.id === o);
  return p ? p.name : o;
}
const usesId = (d) => JSON.stringify([d.sizes, d.action, d.hold]).includes("$id");
// o modelo de um tamanho, por extenso: "1×1 até 2×5, 8 tamanhos"
function sizesSummary(d) {
  const s = Object.keys(d.sizes);
  return s.length === 1 ? sizeLabel(s[0]) : t("{0} to {1}, {2} sizes", [sizeLabel(s[0]), sizeLabel(s[s.length - 1]), s.length]);
}
// o que vai para o servidor montar o widget (as cores e opções da tecla, se houver)
const widgetKey = (spec) => ({ widget: spec.widget, size: spec.size, options: spec.options || null, colors: spec.colors || null });
const expandWidget = (spec, id) => api("/api/widget/expand", { key: widgetKey(spec), widgets: S.cfg.widgets || null, id: id || null });

// ---------------------------------------------------------------------------- miniaturas (desenhadas pelo servidor)

const THUMBS = new Map();          // chave -> [data URL por tecla]
let thumbQueue = [];
function thumbKey(item) {
  const d = widgetDefs()[item.widget];
  return JSON.stringify([item, d && d.mine ? d.sizes : null]);
}
function flushThumbs() {
  const batch = thumbQueue; thumbQueue = [];
  const items = batch.map((b) => b.item);
  api("/api/preview", { keys: items, widgets: S.cfg.widgets || null, icons: isObj(S.cfg.icons) ? S.cfg.icons : null, device: S.cfg.device || null })
    .then((r) => batch.forEach((b, i) => {
      const img = r.images[i] || {};
      const cells = img.cells || (img.normal ? [img.normal] : []);
      THUMBS.set(b.key, cells);
      b.fill(cells);
    }))
    .catch(() => {});
}
// a miniatura de um widget num tamanho: uma grade de teclas com o desenho de verdade de cada uma
function widgetThumb(id, size, { unit = 20, options = null, colors = null, dim = false } = {}) {
  const [rows, cols] = sizeRC(size);
  const cells = Array.from({ length: rows * cols }, () => h("span", { class: "wthumb-cell" }));
  const grid = h("span", { class: "wthumb" + (dim ? " dim" : ""), "aria-hidden": "true",
    style: { gridTemplateColumns: `repeat(${cols}, ${unit}px)`, gridAutoRows: `${unit}px` } }, ...cells);
  const item = { widget: id, size, options, colors };
  const key = thumbKey(item);
  const fill = (srcs) => cells.forEach((c, i) => srcs[i] && c.replaceChildren(h("img", { src: srcs[i], alt: "" })));
  if (THUMBS.has(key)) fill(THUMBS.get(key));
  else {
    if (!thumbQueue.length) setTimeout(flushThumbs, 0);
    thumbQueue.push({ item, key, fill });
  }
  return grid;
}
// uma peça de tamanho (biblioteca, inspetor, página do plugin): a miniatura em cima, o tamanho embaixo
function sizeTile(id, size, { unit = 20, pressed = null, disabled = false, note = null, options = null, colors = null, onClick = null, onDrag = null, title = null } = {}) {
  const [rows] = sizeRC(size);
  const btn = h("button", { class: "size-tile", "aria-pressed": pressed === null ? null : String(pressed), disabled, title,
    draggable: onDrag ? "true" : null, onclick: onClick },
    h("span", { class: "size-tile-art", style: { height: `${Math.max(2, rows) * unit + (Math.max(2, rows) - 1) * 2}px` } },
      widgetThumb(id, size, { unit, options, colors, dim: disabled })),
    h("span", { class: "size-tile-label" }, sizeLabel(size)), note ? h("small", {}, note) : null);
  if (onDrag) {
    btn.addEventListener("dragstart", (e) => { e.stopPropagation(); onDrag(e); });
    btn.addEventListener("dragend", () => { S.drag = null; endFoot(); });
  }
  return btn;
}

// ---------------------------------------------------------------------------- colocar no Deck

function startWidgetDrag(e, id, size) {
  const d = widgetDefs()[id];
  const [rows, cols] = sizeRC(size);
  S.drag = { kind: "widget", widget: id, size, rows, cols, label: d.label };
  e.dataTransfer.setData("text/plain", "widget");
  e.dataTransfer.effectAllowed = "copy";
  const srcs = THUMBS.get(thumbKey({ widget: id, size, options: null, colors: null })) || [];
  const cells = Array.from({ length: rows * cols }, (_, i) => ghostCell(srcs[i] ? h("img", { src: srcs[i], alt: "" }) : h("b", {}, i ? "" : d.label)));
  const g = dragGhost(cols, rows, cells);
  const m = keyMetrics();
  e.dataTransfer.setDragImage(g, m.size / 2, m.size / 2);
}

async function placeWidget(anchor, id, size) {
  const d = widgetDefs()[id];
  if (!d || !d.sizes[size]) return;
  const [rows, cols] = sizeRC(size);
  const keys = footprint(anchor, cols, rows);
  if (!keys) return toast(t("It doesn't fit there: the piece goes past the edge."), { bad: true });
  const spec = { widget: id, size };
  if (usesId(d)) spec.options = { id: keyId(S.page, anchor) };
  if (d.action || d.hold) {
    try {
      const built = await expandWidget(spec);
      if (built.action) spec.action = built.action;
      if (built.hold) spec.hold = built.hold;
    } catch (e) { return toast(t("Couldn't place the widget: ") + e.message, { bad: true }); }
  }
  const removed = clearKeys(keys);
  pageKeys()[anchor] = spec;
  afterPlace(anchor);
  placedToast(t("{0} {1} placed.", [d.label, sizeLabel(size)]), removed);
}

// ---------------------------------------------------------------------------- biblioteca: aba Widgets

const LIB_TAB_KEY = "d6-lib-tab";
let libTab = (() => { try { return localStorage.getItem(LIB_TAB_KEY) === "widgets" ? "widgets" : "actions"; } catch { return "actions"; } })();
let libOrigin = "all";                 // "all" | "app" | "mine" | id do plugin
const LIB_WIDGET_OPEN = new Set();
function setLibTab(tab) {
  libTab = tab;
  try { localStorage.setItem(LIB_TAB_KEY, tab); } catch { /* sem storage */ }
  renderLibrary();
}
// abre a biblioteca já na aba Widgets, filtrada por uma origem (ex.: "Ver na biblioteca" na página do plugin)
function showWidgetsOf(origin) {
  libOrigin = origin;
  $("#libSearch").value = "";
  S.section = "keys";
  setLibTab("widgets");
  renderAll();
  document.body.classList.add("lib-open");
}
function widgetMatches(id, d, nq) {
  if (!nq) return true;
  const cat = widgetCategories().find((c) => c.id === d.category);
  return norm(`${d.label} ${id} ${cat ? cat.label : ""} ${originName(widgetOrigin(d))}`).includes(nq);
}
function libTabs(query) {
  const nq = norm(query);
  const nActions = query ? groupedActions(query).reduce((n, [, items]) => n + items.length, 0) : null;
  const nWidgets = query ? Object.entries(widgetDefs()).filter(([id, d]) => widgetMatches(id, d, nq)).length : null;
  const tab = (id, icon, label, n) => h("button", { role: "tab", "aria-selected": libTab === id ? "true" : "false", onclick: () => setLibTab(id) },
    ic(icon), label, n !== null ? h("span", { class: "lib-tab-n" }, String(n)) : null);
  return [tab("actions", "zap", t("Actions"), nActions), tab("widgets", "layout-grid", t("Widgets"), nWidgets)];
}

function widgetLibrary(query) {
  const nq = norm(query);
  const defs = Object.entries(widgetDefs());
  const out = [];
  // filtro de origem: todas, do app, meus, ou um plugin (com quantos widgets cada um tem)
  const counts = {};
  for (const [, d] of defs) counts[widgetOrigin(d)] = (counts[widgetOrigin(d)] || 0) + 1;
  const plugins = Object.keys(counts).filter((o) => o !== "app" && o !== "mine").sort((a, b) => originName(a).localeCompare(originName(b)));
  if (libOrigin !== "all" && !counts[libOrigin]) libOrigin = "all";
  const opt = (v, label, n) => h("option", { value: v, selected: libOrigin === v }, n === undefined ? label : `${label} (${n})`);
  const sel = h("select", { class: "lib-origin-sel", "aria-label": t("Origin"), onchange: (e) => { libOrigin = e.target.value; renderLibrary(); } },
    opt("all", t("All origins"), defs.length),
    counts.app ? opt("app", t("From the app"), counts.app) : null,
    counts.mine ? opt("mine", t("My widgets"), counts.mine) : null,
    plugins.length ? h("optgroup", { label: t("Plugins") }, ...plugins.map((p) => opt(p, originName(p), counts[p]))) : null);
  out.push(h("div", { class: "lib-origin" }, h("span", {}, t("Origin")), sel,
    libOrigin !== "all" ? h("button", { class: "icon-btn small", title: t("Clear filter"), "aria-label": t("Clear filter"),
      onclick: () => { libOrigin = "all"; renderLibrary(); } }, ic("x")) : null));

  const shown = defs.filter(([id, d]) => (libOrigin === "all" || widgetOrigin(d) === libOrigin) && widgetMatches(id, d, nq));
  for (const cat of widgetCategories()) {
    const items = shown.filter(([, d]) => d.category === cat.id);
    if (!items.length) continue;
    const origins = [...new Set(items.map(([, d]) => widgetOrigin(d)))];
    const rank = (o) => (o === "app" ? "0" : o === "mine" ? "2" : "1" + originName(o).toLowerCase());
    items.sort(([, a], [, b]) => rank(widgetOrigin(a)).localeCompare(rank(widgetOrigin(b))));
    const mixed = origins.length > 1;
    out.push(libGroup("w:" + cat.id, cat.color, items.length, query, () => {
      const kids = [];
      let last = null;
      for (const [id, d] of items) {
        const o = widgetOrigin(d);
        if (mixed && o !== last) kids.push(h("div", { class: "lib-sub" }, ic(o === "app" ? "layout-grid" : o === "mine" ? "bookmark" : "plug"), originName(o)));
        last = o;
        kids.push(...widgetItem(id, d, !mixed && o !== "app" && o !== "mine" && libOrigin === "all", query));
      }
      return kids;
    }, cat.label));
  }
  if (!shown.length) out.push(h("p", { class: "fine", style: { padding: "0 8px" } }, libOrigin !== "all" ? t("No widgets from this origin match.") : t("No widgets found.")));
  else if (libOrigin !== "all") out.push(h("p", { class: "fine lib-filter-note" },
    t("Only the widgets from {0}, in their usual categories.", [originName(libOrigin)]), " ",
    h("button", { class: "link-btn", onclick: () => { libOrigin = "all"; renderLibrary(); } }, t("Clear filter"))));
  return out;
}

function widgetItem(id, d, withTag, query) {
  const sizes = Object.keys(d.sizes);
  const open = LIB_WIDGET_OPEN.has(id) || (!!query && sizes.length > 1);
  const cat = widgetCategories().find((c) => c.id === d.category) || { color: MINE_COLOR };
  const tag = withTag ? h("button", { class: "lib-tag link", title: t("Show only the widgets from {0}", [originName(d.plugin)]),
    onclick: (e) => { e.stopPropagation(); libOrigin = d.plugin; renderLibrary(); } }, ic("plug"), originName(d.plugin)) : null;
  const item = h("div", { class: "lib-item widget-item", draggable: "true", role: "button", tabindex: "0", style: { "--cat": cat.color },
    "aria-expanded": sizes.length > 1 ? String(open) : null,
    title: sizes.length > 1 ? t("Drag onto the Deck, or open to see the sizes") : t("Drag onto the Deck"),
    onclick: () => {
      if (sizes.length > 1) { if (open) LIB_WIDGET_OPEN.delete(id); else LIB_WIDGET_OPEN.add(id); renderLibrary(); }
      else if (S.key) placeWidget(S.key, id, sizes[0]);
      else toast(t("Click a key first, or drag the widget onto it."));
    },
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } } },
    h("span", { class: "chip" }, h("span", { class: "lu-ch" }, luChar(d.icon || "layout-grid"))), h("span", { class: "label" }, d.label), tag,
    d.mine ? h("button", { class: "icon-btn small", title: t("Delete from my widgets"), "aria-label": t("Delete from my widgets"),
      onclick: (e) => { e.stopPropagation(); removeUserWidget(id); } }, ic("trash-2")) : null);
  item.addEventListener("dragstart", (e) => startWidgetDrag(e, id, sizes[0]));
  item.addEventListener("dragend", () => { S.drag = null; endFoot(); });
  const out = [item];
  if (open && sizes.length > 1) out.push(h("div", { class: "pieces" }, ...sizes.map((size) => sizeTile(id, size, { unit: 18,
    title: t("{0} in {1}", [d.label, sizeLabel(size)]),
    onClick: () => { if (S.key) placeWidget(S.key, id, size); else toast(t("Click a key first, or drag the piece onto it.")); },
    onDrag: (e) => startWidgetDrag(e, id, size) }))));
  return out;
}

// ---------------------------------------------------------------------------- inspetor: aba Widget

function widgetTitle(spec) {
  const d = widgetDefs()[spec.widget];
  return d ? d.label : spec.widget;
}
function widgetLook(spec) {
  const body = h("div", { class: "insp-body look widget-look" });
  const d = widgetDefs()[spec.widget];
  const anchor = S.key;
  if (!d) {
    body.append(h("div", { class: "note-box bad" }, ic("circle-alert"),
      h("span", {}, t("This widget isn't available anymore (the plugin was turned off or removed). Turn the plugin back on, or remove the key."))));
    body.append(detachCard(spec));
    return body;
  }
  const redraw = () => { S.previews[S.page] = null; changed(); renderKeys(); renderInspector(); };

  // tamanho: só os que o widget tem; os que passam da borda ficam apagados
  const tiles = Object.keys(d.sizes).map((size) => {
    const [rows, cols] = sizeRC(size);
    const keys = footprint(anchor, cols, rows);
    const replaced = keys ? countReplaced(keys, anchor) : 0;
    return sizeTile(spec.widget, size, { unit: 22, pressed: size === spec.size, disabled: !keys, options: spec.options || null, colors: spec.colors || null,
      note: !keys ? t("goes past the edge") : replaced && size !== spec.size ? (replaced === 1 ? t("replaces 1 key") : t("replaces {0} keys", [replaced])) : null,
      title: t("{0} in {1}", [d.label, sizeLabel(size)]),
      onClick: () => { if (size !== spec.size) setWidgetSize(spec, size); } });
  });
  body.append(h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Size")), h("div", { class: "size-tiles" }, ...tiles),
    Object.keys(d.sizes).length > 1 ? h("p", { class: "hint" }, t("Only the sizes this widget has. The options stay the same when you switch.")) : null));

  // opções declaradas pelo widget
  const opts = (d.options || []).filter((o) => o.name !== "id");
  if (opts.length) {
    const sec = h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Options")));
    for (const o of opts) sec.append(optionRow(spec, d, o));
    body.append(sec);
  }

  // cores da peça inteira
  const colors = isObj(spec.colors) ? spec.colors : null;
  const look = h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Colors")),
    pills([["widget", t("From the widget")], ["mine", t("My colors")]], colors ? "mine" : "widget", (m) => {
      if (m === "mine") spec.colors = { bg: "#1d2330", fg: "#ffffff" }; else delete spec.colors;
      redraw();
    }, t("Colors")));
  if (colors) {
    look.append(h("span", { class: "msub" }, t("Background")),
      swatchRow(colors.bg || "#1d2330", (c) => { colors.bg = c; S.previews[S.page] = null; changed(); renderKeys(); }, false, KEY_SWATCHES),
      h("span", { class: "msub" }, t("Text and icon")),
      swatchRow(colors.fg || "#ffffff", (c) => { colors.fg = c; S.previews[S.page] = null; changed(); renderKeys(); }, false,
        [["#ffffff", t("White")], ["#eceef2", t("Light gray")], ["#F5A524", t("Orange")], ["#000000", t("Black")]]),
      h("p", { class: "hint" }, t("They apply to all {0} keys of the widget.", [sizeRC(spec.size)[0] * sizeRC(spec.size)[1]])));
  }
  body.append(look);
  body.append(detachCard(spec));
  return body;
}
function countReplaced(keys, anchor) {
  const pk = pageKeys(), cov = coverMap();
  const anchors = new Set();
  for (const k of keys) {
    if (k === anchor) continue;
    if (pk[k]) anchors.add(k);
    else if (cov[k] && cov[k][0] !== anchor) anchors.add(cov[k][0]);
  }
  return anchors.size;
}
function setWidgetSize(spec, size) {
  const [rows, cols] = sizeRC(size);
  const keys = footprint(S.key, cols, rows);
  if (!keys) return;
  const removed = clearKeys(keys, S.key);
  spec.size = size;
  afterPlace(S.key);
  if (removed.length) placedToast(t("Size changed to {0}.", [sizeLabel(size)]), removed);
}

function optionRow(spec, d, o) {
  const cur = { ...Object.fromEntries((d.options || []).map((x) => [x.name, x.default])), ...(spec.options || {}) }[o.name];
  const set = async (v, rerender = true) => {
    const before = clone(spec);
    spec.options = { ...(spec.options || {}) };
    if (v === null || v === undefined || v === "" && o.default !== "" || JSON.stringify(v) === JSON.stringify(o.default)) delete spec.options[o.name];
    else spec.options[o.name] = v;
    if (!Object.keys(spec.options).length) delete spec.options;
    await refreshWidgetActions(before, spec, d);
    S.previews[S.page] = null; changed(); renderKeys();
    if (rerender) renderInspector();
  };
  let control;
  switch (o.kind) {
    case "choice":
      control = o.choices.length <= 3 ? pills(o.choices, cur ?? "", (v) => set(v), o.label)
        : inlSelect(o.choices, cur, (i) => set(o.choices[i][0]), o.label);
      break;
    case "bool": return h("div", { class: "opt-row" }, toggleRow(o.label, !!cur, (v) => set(v)));
    case "number": control = num(cur, (v) => set(v, false), o.default !== undefined ? String(o.default) : ""); break;
    case "color": control = swatchRow(cur || null, (c) => set(c, false), false, KEY_SWATCHES); break;
    case "glyph": control = glyphCard({ lucide: cur || "circle" }, (c) => set(c)); break;
    case "value": control = valueSelect(cur, (v) => set(v), { kinds: o.kinds, label: o.label }); break;
    default: control = txt(cur, (v) => set(v, false), o.placeholder || "");
  }
  return h("div", { class: "opt-row" }, h("span", { class: "opt-label" }, o.label), control);
}
// as ações padrão seguem as opções (ex.: os minutos da contagem), a não ser que a pessoa tenha mudado a ação
async function refreshWidgetActions(before, spec, d) {
  if (!d.action && !d.hold) return;
  try {
    const [was, now] = await Promise.all([expandWidget(before), expandWidget(spec)]);
    for (const m of ["action", "hold"]) {
      if (now[m] && JSON.stringify(spec[m]) === JSON.stringify(was[m])) spec[m] = now[m];
    }
    buildModel();
  } catch { /* sem servidor: a ação fica como estava */ }
}

function detachCard(spec) {
  return h("div", { class: "detach-card" },
    h("b", {}, t("Want something the options don't have?")),
    h("button", { class: "btn", onclick: () => detachWidget(S.key) }, ic("unlink"), t("Edit key by key")),
    h("p", { class: "hint" }, t("The widget becomes a regular block: you change each key the way you want, but it stops having options and getting improvements. You can undo it.")));
}
// widget -> bloco comum (ou tecla comum, se for 1×1), com o desenho de agora
async function detachWidget(anchor, { quiet = false } = {}) {
  const spec = pageKeys()[anchor];
  if (!isWidget(spec)) return;
  let built;
  try { built = await expandWidget(spec); } catch (e) { return toast(t("Couldn't separate the widget: ") + e.message, { bad: true }); }
  const label = widgetTitle(spec);
  for (const f of ["widget", "size", "options", "colors"]) delete spec[f];
  if (built.span[0] * built.span[1] > 1) Object.assign(spec, { span: built.span, cells: built.cells, mode: "split", icon: { text: label } });
  else spec.icon = built.cells[0] || {};
  if (quiet) return;
  afterPlace(anchor);
  toast(t("{0} is now a regular block. Each key can be changed on its own.", [label]), { undo: true });
}

// ---------------------------------------------------------------------------- meus widgets

function saveAsWidget(spec) {
  const [cols, rows] = spanOf(spec);
  let name = String(normalizeIcon(spec.icon).text || "").replace(/\n/g, " ").trim();
  let icon = "layout-grid";
  const close = () => back.remove();
  const nameIn = h("input", { type: "text", value: name, placeholder: t("e.g.: {0}", [t("Live panel")]), "aria-label": t("Name"), oninput: (e) => { name = e.target.value; } });
  const iconBtn = h("button", { class: "btn", onclick: () => openGlyphPicker((c) => { if (c) { icon = c; iconBtn.replaceChildren(h("span", { class: "lu-ch" }, luChar(c)), t("Change")); } }) },
    h("span", { class: "lu-ch" }, luChar(icon)), t("Change"));
  const save = () => {
    const label = name.trim();
    if (!label) { nameIn.focus(); return toast(t("Give the widget a name."), { bad: true }); }
    S.cfg.widgets = isObj(S.cfg.widgets) ? S.cfg.widgets : {};
    const base = "my." + (norm(label).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "widget");
    let id = base, n = 2;
    while (S.cfg.widgets[id]) id = `${base}_${n++}`;
    const cells = (spec.cells || []).slice(0, cols * rows).map((c) => clone(c) || {});
    while (cells.length < cols * rows) cells.push({});
    const grid = Array.from({ length: rows }, (_, r) => cells.slice(r * cols, (r + 1) * cols));
    S.cfg.widgets[id] = { label, icon, sizes: { [`${rows}x${cols}`]: grid } };
    for (const m of ["action", "hold"]) if (spec[m]) S.cfg.widgets[id][m] = clone(spec[m]);
    libOpen.add("w:mine");
    changed({ keys: false });
    renderLibrary();
    close();
    toast(t("Saved in My widgets, in the library (Widgets tab)."));
  };
  const card = h("div", { class: "vp wdlg", role: "dialog", "aria-label": t("Save as widget") },
    h("div", { class: "vp-head" }, h("h2", {}, t("Save as widget")), h("button", { class: "icon-btn", "aria-label": t("Close"), onclick: close }, ic("x"))),
    h("div", { class: "wdlg-body" },
      field(t("Name"), nameIn),
      field(t("Icon"), iconBtn, t("It shows up next to the name in the library.")),
      field(t("Size"), h("span", { class: "msub" }, t("{0}, the size of this block", [`${rows}×${cols}`])))),
    h("div", { class: "wdlg-foot" }, h("button", { class: "btn", onclick: close }, t("Cancel")),
      h("button", { class: "btn primary", onclick: save }, t("Save widget"))));
  const back = h("div", { class: "vp-back", onclick: (e) => { if (e.target === back) close(); } }, card);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); if (e.key === "Enter" && e.target === nameIn) save(); });
  document.body.append(back);
  nameIn.focus();
  nameIn.select();
}

async function removeUserWidget(id) {
  const d = widgetDefs()[id];
  const used = [];
  for (const [page, keys] of Object.entries(pages())) for (const [k, spec] of Object.entries(keys || {})) if (spec && spec.widget === id) used.push([page, k]);
  const was = S.page;
  for (const [page, k] of used) { S.page = page; await detachWidget(k, { quiet: true }); }
  S.page = was;
  delete S.cfg.widgets[id];
  if (!Object.keys(S.cfg.widgets).length) delete S.cfg.widgets;
  for (const p of Object.keys(S.previews)) S.previews[p] = null;
  buildModel(); changed(); renderKeys(); renderInspector(); renderLibrary();
  toast(used.length ? t("{0} deleted. The {1} keys that used it became regular blocks.", [d ? d.label : id, used.length]) : t("{0} deleted.", [d ? d.label : id]), { undo: true });
}

// ---------------------------------------------------------------------------- página do plugin

function pluginWidgetsSection(pl) {
  const list = Object.entries(widgetDefs()).filter(([, d]) => d.plugin === pl.id);
  if (!list.length) return null;
  return h("div", { class: "int-widgets" }, h("h4", {}, t("Widgets from this plugin")),
    h("div", { class: "int-widget-list" }, ...list.map(([id, d]) => {
      const first = Object.keys(d.sizes)[0];
      return h("div", { class: "int-widget" }, h("span", { class: "size-tile-art" }, widgetThumb(id, first, { unit: 30 })),
        h("b", {}, d.label), h("small", {}, sizesSummary(d)));
    })),
    h("button", { class: "btn small", style: { alignSelf: "flex-start" }, onclick: () => showWidgetsOf(pl.id) }, ic("layout-grid"), t("See in the library")));
}
