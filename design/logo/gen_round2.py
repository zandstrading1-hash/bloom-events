"""Inline SVG snippets for the round-2 directions (E-H)."""
import json
from shapely.ops import unary_union
from shapely import affinity
import geo
from concepts3 import *

S = {}
TOL = 0.02
d = lambda g: geo.path_d(g.simplify(TOL, preserve_topology=True), 2)


def svg(vb, inner, cls="logo", style="", label=None):
    l, t, w, h = vb
    aria = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    return f'<svg class="{cls}" style="{style}" viewBox="{l:.2f} {t:.2f} {w:.2f} {h:.2f}" {aria}>{inner}</svg>'


# ---------- E. Marquee ----------
body, bulbs, br, W = marquee_letters()
ev = spaced(OUTFIT_B, "EVENTS", 17, W / 2, 140, 1.1)
body_d, ev_d = d(body), d(ev)


def marquee(bodyc, sockc, bulbc, evc=None, chase=False, glow=True, pad=10):
    groups = ["", "", ""]
    for i, (x, y) in enumerate(bulbs):
        groups[i % 3] += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{br}"/>'
    sockets = "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{br*1.45:.1f}"/>' for x, y in bulbs)
    f = ' filter="url(#bulbglow)"' if glow else ""
    lights = "".join(f'<g class="{"chase c" + str(k) if chase else ""}" fill="{bulbc}"{f}>{g}</g>' for k, g in enumerate(groups))
    inner = f'<path fill="{bodyc}" d="{body_d}"/><g fill="{sockc}">{sockets}</g>{lights}'
    h = 100
    if evc:
        inner += f'<path fill="{evc}" d="{ev_d}"/>'
        h = 142
    return (-pad, -pad, W + 2 * pad, h + 2 * pad), inner


vb, inner = marquee("#a83d64", "#6e1f40", "#fff4dc", "#f6d8e2", chase=True)
S["E_HERO"] = svg(vb, inner, style="width:min(78%,640px)", label="Bloom Events logo, direction E")
vb, inner = marquee("#a83d64", "#8c2d52", "#fffaf9", "#4b2937", glow=False)
S["E_FLAT"] = svg(vb, inner, style="width:min(80%,420px)")
vb, inner = marquee("#b84a72", "#6e1f40", "#fff4dc", chase=True)
S["E_WALL"] = svg(vb, inner, cls="logo standing", style="width:min(70%,420px)")
# the B alone for a profile picture
bB = body.intersection(box(-5, -5, 62, 105))
bulbsB = [(x, y) for x, y in bulbs if x < 62]
inner = f'<path fill="#a83d64" d="{d(bB)}"/>' + "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{br*1.45:.1f}" fill="#6e1f40"/>' for x, y in bulbsB) + \
        f'<g fill="#fff4dc" filter="url(#bulbglow)">' + "".join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{br}"/>' for x, y in bulbsB) + "</g>"
S["E_B"] = svg((-8, -8, 70, 116), inner, style="width:44%")

# ---------- F. Groovy ----------
g = groovy()
bb = unary_union(list(g.values())).bounds
gd = {k: d(v) for k, v in g.items()}
petal_edge = d(g["petals"].buffer(2.5))


def groovy_svg(sh, ol, fi, pet, cen, evc, style, sticker=None, label=None):
    l, t, r, b = bb
    pad = 6
    inner = ""
    if sticker:
        die = unary_union(list(g.values())).buffer(9).buffer(-2)
        inner += f'<path fill="{sticker}" d="{d(die)}" filter="url(#stickershadow)"/>'
        pad = 16
    inner += (f'<path fill="{sh}" d="{gd["shadow"]}"/><path fill="{ol}" d="{gd["outline"]}"/><path fill="{fi}" d="{gd["fill"]}"/>'
              f'<path fill="{ol}" d="{petal_edge}"/><path fill="{pet}" d="{gd["petals"]}"/><path fill="{cen}" d="{gd["center"]}"/>'
              f'<path fill="{evc}" d="{gd["events"]}"/>')
    return svg((l - pad, t - pad, r - l + 2 * pad, b - t + 2 * pad), inner, style=style, label=label)


S["F_HERO"] = groovy_svg("#4b2937", "#a83d64", "#fffaf9", "#e0457b", "#ffd166", "#4b2937", "width:min(66%,560px)", label="Bloom Events logo, direction F")
S["F_STICKER"] = groovy_svg("#4b2937", "#a83d64", "#fffaf9", "#e0457b", "#ffd166", "#4b2937", "width:min(78%,380px);transform:rotate(-6deg)", sticker="#ffffff")
S["F_REV"] = groovy_svg("#e0457b", "#fffaf9", "#a83d64", "#f6d8e2", "#ffd166", "#fffaf9", "width:min(76%,380px)")
# "b" + daisy avatar
gb, glb = geo.text_geom(SHRIKHAND, "b", 100, 0, 0)
ob = gb.buffer(4.5)
shb = unary_union([affinity.translate(ob, 1.2 * k, 1.2 * k) for k in range(1, 8)])
l, t, r, b = ob.bounds
pet, cen = daisy(r - 2, t + 10, 17)
inner = (f'<path fill="#4b2937" d="{d(shb)}"/><path fill="#a83d64" d="{d(ob)}"/><path fill="#fffaf9" d="{d(gb)}"/>'
         f'<path fill="#a83d64" d="{d(pet.buffer(2.5))}"/><path fill="#e0457b" d="{d(pet)}"/><path fill="#ffd166" d="{d(cen)}"/>')
L, T, R, Bm = unary_union([shb, pet.buffer(2.5)]).bounds
S["F_B"] = svg((L - 6, T - 6, R - L + 12, Bm - T + 12), inner, style="width:50%")

# ---------- G. Paper Bloom ----------
COLS = ["#f8d3df", "#f1b8cb", "#e89ab5", "#de7fa1", "#d1658d", "#c2507c", "#b1416e", "#9c3560", "#842a51", "#6b2143"]
ps = paper_petals(100)
n = len(ps)


def paper(anim=False):
    out = []
    for i, ((x, y, r), c) in enumerate(zip(ps, COLS)):
        delay = (n - 1 - i) * 0.11
        st = f' style="animation-delay:{delay:.2f}s"' if anim else ""
        out.append(f'<circle class="{"petal" if anim else ""}"{st} cx="{x:.2f}" cy="{y:.2f}" r="{r:.2f}" fill="{c}" stroke="rgba(255,255,255,.55)" stroke-width=".5" filter="url(#papershadow)"/>')
    return "".join(out)


word = geo.text_geom(DMSI, "bloom", 70, 122, 70)[0]
evg = spaced(OUTFIT, "EVENTS", 11.5, (word.bounds[0] + word.bounds[2]) / 2, 94, 0.62)
wr = word.bounds[2]
S["G_HERO"] = svg((-4, -4, wr + 8, 108), f'<g class="rose-bloom">{paper(True)}</g><g class="word-in"><path fill="#4b2937" d="{d(word)}"/><path fill="#a83d64" d="{d(evg)}"/></g>',
                  cls="logo paper-hero", style="width:min(80%,620px)", label="Bloom Events logo, direction G")
S["G_ROSE"] = svg((-4, -4, 108, 108), paper(), style="width:62%")
S["G_CARD"] = svg((-4, -4, wr + 8, 108), paper() + f'<path fill="#4b2937" d="{d(word)}"/><path fill="#a83d64" d="{d(evg)}"/>', style="width:88%")
# flat one-colour version for stamps, embroidery and single-colour print
import build as B
line_rose = B.rose_path(0, 0, 100, "#a83d64", sw=0.09)
S["G_FLAT"] = svg((-4, -4, wr + 8, 108), line_rose + f'<path fill="#a83d64" d="{d(word)}"/><path fill="#a83d64" d="{d(evg)}"/>', style="width:min(80%,380px)")

# ---------- H. Window ----------
wdw = window()
l, t, r, b = wdw["word"].bounds
Wd = r - l
word_d, evw_d = d(wdw["word"]), d(wdw["events"])
L, T, R, Bm = unary_union(list(wdw.values())).bounds
VB = (L - 8, T - 8, R - L + 16, Bm - T + 16)
VBW = (l - 6, t - 6, Wd + 12, b - t + 12)


def window_svg(img, cid, evc="#4b2937", style="", with_events=True, edge="#a83d64", zoom=1.3, yoff=0.07, label=None):
    iw = Wd * zoom
    inner = (f'<clipPath id="{cid}"><path d="{word_d}"/></clipPath>'
             f'<image href="{img}" x="{l - (iw - Wd) / 2:.2f}" y="{t - iw * yoff:.2f}" width="{iw:.2f}" height="{iw:.2f}" preserveAspectRatio="xMidYMid slice" clip-path="url(#{cid})"/>'
             f'<path d="{word_d}" fill="none" stroke="{edge}" stroke-width="1.1"/>')
    if with_events:
        inner += f'<path fill="{evc}" d="{evw_d}"/>'
    return svg(VB if with_events else VBW, inner, style=style, label=label)


S["H_HERO"] = window_svg("pink-ombre-wall-1200.webp", "wh", style="width:min(86%,720px)", label="Bloom Events logo, direction H")
S["H_RED"] = window_svg("red-rose-wall-640.webp", "wr", with_events=False, edge="#7d1d2e", style="width:84%")
S["H_GREEN"] = window_svg("greenery-wall-1200.webp", "wg", with_events=False, edge="#2f4a22", style="width:84%")
S["H_IVORY"] = window_svg("champagne-rose-wall-1200.webp", "wi", with_events=False, edge="#b89a7a", style="width:84%")
S["H_TOTE"] = window_svg("pink-ombre-wall-1200.webp", "wt", style="width:74%")
S["H_SOLID"] = svg(VB, f'<path fill="#fffaf9" d="{word_d}"/><path fill="#fffaf9" d="{evw_d}"/>', style="width:min(80%,420px)")

json.dump(S, open("round2.json", "w"))
print({k: len(v) // 1024 for k, v in S.items()})
