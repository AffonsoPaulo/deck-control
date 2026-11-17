"""Leitura/gravação do config.yaml preservando comentários e formatação (para o editor).

A gravação não reescreve o arquivo do zero: carrega o YAML original (ruamel,
modo round-trip), aplica só as diferenças e salva. Assim comentários, aspas,
ordem e indentação do que não mudou continuam iguais.
"""

from __future__ import annotations

import io
import re
import shutil
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.scalarstring import DoubleQuotedScalarString

# Strings novas que precisam de aspas (o ruamel usaria aspas simples; o arquivo usa duplas).
_NEEDS_QUOTES = re.compile(
    r"""^[#&*!|>'"%@`{}\[\],?:\-\s]|: | #|\s$|^(true|false|yes|no|on|off|null|~)$|^[\d.+\-]+$""",
    re.IGNORECASE,
)


def _yaml(indent: int = 2) -> YAML:
    y = YAML()  # round-trip
    y.preserve_quotes = True
    y.width = 4096
    y.indent(mapping=indent, sequence=indent + 2, offset=indent)
    return y


def _detect_indent(text: str) -> int:
    m = re.search(r"^[A-Za-z_][^\n]*:\s*\n((?:[ ]*#[^\n]*\n)*)([ ]+)\S", text, re.M)
    return len(m.group(2)) if m else 2


def to_plain(node):
    """CommentedMap/Seq -> dict/list comuns (para mandar como JSON)."""
    if isinstance(node, dict):
        return {(k if isinstance(k, str) else str(k)): to_plain(v) for k, v in node.items()}
    if isinstance(node, list):
        return [to_plain(v) for v in node]
    if isinstance(node, str):
        return str(node)
    return node


def read_plain(path: Path) -> dict:
    text = Path(path).read_text(encoding="utf-8")
    return to_plain(_yaml().load(text) or {})


def _is_simple(d: dict) -> bool:
    """Objeto pequeno só com valores simples (ou listas simples) -> estilo { a: b } numa linha."""

    def scalar_list(v):
        return isinstance(v, list) and all(not isinstance(x, (dict, list)) for x in v)

    return len(d) <= 8 and all(not isinstance(v, (dict, list)) or scalar_list(v) for v in d.values())


def _to_node(value):
    if isinstance(value, dict):
        m = CommentedMap()
        for k, v in value.items():
            m[k] = _to_node(v)
        if _is_simple(value):
            m.fa.set_flow_style()
        return m
    if isinstance(value, list):
        s = CommentedSeq()
        for v in value:
            s.append(_to_node(v))
        return s
    if isinstance(value, str) and (_NEEDS_QUOTES.search(value) or "\n" in value):
        return DoubleQuotedScalarString(value)
    return value


def _merge_map(dst: CommentedMap, src: dict) -> None:
    for k in list(dst.keys()):
        if k not in src:
            del dst[k]
    all_int = all(isinstance(k, int) for k in list(dst.keys()) + list(src.keys()))
    for k, v in src.items():
        if k in dst:
            cur = dst[k]
            if isinstance(cur, CommentedMap) and isinstance(v, dict):
                if to_plain(cur) == to_plain(v):
                    continue  # nada mudou aqui: não mexe nem no estilo
                was_flow = cur.fa.flow_style()
                _merge_map(cur, v)
                if was_flow and not _is_simple(v):
                    cur.fa.set_block_style()
            elif isinstance(cur, CommentedSeq) and isinstance(v, list):
                _merge_seq(cur, v)
            elif cur != v or isinstance(cur, bool) != isinstance(v, bool):
                dst[k] = _to_node(v)
            # igual: mantém o nó original (preserva aspas/estilo)
        else:
            node = _to_node(v)
            if all_int:
                pos = sum(1 for existing in dst if existing < k)
                dst.insert(pos, k, node)
            else:
                # no lugar em que o editor mandou (desfazer a exclusão de uma página a devolve onde estava)
                order = list(src.keys())
                prev = next((p for p in reversed(order[: order.index(k)]) if p in dst), None)
                _insert_key(dst, prev, k, node)


def _insert_key(dst: CommentedMap, prev, k, node) -> None:
    """Põe k logo depois de prev (no começo, se prev for None) sem roubar o comentário da próxima seção.

    O ruamel guarda o que vem depois de uma chave (comentário da linha, linha em branco e o
    comentário que abre a próxima seção) como um comentário só, preso a essa chave. Sem isto,
    a chave nova sai embaixo desse bloco, longe do lugar dela.
    """
    if prev is None:
        dst.insert(0, k, node)
        return
    tail = None
    entry = dst.ca.items.get(prev)
    if entry and len(entry) > 2 and entry[2] is not None and isinstance(entry[2].value, str):
        val = entry[2].value
        nl = val.find("\n")
        if nl != -1 and val[nl + 1 :].strip():
            entry[2].value, tail = val[: nl + 1], val[nl + 1 :]
    dst.insert(list(dst.keys()).index(prev) + 1, k, node)
    if tail is not None:
        from ruamel.yaml.error import CommentMark
        from ruamel.yaml.tokens import CommentToken

        dst.ca.items[k] = [None, None, CommentToken("\n" + tail, CommentMark(0), None), None]


def _merge_seq(dst: CommentedSeq, src: list) -> None:
    for i, v in enumerate(src):
        if i < len(dst):
            cur = dst[i]
            if isinstance(cur, CommentedMap) and isinstance(v, dict):
                _merge_map(cur, v)
            elif isinstance(cur, CommentedSeq) and isinstance(v, list):
                _merge_seq(cur, v)
            elif cur != v:
                dst[i] = _to_node(v)
        else:
            dst.append(_to_node(v))
    del dst[len(src) :]


def _int_keys_in_pages(cfg: dict) -> dict:
    """O JSON do navegador traz as teclas como "1", "2"...; no YAML elas são números."""
    cfg = dict(cfg)
    pages = {}
    for name, keys in (cfg.get("pages") or {}).items():
        pages[name] = {(int(k) if str(k).isdigit() else k): v for k, v in (keys or {}).items()}
    cfg["pages"] = pages
    return cfg


def _space_braces(text: str) -> str:
    """{a: b} -> { a: b } fora de strings e comentários (estilo do Prettier)."""
    lines = []
    for line in text.split("\n"):
        out: list[str] = []
        quote = None
        added = 0
        i = 0
        while i < len(line):
            c = line[i]
            if quote:
                out.append(c)
                if c == "\\" and quote == '"' and i + 1 < len(line):
                    out.append(line[i + 1])
                    i += 1
                elif c == quote:
                    quote = None
            elif c in "\"'":
                quote = c
                out.append(c)
            elif c == "#" and (i == 0 or line[i - 1] == " "):
                # o ruamel guarda a coluna do comentário; tira os espaços que acrescentamos
                # nas chaves, senão o comentário anda para a direita a cada salvamento
                joined = "".join(out)
                body = joined.rstrip(" ")
                pad = len(joined) - len(body)
                out = [body + " " * max(1 if body else 0, pad - added), line[i:]]
                break
            elif c == "{" and i + 1 < len(line) and line[i + 1] not in " }":
                out.append("{ ")
                added += 1
            elif c == "}" and out and not out[-1].endswith((" ", "{")):
                out.append(" }")
                added += 1
            else:
                out.append(c)
            i += 1
        lines.append("".join(out))
    return "\n".join(lines)


def save_plain(path: Path, new_cfg: dict) -> None:
    """Grava new_cfg no YAML existente, mexendo só no que mudou. Mantém um .bak."""
    path = Path(path)
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    y = _yaml(_detect_indent(text))
    doc = y.load(text) if text.strip() else CommentedMap()
    if not isinstance(doc, CommentedMap):
        doc = CommentedMap()
    new_cfg = _int_keys_in_pages(new_cfg)
    if to_plain(doc) == to_plain(new_cfg):
        return  # nada mudou: não reescreve o arquivo
    _merge_map(doc, new_cfg)
    replace_text(path, _dump(y, doc, text))


def replace_text(path: Path, text: str) -> None:
    """Troca o conteúdo do arquivo: o atual vira o .bak, e o novo entra inteiro (grava num .tmp e troca), para
    um app fechado no meio nunca deixar o config pela metade. Toda gravação do config passa por aqui."""
    path = Path(path)
    if path.exists():
        shutil.copy2(path, path.with_suffix(path.suffix + ".bak"))
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _dump(y: YAML, doc, original_text: str) -> str:
    buf = io.StringIO()
    y.dump(doc, buf)
    result = buf.getvalue()
    # mantém o estilo de chaves do arquivo: "{ a: b }" (Prettier) ou "{a: b}"
    if len(re.findall(r"\{ \S", original_text)) > len(re.findall(r"\{[^\s}]", original_text)):
        result = _space_braces(result)
    return result


def without_secrets(text: str, paths=(("obs", "password"),)) -> str:
    """Mesmo texto do config, com as senhas em branco (para exportar). paths: caminhos até cada senha."""
    y = _yaml(_detect_indent(text))
    doc = y.load(text)
    if not isinstance(doc, CommentedMap):
        return text
    changed = False
    for path in paths:
        node = doc
        for k in path[:-1]:
            node = node.get(k) if isinstance(node, dict) else None
        if isinstance(node, dict) and node.get(path[-1]):
            node[path[-1]] = DoubleQuotedScalarString("")
            changed = True
    return _dump(y, doc, text) if changed else text
