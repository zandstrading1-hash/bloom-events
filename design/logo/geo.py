"""Helpers to turn font glyphs into shapely geometry and back to SVG paths."""
import math
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from shapely.geometry import Polygon, MultiPolygon, Point
from shapely.ops import unary_union
from shapely import affinity

_cache = {}


def _load(path):
    if path not in _cache:
        blob = hb.Blob.from_file_path(path); face = hb.Face(blob)
        _cache[path] = (hb.Font(face), TTFont(path), face.upem)
    return _cache[path]


class FlattenPen(BasePen):
    def __init__(self, gs, steps=24):
        super().__init__(gs); self.contours = []; self.cur = []; self.steps = steps
    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)
    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps; u = 1 - t
            self.cur.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                             u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps; u = 1 - t
            self.cur.append((u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0], u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]))
    def _closePath(self):
        if len(self.cur) > 2: self.contours.append(self.cur)
        self.cur = []
    _endPath = _closePath


def _area(c):
    return 0.5 * sum(c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1] for i in range(len(c)))


def contours_to_geom(contours):
    """Non-zero fill: contours wound like the largest one are solid, the others are holes.
    Handles fonts whose outlines overlap (common in variable-font instances)."""
    if not contours:
        return Polygon()
    areas = [_area(c) for c in contours]
    sign = 1 if areas[max(range(len(areas)), key=lambda i: abs(areas[i]))] > 0 else -1
    solid = [Polygon(c).buffer(0) for c, a in zip(contours, areas) if a * sign > 0]
    holes = [Polygon(c).buffer(0) for c, a in zip(contours, areas) if a * sign < 0]
    g = unary_union(solid)
    return g.difference(unary_union(holes)) if holes else g


def glyph_geoms(font, text, size, x=0, y=0, tracking=0, features=None):
    """List of (geometry, advance_x_start) per glyph, y-down coords, baseline at y."""
    hbf, tt, upem = _load(font)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(hbf, buf, features or {"kern": True, "liga": True})
    gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    s = size / upem; cx = 0; out = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen = FlattenPen(gs); gs[order[info.codepoint]].draw(pen)
        g = contours_to_geom(pen.contours)
        g = affinity.affine_transform(g, [s, 0, 0, -s, x + (cx + pos.x_offset) * s, y - pos.y_offset * s])
        out.append((g, x + cx * s, pos.x_advance * s))
        cx += pos.x_advance + tracking * upem
    return out


def text_geom(font, text, size, x=0, y=0, tracking=0):
    gl = glyph_geoms(font, text, size, x, y, tracking)
    return unary_union([g for g, _, _ in gl]), gl


def path_d(geom, prec=2):
    if geom.is_empty: return ""
    polys = geom.geoms if hasattr(geom, "geoms") else [geom]
    parts = []
    for p in polys:
        if p.geom_type != "Polygon": continue
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)[:-1]
            parts.append("M" + " ".join(f"{a:.{prec}f},{b:.{prec}f}" for a, b in c) + "Z")
    return "".join(parts)


def path(geom, fill, extra=""):
    return f'<path d="{path_d(geom)}" fill="{fill}" fill-rule="evenodd"{extra}/>'
