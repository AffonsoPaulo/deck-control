// Busca de ícone, igual à do editor atual: nome, etiquetas em inglês do Lucide e o nome em português dos mais
// usados; palavra em português que começa com o que se digitou vira os termos em inglês (palavra inteira).
import { norm, type LucideIndex } from "@/core/icons/lucide";

// busca em português: palavra -> termos em inglês do Lucide
export const PT_ICON_WORDS: Record<string, string> = {
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

/** Os mais usados (o GLYPHS do editor atual): o código Segoe antigo e o nome em inglês (texto do t()); nome com
 * "=" na frente não se traduz. O Segoe vira Lucide pelo segoe_to_lucide do schema. */
export const POPULAR_SEGOE: [string, string][] = [
  ["E720", "Microphone"], ["EC54", "Microphone muted"], ["E7F6", "Headphones"], ["E767", "Volume"],
  ["E74F", "Mute"], ["E993", "Volume down"], ["E995", "Volume up"], ["E768", "Play"], ["E769", "Pause"],
  ["E71A", "Stop"], ["E892", "Previous"], ["E893", "Next"], ["E8B1", "Shuffle"], ["E8EE", "Repeat"],
  ["E8D6", "Music"], ["E7C8", "Record"], ["E93E", "Broadcast"], ["E714", "Video camera"],
  ["E722", "Camera"], ["E7F4", "Monitor"], ["E7FC", "Game"], ["E8BD", "Message"], ["E8F2", "Chat"],
  ["E715", "=E-mail"], ["E717", "Phone"], ["E774", "Internet"], ["E80F", "Home"], ["E72B", "Back"],
  ["E72A", "Forward"], ["E8B7", "Folder"], ["E8A5", "Document"], ["E70B", "Note"], ["E765", "Keyboard"],
  ["E713", "Settings"], ["E706", "Brightness"], ["E708", "Moon"], ["E7E8", "Turn off"], ["E72E", "Lock"],
  ["E785", "Unlock"], ["E77B", "Person"], ["E716", "People"], ["E734", "Star"], ["E735", "Filled star"],
  ["EB51", "Heart"], ["EB52", "Filled heart"], ["E945", "Lightning"], ["E968", "Network"], ["E896", "Download"],
  ["E898", "Upload"], ["E74E", "Save"], ["E74D", "Trash"], ["E710", "Plus"], ["E738", "Minus"],
  ["E711", "Close"], ["E73E", "Confirm"], ["E7BA", "Warning"], ["E946", "Information"], ["E897", "Help"],
  ["E8C8", "Copy"], ["E77F", "Paste"], ["E8C6", "Cut"], ["E7A7", "Undo"], ["E7A6", "Redo"],
  ["E72C", "Update"], ["E787", "Calendar"], ["E823", "Clock"], ["E916", "Timer"], ["E7B3", "Eye"],
  ["ED1A", "Hide##2"], ["E8A7", "Open in window"], ["E790", "Color"], ["E771", "Customize"], ["EA8F", "Bell"],
  ["E7F8", "Laptop"], ["E701", "=Wi-Fi"], ["E702", "Bluetooth"], ["E719", "Store"], ["E7BF", "Cart"],
  ["E8EC", "Tag"], ["E718", "Pin"], ["E71C", "Filter"], ["E721", "Search"], ["E8FD", "List"],
  ["E700", "Menu"], ["E81C", "History"], ["E8F1", "Library"], ["E756", "Terminal"], ["E71B", "Link"],
];
const POPULAR_EXTRA: [string, string][] = [
  ["lightbulb", "Light"],
  ["clapperboard", "Scene"],
  ["layers", "Pages"],
  ["mic-off", "Microphone muted"],
];

export interface Popular {
  list: [string, string][]; // [nome Lucide, nome traduzido], na ordem
  names: Record<string, string>; // nome Lucide -> nome traduzido
}

/** Os mais usados em Lucide, já traduzidos. */
export function buildPopular(segoeToLucide: Record<string, string>, t: (s: string) => string): Popular {
  const list: [string, string][] = [];
  if (!Object.keys(segoeToLucide).length) return { list, names: {} };
  const tr = (s: string) => (s.startsWith("=") ? s.slice(1) : t(s));
  const seen = new Set<string>();
  const add = (n: string | undefined, label: string) => {
    if (n && !seen.has(n)) {
      seen.add(n);
      list.push([n, tr(label)]);
    }
  };
  for (const [code, label] of POPULAR_SEGOE) add(segoeToLucide[code.toUpperCase()], label);
  for (const [n, label] of POPULAR_EXTRA) add(n, label);
  return { list, names: Object.fromEntries(list) };
}

function matches(idx: LucideIndex, names: Record<string, string>, name: string, q: string): boolean {
  const v = idx[name];
  const hay = name + " " + (v ? v[1] : "") + " " + norm(names[name] ?? "");
  if (hay.includes(q)) return true;
  // palavras em português viram termos em inglês; aí vale a palavra inteira (senão "mic" acharia "atomic")
  const tokens = hay.split(/[\s-]+/);
  for (const [pt, en] of Object.entries(PT_ICON_WORDS)) {
    if (pt.startsWith(q) && en.split(" ").some((w) => tokens.some((tk) => tk === w || (w.length >= 4 && tk.startsWith(w))))) {
      return true;
    }
  }
  return false;
}

/** Os ícones achados, do mais parecido para o menos (mesma ordem do editor atual). */
export function searchIcons(idx: LucideIndex, popular: Popular, query: string): string[] {
  const q = norm(query).trim();
  const names = popular.names;
  const pn = (n: string) => norm(names[n] ?? "");
  const rank = (n: string) => (n === q || pn(n) === q ? 0 : n.startsWith(q) ? 1 : pn(n).startsWith(q) ? 2 : names[n] ? 3 : 4);
  return Object.keys(idx)
    .filter((n) => matches(idx, names, n, q))
    .sort((a, b) => rank(a) - rank(b));
}
