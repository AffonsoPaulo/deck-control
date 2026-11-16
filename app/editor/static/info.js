"use strict";
// Informação no Deck: teclas que mostram valores, blocos de teclas (encaixe tipo tetris),
// escolher valores, regras de aparência, condições do "Se" com valores, prateleira de teclas
// guardadas e a aba Automações. Usa as peças de app.js (h, ic, t, S, api, toast…).

// ---------------------------------------------------------------------------- valores

let VALS = {};                                              // id -> valor atual (texto), de /api/values
const valueDefs = () => (S.schema && S.schema.values) || [];
const valueDef = (id) => valueDefs().find((v) => v.id === id) || null;
const valueLabel = (id) => (valueDef(id) || {}).label || id;
const TOKEN_RE = /\{([A-Za-z0-9_.:\-$]+)(?:\|([a-z0-9]+))?\}/g;
const hasTokens = (s) => typeof s === "string" && /\{[A-Za-z0-9_.:\-$]+(\|[a-z0-9]+)?\}/.test(s);
async function refreshValues() {
  try { VALS = (await api("/api/values")).values || {}; } catch { /* app fechado */ }
}
setInterval(() => { if (S.cfg && !document.hidden) refreshValues(); }, 5000);
const valueNow = (id) => {
  const v = VALS[id];
  if (v !== undefined && v !== null) return String(v);
  const d = valueDef(id);
  return d && d.sample !== undefined && d.sample !== null ? String(d.sample) : "–";
};
const panelDefs = () => (S.schema && S.schema.panels) || {};

// campo de texto com valores: o texto livre continua digitável e cada valor vira uma etiqueta
function tokenEditor(value, onChange, opts = {}) {
  const box = h("div", { class: "tok-field", contenteditable: "true", role: "textbox", "aria-label": opts.label || t("Text"),
    "data-placeholder": opts.placeholder || "" });
  let caret = null;
  const chip = (id, fmt) => h("span", { class: "tok", contenteditable: "false", "data-v": id, "data-f": fmt || "", title: `{${id}}` },
    ic("braces"), valueLabel(id) + (fmt === "nz" ? " (5)" : ""));
  const build = () => {
    box.replaceChildren();
    const s = String(value || "");
    let last = 0;
    for (const m of s.matchAll(TOKEN_RE)) {
      if (m.index > last) box.append(document.createTextNode(s.slice(last, m.index)));
      box.append(chip(m[1], m[2]));
      last = m.index + m[0].length;
    }
    if (last < s.length) box.append(document.createTextNode(s.slice(last)));
  };
  const serialize = () => {
    let out = "";
    box.childNodes.forEach((n) => {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.dataset && n.dataset.v) out += `{${n.dataset.v}${n.dataset.f ? "|" + n.dataset.f : ""}}`;
      else if (n.nodeName === "BR") out += "";
      else out += n.textContent;
    });
    return out.replace(/ /g, " ");
  };
  const remember = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && box.contains(sel.getRangeAt(0).startContainer)) caret = sel.getRangeAt(0).cloneRange();
  };
  box.addEventListener("keyup", remember);
  box.addEventListener("mouseup", remember);
  box.addEventListener("input", () => { value = serialize(); remember(); onChange(value || null); });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
  box.addEventListener("paste", (e) => {                     // cola só texto
    e.preventDefault();
    document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text").replace(/\n/g, " "));
  });
  build();
  const insert = h("button", { class: "icon-btn small tok-insert", title: t("Insert a value"), "aria-label": t("Insert a value"),
    onclick: () => openValuePicker((id, fmt) => {
      const node = chip(id, fmt);
      if (caret && box.contains(caret.startContainer)) { caret.deleteContents(); caret.insertNode(node); caret.setStartAfter(node); }
      else box.append(node);
      value = serialize(); onChange(value); remember();
    }, { kinds: opts.kinds }) }, ic("braces"));
  return h("div", { class: "tok-wrap" }, box, insert);
}

// lista para escolher um valor (agrupada, com o valor de agora à direita)
function openValuePicker(cb, opts = {}) {
  closeValuePicker();
  refreshValues().then(() => paint());
  let q = "", selected = null, fmt = "";
  const list = h("div", { class: "vp-list" });
  const foot = h("div", { class: "vp-foot" });
  const search = h("input", { type: "search", placeholder: t("Search (e.g.: hour, scene, temperature)"), "aria-label": t("Search values"),
    oninput: (e) => { q = norm(e.target.value); paint(); } });
  const close = () => closeValuePicker();
  const done = () => { if (selected) { close(); cb(selected, fmt); } };
  const paint = () => {
    const groups = {};
    for (const v of valueDefs()) {
      if (opts.kinds && !opts.kinds.includes(v.kind)) continue;
      if (q && !norm(`${v.label} ${v.id} ${v.group}`).includes(q)) continue;
      (groups[v.group] ||= []).push(v);
    }
    list.replaceChildren(...Object.entries(groups).map(([g, items]) => h("div", { class: "vp-group" },
      h("div", { class: "vp-ghead" }, g),
      ...items.map((v) => h("button", { class: "vp-row", "aria-pressed": selected === v.id ? "true" : "false",
        onclick: () => { selected = v.id; fmt = ""; paint(); }, ondblclick: () => { selected = v.id; done(); } },
        h("span", { class: "vp-name" }, h("b", {}, v.label), h("small", {}, v.id)),
        h("span", { class: "tok vp-now" }, valueNow(v.id)))))));
    if (!list.children.length) list.append(h("p", { class: "fine" }, t("No values found.")));
    const d = selected && valueDef(selected);
    foot.replaceChildren(
      d && /^clock\.(hour|minute|second|day)$/.test(d.id) ? h("div", { class: "vp-fmt" }, h("span", { class: "msub" }, t("How to show")),
        pills([["", t("Two digits (05)")], ["nz", t("No zero (5)")]], fmt, (v) => { fmt = v; paint(); }, t("How to show"))) : h("span"),
      h("div", { class: "row", style: { justifyContent: "flex-end", gap: "8px" } },
        h("button", { class: "btn", onclick: close }, t("Cancel")),
        h("button", { class: "btn primary", disabled: !selected, onclick: done }, selected ? t("Insert {0}", [d ? d.label : selected]) : t("Insert"))));
  };
  const card = h("div", { class: "vp", role: "dialog", "aria-label": t("Choose a value") },
    h("div", { class: "vp-head" }, h("h2", {}, t("Choose a value")),
      h("button", { class: "icon-btn", "aria-label": t("Close"), onclick: close }, ic("x"))),
    search, h("p", { class: "hint vp-hint" }, t("On the right, the value right now. Plugins can add their own.")), list, foot);
  const back = h("div", { class: "vp-back", id: "valuePicker", onclick: (e) => { if (e.target === back) close(); } }, card);
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); if (e.key === "Enter" && selected) done(); });
  document.body.append(back);
  paint();
  search.focus();
}
function closeValuePicker() { const el = document.getElementById("valuePicker"); if (el) el.remove(); }

function valueSelect(value, onPick, opts = {}) {
  const defs = valueDefs().filter((v) => !opts.kinds || opts.kinds.includes(v.kind));
  const sel = h("select", { class: opts.inline ? "inl" : "", "aria-label": opts.label || t("Value") });
  if (opts.empty) sel.append(h("option", { value: "" }, opts.empty));
  const groups = {};
  for (const v of defs) (groups[v.group] ||= []).push(v);
  for (const [g, items] of Object.entries(groups))
    sel.append(h("optgroup", { label: g }, ...items.map((v) => h("option", { value: v.id, selected: v.id === value }, v.label))));
  if (value && !defs.some((v) => v.id === value)) sel.append(h("option", { value, selected: true }, value));
  sel.addEventListener("change", () => onPick(sel.value || null));
  return sel;
}

// ---------------------------------------------------------------------------- condições (regras e "Se")

const OP_LABELS = () => ({ eq: t("is"), ne: t("is not"), gt: t("is greater than"), lt: t("is less than"),
  ge: t("is at least"), le: t("is at most"), contains: t("contains") });
// edita {value, op, to} no próprio objeto; on() é chamado a cada mudança
function condEditor(c, on, inline = true) {
  const wrap = h("span", { class: "cond" });
  const paint = () => {
    const d = valueDef(c.value);
    const kids = [valueSelect(c.value, (v) => {
      c.value = v; delete c.state;
      const nd = valueDef(v);
      if (nd && nd.kind === "bool") { c.op = "eq"; c.to = true; } else { c.op = c.op && c.op !== "eq" ? c.op : "eq"; if (typeof c.to === "boolean") c.to = ""; }
      on(); paint();
    }, { inline, label: t("Value"), empty: c.value ? null : t("choose a value…") })];
    if (c.value && d && d.kind === "bool") {
      kids.push(w(t("is")), inlSelect([[true, t("yes")], [false, t("no")]].map(([v, l]) => [v, l]), c.to !== false,
        (i) => { c.op = "eq"; c.to = i === 0; on(); }, t("Yes or no")));
    } else if (c.value) {
      const ops = Object.entries(OP_LABELS());
      kids.push(inlSelect(ops, c.op || "eq", (i) => { c.op = ops[i][0]; on(); }, t("Comparison")));
      const inp = h("input", { class: "inl", type: "text", value: c.to ?? "", placeholder: valueNow(c.value), "aria-label": t("Compare with"),
        oninput: (e) => { const s = e.target.value; c.to = s !== "" && !isNaN(Number(s.replace(",", "."))) ? Number(s.replace(",", ".")) : s; on(); } });
      autosize(inp, 4, 16);
      kids.push(inp);
    }
    wrap.replaceChildren(...kids);
  };
  paint();
  return wrap;
}
// "Se" com valor (os antigos, com 'state', continuam funcionando e viram valor ao mexer)
function inlCond(s, ed) {
  if (!s.value && s.state) { s.value = s.state; s.op = "eq"; s.to = s.is === false ? false : true; delete s.is; }
  const c = condEditor(s, () => { delete s.state; ed(); });
  c.classList.add("grow");
  return c;
}

// ---------------------------------------------------------------------------- tecla de informação

const isInfoIcon = (ic) => !!ic && (ic.sub !== undefined || isObj(ic.bar) || isObj(ic.bg) || ic.style === "info" ||
  Object.values(ic).some(hasTokens));
const isInfoKey = (spec) => !!spec && (!!spec.format || (Array.isArray(spec.rules) && spec.rules.length > 0) || isInfoIcon(normalizeIcon(spec.icon)));
const keyId = (page, key) => `${page}-${key}`.replace(/[^A-Za-z0-9_-]/g, "_");
function withId(obj, id) { return JSON.parse(JSON.stringify(obj).replace(/\$id/g, id)); }
const FORMATS = [["app.clock", "clock"], ["app.date", "calendar"], ["app.countdown", "hourglass"], ["app.gauge", "gauge"], ["app.free", "braces"]];

// a aba Aparência das teclas que mostram informação (e das células de um bloco)
function infoLook(spec, target) {
  // target: {get(), set(icon), cellOf?} — padrão: o ícone da própria tecla
  target = target || { get: () => normalizeIcon(spec.icon), set: (v) => { spec.icon = v; } };
  const body = h("div", { class: "insp-body look info-look" });
  const icon = clone(target.get()) || {};
  const save = (patch, rerender = false) => {
    const cur = clone(target.get()) || {};
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === "") delete cur[k]; else cur[k] = v; }
    target.set(cur);
    changed();
    if (rerender) renderInspector();
  };
  const noAction = !spec.action && !spec.hold && !spec.release && !spec.double;
  if (!target.cell && noAction) body.append(h("div", { class: "info-note" }, ic("info"),
    h("span", {}, t("This key only shows information. Pressing it does nothing, unless you add an action in What it does."))));

  if (!target.cell) {
    const tiles = FORMATS.filter(([id]) => panelDefs()[id]).map(([id, icn]) => h("button", { class: "ftile", "aria-pressed": spec.format === id ? "true" : "false",
      onclick: () => applyFormat(spec, id) }, ic(icn), panelDefs()[id].label));
    body.append(h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Format")),
      h("div", { class: "ftiles" }, ...tiles), h("p", { class: "hint" }, t("A starting point already arranged. Everything below stays editable."))));
  }
  body.append(h("div", { class: "look-top" }, h("img", { id: "lookImg", class: "look-img", alt: t("Key preview") }),
    h("div", { class: "look-side" }, h("p", { class: "hint" }, t("The preview uses the values right now (or an example, with the app closed).")))));

  body.append(h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Text")),
    tokenEditor(icon.text, (v) => save({ text: v }), { label: t("Text"), placeholder: t("e.g.: {0}", ["14:32"]) }),
    h("span", { class: "lbl", style: { marginTop: "6px" } }, t("Second line")),
    tokenEditor(icon.sub, (v) => save({ sub: v }), { label: t("Second line"), placeholder: t("optional") }),
    h("p", { class: "hint" }, t("Mix fixed text with values. The {0} button opens the list of values.", ["{ }"]))));

  // ícone: nenhum, fixo ou vindo de um valor
  const iconMode = icon.lucide ? (hasTokens(icon.lucide) ? "value" : "fixed") : "none";
  const iconSec = h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Icon")),
    pills([["none", t("None##icon")], ["fixed", t("Fixed##icon")], ["value", t("From a value")]], iconMode, (m) => {
      if (m === "none") save({ lucide: null }, true);
      else if (m === "fixed") openGlyphPicker((c) => c && save({ lucide: c }, true));
      else {
        const first = valueDefs().find((v) => v.kind === "icon");
        save({ lucide: first ? `{${first.id}}` : null }, true);
      }
    }, t("Icon")));
  if (iconMode === "fixed") iconSec.append(glyphCard(icon, (c) => save({ lucide: c }, true), () => save({ lucide: null }, true)));
  if (iconMode === "value") {
    const cur = (icon.lucide.match(/\{([^}|]+)/) || [])[1];
    iconSec.append(valueSelect(cur, (v) => save({ lucide: v ? `{${v}}` : null }, true), { kinds: ["icon"], label: t("Value with the icon") }),
      h("p", { class: "hint" }, t("For example, the weather condition: the plugin says which icon to use.")));
  }
  body.append(iconSec);

  // fundo: cor fixa ou conforme um valor (faixas)
  const bgSec = h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Background")));
  if (isObj(icon.bg)) {
    bgSec.append(bandsEditor(icon.bg, (v) => save({ bg: v }), t("Color by value")),
      h("button", { class: "btn small", onclick: () => save({ bg: (icon.bg.bands && icon.bg.bands[0] && icon.bg.bands[0][1]) || "#1d2330" }, true) }, t("Use one color")));
  } else {
    bgSec.append(swatchRow(icon.bg || null, (c) => save({ bg: c }), true, INFO_SWATCHES, t("Default")),
      h("button", { class: "btn small", onclick: () => save({ bg: { value: firstNumber(), bands: [[30, "#1d2330"], [80, "#3a2a12"], [100, "#b4232a"]] } }, true) },
        ic("sliders-horizontal"), t("Depending on a value")));
  }
  body.append(bgSec);

  // barra (medidor)
  const barSec = h("div", { class: "lsec" });
  barSec.append(toggleRow(t("Bar at the bottom"), isObj(icon.bar), (on) =>
    save({ bar: on ? { value: firstNumber(), min: 0, max: 100, color: "#F5A524" } : null }, true)));
  if (isObj(icon.bar)) {
    const b = icon.bar;
    const upd = () => save({ bar: b });
    const range = h("div", { class: "row", style: { gap: "8px", alignItems: "center", flexWrap: "wrap" } },
      valueSelect(b.value, (v) => { b.value = v; upd(); }, { kinds: ["number"], label: t("Value of the bar") }),
      h("span", { class: "msub" }, t("from")), num(b.min ?? 0, (v) => { b.min = v; upd(); }, "0"),
      h("span", { class: "msub" }, t("to")), num(b.max ?? 100, (v) => { b.max = v; upd(); }, "100"));
    barSec.append(range, pills([["one", t("One color")], ["bands", t("By range")]], b.bands ? "bands" : "one", (m) => {
      if (m === "bands") { b.bands = [[30, "#8f98a5"], [80, "#F5A524"], [100, "#f97316"]]; delete b.color; }
      else { b.color = (b.bands && b.bands[1] && b.bands[1][1]) || "#F5A524"; delete b.bands; }
      save({ bar: b }, true);
    }, t("Bar color")));
    if (b.bands) barSec.append(bandRows(b.bands, () => save({ bar: b })));
    else barSec.append(swatchRow(b.color || "#F5A524", (c) => { b.color = c; upd(); }, false, INFO_SWATCHES));
  }
  body.append(barSec);

  if (!target.cell) body.append(rulesSection(spec));
  return body;
}
const INFO_SWATCHES = [["#1d2330", t("Graphite")], ["#22336e", t("Blue")], ["#1f3a5f", t("Sky blue")], ["#1d4d37", t("Green")], ["#3a2a12", t("Amber")],
  ["#b4232a", t("Red")], ["#2b2440", t("Violet")], ["#5865F2", "Discord"], ["#F5A524", t("Orange")], ["#000000", t("Black")]];
// nome da cor para os resumos ("Luz verde por 3 s" em vez do código)
function colorName(hex) {
  const all = INFO_SWATCHES.concat([["#22c55e", t("green")], ["#ef4444", t("red")], ["#b4232a", t("red")], ["#F5A524", t("orange")]]);
  const hit = all.find(([c]) => String(c).toLowerCase() === String(hex || "").toLowerCase());
  return hit ? String(hit[1]).toLowerCase() : (hex || "");
}
const firstNumber = () => (valueDefs().find((v) => v.kind === "number") || { id: "system.volume" }).id;

function bandsEditor(bg, on, label) {
  bg.bands = bg.bands || [[50, "#1d2330"], [100, "#b4232a"]];
  return h("div", { class: "bands" }, h("span", { class: "msub" }, label),
    valueSelect(bg.value, (v) => { bg.value = v; on(bg); }, { kinds: ["number"], label: t("Value") }),
    bandRows(bg.bands, () => on(bg)));
}
// faixas: [[até, cor], ...] em ordem crescente
function bandRows(bands, on) {
  const wrap = h("div", { class: "band-rows" });
  const paint = () => {
    wrap.replaceChildren(...bands.map((b, i) => h("div", { class: "band" },
      h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(b[1]) ? b[1] : "#888888", "aria-label": t("Color"),
        oninput: (e) => { b[1] = e.target.value; on(); } }),
      h("span", {}, i === 0 ? t("up to") : t("then up to")),
      num(b[0], (v) => { b[0] = v ?? 0; on(); }, "100"),
      bands.length > 1 ? h("button", { class: "icon-btn small", "aria-label": t("Remove range"), onclick: () => { bands.splice(i, 1); on(); paint(); } }, ic("x")) : null)),
      h("button", { class: "btn small", onclick: () => { const last = bands[bands.length - 1]; bands.push([Number(last[0]) + 10, last[1]]); on(); paint(); } },
        ic("plus"), t("Range")));
  };
  paint();
  return wrap;
}

function applyFormat(spec, id) {
  const p = panelDefs()[id];
  if (!p || !p.sizes["1x1"]) return;
  const kid = keyId(S.page, S.key);
  spec.icon = withId(p.sizes["1x1"][0][0], kid);
  Object.keys(spec.icon).forEach((k) => spec.icon[k] === null && delete spec.icon[k]);
  spec.format = id;
  if (p.action && !spec.action) spec.action = withId(p.action, kid);
  if (p.hold && !spec.hold) spec.hold = withId(p.hold, kid);
  S.previews[S.page] = null; buildModel(); changed(); renderKeys(); renderInspector();
}

// regras: o bloco "Se" do sistema, com a aparência dentro
function rulesSection(spec) {
  const sec = h("div", { class: "lsec" }, h("div", { class: "row", style: { alignItems: "center" } },
    h("span", { class: "lbl" }, t("Rules")), h("span", { class: "msub", style: { marginLeft: "8px" } }, t("optional"))),
    h("p", { class: "hint" }, t("The first rule that holds changes the appearance. With none holding, the key looks like above.")));
  const rules = spec.rules = Array.isArray(spec.rules) ? spec.rules : [];
  rules.forEach((r, i) => {
    r.if = isObj(r.if) ? r.if : {};
    r.icon = isObj(r.icon) ? r.icon : {};
    const look = r.icon;
    const editing = S.ruleOpen === `${S.page}:${S.key}:${i}`;
    const summary = [look.bg ? t("background {0}", [look.bg]) : null, look.lucide ? t("icon {0}", [look.lucide]) : null,
      look.text ? `“${look.text}”` : null].filter(Boolean).join(", ") || t("no changes yet");
    const mini = h("span", { class: "rule-mini", style: { background: look.bg || "#1d2330" } }, look.lucide ? h("span", { class: "lu-ch" }, luChar(look.lucide)) : null);
    const inner = editing ? h("div", { class: "rule-edit" },
      h("span", { class: "msub" }, t("Background")), swatchRow(look.bg || null, (c) => { setOrDelete(look, "bg", c); changed(); }, true, INFO_SWATCHES, t("Unchanged")),
      h("span", { class: "msub" }, t("Icon")), h("div", { class: "row", style: { gap: "8px" } },
        h("button", { class: "btn small", onclick: () => openGlyphPicker((c) => { if (c) { look.lucide = c; changed(); renderInspector(); } }) }, ic("search"), look.lucide ? look.lucide : t("Choose")),
        look.lucide ? h("button", { class: "btn small ghost", onclick: () => { delete look.lucide; changed(); renderInspector(); } }, t("Remove")) : null),
      h("span", { class: "msub" }, t("Text")), txt(look.text || "", (v) => { setOrDelete(look, "text", v || null); changed(); }, t("Unchanged")),
      h("button", { class: "btn small", style: { alignSelf: "flex-start" }, onclick: () => { S.ruleOpen = null; renderInspector(); } }, t("Done")))
      : h("div", { class: "rule-look" }, mini, h("span", { class: "grow" }, h("b", {}, t("Appearance")), h("small", {}, summary)),
        h("button", { class: "icon-btn small", "aria-label": t("Edit appearance"), onclick: () => { S.ruleOpen = `${S.page}:${S.key}:${i}`; renderInspector(); } }, ic("pencil")));
    sec.append(h("div", { class: "cblk rule", style: { "--cat": "#e5701a" } },
      h("div", { class: "cbar" }, h("span", { class: "blk-icon" }, ic("split")),
        h("span", { class: "blk-words" }, h("span", { class: "chiplabel" }, t("If")), inlCond(r.if, () => changed())),
        h("button", { class: "icon-btn small", "aria-label": t("Remove rule"), onclick: () => { rules.splice(i, 1); if (!rules.length) delete spec.rules; changed(); renderInspector(); } }, ic("trash-2"))),
      h("div", { class: "cbody" }, inner), h("div", { class: "cfoot" })));
  });
  sec.append(h("button", { class: "btn small", style: { alignSelf: "flex-start" }, onclick: () => {
    rules.push({ if: { value: "", op: "eq", to: true }, icon: { bg: "#b4232a" } });
    S.ruleOpen = `${S.page}:${S.key}:${rules.length - 1}`;
    changed(); renderInspector();
  } }, ic("plus"), t("Add rule")));
  return sec;
}

// ---------------------------------------------------------------------------- blocos de teclas

const COLS_N = 5, ROWS_N = 3;
const kpos = (k) => [(Number(k) - 1) % COLS_N, Math.floor((Number(k) - 1) / COLS_N)];
const kat = (c, r) => String(r * COLS_N + c + 1);
const spanOf = (spec) => (spec && Array.isArray(spec.span) ? [Number(spec.span[0]) || 1, Number(spec.span[1]) || 1] : [1, 1]);
function coverMap(page = S.page) {
  const out = {};
  for (const [k, spec] of Object.entries(pageKeys(page))) {
    const [cols, rows] = spanOf(spec);
    if (cols === 1 && rows === 1) continue;
    const [c0, r0] = kpos(k);
    let i = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const kk = kat(c0 + c, r0 + r); if (kk !== k) out[kk] = [k, i]; i++; }
  }
  return out;
}
// teclas que um pedaço rows×cols ocuparia a partir de 'anchor' (null se sair da grade)
function footprint(anchor, cols, rows) {
  const [c0, r0] = kpos(anchor);
  if (c0 < 0 || r0 < 0 || c0 + cols > COLS_N || r0 + rows > ROWS_N) return null;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(kat(c0 + c, r0 + r));
  return out;
}
// tira tudo que estiver nessas teclas (blocos inteiros); devolve o que saiu, para poder guardar
function clearKeys(list, except) {
  const keys = pageKeys(), cov = coverMap();
  const removed = [];
  const anchors = new Set();
  for (const k of list) { if (keys[k] && k !== except) anchors.add(k); else if (cov[k] && cov[k][0] !== except) anchors.add(cov[k][0]); }
  for (const a of anchors) { removed.push({ key: a, spec: keys[a] }); delete keys[a]; }
  return removed;
}
function placedToast(msg, removed) {
  if (!removed.length) return toast(msg, { undo: true });
  toast(msg + " " + (removed.length === 1 ? t("1 key was replaced.") : t("{0} keys were replaced.", [removed.length])), {
    undo: true, sticky: false,
    action: { label: t("Keep the replaced ones"), fn: () => { removed.forEach((r) => saveSpec(r.spec)); toast(t("Saved in Saved keys, in the library.")); } } });
}

// encaixa um painel (formato do app ou painel de plugin) num tamanho, a partir de uma tecla
function placePanel(anchor, panelId, size) {
  const p = panelDefs()[panelId];
  if (!p || !p.sizes[size]) return;
  const [rows, cols] = size.split("x").map(Number);
  const keys = footprint(anchor, cols, rows);
  if (!keys) return toast(t("It doesn't fit there: the piece goes past the edge."), { bad: true });
  const removed = clearKeys(keys);
  const kid = keyId(S.page, anchor);
  const cells = withId(p.sizes[size], kid).flat().map((c) => { const o = { ...c }; Object.keys(o).forEach((k) => o[k] === null && delete o[k]); return o; });
  const spec = rows === 1 && cols === 1 ? { icon: cells[0], format: panelId }
    : { span: [cols, rows], cells, mode: "split", panel: panelId, format: panelId, icon: { text: p.label } };
  if (p.action) spec.action = withId(p.action, kid);
  if (p.hold) spec.hold = withId(p.hold, kid);
  pageKeys()[anchor] = spec;
  afterPlace(anchor);
  placedToast(t("{0} {1} placed.", [p.label, sizeLabel(size)]), removed);
}
function placeSaved(anchor, idx) {
  const item = (S.cfg.saved_keys || [])[idx];
  if (!item) return;
  const spec = clone(item.key);
  const [cols, rows] = spanOf(spec);
  const keys = footprint(anchor, cols, rows);
  if (!keys) return toast(t("It doesn't fit there: the piece goes past the edge."), { bad: true });
  const removed = clearKeys(keys);
  pageKeys()[anchor] = spec;
  afterPlace(anchor);
  placedToast(t("“{0}” placed.", [item.name]), removed);
}
function afterPlace(anchor) {
  S.previews[S.page] = null; S.key = anchor; S.tab = "look"; S.multi = new Set();
  buildModel(); changed(); renderKeys(); renderInspector();
}
const sizeLabel = (size) => size.replace("x", "×");

// juntar teclas à mão (Shift+clique ou arrastar por cima)
function toggleMulti(k) {
  S.multi = S.multi || new Set();
  if (S.multi.has(k)) S.multi.delete(k); else S.multi.add(k);
  renderJoinBar(); markMulti();
}
function multiRect() {
  const ks = [...(S.multi || [])];
  if (ks.length < 2) return null;
  const ps = ks.map(kpos);
  const c0 = Math.min(...ps.map((p) => p[0])), c1 = Math.max(...ps.map((p) => p[0]));
  const r0 = Math.min(...ps.map((p) => p[1])), r1 = Math.max(...ps.map((p) => p[1]));
  const cols = c1 - c0 + 1, rows = r1 - r0 + 1;
  if (cols * rows !== ks.length) return null;                     // tem buraco: não é um retângulo
  const cov = coverMap();
  if (ks.some((k) => cov[k] || spanOf(pageKeys()[k])[0] * spanOf(pageKeys()[k])[1] > 1)) return null;   // já tem bloco no meio
  return { anchor: kat(c0, r0), cols, rows };
}
function markMulti() {
  document.querySelectorAll("#keys .key").forEach((el) => el.classList.toggle("multi", !!(S.multi && S.multi.has(el.dataset.key))));
}
function renderJoinBar() {
  let bar = document.getElementById("joinBar");
  const n = S.multi ? S.multi.size : 0;
  if (n < 2) { if (bar) bar.remove(); return; }
  const rect = multiRect();
  if (!bar) { bar = h("div", { id: "joinBar", class: "join-bar", role: "toolbar", "aria-label": t("Join keys") }); $("#deckWrap").append(bar); }
  bar.replaceChildren(
    rect ? h("button", { class: "btn primary", onclick: joinKeys }, ic("combine"), t("Join {0}", [`${rect.rows}×${rect.cols}`]))
      : h("span", { class: "msub" }, t("Select a full rectangle of keys (no gaps).")),
    h("button", { class: "btn", onclick: () => { S.multi = new Set(); renderJoinBar(); markMulti(); } }, t("Cancel")));
}
function joinKeys() {
  const rect = multiRect();
  if (!rect) return;
  const keys = pageKeys();
  const list = footprint(rect.anchor, rect.cols, rect.rows);
  const cells = list.map((k) => (keys[k] ? normalizeIcon(keys[k].icon) : {}));
  const withAction = list.find((k) => keys[k] && (keys[k].action || keys[k].hold));
  const base = keys[rect.anchor] ? clone(keys[rect.anchor]) : {};
  const donor = withAction ? keys[withAction] : null;
  const removed = clearKeys(list.filter((k) => k !== rect.anchor), null).filter((r) => r.key !== withAction);
  const spec = { ...base, span: [rect.cols, rect.rows], cells, mode: "split", icon: { text: (normalizeIcon(base.icon).text) || t("Block") } };
  if (donor && donor !== base) for (const m of MOMENTS) if (donor[m] && !spec[m]) spec[m] = clone(donor[m]);
  keys[rect.anchor] = spec;
  afterPlace(rect.anchor);
  placedToast(t("Keys joined into a {0} block.", [`${rect.rows}×${rect.cols}`]), removed);
}
function splitBlock(anchor) {
  const keys = pageKeys();
  const spec = keys[anchor];
  if (!spec) return;
  const [cols, rows] = spanOf(spec);
  const list = footprint(anchor, cols, rows) || [anchor];
  const cells = spec.cells || [];
  list.forEach((k, i) => {
    if (k === anchor) return;
    keys[k] = { icon: cells[i] ? clone(cells[i]) : {} };
  });
  if (cells[0]) spec.icon = clone(cells[0]);
  for (const f of ["span", "cells", "mode", "panel", "format"]) delete spec[f];
  afterPlace(anchor);
  toast(t("Block separated into {0} keys.", [list.length]), { undo: true });
}

// aparência de um bloco: distribuir (cada tecla uma parte) ou imagem contínua
function blockLook(spec) {
  const body = h("div", { class: "insp-body look block-look" });
  const [cols, rows] = spanOf(spec);
  body.append(h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Block {0}", [`${rows}×${cols}`])),
    pills([["split", t("Distribute")], ["image", t("Continuous image")]], spec.mode === "image" ? "image" : "split", (m) => {
      spec.mode = m; if (m === "split" && !spec.cells) spec.cells = Array.from({ length: cols * rows }, () => ({}));
      S.previews[S.page] = null; changed(); renderKeys(); renderInspector();
    }, t("How to show")),
    h("p", { class: "hint" }, spec.mode === "image"
      ? t("One picture crosses the screens. The app skips the frame between them, so it looks continuous.")
      : t("Each screen gets a whole part. Best for text and numbers."))));
  if (spec.mode === "image") {
    const icon = normalizeIcon(spec.icon);
    body.append(h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Image")),
      icon.image ? imageCard(icon.image, (p) => { spec.icon = { ...icon, image: p }; S.previews[S.page] = null; changed(); renderKeys(); renderInspector(); },
        () => { delete icon.image; spec.icon = icon; S.previews[S.page] = null; changed(); renderKeys(); renderInspector(); })
        : h("button", { class: "btn", onclick: () => pickImage((p) => { spec.icon = { ...icon, image: p }; S.previews[S.page] = null; changed(); renderKeys(); renderInspector(); }) },
          ic("upload"), t("Choose image"))));
  } else {
    spec.cells = Array.isArray(spec.cells) ? spec.cells : [];
    while (spec.cells.length < cols * rows) spec.cells.push({});
    const sel = Math.min(S.cellIdx || 0, cols * rows - 1);
    const picker = h("div", { class: "cell-pick", style: { gridTemplateColumns: `repeat(${cols}, 34px)` } },
      ...spec.cells.slice(0, cols * rows).map((c, i) => h("button", { class: "cell-btn", "aria-pressed": i === sel ? "true" : "false",
        "aria-label": t("Key {0} of the block", [i + 1]), onclick: () => { S.cellIdx = i; renderInspector(); } }, String(i + 1))));
    body.append(h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Editing the key")), picker));
    body.append(infoLook(spec, { cell: true, get: () => spec.cells[sel] || {}, set: (v) => { spec.cells[sel] = v; S.previews[S.page] = null; } }));
  }
  body.append(rulesSection(spec));
  body.append(h("div", { class: "lsec" }, h("button", { class: "btn", style: { alignSelf: "flex-start" }, onclick: () => splitBlock(S.key) }, ic("ungroup"), t("Separate keys"))));
  return body;
}

// ---------------------------------------------------------------------------- arrastar no tamanho real

function keyMetrics() {
  const a = document.querySelector('#keys .key[data-key="1"]'), b = document.querySelector('#keys .key[data-key="2"]'), c = document.querySelector('#keys .key[data-key="6"]');
  if (!a) return { size: 80, gapX: 12, gapY: 12 };
  const ra = a.getBoundingClientRect();
  return { size: ra.width, gapX: b ? b.getBoundingClientRect().left - ra.right : 12, gapY: c ? c.getBoundingClientRect().top - ra.bottom : 12 };
}
// "fantasma" do tamanho exato que a peça vai ocupar, para setDragImage
function dragGhost(cols, rows, cellsHtml) {
  const m = keyMetrics();
  const g = h("div", { class: "drag-ghost", style: { gridTemplateColumns: `repeat(${cols}, ${m.size}px)`, gridAutoRows: `${m.size}px`,
    columnGap: `${m.gapX}px`, rowGap: `${m.gapY}px` } }, ...cellsHtml);
  document.body.append(g);
  setTimeout(() => g.remove(), 0);
  return g;
}
function ghostCell(content, bg) { return h("div", { class: "ghost-cell", style: { background: bg || "#1d2330" } }, ...[].concat(content)); }

function startPieceDrag(e, piece) {
  S.drag = piece;
  e.dataTransfer.setData("text/plain", "piece");
  e.dataTransfer.effectAllowed = "copy";
  const cells = [];
  const src = piece.cellsPreview || [];
  for (let i = 0; i < piece.cols * piece.rows; i++) {
    const c = src[i] || {};
    cells.push(ghostCell([c.lucide && !hasTokens(c.lucide) ? h("span", { class: "lu-ch" }, luChar(c.lucide)) : null,
      h("b", {}, previewText(c.text)), c.sub ? h("small", {}, previewText(c.sub)) : null].filter(Boolean), isObj(c.bg) ? "#1d2330" : c.bg));
  }
  const g = dragGhost(piece.cols, piece.rows, cells);
  const m = keyMetrics();
  e.dataTransfer.setDragImage(g, m.size / 2, m.size / 2);
}
const previewText = (s) => String(s || "").replace(TOKEN_RE, (_, id, f) => { const v = valueNow(id); return f === "nz" ? v.replace(/^0+(?=\d)/, "") : v; });

// sobre a grade: destaca as casas da peça e as que vão ser substituídas
function pieceOver(k) {
  const d = S.drag;
  if (!d) return;
  clearFoot();
  const keys = footprint(k, d.cols || 1, d.rows || 1);
  const tip = document.getElementById("footTip");
  if (!keys) { const el = document.querySelector(`#keys .key[data-key="${k}"]`); if (el) el.classList.add("foot-bad"); return; }
  const cov = coverMap(), pk = pageKeys();
  let replace = 0;
  for (const kk of keys) {
    const el = document.querySelector(`#keys .key[data-key="${kk}"]`) || (cov[kk] && document.querySelector(`#keys .key[data-key="${cov[kk][0]}"]`));
    const busy = !!(pk[kk] || cov[kk]);
    if (busy) replace++;
    if (el) el.classList.add(busy ? "foot-replace" : "foot");
  }
  if (d.cols * d.rows > 1 || replace) showFootTip(k, replace);
  else if (tip) tip.remove();
}
function showFootTip(k, replace) {
  const d = S.drag;
  let tip = document.getElementById("footTip");
  if (!tip) { tip = h("div", { id: "footTip", class: "foot-tip" }); $("#deckWrap").append(tip); }
  tip.textContent = (d.label ? `${d.label} ${d.rows}×${d.cols}` : `${d.rows}×${d.cols}`) + (replace ? ": " + (replace === 1 ? t("replaces 1 key") : t("replaces {0} keys", [replace])) : "");
}
function clearFoot() {
  document.querySelectorAll("#keys .foot, #keys .foot-replace, #keys .foot-bad").forEach((el) => el.classList.remove("foot", "foot-replace", "foot-bad"));
}
function endFoot() { clearFoot(); const tip = document.getElementById("footTip"); if (tip) tip.remove(); }
function pieceDrop(k) {
  const d = S.drag;
  endFoot();
  if (!d) return;
  if (d.kind === "piece") placePanel(k, d.panel, d.size);
  else if (d.kind === "saved") placeSaved(k, d.index);
  S.drag = null;
}

// ---------------------------------------------------------------------------- biblioteca: informação e guardadas

const LIB_PANEL_OPEN = new Set();
function infoLibraryGroups(query) {
  const nq = norm(query);
  const out = [];
  const panels = Object.entries(panelDefs()).filter(([id, p]) => !nq || norm(`${p.label} ${id}`).includes(nq));
  if (panels.length) {
    const gname = "Show information";
    const open = !!query || libOpen.has(gname);
    const head = h("button", { class: "lib-head", "aria-expanded": open ? "true" : "false", onclick: () => toggleLibGroup(gname) },
      h("i", { class: "lib-dot", "aria-hidden": "true" }), h("span", { class: "grow" }, t(gname)),
      h("span", { class: "lib-count" }, String(panels.length)), ic("chevron-right"));
    const sec = h("section", { class: "lib-group", style: { "--cat": "#8e4ec6" } }, head);
    if (open) for (const [id, p] of panels) {
      const sizes = Object.keys(p.sizes);
      const expanded = LIB_PANEL_OPEN.has(id) || !!query;
      const item = h("button", { class: "lib-item", draggable: "true", style: { "--cat": "#8e4ec6" }, title: t("Drag onto a key, or open to see the sizes"),
        "aria-expanded": sizes.length > 1 ? (expanded ? "true" : "false") : null,
        onclick: () => { if (sizes.length > 1) { if (expanded) LIB_PANEL_OPEN.delete(id); else LIB_PANEL_OPEN.add(id); renderLibrary(); }
          else if (S.key) placePanel(S.key, id, sizes[0]); } },
        h("span", { class: "chip" }, ic(p.icon || "braces")), h("span", { class: "label" }, p.label),
        p.plugin ? h("span", { class: "lib-tag" }, t("plugin")) : null);
      const first = sizes[0];
      item.addEventListener("dragstart", (e) => startPieceDrag(e, pieceOf(id, p, first)));
      item.addEventListener("dragend", () => { S.drag = null; endFoot(); });
      sec.append(item);
      if (expanded && sizes.length > 1) sec.append(h("div", { class: "pieces" }, ...sizes.map((size) => pieceThumb(id, p, size))));
    }
    out.push(sec);
  }
  const saved = (S.cfg.saved_keys || []).map((it, i) => [it, i]).filter(([it]) => !nq || norm(it.name).includes(nq));
  if (saved.length) {
    const gname = "Saved keys";
    const open = !!query || libOpen.has(gname);
    const head = h("button", { class: "lib-head", "aria-expanded": open ? "true" : "false", onclick: () => toggleLibGroup(gname) },
      h("i", { class: "lib-dot", "aria-hidden": "true" }), h("span", { class: "grow" }, t(gname)),
      h("span", { class: "lib-count" }, String(saved.length)), ic("chevron-right"));
    const sec = h("section", { class: "lib-group", style: { "--cat": "#a7aebb" } }, head);
    if (open) for (const [it, i] of saved) {
      const [cols, rows] = spanOf(it.key);
      const icon = normalizeIcon(it.key.icon);
      const item = h("div", { class: "lib-item saved-item", draggable: "true", title: t("Drag onto the keys to use it again") },
        h("span", { class: "chip", style: { background: isObj(icon.bg) ? "#1d2330" : (icon.bg || "#1d2330"), color: "#fff" } }, icon.lucide && !hasTokens(icon.lucide) ? h("span", { class: "lu-ch" }, luChar(icon.lucide)) : ic("bookmark")),
        h("span", { class: "label" }, it.name), cols * rows > 1 ? h("span", { class: "lib-tag" }, `${rows}×${cols}`) : null,
        h("button", { class: "icon-btn small", "aria-label": t("Remove from saved keys"), title: t("Remove from saved keys"),
          onclick: (e) => { e.stopPropagation(); S.cfg.saved_keys.splice(i, 1); if (!S.cfg.saved_keys.length) delete S.cfg.saved_keys; changed({ keys: false }); renderLibrary(); } }, ic("x")));
      item.addEventListener("dragstart", (e) => {
        const cells = (it.key.cells && it.key.cells.length ? it.key.cells : [icon]);
        startPieceDrag(e, { kind: "saved", index: i, cols, rows, label: it.name, cellsPreview: cells });
      });
      item.addEventListener("dragend", () => { S.drag = null; endFoot(); });
      sec.append(item);
    }
    out.push(sec);
  }
  return out;
}
function pieceOf(id, p, size) {
  const [rows, cols] = size.split("x").map(Number);
  return { kind: "piece", panel: id, size, rows, cols, label: p.label, cellsPreview: (p.sizes[size] || []).flat() };
}
function pieceThumb(id, p, size) {
  const [rows, cols] = size.split("x").map(Number);
  const u = 15, g = 3;
  const cells = (p.sizes[size] || []).flat();
  const grid = h("span", { class: "piece-grid", style: { gridTemplateColumns: `repeat(${cols}, ${u}px)`, gap: `${g}px` } },
    ...cells.map(() => h("span", { class: "piece-cell" })));
  const btn = h("button", { class: "piece", draggable: "true", title: t("{0} in {1}", [p.label, sizeLabel(size)]),
    onclick: () => { if (S.key) placePanel(S.key, id, size); else toast(t("Click a key first, or drag the piece onto it.")); } },
    grid, h("span", {}, sizeLabel(size)));
  btn.addEventListener("dragstart", (e) => { e.stopPropagation(); startPieceDrag(e, pieceOf(id, p, size)); });
  btn.addEventListener("dragend", () => { S.drag = null; endFoot(); });
  return btn;
}

// guardar teclas para usar depois (vai para o config: saved_keys)
function saveSpec(spec, name) {
  if (!spec) return;
  S.cfg.saved_keys = Array.isArray(S.cfg.saved_keys) ? S.cfg.saved_keys : [];
  const icon = normalizeIcon(spec.icon);
  S.cfg.saved_keys.push({ name: name || String(icon.text || t("Key")).replace(/\n/g, " ").replace(TOKEN_RE, (_, id) => valueLabel(id)), key: clone(spec) });
  libOpen.add("Saved keys");
  changed({ keys: false });
  renderLibrary();
}
function saveCurrentKey() {
  const spec = pageKeys()[S.key];
  if (!spec) return;
  saveSpec(spec);
  toast(t("Saved in Saved keys, in the library. Drag it from there to use it on any page."));
}

// ---------------------------------------------------------------------------- automações

const TRIGGERS = () => [
  ["time", "clock", t("Time of day"), t("every day, at a time")],
  ["every", "repeat", t("Every"), t("from time to time")],
  ["countdown", "hourglass", t("Countdown"), t("once, in X min")],
  ["value", "braces", t("Value changed"), t("when something starts to hold")],
  ["connected", "power", t("Deck connected"), t("when the device connects")],
  ["page", "layers", t("Entering a page"), t("when a page opens")],
];
function autoSummary(a) {
  const w = a.when || {};
  switch (w.type) {
    case "time": return t("Every day at {0}", [w.at || "?"]);
    case "every": return t("Every {0} min", [w.minutes || "?"]);
    case "countdown": return t("In {0} min (once)", [w.minutes || "?"]);
    case "value": return w.value ? t("When {0} {1} {2}", [valueLabel(w.value), (OP_LABELS()[w.op || "eq"] || "="), w.to === true ? t("yes") : w.to === false ? t("no") : (w.to ?? "")]) : t("When a value changes");
    case "connected": return t("When the Deck connects");
    case "page": return t("When entering the page {0}", [w.page || "?"]);
    default: return t("New automation");
  }
}
function renderAutomationsView() {
  const view = $("#autoView");
  const list = S.cfg.automations = Array.isArray(S.cfg.automations) ? S.cfg.automations : [];
  if (S.autoSel === undefined || S.autoSel >= list.length) S.autoSel = list.length ? 0 : -1;
  const side = h("aside", { class: "auto-list" },
    h("div", { class: "row", style: { alignItems: "center", gap: "10px" } },
      h("p", { class: "hint grow" }, t("Things the Deck does on its own, without pressing a key.")),
      h("button", { class: "btn primary", onclick: () => {
        list.push({ name: "", enabled: true, when: { type: "value", value: "", op: "eq", to: true }, do: [] });
        S.autoSel = list.length - 1; changed({ keys: false }); renderAutomationsView();
      } }, ic("plus"), t("New"))),
    ...list.map((a, i) => {
      const tr = TRIGGERS().find((x) => x[0] === (a.when || {}).type) || TRIGGERS()[0];
      const steps = toList(a.do);
      return h("div", { class: "auto-item" + (i === S.autoSel ? " sel" : "") },
        h("button", { class: "auto-pick", onclick: () => { S.autoSel = i; renderAutomationsView(); } },
          h("span", { class: "auto-ic" }, ic(tr[1])),
          h("span", { class: "grow" }, h("b", {}, a.name || autoSummary(a)),
            h("small", {}, steps.length ? steps.map((s) => summarize(s)).join(", ") : t("Nothing to do yet")))),
        h("button", { class: "switch", role: "switch", "aria-checked": a.enabled !== false ? "true" : "false", "aria-label": t("Turn on {0}", [a.name || autoSummary(a)]),
          onclick: () => { a.enabled = a.enabled === false; if (a.enabled) delete a.enabled; changed({ keys: false }); renderAutomationsView(); } }));
    }),
    list.length ? null : h("div", { class: "info-note" }, ic("zap"), h("span", {}, t("No automations yet. Create one: for example, “when the live starts, light the ring green for 3 seconds”."))));
  const main = h("section", { class: "auto-edit" });
  const a = list[S.autoSel];
  if (a) {
    a.when = isObj(a.when) ? a.when : { type: "value" };
    const w = a.when;
    const name = h("input", { type: "text", class: "auto-name", value: a.name || "", placeholder: autoSummary(a), "aria-label": t("Automation name"),
      oninput: (e) => { setOrDelete(a, "name", e.target.value || null); changed({ keys: false }); } });
    main.append(h("div", { class: "row", style: { alignItems: "center", gap: "12px" } }, name,
      h("span", { class: "grow" }),
      h("button", { class: "icon-btn", title: t("Delete automation"), "aria-label": t("Delete automation"),
        onclick: () => { list.splice(S.autoSel, 1); if (!list.length) delete S.cfg.automations; S.autoSel = Math.max(0, S.autoSel - 1); changed({ keys: false }); renderAutomationsView(); } }, ic("trash-2"))));
    main.append(h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("When")),
      h("div", { class: "ttiles" }, ...TRIGGERS().map(([type, icn, label, desc]) => h("button", { class: "ftile", "aria-pressed": w.type === type ? "true" : "false",
        onclick: () => { a.when = { type, ...(type === "time" ? { at: "18:00" } : type === "every" ? { minutes: 60 } : type === "countdown" ? { minutes: 25 } : type === "page" ? { page: S.page } : type === "value" ? { value: "", op: "eq", to: true } : {}) };
          changed({ keys: false }); renderAutomationsView(); } }, ic(icn), h("span", {}, label), h("small", {}, desc)))),
      triggerFields(a)));
    // passos: a mesma lista de blocos das teclas
    S.autoModel = { list: toList(a.do), auto: a };
    main.append(h("div", { class: "lsec" }, h("div", { class: "row", style: { alignItems: "center" } }, h("span", { class: "lbl grow" }, t("Do")),
      h("button", { class: "btn small", onclick: () => pickAndInsert(S.autoModel.list, S.autoModel.list.length) }, ic("plus"), t("Step"))),
      h("div", { class: "logic auto-flow" }, renderFlow(S.autoModel.list, { top: true })),
      h("p", { class: "hint" }, t("Any key action works here: pages, shortcuts, OBS, sequences and the temporary responses."))));
    main.append(h("div", { class: "lsec" }, h("span", { class: "lbl" }, t("Options")),
      h("div", { class: "row", style: { alignItems: "center", gap: "8px", flexWrap: "wrap" } }, h("span", {}, t("Don't run again before")),
        num(a.cooldown ?? "", (v) => { setOrDelete(a, "cooldown", v); changed({ keys: false }); }, "0"), h("span", {}, t("seconds"))),
      h("div", { class: "row", style: { alignItems: "center", gap: "8px", flexWrap: "wrap" } }, h("span", {}, t("Only on")),
        pills([["all", t("Every day")], ["weekdays", t("Mon to Fri")], ["weekend", t("Weekend")]], a.days || "all",
          (v) => { setOrDelete(a, "days", v === "all" ? null : v); changed({ keys: false }); renderAutomationsView(); }, t("Days")))));
    main.append(h("div", { class: "info-note" }, ic("info"), h("span", {}, t("Automations run while the app is open (the icon in the tray)."))));
  } else {
    main.append(h("p", { class: "hint" }, t("Choose or create an automation on the left.")));
  }
  view.replaceChildren(h("div", { class: "auto-wrap" }, side, main));
}
function triggerFields(a) {
  const w = a.when;
  const up = () => changed({ keys: false });
  switch (w.type) {
    case "time": return h("div", { class: "row tfields" }, h("span", {}, t("At")),
      h("input", { type: "time", value: w.at || "18:00", "aria-label": t("Time"), onchange: (e) => { w.at = e.target.value; up(); } }));
    case "every": case "countdown": return h("div", { class: "row tfields" }, h("span", {}, w.type === "every" ? t("Every") : t("In")),
      num(w.minutes ?? 60, (v) => { w.minutes = v; up(); }, "60"), h("span", {}, t("minutes")));
    case "value": return h("div", { class: "row tfields" }, condEditor(w, up, false),
      h("p", { class: "hint", style: { flexBasis: "100%" } }, t("Runs once each time the condition starts to hold.")));
    case "page": return h("div", { class: "row tfields" }, h("span", {}, t("Page")),
      inlSelect(Object.keys(pages()).map((p) => [p, p]), w.page, (i) => { w.page = Object.keys(pages())[i]; up(); }, t("Page")));
    default: return h("span");
  }
}
// os blocos chamam commitModel/rerenderLogic: nas Automações, gravam na automação aberta
function autoCommit() {
  const m = S.autoModel;
  if (!m) return;
  setOrDelete(m.auto, "do", collapse(m.list) ?? []);
  changed({ keys: false });
}
