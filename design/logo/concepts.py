import math, cairosvg
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union
from shapely import affinity
import geo, build as B

BERRY, PLUM, CREAM, BLUSH = "#a83d64", "#4b2937", "#fffaf9", "#f6d8e2"
F2 = "fonts2/"
BODONI = F2 + "BodoniModa-500.ttf"
CORM_SC = F2 + "CormorantSC-500.ttf"
MARCELLUS = F2 + "Marcellus-400.ttf"


def fit_geom(g, x, y, w, h):
    """Scale uniformly to fit a w x h box at (x, y), centred."""
    l, t, r, b = g.bounds
    k = min(w / (r - l), h / (b - t))
    g = affinity.scale(g, k, k, origin=(0, 0))
    l, t, r, b = g.bounds
    return affinity.translate(g, x + (w - (r - l)) / 2 - l, y + (h - (b - t)) / 2 - t)


def rose_geom(size, sw=0.085, rose=None):
    return fit_geom(B.rose_geometry(sw, rose or B.ROSE), 0, 0, size, size)


def arch_poly(x, y, w, h):
    r = w / 2
    top = Point(x + r, y + r).buffer(r, quad_segs=64)
    return unary_union([top, box(x, y + r, x + w, y + h)])


# ---------- Concept A: the flower-wall arch with a carved B ----------
def concept_arch(cell=0.13, sw=0.14):
    W, H = 100, 132
    arch = arch_poly(0, 0, W, H)
    bg = geo.text_geom(BODONI, "B", 100)[0]
    bg = fit_geom(bg, W * 0.24, H * 0.30, W * 0.52, H * 0.56)
    moat = bg.buffer(W * 0.028)
    c = W * cell
    unit = rose_geom(c * 0.92, sw=sw, rose=B.FAVICON_ROSE)
    roses = []
    row = 0
    y = -c / 2
    while y < H + c:
        x = -c / 2 + (c / 2 if row % 2 else 0)
        while x < W + c:
            rot = (row * 37 + int(x) * 11) % 360  # vary each rose so the wall looks natural
            g = affinity.rotate(unit, rot, origin=(c * 0.46, c * 0.46))
            roses.append(affinity.translate(g, x - c * 0.46, y - c * 0.46))
            x += c
        y += c * 0.87
        row += 1
    texture = unary_union([r.buffer(0) for r in roses]).buffer(0).intersection(arch.buffer(-W * 0.035)).difference(moat)
    return arch, texture, bg, (W, H)


# ---------- Concept B: BLOOM with the O's as interlocking rings ----------
def concept_rings(size=100, overlap=0.34, gap=0.035):
    gl = geo.glyph_geoms(BODONI, "BLOOM", size, 0, 0, tracking=0.06)
    (gB, _, _), (gL, _, _), (o1, x1, a1), (o2, x2, a2), (gM, xm, am) = gl
    w = o1.bounds[2] - o1.bounds[0]
    shift = w * overlap
    o2 = affinity.translate(o2, -shift, 0)
    gM = affinity.translate(gM, -shift, 0)
    cy = (o1.bounds[1] + o1.bounds[3]) / 2
    top = box(-1e3, -1e3, 1e3, cy)
    bot = box(-1e3, cy, 1e3, 1e3)
    g = size * gap
    # weave: ring 2 passes over ring 1 at the top crossing, under it at the bottom
    r1 = o1.difference(o2.buffer(g).intersection(top))
    r2 = o2.difference(o1.buffer(g).intersection(bot))
    letters = unary_union([gB, gL, gM])
    # rose "stone" set on top of the second ring
    l, t, r, b = o2.bounds
    rs = size * 0.30
    stone = rose_geom(rs, sw=0.13, rose=B.WORD_ROSE)
    stone = affinity.translate(stone, (l + r) / 2 - rs / 2, t - rs * 0.62)
    rings = unary_union([r1, r2]).difference(Point(((l + r) / 2), t - rs * 0.12).buffer(rs * 0.62))
    return letters, rings, stone


def show(parts, bounds, pad, bg=None, scale=1.0):
    l, t, r, b = bounds
    w, h = r - l + 2 * pad, b - t + 2 * pad
    body = "".join(parts)
    rect = f'<rect x="{l-pad}" y="{t-pad}" width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{l-pad:.2f} {t-pad:.2f} {w:.2f} {h:.2f}" '
            f'width="{w*scale:.0f}" height="{h*scale:.0f}">{rect}{body}</svg>')


if __name__ == "__main__":
    arch, tex, bgl, (W, H) = concept_arch()
    a = show([geo.path(arch, BERRY), geo.path(tex, CREAM), geo.path(bgl, CREAM)], (0, 0, W, H), 6, CREAM, 3)
    cairosvg.svg2png(bytestring=a.encode(), write_to="cA.png")
    letters, rings, stone = concept_rings()
    allg = unary_union([letters, rings, stone])
    bb = allg.bounds
    s = show([geo.path(letters, PLUM), geo.path(rings, PLUM), geo.path(stone, BERRY)], bb, 10, CREAM, 2.5)
    cairosvg.svg2png(bytestring=s.encode(), write_to="cB.png")
    print("ok")
