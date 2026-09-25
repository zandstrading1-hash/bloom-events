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
- `site.js` handles navigation, gallery interactions, rental picks and the booking request.
- `assets/` contains website-ready photos and videos.
- `design/` holds the logo generator and logo concepts, `tests/` the browser checks, and `docs/next-steps.md` the open questions and the availability calendar plan. None of these are part of the website; don't deploy them.

## Logo files

The logo is the name itself: "Bloom" with a line-drawn rose standing in for the first "o", over a ruled "EVENTS" line, in the site's plum (`#4b2937`) and berry (`#a83d64`). Text is converted to outlines, so no fonts need to be installed (wordmark: Cormorant Garamond SemiBold; "EVENTS": Jost Medium).

- `bloom-events-logo.svg` / `.png` / `.pdf`: main logo, transparent background (used in the site footer)
- `bloom-events-logo-cream.png`: main logo on the site's cream background
- `bloom-events-logo-reversed.svg` / `.png`: all-cream version for photos and dark or berry backgrounds
- `bloom-events-logo-stacked.svg` / `.png`: main logo on a square canvas
- `bloom-events-logo-inline.svg`: one-line version used in the site header
- `bloom-events-icon.svg` / `.png`: the rose on its own, for spaces too small for the name
- `bloom-events-favicon.svg` / `.png`, `bloom-events-apple-touch-icon.png`: browser tab and home-screen icons

## Booking

On the Rentals page, visitors tap “Book this” on any flower wall, rental or package. Each item can be picked once (there is one of each wall), and the picks follow them to the Book page (`contact.html`), where they send one request with their date.

- Picks are stored in the visitor’s browser and also carried in the Book link, so they survive if storage is blocked. The list of bookable items lives in `RENTALS` at the top of the picks code in `site.js`; add a matching `data-pick` button in `services.html` for any new item.
- Until a Web3Forms access key is added to the form in `contact.html`, “Send by text” opens the visitor’s messages app (or email) with the request filled in. With a key, the same button sends the request online.
- The site does not check availability. The owner confirms each date by reply.

## Tests

With the site served locally (see Local preview), run the browser checks from `tests/`:

```sh
cd tests
npm install
npx playwright install chromium   # skip if a Chromium is available; set CHROMIUM_PATH to use it
npm test
```

`booking-flow.js` walks through picking rentals and building a booking request; `site-check.js` loads every page at four widths and checks accessibility (axe), failed requests, JS errors, sideways scrolling and that the bottom Book bar never covers the footer. Set `BASE_URL` if the site isn't at http://127.0.0.1:8765.

## Publication status

This repository is a private source backup. It does not publish a live website.

The privacy, terms, booking policy, and accessibility pages are review drafts. Confirm the business identity, contact information, domain, rental terms, and actual data handling before public launch. Online sending stays off until a valid form integration is configured; until then, booking requests go out by text or email.

Original supplied media and local review notes are preserved separately and are not included in this repository.
