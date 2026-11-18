// Texto com valores (o tokenEditor do editor atual): o texto continua digitável e cada valor vira uma etiqueta
// ("Hora" no lugar de {clock.hour}). O botão { } abre a lista de valores e insere onde o cursor estava. Uma linha
// só (Enter não quebra); colar cola só o texto.
//
// O conteúdo é um contenteditable montado à mão: o React não toca nos filhos (só quando o valor muda de fora).
import { Braces } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "@/components/IconButton";
import { useT } from "@/core/i18n";
import { ValuePicker } from "@/features/keys/ValuePicker";
import { TOKEN_RE, useValueDefs, valueLabel } from "@/features/keys/values";

interface TokenFieldProps {
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  placeholder?: string;
  kinds?: string[];
}

const CHIP =
  "mx-0.5 inline-flex h-control-xs items-center gap-1.5 rounded-sm bg-selected px-2 align-middle text-sm font-semibold whitespace-nowrap text-fg select-none";

function serialize(box: HTMLElement): string {
  let out = "";
  box.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
    else if (n instanceof HTMLElement && n.dataset.v) out += `{${n.dataset.v}${n.dataset.f ? "|" + n.dataset.f : ""}}`;
    else if (n.nodeName !== "BR") out += n.textContent ?? "";
  });
  return out.replace(/\u00a0/g, " ");
}

export function TokenField({ value, onChange, label, placeholder = "", kinds }: TokenFieldProps) {
  const t = useT();
  const defs = useValueDefs();
  const box = useRef<HTMLDivElement>(null);
  const caret = useRef<Range | null>(null);
  const [picker, setPicker] = useState(false);

  const chip = (id: string, fmt: string): HTMLElement => {
    const el = document.createElement("span");
    el.className = CHIP;
    el.contentEditable = "false";
    el.dataset.v = id;
    el.dataset.f = fmt;
    el.title = `{${id}}`;
    el.textContent = valueLabel(defs, id) + (fmt === "nz" ? " (5)" : "");
    return el;
  };

  // monta o conteúdo quando o valor muda de fora (o que a pessoa digita já está no DOM)
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || serialize(el) === (value ?? "")) return;
    el.replaceChildren();
    const s = value ?? "";
    let last = 0;
    for (const m of s.matchAll(TOKEN_RE)) {
      if (m.index > last) el.append(document.createTextNode(s.slice(last, m.index)));
      el.append(chip(m[1] ?? "", m[2] ?? ""));
      last = m.index + m[0].length;
    }
    if (last < s.length) el.append(document.createTextNode(s.slice(last)));
  });

  const remember = () => {
    const sel = window.getSelection();
    const el = box.current;
    if (sel?.rangeCount && el?.contains(sel.getRangeAt(0).startContainer)) caret.current = sel.getRangeAt(0).cloneRange();
  };
  const emit = () => {
    const el = box.current;
    if (el) onChange(serialize(el) || null);
  };

  return (
    <div className="relative flex items-start">
      <div
        ref={box}
        role="textbox"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        aria-label={label}
        data-placeholder={placeholder}
        onInput={() => {
          remember();
          emit();
        }}
        onKeyUp={remember}
        onMouseUp={remember}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text").replace(/\n/g, " "));
        }}
        className="min-h-control-xl flex-1 rounded-md border border-border-strong bg-field py-1.75 pr-10 pl-2.75 text-base leading-6 break-words whitespace-pre-wrap text-fg outline-none placeholder-attr focus:border-accent focus:ring-1 focus:ring-accent"
      />
      <IconButton icon={Braces} size="sm" label={t("Insert a value")} onClick={() => setPicker(true)} className="absolute top-1.25 right-1.25 size-7.5" />
      <ValuePicker
        open={picker}
        onOpenChange={setPicker}
        {...(kinds ? { kinds } : {})}
        onPick={(id, fmt) => {
          const el = box.current;
          if (!el) return;
          const node = chip(id, fmt);
          const r = caret.current;
          if (r && el.contains(r.startContainer)) {
            r.deleteContents();
            r.insertNode(node);
            r.setStartAfter(node);
          } else el.append(node);
          emit();
        }}
      />
    </div>
  );
}
