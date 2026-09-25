"""Build the Bloom Events logo set.

The rose is ten overlapping petals (circles) spiralling inward; each petal's rim
is hidden wherever a later, inner petal sits on top of it. The visible line work
is computed with shapely so every output is plain filled paths: transparent,
mask-free, and identical in browsers, PDF viewers and print/vinyl software.
"""
import math, os, sys
import cairosvg
from shapely.geometry import Point, Polygon, MultiPolygon
from shapely.ops import unary_union
from shapely import affinity
from textpath import glyphs, text_path

BERRY = "#a83d64"   # --rose on the current site
PLUM = "#4b2937"    # --ink on the current site
CREAM = "#fffaf9"   # --bg on the current site
F = "fonts/"
SERIF = F + "CormorantGaramond-600.ttf"
SANS = F + "Jost-500.ttf"

ROSE = dict(n=10, phi=120, off=0.3, shrink=0.85, a0=-45, offk=0.3)
# Fewer, heavier petals so the favicon still reads as a rose at 16px
FAVICON_ROSE = dict(ROSE, n=6, shrink=0.72)
# Slightly simpler rose for the o in the wordmark, so it stays crisp at header size
WORD_ROSE = dict(ROSE, n=8, shrink=0.8)
QS = 48  # circle quadrant segments: <0.15px deviation even at 2000px wide


def petals(n, phi, off, shrink, a0, offk):
    out = []
    for i in range(n):
        t = i / (n - 1)
        rho = 1 - shrink * t
        a = math.radians(a0 + i * phi)
        o = off * (1 - offk + offk * t) * rho
        out.append((o * math.cos(a), o * math.sin(a), rho))
    return out


def rose_geometry(sw, rose=ROSE):
    """Ink of the rose at unit scale; sw is the line weight."""
    ps = petals(**rose)
    pieces = []
    for i, (x, y, r) in enumerate(ps):
        band = Point(x, y).buffer(r + sw / 2, quad_segs=QS).difference(
            Point(x, y).buffer(r - sw / 2, quad_segs=QS))
        later = [Point(px, py).buffer(pr + sw / 2, quad_segs=QS) for px, py, pr in ps[i + 1:]]
        if later:
            band = band.difference(unary_union(later))
        pieces.append(band)
    return unary_union(pieces)


def fit(geom, x, y, size):
    """Scale geometry to fit a size x size box at (x, y), centred."""
    minx, miny, maxx, maxy = geom.bounds
    k = size / max(maxx - minx, maxy - miny)
    g = affinity.scale(geom, k, k, origin=(0, 0))
    minx, miny, maxx, maxy = g.bounds
    return affinity.translate(g, x + (size - (maxx - minx)) / 2 - minx,
                              y + (size - (maxy - miny)) / 2 - miny)


def path_d(geom):
    polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    parts = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)[:-1]
            parts.append("M" + " ".join(f"{px:.2f},{py:.2f}" for px, py in c) + "Z")
    return "".join(parts)


def rose_path(x, y, size, color, sw=0.085, rose=ROSE):
    return f'<path d="{path_d(fit(rose_geometry(sw, rose), x, y, size))}" fill="{color}" fill-rule="evenodd"/>'


def text(s, font, size, x, y, color, tracking=0):
    d, w, b = text_path(font, s, size, x, y, tracking=tracking)
    return f'<path d="{d}" fill="{color}"/>', w, b


EV_TRACK = 0.42


def events_line(cx, base, size, width, color):
    """'EVENTS' centred on cx with hairline rules filling out to `width`."""
    _, ew, _ = text_path(SANS, "EVENTS", size, 0, 0, tracking=EV_TRACK)
    ex = cx - ew / 2
    p, _, _ = text("EVENTS", SANS, size, ex, base, color, tracking=EV_TRACK)
    gap = size * 0.9
    ly = base - size * 0.36
    sw = size * 0.06
    left, right = cx - width / 2, cx + width / 2
    rules = (f'<path d="M{left:.2f},{ly:.2f} H{ex - gap:.2f} M{ex + ew + gap:.2f},{ly:.2f} H{right:.2f}" '
             f'stroke="{color}" stroke-width="{sw:.2f}" fill="none"/>')
    return p + rules


def wordmark(x, base, size, ink, accent):
    """'Bloom' with the rose standing in for the first o.

    Returns (svg, (left, top, right, bottom)) in the same coordinates.
    """
    gl = glyphs(SERIF, "Bloom", size, x, base)
    pad = 0.02 * size  # a little air either side of the rose
    parts, shift = [], 0.0
    top = min(b[1] for _, b, _ in gl)
    bottom = max(b[3] for _, b, _ in gl)
    for i, (d, b, _) in enumerate(gl):
        if i == 2:
            shift += pad
            s = max(b[2] - b[0], b[3] - b[1]) * 1.15  # rounds look small next to stems
            cx, cy = (b[0] + b[2]) / 2 + shift, (b[1] + b[3]) / 2
            parts.append(rose_path(cx - s / 2, cy - s / 2, s, accent, sw=0.15, rose=WORD_ROSE))
            bottom = max(bottom, cy + s / 2)
            shift += pad
        else:
            parts.append(f'<path transform="translate({shift:.2f},0)" d="{d}" fill="{ink}"/>')
    return "".join(parts), (gl[0][1][0], top, gl[-1][1][2] + shift, bottom)


def primary(ink, accent, size=100):
    """Wordmark over a ruled EVENTS line. Returns (svg, bounds)."""
    word, (l, t, r, b) = wordmark(0, 0, size, ink, accent)
    ebase = size * 0.35
    esize = size * 0.157
    ev = events_line((l + r) / 2, ebase, esize, (r - l) * 0.97, accent)
    return word + ev, (l, t, r, ebase)


def inline(ink, accent, size=100):
    """One-line version for the site header, where a second line would be too small."""
    word, (l, t, r, b) = wordmark(0, 0, size, ink, accent)
    ev, ew, _ = text("EVENTS", SANS, size * 0.38, r + size * 0.28, 0, accent, tracking=0.3)
    return word + ev, (l, t, r + size * 0.28 + ew, b)


def doc(w, h, inner, bg=None, label="Bloom Events"):
    r = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" role="img" aria-label="{label}">'
            f'<title>{label}</title>{r}{inner}</svg>\n')


def place(inner, bounds, W, H, box_w, box_h):
    """Fit content with the given bounds into a box_w x box_h area centred on a W x H canvas."""
    l, t, r, b = bounds
    k = min(box_w / (r - l), box_h / (b - t))
    x = (W - (r - l) * k) / 2 - l * k
    y = (H - (b - t) * k) / 2 - t * k
    return f'<g transform="translate({x:.3f},{y:.3f}) scale({k:.5f})">{inner}</g>'


def tight(inner, bounds, margin):
    """Document cropped to the content plus a margin (in content units)."""
    l, t, r, b = bounds
    w, h = r - l + 2 * margin, b - t + 2 * margin
    return doc(round(w, 2), round(h, 2), f'<g transform="translate({margin - l:.2f},{margin - t:.2f})">{inner}</g>'), w, h


def write(path, content):
    with open(path, "w") as f:
        f.write(content)


def main(out):
    os.makedirs(out, exist_ok=True)
    j = lambda n: os.path.join(out, n)

    # Main logo. The SVG and PDF are cropped for web and print use; the PNGs keep
    # the padded 3:1 canvas of the previous files (also used as the og:image).
    inner, bounds = primary(PLUM, BERRY)
    svg_tight, w, h = tight(inner, bounds, 6)
    write(j("bloom-events-logo.svg"), svg_tight)
    cairosvg.svg2pdf(bytestring=svg_tight.encode(), write_to=j("bloom-events-logo.pdf"))
    canvas = lambda bg=None, content=inner: doc(600, 200, place(content, bounds, 600, 200, 460, 132), bg=bg)
    cairosvg.svg2png(bytestring=canvas().encode(), write_to=j("bloom-events-logo.png"), output_width=2400, output_height=800)
    cairosvg.svg2png(bytestring=canvas(CREAM).encode(), write_to=j("bloom-events-logo-cream.png"), output_width=2400, output_height=800)

    # Reversed, for photos and berry/dark backgrounds
    inner_r, _ = primary(CREAM, CREAM)
    write(j("bloom-events-logo-reversed.svg"), tight(inner_r, bounds, 6)[0])
    cairosvg.svg2png(bytestring=canvas(content=inner_r).encode(), write_to=j("bloom-events-logo-reversed.png"), output_width=2400, output_height=800)

    # Square version for social profiles
    st = doc(300, 300, place(inner, bounds, 300, 300, 230, 230))
    write(j("bloom-events-logo-stacked.svg"), st)
    cairosvg.svg2png(bytestring=st.encode(), write_to=j("bloom-events-logo-stacked.png"), output_width=1200, output_height=1200)

    # One-line version for the site header
    inner_i, bounds_i = inline(PLUM, BERRY)
    write(j("bloom-events-logo-inline.svg"), tight(inner_i, bounds_i, 2)[0])

    # Rose on its own, for places too small for the name
    icon = doc(240, 240, rose_path(24, 24, 192, BERRY, sw=0.095))
    write(j("bloom-events-icon.svg"), icon)
    cairosvg.svg2png(bytestring=icon.encode(), write_to=j("bloom-events-icon.png"), output_width=800, output_height=800)

    # Favicon badge: cream rose on a berry circle, legible on light and dark tab bars
    fav = doc(64, 64, f'<circle cx="32" cy="32" r="32" fill="{BERRY}"/>' + rose_path(10, 10, 44, CREAM, sw=0.16, rose=FAVICON_ROSE))
    write(j("bloom-events-favicon.svg"), fav)
    cairosvg.svg2png(bytestring=fav.encode(), write_to=j("bloom-events-favicon.png"), output_width=192, output_height=192)
    # Apple touch icon: full bleed square (iOS applies its own rounding)
    touch = doc(180, 180, f'<rect width="180" height="180" fill="{BERRY}"/>' + rose_path(38, 38, 104, CREAM, sw=0.11))
    cairosvg.svg2png(bytestring=touch.encode(), write_to=j("bloom-events-apple-touch-icon.png"), output_width=180, output_height=180)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
