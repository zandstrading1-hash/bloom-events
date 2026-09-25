# Design sources

Not part of the website. These files produce the logo and the logo concept page, and should not be deployed with the site.

## `logo/`

Python scripts that draw the logo from fonts and geometry, so every file is clean vector outlines (no fonts needed to open them).

| File | What it does |
| --- | --- |
| `build.py` | Builds the live logo set: `python build.py out` writes every `bloom-events-*` logo, icon and favicon file into `out/`. Copy them to the repo root to update the site. |
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
