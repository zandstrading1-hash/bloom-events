# Bloom Events

Source repository for the Bloom Events static website, including the current pink design, rental and gallery pages, photos, videos, and policy drafts.

## Local preview

With Python installed, run this command from the repository directory:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765/ in your browser. No build step is required.

## Project files

- HTML files contain the website pages.
- `styles.css` and `refinements.css` contain the styling.
- `site.js` handles navigation, gallery interactions, rental picks, the availability calendar and the booking request.
- `admin.html` and `admin.js` are the owner's bookings page (not linked anywhere, hidden from search engines).
- `supabase/schema.sql` sets up the availability database; `.github/workflows/keep-calendar-awake.yml` keeps it from pausing.
- `assets/` contains website-ready photos and videos.
- `design/` holds the logo generator and logo concepts, `tests/` the browser checks, `supabase/` the database setup, and `docs/next-steps.md` the open questions. None of these are part of the website; don't deploy them.

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
- The owner still confirms every request by reply; a request never reserves a date by itself.

## Availability calendar

Bookings live in a free Supabase project (`dwazctmqkrnajqmswtiy`). The site's address and publishable key for it are in `DB` in `site.js`. That key is meant to be public: with it, visitors can only call `booked_items()`, which returns item ids and dates, never names or notes.

- **Rentals page:** "Check your date" shows a month calendar. Choosing a date marks anything booked that day and stops it being added. A package is blocked when one of its parts is booked (`PARTS` in `site.js`). Days with every flower wall booked are marked. The date carries to the Book page.
- **Book page:** the date is checked against the picks. A booked pick is flagged and the request can't be sent until it's removed or the date changes.
- **If Supabase can't be reached** (including if the free project pauses), nothing is blocked and requests go out as before.
- **Owner page (`admin.html`):** sign in with a code emailed to you, tap a day, check the items to book with the customer's name, or tap Unbook. Only emails listed in `private.admins` can see or change bookings. Supabase's built-in email only delivers to members of the Supabase organization, so an owner email must be a team member there (or set up custom email sending).
- **Adding an owner email:** in the Supabase SQL editor, run `insert into private.admins (email) values ('name@example.com');` (lowercase).
- **Adding a new rental:** add it to `RENTALS` in `site.js`, add its `data-pick` button in `services.html`, and add its id to the `item_id` check in `supabase/schema.sql` (then run that file again in the SQL editor). A new package also needs its parts in `PARTS`.
- **Keeping it awake:** Supabase pauses free projects after about a week with little activity. The `Keep calendar awake` GitHub Action looks up booked dates four times a day. If a lookup fails, the run fails and GitHub emails the repository owner; resume the project from the Supabase dashboard. Because this repository is public, GitHub would turn the schedule off after 60 days without commits, so after 45 quiet days the Action commits a dated `.github/keepalive` file.

## Tests

With the site served locally (see Local preview), run the browser checks from `tests/`. They fake Supabase, so they never read or change real bookings:

```sh
cd tests
npm install
npx playwright install chromium   # skip if a Chromium is available; set CHROMIUM_PATH to use it
npm test
```

`booking-flow.js` walks through picking rentals and building a booking request; `calendar-flow.js` covers booked dates on the Rentals and Book pages and the fallback when Supabase is down; `admin-flow.js` covers the owner page (sign-in, booking, unbooking, expired sign-ins); `site-check.js` loads every page, including the owner page signed in and out, at four widths and checks accessibility (axe), failed requests, JS errors, sideways scrolling and that the bottom Book bar never covers the footer. Set `BASE_URL` if the site isn't at http://127.0.0.1:8765, and `CHROMIUM_PATH` to use an installed Chrome instead of downloading one.

## Publication status

GitHub Pages publishes the `main` branch at https://zandstrading1-hash.github.io/bloom-events/, so anything merged to `main` goes live. The repository is public.

The privacy, terms, booking policy, and accessibility pages are review drafts. Confirm the business identity, contact information, domain, rental terms, and actual data handling before public launch. Online sending stays off until a valid form integration is configured; until then, booking requests go out by text or email.

Original supplied media and local review notes are preserved separately and are not included in this repository.
