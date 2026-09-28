# Design sources

Not part of the website, and not to be deployed with it.

The live logo is the owner's own (`logo/bloom-events-logo-source.jpg`, September 2026). `logo/build_supplied.py` makes every site and owner-app logo and icon file from it: run `python build_supplied.py out` in `logo/`, then copy the files into the repo root and `owner/` (needs Pillow). The rest of `logo/` is the earlier generated wordmark (a rose as the "o") and its concept directions, kept for reference.

## `logo/`

Python scripts that draw the logo from fonts and geometry, so every file is clean vector outlines (no fonts needed to open them).

| File | What it does |
| --- | --- |
| `bloom-events-logo-source.jpg`, `build_supplied.py` | The owner's logo and the script that builds the site's logo and icon files from it (see above). |
| `build.py` | Builds the earlier wordmark set (no longer on the site): `python build.py out` writes every `bloom-events-*` logo, icon and favicon file into `out/`. Copy them to the repo root to update the site. |
| `textpath.py`, `geo.py` | Turn text into outlines (HarfBuzz shaping + fontTools) and shapes into SVG paths (Shapely). |
| `concepts.py`, `concepts2.py`, `concepts3.py` | The eight concept directions: A Backdrop, B Rings, C Signature, D Seal (round 1) and E Marquee, F Groovy, G Paper Bloom, H Window (round 2). |
| `gen_symbols.py`, `gen_round2.py`, `page_template.html` | Pieces of the concept comparison page. |
| `build_directions_page.py` | Rebuilds `logo-directions.html` from the pieces above. |
| `logo-directions.html` | The concept comparison page. Open it from this folder; its photos load from `../../assets/`. |
| `fetch_fonts.py` | Downloads the fonts the scripts use (all SIL Open Font License) into `fonts/`, `fonts2/` and `fonts3/`. |

### Rebuilding

```sh
cd design/logo
pip install fonttools uharfbuzz shapely cairosvg
python fetch_fonts.py
python build.py out                # logo files
python build_directions_page.py    # concept page
```

The font folders and `out/` are ignored by git.
