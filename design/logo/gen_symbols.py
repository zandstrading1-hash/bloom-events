"""Export each concept as an SVG <symbol> whose colours come from CSS custom properties."""
import re, json
from shapely.ops import unary_union
import geo, build as B
from concepts2 import backdrop_lockup, backdrop, rings, signature, seal

TOL = 0.025


def p(geom, var, default):
    g = geom.simplify(TOL, preserve_topology=True)
    return f'<path style="fill:var({var},{default})" fill-rule="evenodd" d="{geo.path_d(g, 2)}"/>'


def symbol(sid, parts, bounds, pad):
    l, t, r, b = bounds
    vb = f"{l-pad:.2f} {t-pad:.2f} {r-l+2*pad:.2f} {b-t+2*pad:.2f}"
    return f'<symbol id="{sid}" viewBox="{vb}">{"".join(parts)}</symbol>', (r - l + 2 * pad) / (b - t + 2 * pad)


out, ratios = [], {}
INK, ACC, TEX, PAPER = "--ink", "--accent", "--tex", "--paper"

# A. Backdrop
a, word, ev, rules = backdrop_lockup()
mark = [p(a["arch"], ACC, B.BERRY), p(a["texture"], TEX, "#d892a8"), p(a["letter"], PAPER, B.CREAM), p(a["frame"], PAPER, B.CREAM)]
s, ratios["a-mark"] = symbol("mark-a", mark, a["arch"].bounds, 2); out.append(s)
al, at, ar, ab = a["arch"].bounds
use_mark = f'<use href="#mark-a" x="{al-2:.2f}" y="{at-2:.2f}" width="{ar-al+4:.2f}" height="{ab-at+4:.2f}"/>'
s, ratios["a"] = symbol("logo-a", [use_mark, p(word, INK, B.PLUM), p(unary_union([ev, rules]), ACC, B.BERRY)],
                        unary_union([a["arch"], word, ev, rules]).bounds, 3); out.append(s)

# B. Rings
r = rings()
s, ratios["b"] = symbol("logo-b", [p(unary_union([r["letters"], r["rings"]]), INK, B.PLUM), p(r["stone"], ACC, B.BERRY),
                                   p(unary_union([r["events"], r["rules"]]), ACC, B.BERRY)],
                        unary_union(list(r.values())).bounds, 4); out.append(s)
s, ratios["b-word"] = symbol("word-b", [p(unary_union([r["letters"], r["rings"]]), INK, B.PLUM), p(r["stone"], ACC, B.BERRY)],
                             unary_union([r["letters"], r["rings"], r["stone"]]).bounds, 4); out.append(s)
s, ratios["b-mark"] = symbol("mark-b", [p(r["rings"], INK, B.PLUM), p(r["stone"], ACC, B.BERRY)],
                             unary_union([r["rings"], r["stone"]]).bounds, 4); out.append(s)

# C. Signature
c = signature()
s, ratios["c"] = symbol("logo-c", [p(c["word"], INK, B.PLUM), p(unary_union([c["stem"], c["rose"]]), ACC, B.BERRY),
                                   p(c["events"], ACC, B.BERRY)], unary_union(list(c.values())).bounds, 4); out.append(s)
s, ratios["c-neon"] = symbol("neon-c", [p(c["word"], INK, B.PLUM), p(unary_union([c["stem"], c["rose"]]), ACC, B.BERRY)],
                             unary_union([c["word"], c["stem"], c["rose"]]).bounds, 4); out.append(s)

# D. Seal
d = seal()
s, ratios["d"] = symbol("logo-d", [p(d["lines"], ACC, B.BERRY), p(d["text"], INK, B.PLUM), p(d["rose"], ACC, B.BERRY)], (0, 0, 100, 100), 1); out.append(s)

# Current logo, from the merged build (fills swapped for variables)
inner, bounds = B.primary("#000001", "#000002")
inner = inner.replace('fill="#000001"', 'style="fill:var(--ink,#4b2937)"').replace('fill="#000002"', 'style="fill:var(--accent,#a83d64)"')
inner = inner.replace('stroke="#000002"', 'style="stroke:var(--accent,#a83d64)"')
s, ratios["cur"] = symbol("logo-cur", [inner], bounds, 4); out.append(s)

svg = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' + "".join(out) + "</svg>"
open("symbols.svg", "w").write(svg)
json.dump(ratios, open("ratios.json", "w"), indent=1)
print(len(svg) // 1024, "KB", {k: round(v, 3) for k, v in ratios.items()})
