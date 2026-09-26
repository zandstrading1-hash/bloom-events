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

## Availability calendar and Bloom Bookings

Built: the Rentals page calendar, booked-item blocking on the Rentals and Book pages, the keep-alive GitHub Action, and Bloom Bookings (`owner/`), the owner's home-screen app with times, customers, addresses and lists. See the README for how they work and how to add an account.

- **Supabase project:** `dwazctmqkrnajqmswtiy` ("Bloom Events"), in its own Supabase account (zuhairmikhail12@gmail.com) so it doesn't count against the zandstrading1-hash account's two free projects. The Supabase connector in Claude is connected to the other account, so database changes go through the Supabase dashboard SQL editor.
- **Her login:** her email address is still needed. Create her account in Supabase (see the README), or invite her email to the Supabase organization so "Email me a sign-in link" works for her too.
- **Next (Phase 2):** on the website, customers choose a start and end time and see which items are free then; requests are saved straight into the app as "On hold" and hold their items, expiring after about 3 days unless she confirms (a scheduled database job); a requests inbox with Confirm and Decline; spam limits (a hidden trap field, a couple of pending requests per email or phone).
- **Later (Phase 3):** new-request notifications on her phone, her bookings in her phone's own calendar through a private link, and deposit and payment tracking.
- **Privacy page:** the draft should mention that bookings (customer name, phone, email, event address, date, items, notes) are stored with Supabase.
- **Own domain before launch.** The site shares its address (zandstrading1-hash.github.io) with other sites on the same GitHub account. The owner app's sign-in is stored for that whole address, so a script on any of those sites could read it. Moving Bloom to its own domain (for example bloomevents.com) fixes this; then update Site URL and Redirect URLs in Supabase.

## Logo

- The live logo is the rose-as-"o" wordmark (PR #1). Its generator and the eight other concept directions (A-H) are in `design/logo/`; see `design/README.md`.
- The concept comparison page is also published as a private Claude artifact: https://claude.ai/artifact/QkL8pVcgFDNuHHzoR4tbLb (share it from its Share menu before sending it to anyone).

## Tests

`tests/` has four browser checks: booking flow, availability calendar, the owner app, and every page at four widths with axe. See the Tests section of the README.
