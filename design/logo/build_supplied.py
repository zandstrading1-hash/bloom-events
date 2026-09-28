"""Builds the site's logo and icon files from the owner's logo, bloom-events-logo-source.jpg
(white lettering on a flat pink square).

    python build_supplied.py out

writes into out/:
- bloom-events-logo.png (1200 px), bloom-events-logo-tile.png (360 px): the logo as supplied, for sharing,
  the site footer and the owner app's sign-in screen
- bloom-events-logo-header.png: the lettering alone in the site's berry (#a83d64) on transparency, for the
  light site header
- bloom-events-favicon.png (192), bloom-events-apple-touch-icon.png (180): browser tab and home-screen icons
- owner/icon-192.png, owner/icon-512.png, owner/icon-maskable-512.png, owner/apple-touch-icon.png: the
  owner app's icons (the maskable one keeps the logo inside the safe zone phones crop to)
Copy them into the repo root and owner/ to update the site. Needs Pillow."""
import pathlib
import sys
from PIL import Image, ImageFilter

HERE = pathlib.Path(__file__).parent
BG = (253, 192, 202)
BERRY = (0xa8, 0x3d, 0x64)

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / 'out')
(out / 'owner').mkdir(parents=True, exist_ok=True)
tile = Image.open(HERE / 'bloom-events-logo-source.jpg').convert('RGB')

# Lettering strength: how far each pixel is from the pink toward white. Green separates them best
# (pink 192, white 255); the soft shadows are darker than the pink, so they drop out.
base = BG[1] + 6
strength = tile.getchannel('G').point(lambda v: 0 if v <= base else min(255, round((v - base) * 255 / (250 - base))))
x0, y0, x1, y1 = strength.point(lambda v: 255 if v > 40 else 0).getbbox()
pad = 6
alpha = strength.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
# The hairline strokes fade at header size, so they're thickened a little and made stronger.
alpha = alpha.filter(ImageFilter.MaxFilter(3)).point(lambda v: min(255, round(v * 1.6)))
header = Image.new('RGBA', alpha.size, BERRY + (0,))
header.putalpha(alpha)
header = header.resize((round(header.width * 180 / header.height), 180), Image.LANCZOS)
header.save(out / 'bloom-events-logo-header.png', optimize=True)


def square(size, name, scale=1.0):
    if scale == 1.0:
        img = tile.resize((size, size), Image.LANCZOS)
    else:
        img = Image.new('RGB', (size, size), BG)
        inner = tile.resize((round(size * scale), round(size * scale)), Image.LANCZOS)
        img.paste(inner, ((size - inner.width) // 2, (size - inner.height) // 2))
    img.save(out / name, optimize=True)


square(1200, 'bloom-events-logo.png')
square(360, 'bloom-events-logo-tile.png')
square(192, 'bloom-events-favicon.png')
square(180, 'bloom-events-apple-touch-icon.png')
square(192, 'owner/icon-192.png')
square(512, 'owner/icon-512.png')
square(512, 'owner/icon-maskable-512.png', scale=.78)
square(180, 'owner/apple-touch-icon.png')
print('header lockup', header.size, '- files written to', out)
