"use strict";
// Idiomas do editor. O texto em inglês é a chave: t("Save") devolve a tradução do idioma atual,
// ou o inglês se faltar. Variáveis por posição: t("Key {0}, page {1}", [3, "main"]).
// "Mute##2" = mesma palavra em inglês com outra tradução; o "##2" some na tela.
// Traduções em locales/<idioma>.json. O idioma é escolhido antes do resto do editor carregar
// (as listas de nomes são montadas uma vez só); trocar de idioma recarrega a página.

const I18N = (() => {
  const KEY = "d6-lang";
  let lang = null;
  try { lang = localStorage.getItem(KEY); } catch { /* sem storage */ }
  if (lang !== "en" && lang !== "pt-BR") lang = (navigator.language || "").toLowerCase().startsWith("pt") ? "pt-BR" : "en";
  let dict = {};
  if (lang !== "en") {
    try {
      const xhr = new XMLHttpRequest();          // síncrono de propósito: precisa estar pronto antes do app.js
      xhr.open("GET", `locales/${lang}.json`, false);
      xhr.send();
      if (xhr.status === 200) dict = JSON.parse(xhr.responseText);
    } catch { /* fica em inglês */ }
  }
  document.documentElement.lang = lang;
  return {
    lang, dict, KEY,
    // troca de idioma: guarda e recarrega, para tudo sair no idioma novo
    switchTo(next) {
      try { localStorage.setItem(KEY, next); } catch { /* sem storage */ }
      if (next !== lang) location.reload();
    },
  };
})();
const LANG = I18N.lang;

function t(key, args) {
  let s = I18N.dict[key];
  if (s === undefined) s = String(key).split("##")[0];
  if (args) s = s.replace(/\{(\d+)\}/g, (m, n) => (args[n] === undefined || args[n] === null ? "" : String(args[n])));
  return s.replace(/\{\{/g, "{").replace(/\}\}/g, "}");
}

// números e datas no formato do idioma (0,25 em português, 0.25 em inglês)
const numFmt = (v, digits = 0) => Number(v).toLocaleString(LANG, { minimumFractionDigits: digits, maximumFractionDigits: digits });

// textos fixos do index.html
document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.textContent.trim()); });
document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
  for (const pair of el.dataset.i18nAttr.split("|")) {
    const i = pair.indexOf("=");
    if (i > 0) el.setAttribute(pair.slice(0, i), t(pair.slice(i + 1)));
  }
});
