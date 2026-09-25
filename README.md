# Bloom Events

Private source repository for the Bloom Events static website, including the current pink design, rental and gallery pages, photos, videos, and policy drafts.

## Local preview

With Python installed, run this command from the repository directory:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765/ in your browser. No build step is required.

## Project files

- HTML files contain the website pages.
- `styles.css` and `refinements.css` contain the styling.
- `site.js` handles navigation, gallery interactions, and inquiry form availability.
- `assets/` contains website-ready photos and videos.

## Logo files

The logo is the name itself: "Bloom" with a line-drawn rose standing in for the first "o", over a ruled "EVENTS" line, in the site's plum (`#4b2937`) and berry (`#a83d64`). Text is converted to outlines, so no fonts need to be installed (wordmark: Cormorant Garamond SemiBold; "EVENTS": Jost Medium).

- `bloom-events-logo.svg` / `.png` / `.pdf`: main logo, transparent background (used in the site footer)
- `bloom-events-logo-cream.png`: main logo on the site's cream background
- `bloom-events-logo-reversed.svg` / `.png`: all-cream version for photos and dark or berry backgrounds
- `bloom-events-logo-stacked.svg` / `.png`: main logo on a square canvas
- `bloom-events-logo-inline.svg`: one-line version used in the site header
- `bloom-events-icon.svg` / `.png`: the rose on its own, for spaces too small for the name
- `bloom-events-favicon.svg` / `.png`, `bloom-events-apple-touch-icon.png`: browser tab and home-screen icons

## Publication status

This repository is a private source backup. It does not publish a live website.

The privacy, terms, booking policy, and accessibility pages are review drafts. Confirm the business identity, contact information, domain, rental terms, and actual data handling before public launch. The inquiry forms remain disabled until a valid form integration is configured.

Original supplied media and local review notes are preserved separately and are not included in this repository.
