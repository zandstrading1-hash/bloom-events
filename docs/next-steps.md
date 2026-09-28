# Next steps

Where the Bloom Events site stands and what is still open, as of September 27, 2026.

## Waiting on the owner

These need real answers; nothing on the site should be guessed.

1. **Web3Forms access key.** The Book page (`contact.html`) is wired for Web3Forms. Until a key is added to the hidden `access_key` field, "Send by text" opens the visitor's messages app (or email) with the request filled in. The key is free at web3forms.com and is created with the business email.
2. **Contact details.** Confirm (586) 360-4200, hello@bloomevents.com and the bloomevents.com domain. Every booking request, the footer and the policy pages use them.
3. **Social accounts.** The homepage structured data lists instagram.com/bloomevents and tiktok.com/@bloomevents, but no social links are shown. Confirm the real handles before linking them.
4. **Reviews.** A reviews section would help, but only with real client reviews.
5. **Neon signs and prices.** The nine signs can be booked like the walls (one of each), and every booking is priced from the catalog automatically. Confirm the prices (walls $450 each, neon signs $125, the package savings) since they now set each booking's price; custom-wording signs are still arranged through the notes. The supplied grids give about 360×450 px per photo, so the original photos would look sharper on large screens.
6. **Pedestal photos.** Captions on the homepage and gallery say "Retouched reference" and "reference". If these are Bloom's own pedestals, remove the labels; if they are stock photos, replace them.
7. **Policy drafts.** Privacy, terms, booking and accessibility pages still show "For owner review" boxes. Deposit, refund and damage terms need confirming before launch.

## Availability calendar and Bloom Bookings

Built: the Rentals page calendar, booked-item blocking on the Rentals and Book pages, the keep-alive GitHub Action, and Bloom Bookings (`owner/`), the owner's home-screen app with times, customers, addresses and lists. See the README for how they work and how to add an account.

- **Supabase project:** `dwazctmqkrnajqmswtiy` ("Bloom Events"), in its own Supabase account (zuhairmikhail12@gmail.com) so it doesn't count against the zandstrading1-hash account's two free projects. The Supabase connector in Claude is connected to the other account, so database changes go through the Supabase dashboard SQL editor.
- **Her login:** her email address is still needed. Create her account in Supabase (see the README), or invite her email to the Supabase organization so "Email me a sign-in link" works for her too.
- **Built (Phase 2):** customers choose a date and event times and see what's free then; requests are saved straight into the app as "On hold", hold their items for 72 hours (changeable) unless she confirms or declines, and then expire; a Requests list with Confirm and Decline and a count on the Bookings tab; spam limits (a hidden trap field, two waiting requests per email or phone, ten website requests an hour, thirty a day, thirty waiting at once) and "Decline all". If spam ever gets through anyway, add a CAPTCHA (Cloudflare Turnstile is free) checked in `request_booking`.
- **Built (Phase 3):** an alert on her phone for every new website request (Web Push from the `bloom-bookings` edge function, retried for a day if it can't go out), a count of waiting requests on the app icon, and her confirmed bookings and holds in her phone's Calendar app through a private link she can replace. Each phone turns alerts on once: open the app from the Home Screen, More, "Turn on alerts", allow, then "Send a test alert".
- **Next:** deposit and payment tracking (taking payments online needs a Stripe account in the business's name), and a reminder alert before a request's hold runs out if she'd find it useful.
- **Privacy page:** the draft should mention that booking requests and bookings (customer name, phone, email, event address, date and times, items, notes) are stored with Supabase, and that the owner's alerts and calendar show them on her phone (alerts are encrypted end to end; a subscribed calendar is kept by her phone's calendar service).
- **Own domain before launch.** The site shares its address (zandstrading1-hash.github.io) with other sites on the same GitHub account. The owner app's sign-in is stored for that whole address, so a script on any of those sites could read it. Moving Bloom to its own domain (for example bloomevents.com) fixes this; then update Site URL and Redirect URLs in Supabase.

## Logo

- The live logo is the owner's own (September 2026): white script "Bloom" with a lily on pink. `design/logo/build_supplied.py` builds the site and owner-app files from it. The earlier rose-as-"o" wordmark and the eight concept directions (A-H) stay in `design/logo/` for reference; see `design/README.md`.
- The concept comparison page is also published as a private Claude artifact: https://claude.ai/artifact/QkL8pVcgFDNuHHzoR4tbLb (share it from its Share menu before sending it to anyone).

## Tests

`tests/` has four browser checks: booking flow, availability calendar, the owner app, and every page at four widths with axe. See the Tests section of the README.
