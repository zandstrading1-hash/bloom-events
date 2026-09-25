"""Download the fonts the logo scripts use from Google Fonts (all SIL Open Font License).

Run from this folder:  python fetch_fonts.py
Creates fonts/, fonts2/ and fonts3/ with the file names the scripts expect.
"""
import os, re, urllib.request

FAMILIES = {
    "fonts": ["Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600", "Playfair+Display:ital,wght@0,400;1,400",
              "Fraunces:ital,wght@0,400;1,400", "Jost:wght@400;500"],
    "fonts2": ["Bodoni+Moda:ital,wght@0,500;1,500", "Italiana", "Cinzel:wght@500", "Marcellus", "Pinyon+Script",
               "Great+Vibes", "Allura", "Parisienne", "Sacramento", "Mrs+Saint+Delafield", "Monsieur+La+Doulaise",
               "Corinthia", "Italianno", "Gilda+Display", "Cormorant+SC:wght@500"],
    "fonts3": ["Syne:wght@700;800", "Unbounded:wght@500;700", "Shrikhand", "Bagel+Fat+One", "Chango",
               "Cherry+Bomb+One", "Modak", "Rubik:wght@700", "Outfit:wght@500;700", "DM+Serif+Display:ital@0;1"],
}

for folder, specs in FAMILIES.items():
    os.makedirs(folder, exist_ok=True)
    for spec in specs:
        # a plain user agent makes the CSS API answer with .ttf files
        req = urllib.request.Request(f"https://fonts.googleapis.com/css2?family={spec}", headers={"User-Agent": "curl/8"})
        css = urllib.request.urlopen(req).read().decode()
        for block in re.findall(r"@font-face \{(.*?)\}", css, re.S):
            fam = re.search(r"font-family: '([^']*)'", block).group(1).replace(" ", "")
            style = re.search(r"font-style: (\w+)", block).group(1)
            weight = re.search(r"font-weight: (\d+)", block).group(1)
            url = re.search(r"url\(([^)]*)\)", block).group(1)
            name = f"{fam}-{weight}{'i' if style == 'italic' else ''}.ttf"
            urllib.request.urlretrieve(url, os.path.join(folder, name))
            print(folder, name)
