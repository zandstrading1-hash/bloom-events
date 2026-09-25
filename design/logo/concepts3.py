"""Round 2: bolder logo directions."""
import math
from shapely.geometry import Point, LineString, box, MultiLineString, Polygon
from shapely.ops import unary_union
from shapely import affinity
import geo, build as B
from concepts import rose_geom, fit_geom
from concepts2 import vesica, spaced

F3 = "fonts3/"
SHRIKHAND = F3 + "Shrikhand-400.ttf"
SYNE = F3 + "Syne-800.ttf"
CHANGO = F3 + "Chango-400.ttf"
OUTFIT = F3 + "Outfit-500.ttf"
OUTFIT_B = F3 + "Outfit-700.ttf"
DMSI = F3 + "DMSerifDisplay-400i.ttf"
BERRY, PLUM, CREAM, BLUSH, HOT = "#a83d64", "#4b2937", "#fffaf9", "#f6d8e2", "#e0457b"


def arc_pts(cx, cy, r, a0, a1, n=48):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


# ---------- E. Marquee: light-bulb letters ----------
def marquee_letters(stroke=26, pitch=15.5, bulb=4.6, gap=18):
    """Single-line skeletons for B L O O M (cap height 100), letter bodies and bulb centres."""
    h = stroke / 2
    sk = []
    x = 0
    # B
    r1 = (46 - stroke) / 2 + h * 0.2          # upper bowl
    r2 = (100 - stroke - 2 * r1) / 2          # lower bowl fills the rest
    ym = h + 2 * r1
    top = [(x + h, 100 - h), (x + h, h), (x + 28, h)] + arc_pts(x + 28, h + r1, r1, -90, 90)[1:] + [(x + h, ym)]
    bot = [(x + 30, ym)] + arc_pts(x + 30, ym + r2, r2, -90, 90)[1:] + [(x + h, 100 - h)]
    sk.append([top, bot]); x += 30 + r2 + h + gap
    # L
    sk.append([[(x + h, h), (x + h, 100 - h), (x + 56, 100 - h)]]); x += 56 + gap
    # O, O
    for _ in range(2):
        r = 50 - h
        sk.append([arc_pts(x + 50, 50, r, -90, 270, 96)]); x += 100 + gap
    # M
    sk.append([[(x + h, 100 - h), (x + h, h), (x + 46, 64), (x + 92 - h, h), (x + 92 - h, 100 - h)]]); x += 92
    bodies, bulbs = [], []
    for letter in sk:
        lines = [LineString(p) for p in letter]
        bodies.append(unary_union([l.buffer(h, cap_style=3, join_style=2, mitre_limit=2.2) for l in lines]).intersection(box(-1e3, 0, 1e4, 100)))
        for l in lines:
            n = max(2, round(l.length / pitch))
            for i in range(n + (0 if l.is_ring else 1)):
                d = l.length * i / n
                bulbs.append(l.interpolate(d))
    # de-duplicate bulbs that land on shared joints
    uniq = []
    for p in bulbs:
        if all(p.distance(q) > pitch * 0.55 for q in uniq):
            uniq.append(p)
    return unary_union(bodies), [(p.x, p.y) for p in uniq], bulb, x


# ---------- F. Groovy: 70s bubble letters with a stacked shadow ----------
def daisy(cx, cy, r, petals=8):
    pr = r * 0.36
    ps = [Point(cx + (r - pr) * math.cos(2 * math.pi * i / petals), cy + (r - pr) * math.sin(2 * math.pi * i / petals)).buffer(pr, quad_segs=32) for i in range(petals)]
    return unary_union(ps), Point(cx, cy).buffer(r * 0.34, quad_segs=32)


def groovy(size=100):
    g, gl = geo.text_geom(SHRIKHAND, "bloom", size, 0, 0)
    g = g.buffer(0)
    outline = g.buffer(size * 0.045)
    shadow = unary_union([affinity.translate(outline, size * 0.012 * k, size * 0.012 * k) for k in range(1, 8)]).buffer(size * 0.006)
    l, t, r, b = outline.bounds
    petals, center = daisy(r - size * 0.05, t + size * 0.06, size * 0.17)
    ev = spaced(OUTFIT_B, "EVENTS", size * 0.16, (l + r) / 2 + size * 0.05, b + size * 0.34, 0.5)
    return dict(fill=g, outline=outline, shadow=shadow, petals=petals, center=center, events=ev)


# ---------- G. Paper Bloom: layered paper rose ----------
def paper_petals(size=100):
    ps = B.petals(**B.ROSE)
    # fit to box
    l = min(x - r for x, y, r in ps); t = min(y - r for x, y, r in ps)
    rr = max(x + r for x, y, r in ps); bb = max(y + r for x, y, r in ps)
    k = size / max(rr - l, bb - t)
    return [((x - l) * k, (y - t) * k, r * k) for x, y, r in ps]


# ---------- H. Window: heavy letters filled with the flower wall photo ----------
def window(size=100):
    g, gl = geo.text_geom(CHANGO, "BLOOM", size, 0, 0, tracking=0.02)
    l, t, r, b = g.bounds
    ev = spaced(OUTFIT_B, "EVENTS", size * 0.2, (l + r) / 2, b + size * 0.42, 1.05)
    return dict(word=g, events=ev)


# ---------- I. Sprout B: a stem with two leaves ----------
def sprout_b(H=100):
    sw = H * 0.2
    stem = box(0, 0, sw, H)
    up = affinity.rotate(vesica(H * 0.62, H * 0.36), -18, origin=(0, 0))
    up = affinity.translate(up, sw + H * 0.27, H * 0.24)
    lo = affinity.rotate(vesica(H * 0.74, H * 0.42), 14, origin=(0, 0))
    lo = affinity.translate(lo, sw + H * 0.33, H * 0.72)
    return unary_union([stem, up, lo]).buffer(0)


def sprout_b2(H=100):
    """Geometric B whose bowls end in petal points."""
    sw = H * 0.22
    stem = box(0, 0, sw, H)
    def bowl(y0, y1, reach):
        hgt = y1 - y0
        pts = [(sw * 0.5, y0)]
        for i in range(0, 61):
            u = i / 60
            ang = math.pi * u
            x = sw + reach * math.sin(ang) ** 0.8 * (1 + 0.25 * math.sin(ang * 0.5))
            y = y0 + hgt * (1 - math.cos(ang)) / 2
            pts.append((x, y))
        pts.append((sw * 0.5, y1))
        outer = Polygon(pts)
        return outer
    up_o = bowl(0, H * 0.47, H * 0.44); lo_o = bowl(H * 0.44, H, H * 0.52)
    up_i = affinity.scale(up_o, 0.5, 0.42, origin=(sw, H * 0.235)); lo_i = affinity.scale(lo_o, 0.52, 0.46, origin=(sw, H * 0.72))
    return unary_union([stem, up_o.difference(up_i), lo_o.difference(lo_i)]).buffer(0)
