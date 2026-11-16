// Movimento do editor. Só anima o que responde a algo que a pessoa fez: o que entrou, o que saiu e
// o que mudou de lugar. O editor redesenha painéis inteiros a cada edição, então cada coisa que pode
// se mexer leva um data-m (identidade); antes e depois do redesenho, compara-se quem já estava lá.
// Com "Efeitos de animação" desligado no Windows (prefers-reduced-motion), nada se mexe.
"use strict";

const M = (() => {
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  const off = () => mq.matches;
  const OUT = "cubic-bezier(.2,.8,.2,1)";     // entrar / assentar: desacelera no fim
  const IN = "cubic-bezier(.4,0,1,1)";        // sair: acelera
  const ids = new WeakMap();
  let seq = 0;
  // identidade estável de um objeto (passo, tecla, automação, regra) enquanto ele existir
  const id = (o) => {
    if (!o || typeof o !== "object") return null;
    let v = ids.get(o);
    if (!v) { v = "m" + (++seq); ids.set(o, v); }
    return v;
  };

  // posição no conteúdo do contêiner (não muda com a rolagem nem com o redesenho)
  function frame(host) {
    const r = host.getBoundingClientRect();
    return { x: r.left + host.clientLeft - host.scrollLeft, y: r.top + host.clientTop - host.scrollTop };
  }
  function posIn(el, f) {
    const r = el.getBoundingClientRect();
    return { x: r.left - f.x, y: r.top - f.y, w: r.width, h: r.height };
  }
  function snap(root, host) {
    const f = frame(host);
    const out = new Map();
    root.querySelectorAll("[data-m]").forEach((el) => {
      if (!el.closest(".m-ghost") && !out.has(el.dataset.m)) out.set(el.dataset.m, { el, p: posIn(el, f) });
    });
    return out;
  }
  const parentM = (el, stop) => {
    const p = el.parentElement && el.parentElement.closest("[data-m]");
    return p && (!stop || stop.contains(p)) ? p : null;
  };

  const ENTER = {
    fade: [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }],
    drop: [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
    // a peça "trava" no lugar, como no tetris
    settle: [{ opacity: 0, transform: "scale(.84)" }, { opacity: 1, transform: "scale(1.045)", offset: .62 }, { opacity: 1, transform: "none" }],
  };
  function enter(el, kind = "fade", delay = 0) {
    if (kind === "settle" && el.classList.contains("empty")) kind = "fade";
    el.animate(ENTER[kind], { duration: kind === "settle" ? 260 : 170, delay, easing: OUT, fill: "backwards" });
  }

  // o que saiu: o próprio elemento antigo some no lugar onde estava, por cima do novo desenho
  function ghost(host, el, p) {
    const chain = [];
    for (let a = el.parentElement; a; a = a.parentElement) chain.unshift(a);
    const wrap = document.createElement("div");
    wrap.className = "m-ghost";
    let cur = wrap;
    for (const a of chain) {          // repete os pais antigos sem caixa, para os seletores do CSS continuarem valendo
      const tag = /^(INPUT|SELECT|TEXTAREA|IMG|BUTTON)$/.test(a.tagName) ? "div" : a.tagName;
      const d = document.createElement(tag);
      d.className = a.className;
      const st = a.getAttribute("style");
      if (st) d.setAttribute("style", st);
      d.style.display = "contents";
      cur.append(d); cur = d;
    }
    Object.assign(el.style, { position: "absolute", left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px`,
      margin: "0", boxSizing: "border-box", gridArea: "auto", pointerEvents: "none", zIndex: "4" });
    el.removeAttribute("data-m");
    el.querySelectorAll("[data-m]").forEach((x) => x.removeAttribute("data-m"));
    cur.append(el);
    host.append(wrap);
    const a = el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.94)" }], { duration: 150, easing: IN, fill: "forwards" });
    a.onfinish = a.oncancel = () => wrap.remove();
  }

  // Roda fn (o redesenho) e anima a diferença dentro de root.
  //   enter: fade | drop | settle    scale: anima também a mudança de tamanho (teclas que viram bloco)
  //   tag(root): marca data-m antes e depois (quando a identidade vem do próprio conteúdo)
  //   after(root): marca data-m só depois (quando vem do estado, que já mudou antes do redesenho)
  //   scroller: seletor do elemento que rola dentro de root (ele é recriado no redesenho)
  //   ghosts(el): false para não fazer sumir aquele elemento
  let quiet = 0;
  // desfazer, refazer, recuperar: a tela inteira muda de uma vez, sem movimento
  function still(fn) { quiet++; try { return fn(); } finally { quiet--; } }

  function morph(root, fn, o = {}) {
    if (!root) return fn();
    if (off() || quiet || root.hidden || !root.isConnected) { const r = fn(); if (o.tag) o.tag(root); if (o.after) o.after(root); return r; }
    const hostOf = () => (o.scroller && root.querySelector(o.scroller)) || root;
    const hadContent = root.children.length > 0;
    if (o.tag) o.tag(root);
    const before = snap(root, hostOf());
    const ret = fn();
    if (o.tag) o.tag(root);
    if (o.after) o.after(root);
    const host = hostOf();
    const after = snap(root, host);
    if (!before.size && !hadContent) return ret;            // nada para comparar (primeiro desenho)
    const objs = (m) => [...m.keys()].filter((k) => k[0] === "m");
    const bo = objs(before), ao = objs(after);
    // tudo trocado de uma vez (desfazer, voltar uma versão): sem movimento, senão tudo piscaria
    if (bo.length && ao.length && !ao.some((k) => before.has(k))) return ret;

    const delta = new Map();
    for (const [k, a] of after) {
      const b = before.get(k);
      if (b) delta.set(a.el, [b.p.x - a.p.x, b.p.y - a.p.y]);
    }
    let n = 0;
    for (const [k, a] of after) {
      const par = parentM(a.el, root);
      const b = before.get(k);
      if (!b) {
        if (par && !before.has(par.dataset.m)) continue;   // o pai já está entrando
        enter(a.el, o.enter, Math.min(n++, 10) * (o.stagger || 0));
        continue;
      }
      let [dx, dy] = delta.get(a.el);
      if (par && delta.has(par)) { const [px, py] = delta.get(par); dx -= px; dy -= py; }
      const sx = o.scale && a.p.w ? b.p.w / a.p.w : 1, sy = o.scale && a.p.h ? b.p.h / a.p.h : 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) continue;
      a.el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, transformOrigin: "0 0" },
        { transform: "none", transformOrigin: "0 0" }], { duration: 210, easing: OUT });
    }
    for (const [k, b] of before) {
      if (after.has(k) || b.el.isConnected) continue;
      const par = parentM(b.el);
      if (par && !after.has(par.dataset.m) && before.has(par.dataset.m)) continue;   // o pai já está saindo
      if (o.ghosts && o.ghosts(b.el) === false) continue;
      ghost(host, b.el, b.p);
    }
    return ret;
  }

  function fadeIn(els, { y = 4, dur = 170, stagger = 0 } = {}) {
    if (off()) return;
    [...els].filter(Boolean).forEach((el, i) => el.animate([{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: "none" }],
      { duration: dur, delay: i * stagger, easing: OUT, fill: "backwards" }));
  }

  // a linha da aba escolhida desliza da aba antiga até a nova
  function slideTab(oldRect, tab) {
    if (off() || !oldRect || !tab) return;
    const r = tab.getBoundingClientRect();
    if (!r.width) return;
    const dx = oldRect.left - r.left, sx = oldRect.width / r.width;
    if (Math.abs(dx) < 1) return;
    try {
      tab.animate([{ transform: `translateX(${dx}px) scaleX(${sx})`, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }],
        { duration: 220, easing: OUT, pseudoElement: "::after" });
    } catch { /* navegador sem animação de pseudo-elemento */ }
  }

  // classe que dispara uma animação do CSS uma vez e sai sozinha
  function once(el, cls) {
    if (!el || off()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
  }

  // some com animação e depois esconde (hidden) ou remove
  function leave(el, then, ms = 150) {
    if (!el) return;
    if (off()) { then(); return; }
    el.classList.add("m-leave");
    setTimeout(() => { if (el.classList.contains("m-leave")) { el.classList.remove("m-leave"); then(); } }, ms);
  }

  return { off, id, morph, still, fadeIn, slideTab, once, leave, OUT };
})();

// ---------------------------------------------------------------------------- ligando nas telas do editor
// Os desenhos são funções globais do app.js / info.js; aqui elas ganham o movimento por fora.

window.addEventListener("DOMContentLoaded", () => {
  const wrap = (name, make) => { const orig = window[name]; if (typeof orig === "function") window[name] = make(orig); };
  const sel = (q) => document.querySelector(q);

  // pausa curta depois de digitar/clicar: troca de imagem nesse intervalo é edição, não valor mudando
  let lastInput = 0;
  for (const ev of ["pointerdown", "keydown", "input", "drop"]) addEventListener(ev, () => { lastInput = performance.now(); }, true);

  wrap("travel", (orig) => function () { return M.still(() => orig.apply(this, arguments)); });

  // -- seções (Teclas, Luz, Automações, Config)
  const VIEWS = { keys: "#workspace", light: "#lightView", settings: "#settingsView", auto: "#autoView", logs: "#logsView" };
  let section = null;
  wrap("renderSection", (orig) => function () {
    const was = section;
    const r = orig.apply(this, arguments);
    section = S.section;
    if (was && was !== section) M.fadeIn([sel(VIEWS[section])], { y: 6, dur: 190 });
    return r;
  });

  // -- teclas: troca de página desliza para o lado da aba; dentro da página, as teclas encaixam e trocam de lugar
  const tagKeys = (root) => root.querySelectorAll(".key[data-key]").forEach((el) => {
    const spec = pageKeys()[el.dataset.key];
    el.dataset.m = spec ? M.id(spec) : "e" + el.dataset.key;
  });
  let keysPage = null;
  wrap("renderKeys", (orig) => function () {
    const grid = sel("#keys");
    const was = keysPage;
    keysPage = S.page;
    if (was !== null && was !== S.page) {
      const r = orig.apply(this, arguments);
      tagKeys(grid);
      if (!M.off()) {
        const names = Object.keys(pages());
        const dir = names.indexOf(S.page) >= names.indexOf(was) ? 1 : -1;
        grid.querySelectorAll(".key").forEach((el) => {
          const col = (parseInt(el.style.gridColumn, 10) || 1) - 1;
          el.animate([{ opacity: 0, transform: `translateX(${dir * 16}px)` }, { opacity: 1, transform: "none" }],
            { duration: 220, delay: (dir > 0 ? col : 4 - col) * 18, easing: M.OUT, fill: "backwards" });
        });
      }
      return r;
    }
    return M.morph(grid, () => orig.apply(this, arguments), { enter: "settle", scale: true, after: tagKeys,
      ghosts: (el) => !el.classList.contains("empty") });
  });

  // -- selecionar uma tecla: o contorno fecha sobre ela
  wrap("selectKey", (orig) => function (k) {
    const changedKey = S.key !== k;
    const r = orig.apply(this, arguments);
    if (changedKey) M.once(document.querySelector(`#keys .key[data-key="${k}"]`), "m-sel");
    return r;
  });

  // -- prévias que mudam sozinhas (relógio, valores): a imagem nova aparece suave, só na tecla que mudou
  new MutationObserver((muts) => {
    if (M.off() || performance.now() - lastInput < 1500) return;
    for (const m of muts) {
      if (m.type === "attributes" && m.target.tagName === "IMG" && m.oldValue && m.oldValue !== m.target.src) {
        m.target.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 280, easing: M.OUT });
      } else if (m.type === "childList" && m.target.classList && m.target.classList.contains("cellbox") && m.removedNodes.length) {
        m.addedNodes.forEach((n) => n.tagName === "IMG" && n.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 280, easing: M.OUT }));
      }
    }
  }).observe(sel("#keys"), { subtree: true, childList: true, attributes: true, attributeFilter: ["src"], attributeOldValue: true });

  // -- painel da tecla: outra tecla = o painel aparece; outra aba = a linha desliza; mesma aba = passos entram/saem/mudam de lugar
  let insp = null;
  wrap("renderInspector", (orig) => function () {
    if (S.expanded) return orig.apply(this, arguments);
    const root = sel("#inspector");
    const was = insp;
    insp = { key: `${S.page}|${S.key}`, tab: `${S.tab}|${S.lookMode}` };
    if (!was || M.off()) return orig.apply(this, arguments);
    if (was.key !== insp.key) {
      const r = orig.apply(this, arguments);
      M.fadeIn(root.children, { y: 4, dur: 170, stagger: 25 });
      return r;
    }
    if (was.tab !== insp.tab) {
      const old = root.querySelector('.tabs [aria-selected="true"]');
      const oldRect = old && old.getBoundingClientRect();
      const r = orig.apply(this, arguments);
      const tabs = root.querySelector(".tabs");
      M.slideTab(oldRect, root.querySelector('.tabs [aria-selected="true"]'));
      const rest = [];
      for (let el = tabs && tabs.nextElementSibling; el; el = el.nextElementSibling) rest.push(el);
      M.fadeIn(rest, { y: 4, dur: 160 });
      return r;
    }
    return M.morph(root, () => orig.apply(this, arguments), { enter: "fade" });
  });

  // -- lógica expandida
  let expKey = null;
  wrap("renderAll", (orig) => function () {
    const wasExpanded = document.body.classList.contains("expanded");
    const r = orig.apply(this, arguments);
    if (!S.expanded) expKey = null;
    if (S.section === "keys" && wasExpanded !== !!S.expanded) {
      M.fadeIn(S.expanded ? [sel("#expandView")] : [sel("#deckWrap"), sel("#stageTop"), sel("#stageBar")], { y: 6, dur: 190 });
    }
    return r;
  });
  wrap("renderExpanded", (orig) => function () {
    const view = sel("#expandView");
    const key = `${S.page}|${S.key}`;
    const same = expKey === key;
    expKey = key;
    if (!same) return orig.apply(this, arguments);
    return M.morph(view, () => orig.apply(this, arguments), { enter: "fade", scroller: ".expand-scroll" });
  });

  // -- automações: a lista e os passos; outra automação escolhida = o editor dela aparece
  let autoSel = null;
  wrap("renderAutomationsView", (orig) => function () {
    const view = sel("#autoView");
    const list = Array.isArray(S.cfg.automations) ? S.cfg.automations : [];
    const was = autoSel;
    const run = () => orig.apply(this, arguments);
    const pick = () => { const a = list[S.autoSel]; return a ? M.id(a) : null; };
    const before = pick();
    if (was === null || before !== was) {
      const r = run();
      autoSel = pick();
      if (was !== null) M.fadeIn([view.querySelector(".auto-edit")], { y: 4, dur: 170 });
      return r;
    }
    const r = M.morph(view, run, { enter: "fade" });
    autoSel = pick();
    return r;
  });

  // -- biblioteca: grupos e tamanhos abrem e fecham empurrando o resto
  const tagLib = (root) => root.querySelectorAll(".lib-group").forEach((sec) => {
    const head = sec.querySelector(".lib-head .grow");
    const g = head ? head.textContent : "";
    sec.dataset.m = "g:" + g;
    let last = "";
    for (const el of sec.children) {
      if (el.classList.contains("lib-head")) continue;
      const label = el.querySelector(".label, b, .grow");
      if (el.classList.contains("pieces")) { el.dataset.m = `p:${g}:${last}`; continue; }
      last = label ? label.textContent : el.textContent;
      el.dataset.m = `i:${g}:${last}`;
    }
  });
  wrap("renderLibrary", (orig) => function () {
    const root = sel("#libList");
    const searching = !!sel("#libSearch").value;
    if (searching) { const r = orig.apply(this, arguments); tagLib(root); return r; }
    // a setinha do grupo é desenhada de novo: gira a partir de onde estava
    const heads = (sel) => new Map([...root.querySelectorAll(sel)].map((b) => [b.closest("[data-m]") && b.closest("[data-m]").dataset.m, b.getAttribute("aria-expanded")]));
    const SEL = ".lib-head";
    const was = heads(SEL);
    const r = M.morph(root, () => orig.apply(this, arguments), { enter: "drop", stagger: 14, tag: tagLib });
    if (!M.off()) root.querySelectorAll(SEL).forEach((b) => {
      const k = b.closest("[data-m]") && b.closest("[data-m]").dataset.m;
      const old = was.get(k), now = b.getAttribute("aria-expanded");
      const chev = b.querySelector(":scope > .ic:last-child");
      if (!chev || old === undefined || old === now) return;
      chev.animate([{ transform: `rotate(${old === "true" ? 90 : 0}deg)` }, { transform: `rotate(${now === "true" ? 90 : 0}deg)` }], { duration: 160, easing: M.OUT });
    });
    return r;
  });

  // -- config: a seção nova aparece
  let setSec = null;
  wrap("renderSettingsView", (orig) => function () {
    const was = setSec;
    const r = orig.apply(this, arguments);
    setSec = S.setSection || "general";
    if (was && was !== setSec) M.fadeIn([sel("#settingsView .set-body")], { y: 4, dur: 170 });
    return r;
  });

  // -- janelas (ícones, ações, histórico): somem em vez de sumir de uma vez
  wrap("closeSheets", (orig) => function () {
    const open = [...document.querySelectorAll(".sheet:not([hidden]):not(.m-leave)")];
    if (M.off() || !open.length) return orig.apply(this, arguments);
    glyphCb = actionCb = null;
    open.forEach((s) => M.leave(s, () => { s.hidden = true; }, 140));
  });
  const cancelLeave = () => document.querySelectorAll(".sheet.m-leave").forEach((s) => { s.classList.remove("m-leave"); s.hidden = true; });
  for (const name of ["openGlyphPicker", "openActionPicker", "openHistory"]) {
    wrap(name, (orig) => function () { cancelLeave(); return orig.apply(this, arguments); });
  }
  wrap("closeValuePicker", (orig) => function () {
    const el = document.getElementById("valuePicker");
    if (!el || M.off()) return orig.apply(this, arguments);
    el.removeAttribute("id");
    M.leave(el, () => el.remove(), 140);
  });
});
