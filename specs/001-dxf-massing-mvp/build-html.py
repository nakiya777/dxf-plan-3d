# -*- coding: utf-8 -*-
"""design.md と video-parity.md から、画像を埋め込んだ単一ファイルの design.html を生成する。

使い方:
    python build-html.py            # design.html（単体で開ける完全な HTML）を書く
    python build-html.py --fragment 出力先.html
                                    # <title> と <style> と本文だけの断片（Artifact 公開用）を書く

依存: markdown-it-py（gfm-like プリセットで表を変換）、Pillow（画像を JPEG に縮小して data URI にする）
編集は必ず MD 側で行い、このスクリプトで HTML を作り直す。HTML を直接編集しない。
"""
import base64
import io
import re
import sys
from pathlib import Path

from markdown_it import MarkdownIt
from PIL import Image

HERE = Path(__file__).parent
DESIGN_MD = HERE / "design.md"
PARITY_MD = HERE / "video-parity.md"
MAX_IMAGE_WIDTH = 1400
JPEG_QUALITY = 82

md = MarkdownIt("gfm-like", {"linkify": False})  # linkify-it-py が無い環境でも動くように無効化


# ---------- 画像を data URI に埋め込む ----------
def image_data_uri(rel_path: str) -> str:
    """相対パスの画像を縮小し、JPEG の data URI にして返す"""
    path = HERE / rel_path
    img = Image.open(path).convert("RGB")
    if img.width > MAX_IMAGE_WIDTH:
        ratio = MAX_IMAGE_WIDTH / img.width
        img = img.resize((MAX_IMAGE_WIDTH, round(img.height * ratio)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- 見出しに id を振り、目次を作る ----------
def slug_for(text: str, prefix: str) -> str:
    """「7.2 見出し」→ sec-7-2、番号が無ければ本文から作る"""
    m = re.match(r"^\s*(\d+(?:\.\d+)*)\.?\s", text)
    if m:
        return f"{prefix}-{m.group(1).replace('.', '-')}"
    m = re.match(r"^\s*([A-Z])\.\s", text)
    if m:
        return f"{prefix}-{m.group(1).lower()}"
    body = re.sub(r"[^\w぀-ヿ㐀-鿿]+", "-", text).strip("-").lower()
    return f"{prefix}-{body[:40]}"


def render_markdown(source: str, id_prefix: str):
    """Markdown を HTML に変換し、見出し一覧（level, id, text）も返す"""
    tokens = md.parse(source)
    headings = []
    for i, tok in enumerate(tokens):
        if tok.type == "heading_open":
            inline = tokens[i + 1]
            text = "".join(c.content for c in inline.children if c.type in ("text", "code_inline"))
            hid = slug_for(text, id_prefix)
            base, n = hid, 2
            while any(h[1] == hid for h in headings):
                hid = f"{base}-{n}"
                n += 1
            tok.attrSet("id", hid)
            headings.append((int(tok.tag[1]), hid, text))
    html = md.renderer.render(tokens, md.options, {})
    return html, headings


def post_process(html: str) -> str:
    """表の横スクロール、図のキャプション、推定・暫定チップ、文書内リンクの付け替え"""
    html = html.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")

    def figure(m):
        src, alt = m.group(1), m.group(2)
        return f'<figure><img src="{image_data_uri(src)}" alt="{alt}" loading="lazy"><figcaption>{alt}</figcaption></figure>'

    html = re.sub(r'<p><img src="([^"]+)" alt="([^"]*)"\s*/?></p>', figure, html)
    html = html.replace("<code>[推定]</code>", '<span class="chip chip-guess">推定</span>')
    html = html.replace("<code>[推定機能]</code>", '<span class="chip chip-guess">推定機能</span>')
    html = html.replace("<code>[暫定]</code>", '<span class="chip chip-prov">暫定</span>')
    html = re.sub(r'href="video-parity\.md[^"]*"', 'href="#app-a"', html)
    html = re.sub(r'href="design\.md#(\d+)-[^"]*"', r'href="#sec-\1"', html)
    return html


# ---------- 文書の頭（メタ情報）を図面枠に ----------
def split_header(source: str):
    """先頭の H1 と「- **項目:** 値」の箇条書きを取り出し、残りの本文を返す"""
    lines = source.split("\n")
    title = lines[0].lstrip("# ").strip()
    meta, i = [], 1
    while i < len(lines) and (lines[i].startswith("- **") or not lines[i].strip()):
        m = re.match(r"- \*\*(.+?):\*\*\s*(.*)", lines[i])
        if m:
            meta.append((m.group(1), m.group(2)))
        i += 1
    while i < len(lines) and lines[i].strip() in ("", "---"):
        i += 1
    return title, meta, "\n".join(lines[i:])


def title_block(title: str, meta: list) -> str:
    """JIS の図面枠になぞらえた表題欄。短い項目を上段、長い項目を下段に置く"""
    short = {k: v for k, v in meta if k in ("文書バージョン", "作成日")}
    version = short.get("文書バージョン", "")
    status = ""
    m = re.match(r"(v[\d.]+)（(.+?)）", version)
    if m:
        version, status = m.group(1), m.group(2)
    cells = [
        ("図面名", f"<strong>{title}</strong>"),
        ("文書バージョン", md.renderInline(version)),
        ("作成日", md.renderInline(short.get("作成日", ""))),
        ("ステータス", md.renderInline(status)),
    ]
    long_rows = [(k, md.renderInline(v)) for k, v in meta if k not in short]
    top = "".join(f'<div class="tb-cell"><span class="tb-label">{k}</span><span class="tb-value">{v}</span></div>' for k, v in cells)
    bottom = "".join(f'<div class="tb-row"><span class="tb-label">{k}</span><span class="tb-value">{v}</span></div>' for k, v in long_rows)
    return f'<header class="titleblock"><div class="tb-top">{top}</div><div class="tb-bottom">{bottom}</div></header>'


def toc_html(design_heads, parity_heads, parity_title) -> str:
    items = []
    for level, hid, text in design_heads:
        if level == 2:
            items.append(f'<li><a href="#{hid}">{text}</a></li>')
    sub = "".join(f'<li><a href="#{hid}">{text}</a></li>' for level, hid, text in parity_heads if level == 2)
    items.append(f'<li><a href="#app-a">付録 A {parity_title}</a><ul>{sub}</ul></li>')
    return '<nav class="toc" aria-label="目次"><p class="toc-title">目次</p><ul>' + "".join(items) + "</ul></nav>"


CSS = """
:root {
  --paper: #f4f6f9; --panel: #e8edf4; --ink: #1a2230; --muted: #5b6777; --line: #d3dae3;
  --accent: #2f6fd8; --amber: #b8700e; --rule: #1a2230;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #11161d; --panel: #1a212b; --ink: #e4e9f0; --muted: #96a2b2; --line: #2a3441;
    --accent: #6ea3ff; --amber: #f0b040; --rule: #c9d3df;
  }
}
:root[data-theme="dark"] {
  --paper: #11161d; --panel: #1a212b; --ink: #e4e9f0; --muted: #96a2b2; --line: #2a3441;
  --accent: #6ea3ff; --amber: #f0b040; --rule: #c9d3df;
}
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font-family: "BIZ UDPGothic", "Yu Gothic UI", "Meiryo", "Hiragino Sans", sans-serif;
  font-size: 15.5px; line-height: 1.85; -webkit-font-smoothing: antialiased;
}
.page { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 56px; max-width: 1240px; margin: 0 auto; padding: 36px 28px 120px; }
@media (max-width: 1000px) { .page { grid-template-columns: 1fr; gap: 24px; padding: 20px 16px 80px; } .toc { position: static !important; max-height: none !important; } }
h1, h2, h3, h4, .toc-title, .tb-label { font-family: "Zen Kaku Gothic New", "Yu Gothic UI", "Meiryo", sans-serif; }
h1 { font-size: 1.9rem; line-height: 1.3; margin: 0 0 20px; letter-spacing: -.01em; text-wrap: balance; }
h2 { font-size: 1.45rem; line-height: 1.35; margin: 3.2rem 0 1rem; padding-top: .7rem; border-top: 2px solid var(--rule); text-wrap: balance; }
h3 { font-size: 1.12rem; margin: 2.2rem 0 .7rem; text-wrap: balance; }
h4 { font-size: .98rem; margin: 1.6rem 0 .5rem; color: var(--muted); letter-spacing: .04em; }
p, ul, ol { margin: 0 0 1rem; }
li { margin: .2rem 0; }
li > ul, li > ol { margin: .2rem 0 .3rem; }
article { max-width: 78ch; }
a { color: var(--accent); text-decoration: underline; text-underline-offset: .18em; text-decoration-thickness: 1px; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
strong { font-weight: 700; }
code, pre { font-family: "IBM Plex Mono", "Consolas", "BIZ UDGothic", monospace; }
code { font-size: .88em; background: var(--panel); padding: .1em .38em; border-radius: 3px; }
pre { background: var(--panel); border-left: 3px solid var(--accent); padding: 14px 18px; overflow-x: auto; font-size: 13px; line-height: 1.6; margin: 0 0 1.2rem; }
pre code { background: none; padding: 0; font-size: inherit; }
.table-wrap { overflow-x: auto; margin: 0 0 1.4rem; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; line-height: 1.6; font-variant-numeric: tabular-nums; }
th { text-align: left; padding: 8px 10px; border-bottom: 2px solid var(--rule); font-weight: 700; white-space: nowrap; }
td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: 1px solid var(--rule); }
figure { margin: 1.6rem 0; }
figure img { display: block; width: 100%; height: auto; border: 1px solid var(--line); background: #fff; }
figcaption { font-size: 12.5px; color: var(--muted); margin-top: 8px; line-height: 1.6; }
.chip { display: inline-block; font-size: 11px; letter-spacing: .08em; padding: 0 7px; border-radius: 999px; border: 1px solid currentColor; line-height: 1.7; vertical-align: 2px; white-space: nowrap; }
.chip-guess { color: var(--amber); }
.chip-prov { color: var(--accent); }
.toc { position: sticky; top: 24px; align-self: start; max-height: calc(100vh - 48px); overflow: auto; font-size: 13px; line-height: 1.55; }
.toc-title { font-size: 11px; letter-spacing: .14em; color: var(--muted); margin: 0 0 8px; text-transform: uppercase; }
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc li { margin: 0; }
.toc > ul > li { border-top: 1px solid var(--line); }
.toc a { display: block; padding: 6px 0; color: var(--ink); text-decoration: none; }
.toc a:hover { color: var(--accent); }
.toc li ul { padding-left: 14px; margin-bottom: 6px; }
.toc li ul a { padding: 3px 0; color: var(--muted); }
.titleblock { border: 2px solid var(--rule); margin: 0 0 2.4rem; font-size: 13.5px; }
.tb-top { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; border-bottom: 1px solid var(--rule); }
.tb-cell { padding: 10px 14px; border-right: 1px solid var(--rule); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tb-cell:last-child { border-right: none; }
.tb-cell:first-child .tb-value { font-size: 1.05rem; line-height: 1.4; }
.tb-row { display: grid; grid-template-columns: 120px 1fr; border-bottom: 1px solid var(--line); }
.tb-row:last-child { border-bottom: none; }
.tb-row .tb-label { padding: 8px 14px; border-right: 1px solid var(--rule); }
.tb-row .tb-value { padding: 8px 14px; }
.tb-label { font-size: 10.5px; letter-spacing: .12em; color: var(--muted); }
.tb-value { overflow-wrap: anywhere; }
@media (max-width: 720px) { .tb-top { grid-template-columns: 1fr 1fr; } .tb-cell:first-child { grid-column: 1 / -1; border-bottom: 1px solid var(--rule); } .tb-cell:nth-child(2) { border-right: 1px solid var(--rule); } .tb-row { grid-template-columns: 1fr; } .tb-row .tb-label { border-right: none; padding-bottom: 0; } }
.appendix-lead { color: var(--muted); font-size: 14px; }
footer.colophon { margin-top: 5rem; padding-top: 1rem; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
@media print { .toc { display: none; } .page { grid-template-columns: 1fr; padding: 0; } body { font-size: 11pt; } a { color: inherit; } h2 { break-before: page; } h2:first-of-type { break-before: auto; } }
"""

FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Zen+Kaku+Gothic+New:wght@500;700&family=IBM+Plex+Mono:wght@400;500&display=swap">'


def build(fragment: bool) -> str:
    design_src = DESIGN_MD.read_text(encoding="utf-8")
    parity_src = PARITY_MD.read_text(encoding="utf-8")
    title, meta, design_body = split_header(design_src)
    parity_title, parity_meta, parity_body = split_header(parity_src)

    design_html, design_heads = render_markdown(design_body, "sec")
    parity_html, parity_heads = render_markdown(parity_body, "app")
    design_html, parity_html = post_process(design_html), post_process(parity_html)
    parity_lead = "".join(f"<p class=\"appendix-lead\"><strong>{k}:</strong> {md.renderInline(v)}</p>" for k, v in parity_meta)

    body = (
        f'<div class="page">{toc_html(design_heads, parity_heads, parity_title)}'
        f"<article><h1>{title}</h1>{title_block(title, meta)}{design_html}"
        f'<h2 id="app-a">付録 A {parity_title}</h2>{parity_lead}{parity_html}'
        f'<footer class="colophon">この HTML は design.md と video-parity.md から build-html.py で生成した。編集は MD 側で行い、HTML は作り直す。画像は縮小して埋め込んである。</footer>'
        f"</article></div>"
    )
    head = f"<title>{title}</title>{FONTS}<style>{CSS}</style>"
    if fragment:
        return head + body
    return (
        '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"{head}</head><body>{body}</body></html>"
    )


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--fragment":
        out = Path(sys.argv[2])
        out.write_text(build(fragment=True), encoding="utf-8")
    else:
        out = HERE / "design.html"
        out.write_text(build(fragment=False), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
