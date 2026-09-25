# Next steps

Where the Bloom Events site stands and what is still open, as of September 25, 2026.

## Waiting on the owner

These need real answers; nothing on the site should be guessed.

1. **Web3Forms access key.** The Book page (`contact.html`) is wired for Web3Forms. Until a key is added to the hidden `access_key` field, "Send by text" opens the visitor's messages app (or email) with the request filled in. The key is free at web3forms.com and is created with the business email.
2. **Contact details.** Confirm (586) 360-4200, hello@bloomevents.com and the bloomevents.com domain. Every booking request, the footer and the policy pages use them.
3. **Social accounts.** The homepage structured data lists instagram.com/bloomevents and tiktok.com/@bloomevents, but no social links are shown. Confirm the real handles before linking them.
4. **Reviews.** A reviews section would help, but only with real client reviews.
5. **Pedestal photos.** Captions on the homepage and gallery say "Retouched reference" and "reference". If these are Bloom's own pedestals, remove the labels; if they are stock photos, replace them.
6. **Policy drafts.** Privacy, terms, booking and accessibility pages still show "For owner review" boxes. Deposit, refund and damage terms need confirming before launch.

## Availability calendar (planned, not built)

Goal: the site shows which walls and rentals are already booked on a date, won't let a booked item be requested for that date, and gives the owner a simple page to mark bookings.

**Blocked on:** a Supabase project. Creating "Bloom Events" failed because the connected Supabase account (owner zandstrading1-hash, organization "Greaseboard", free plan) already has the maximum of 2 active free projects; only one of them (Greaseboard) is visible to the connector. Pausing or deleting an unused free project frees a slot. Putting the tables in the Greaseboard project was ruled out to keep the client's data separate.

**Planned design**

- Table `reservations`: `item_id text` (same ids as `RENTALS` in `site.js`), `event_date date`, `customer text`, `note text`, `created_at`. Unique on `(item_id, event_date)` so an item can't be booked twice on one day. RLS on, no public access.
- Function `booked_items(from_date, to_date)`, `security definer`, returns only `item_id, event_date`, granted to `anon`. Customer names never leave the database.
- Table `admins (user_id)`; insert/update/delete policies on `reservations` only for users listed there. Also turn off public sign-ups in Supabase Auth.
- Packages depend on single items: The Sweet Setup needs bloom-bar + sweets-cart, The Bridal Suite needs bloom-bar (plus a wall picked separately), The Full Bloom needs bloom-bar + pedestals + sweets-cart.
- **Rentals page:** a month calendar above the walls. Picking a date marks booked items "Booked that day" and disables their buttons; days with every wall booked are greyed out. The chosen date carries to the Book page.
- **Book page:** when the date changes, check the picks and flag any that are booked, with a prompt to remove them or change the date.
- **Owner page** (`admin.html`, `noindex`): email sign-in, then a month view per item; tap a day to mark it booked (with the customer's name) or free it again.
- The site reads availability with a plain `fetch` to the Supabase REST API using the publishable key (safe to ship in the page). If Supabase is unreachable, including when a free project pauses after a week without traffic, the site falls back to today's behavior: requests go through and the owner confirms by reply.

## Logo

- The live logo is the rose-as-"o" wordmark (PR #1). Its generator and the eight other concept directions (A-H) are in `design/logo/`; see `design/README.md`.
- The concept comparison page is also published as a private Claude artifact: https://claude.ai/artifact/QkL8pVcgFDNuHHzoR4tbLb (share it from its Share menu before sending it to anyone).

## Tests

`tests/` has two browser checks (booking flow; every page at four widths with axe). See the Tests section of the README.
