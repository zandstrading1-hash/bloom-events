import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
_cache={}
def _num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")
def _load(path):
    if path not in _cache:
        blob=hb.Blob.from_file_path(path); face=hb.Face(blob); font=hb.Font(face)
        _cache[path]=(font, TTFont(path), face.upem)
    return _cache[path]
def text_path(path, text, size, x=0, y=0, tracking=0, features=None):
    """Return (svg path d, advance width, bounds) for text set at baseline (x, y)."""
    font, tt, upem = _load(path)
    buf=hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, features or {"kern":True,"liga":True})
    gs=tt.getGlyphSet(); order=tt.getGlyphOrder()
    scale=size/upem
    pen=SVGPathPen(gs, ntos=_num); bp=BoundsPen(gs)
    cx=0
    n=len(buf.glyph_infos)
    for k,(info,pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        name=order[info.codepoint]
        t=(scale,0,0,-scale, x+(cx+pos.x_offset)*scale, y-pos.y_offset*scale)
        gs[name].draw(TransformPen(pen,t)); gs[name].draw(TransformPen(bp,t))
        cx+=pos.x_advance + (tracking*upem if k<n-1 else 0)
    return pen.getCommands(), cx*scale, bp.bounds


def glyphs(path, text, size, x=0, y=0, tracking=0):
    """Per-glyph outlines: list of (svg path d, bounds, pen x) for text at baseline (x, y)."""
    font, tt, upem = _load(path)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    scale = size / upem
    out = []
    cx = 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        t = (scale, 0, 0, -scale, x + (cx + pos.x_offset) * scale, y - pos.y_offset * scale)
        pen = SVGPathPen(gs, ntos=_num); bp = BoundsPen(gs)
        gs[name].draw(TransformPen(pen, t)); gs[name].draw(TransformPen(bp, t))
        out.append((pen.getCommands(), bp.bounds, x + cx * scale))
        cx += pos.x_advance + tracking * upem
    return out
