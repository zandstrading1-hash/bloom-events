"""Rebuild logo-directions.html, the page comparing the eight logo directions (A-H).

Run from this folder after fetch_fonts.py:  python build_directions_page.py
"""
import json, re, runpy

runpy.run_path("gen_symbols.py")   # round 1 (A-D) and the current logo -> symbols.svg, ratios.json
runpy.run_path("gen_round2.py")    # round 2 (E-H) -> round2.json

t = open("page_template.html").read()
r = json.load(open("ratios.json"))
t = t.replace("{{SYMBOLS}}", open("symbols.svg").read())
for key, rk in {"H_A": "a", "H_AM": "a-mark", "H_B": "b", "H_BW": "b-word", "H_BM": "b-mark",
                "H_C": "c", "H_CN": "c-neon", "H_CUR": "cur"}.items():
    t = t.replace("{{" + key + "}}", f"{100 / r[rk]:.2f}")
for k, v in json.load(open("round2.json")).items():
    t = t.replace("{{" + k + "}}", v)
assert not re.findall(r"\{\{[A-Z_0-9]+\}\}", t)
# photos come from the website's assets folder
t = re.sub(r"(?<![/\w-])((?:champagne-rose-wall|greenery-wall|pink-ombre-wall)-1200|red-rose-wall-640)\.webp", r"../../assets/\1.webp", t)
open("logo-directions.html", "w").write('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n' + t + "\n</html>\n")
print("wrote logo-directions.html")
