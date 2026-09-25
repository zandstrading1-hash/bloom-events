"""Four new logo directions for Bloom Events (exploration, not yet in the repo)."""
import math, cairosvg
from shapely.geometry import Point, box, LineString
from shapely.ops import unary_union
from shapely import affinity
import geo, build as B
from concepts import rose_geom, arch_poly, fit_geom, BERRY, PLUM, CREAM, BLUSH, F2

GOLD = "#b8925a"
ROSE_SOFT = "#d892a8"
BODONI = F2 + "BodoniModa-500.ttf"
CORM_SC = F2 + "CormorantSC-500.ttf"
CINZEL = F2 + "Cinzel-500.ttf"
SACRAMENTO = F2 + "Sacramento-400.ttf"
PINYON = F2 + "PinyonScript-400.ttf"


def spaced(font, text, size, cx, base, tracking):
    g, _ = geo.text_geom(font, text, size, 0, base, tracking=tracking)
    l, t, r, b = g.bounds
    return affinity.translate(g, cx - (l + r) / 2, 0)


def ruled(font, text, size, cx, base, width, tracking=0.35, sw=None):
    """Centred caps with hairline rules out to `width`."""
    g = spaced(font, text, size, cx, base, tracking)
    l, t, r, b = g.bounds
    gap = size * 0.9; ly = base - size * 0.34; sw = sw or size * 0.055
    rules = unary_union([box(cx - width / 2, ly - sw / 2, l - gap, ly + sw / 2),
                         box(r + gap, ly - sw / 2, cx + width / 2, ly + sw / 2)])
    return g, rules


# ---------- A. The Backdrop: their initial carved out of an arched flower wall ----------
def backdrop(cell=0.12, sw=0.15):
    W, H = 100, 130
    arch = arch_poly(0, 0, W, H)
    bl = geo.text_geom(BODONI, "B", 100)[0]
    bl = fit_geom(bl, W * 0.2, H * 0.27, W * 0.6, H * 0.6)
    bl = bl.buffer(W * 0.006)  # a touch heavier so the hairlines survive at small sizes
    moat = bl.buffer(W * 0.03)
    c = W * cell
    unit = rose_geom(c * 0.94, sw=sw, rose=B.FAVICON_ROSE)
    roses, row, y = [], 0, -c / 2
    while y < H + c:
        x = -c / 2 + (c / 2 if row % 2 else 0)
        while x < W + c:
            rot = (row * 83 + int(x * 7)) % 360
            g = affinity.rotate(unit, rot, origin=(c * 0.47, c * 0.47))
            roses.append(affinity.translate(g, x - c * 0.47, y - c * 0.47).buffer(0))
            x += c
        y += c * 0.87; row += 1
    inner = arch.buffer(-W * 0.03)
    texture = unary_union(roses).buffer(0).intersection(inner).difference(moat)
    frame = arch.buffer(-W * 0.018).difference(arch.buffer(-W * 0.026))
    texture = texture.difference(arch.buffer(-W * 0.034).symmetric_difference(inner).buffer(0))
    return dict(arch=arch, texture=texture, letter=bl, frame=frame, size=(W, H))


def backdrop_lockup():
    a = backdrop()
    W, H = a["size"]
    word = spaced(CINZEL, "BLOOM", 30, W / 2, H + 44, 0.22)
    l, t, r, b = word.bounds
    ev, rules = ruled(CINZEL, "EVENTS", 9.5, W / 2, H + 62, (r - l) * 1.0, tracking=0.5)
    return a, unary_union([word]), unary_union([ev]), rules


# ---------- B. The Rings: BLOOM with the O's as interlocked wedding rings ----------
def rings(size=100, tracking=0.12, ring_w=0.05, overlap=0.36, gap=0.03, stone=0.30):
    gl = geo.glyph_geoms(BODONI, "BLOOM", size, 0, 0, tracking=tracking)
    (gB, xb, ab), (gL, xl, al), (o1, x1, a1), (o2, x2, a2), (gM, xm, am) = gl
    letter_gap = gL.bounds[0] - gB.bounds[2]
    l, t, r, b = o1.bounds
    R = (b - t) / 2; sw = size * ring_w
    c1 = (gL.bounds[2] + letter_gap * 0.9 + R, (t + b) / 2)
    c2 = (c1[0] + 2 * R * (1 - overlap), c1[1])
    ring = lambda cx, cy: Point(cx, cy).buffer(R, quad_segs=128).difference(Point(cx, cy).buffer(R - sw, quad_segs=128))
    r1, r2 = ring(*c1), ring(*c2)
    gM = affinity.translate(gM, (c2[0] + R + letter_gap * 0.9) - gM.bounds[0], 0)
    top = box(-1e4, -1e4, 1e4, c1[1]); bot = box(-1e4, c1[1], 1e4, 1e4)
    g = size * gap
    w1 = r1.difference(r2.buffer(g).intersection(top))
    w2 = r2.difference(r1.buffer(g).intersection(bot))
    rs = size * stone
    st = affinity.translate(rose_geom(rs, sw=0.13, rose=B.WORD_ROSE), c2[0] - rs / 2, c2[1] - R - rs * 0.72)
    ring_geom = unary_union([w1, w2]).difference(Point(c2[0], c2[1] - R - rs * 0.22).buffer(rs * 0.5 + g))
    letters = unary_union([gB, gL, gM])
    L, T, Rr, Bb = unary_union([letters, ring_geom]).bounds
    ev, rules = ruled(BODONI, "EVENTS", size * 0.13, (L + Rr) / 2, Bb + size * 0.36, (Rr - L), tracking=0.6)
    return dict(letters=letters, rings=ring_geom, stone=st, events=ev, rules=rules)


# ---------- C. The Signature: handwritten script with a rose-stem flourish ----------
def vesica(L, W):
    """Pointed leaf: intersection of two circles, length L, width W, pointing along +x."""
    r = (L * L / 4 + W * W / 4) / W
    d = r - W / 2
    return Point(0, -d).buffer(r, quad_segs=96).intersection(Point(0, d).buffer(r, quad_segs=96))


def leaf(cx, cy, ang, L, W):
    return affinity.translate(affinity.rotate(vesica(L, W), ang, origin=(0, 0)), cx, cy)


def signature(size=100, weight=0.004):
    g, gl = geo.text_geom(SACRAMENTO, "Bloom", size, 0, 0)
    g = g.buffer(size * weight)
    l, t, r, b = g.bounds
    # a rose stem sweeping under the word, rising into a rose past the m
    pts = []
    x0, x1 = l + (r - l) * 0.10, r + size * 0.10
    for i in range(121):
        u = i / 120
        x = x0 + (x1 - x0) * u
        y = b + size * 0.12 + math.sin(u * math.pi * 0.9) * size * 0.05 - (u ** 3) * size * 0.30
        pts.append((x, y))
    stem = LineString(pts).buffer(size * 0.009, cap_style=1)
    rs = size * 0.30
    ex, ey = pts[-1]
    rose = affinity.translate(rose_geom(rs, sw=0.12, rose=B.WORD_ROSE), ex - rs * 0.5, ey - rs * 0.92)
    k1, k2 = pts[64], pts[88]
    leaves = unary_union([leaf(k1[0] - size * 0.06, k1[1] + size * 0.035, -160, size * 0.2, size * 0.075),
                          leaf(k2[0] + size * 0.055, k2[1] - size * 0.045, 25, size * 0.17, size * 0.064)])
    stem = stem.difference(rose.buffer(size * 0.018))
    ev = spaced(CORM_SC, "EVENTS", size * 0.14, (l + r) / 2, b + size * 0.47, 0.55)
    return dict(word=g, stem=unary_union([stem, leaves]).difference(g.buffer(size * 0.02)), rose=rose, events=ev)


# ---------- D. The Seal: a round stamp for stickers, tags and social ----------
def text_on_arc(font, text, size, cx, cy, radius, center_deg, tracking=0.2, outside=True):
    """Glyphs laid along a circle. Top arc reads clockwise; bottom arc reads left to right."""
    gl = geo.glyph_geoms(font, text, size, 0, 0, tracking=tracking)
    total = gl[-1][1] + gl[-1][2]
    out = []
    for g, x, adv in gl:
        mid = x + adv / 2 - total / 2
        if outside:  # top arc: baseline on the circle, letters pointing outwards
            ang = center_deg + math.degrees(mid / radius)
            gg = affinity.translate(g, -(x + adv / 2), 0)
            gg = affinity.rotate(gg, ang + 90, origin=(0, 0))
            px, py = cx + radius * math.cos(math.radians(ang)), cy + radius * math.sin(math.radians(ang))
        else:  # bottom arc: letters upright, reading left to right
            ang = center_deg - math.degrees(mid / radius)
            gg = affinity.translate(g, -(x + adv / 2), size * 0.7)
            gg = affinity.rotate(gg, ang - 90, origin=(0, 0))
            px, py = cx + radius * math.cos(math.radians(ang)), cy + radius * math.sin(math.radians(ang))
        out.append(affinity.translate(gg, px, py))
    return unary_union(out)


def seal(D=100):
    cx = cy = D / 2
    ring_o = Point(cx, cy).buffer(D / 2, quad_segs=128)
    ring_i = Point(cx, cy).buffer(D / 2 - D * 0.012, quad_segs=128)
    inner_o = Point(cx, cy).buffer(D * 0.335, quad_segs=128)
    inner_i = Point(cx, cy).buffer(D * 0.335 - D * 0.008, quad_segs=128)
    lines = unary_union([ring_o.difference(ring_i), inner_o.difference(inner_i)])
    top = text_on_arc(CINZEL, "BLOOM EVENTS", D * 0.085, cx, cy, D * 0.375, -90, tracking=0.28)
    bot = text_on_arc(CINZEL, "FLOWER WALLS & RENTALS", D * 0.052, cx, cy, D * 0.395, 90, tracking=0.2, outside=False)
    dots = unary_union([Point(cx + D * 0.40 * math.cos(math.radians(a)), cy + D * 0.40 * math.sin(math.radians(a))).buffer(D * 0.009) for a in (180 + 8, -8)])
    rose = rose_geom(D * 0.42, sw=0.1)
    rose = affinity.translate(rose, cx - D * 0.21, cy - D * 0.21)
    return dict(lines=lines, text=unary_union([top, bot, dots]), rose=rose)
