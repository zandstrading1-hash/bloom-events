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

## Availability calendar

Built: the Rentals page calendar, booked-item blocking on the Rentals and Book pages, the owner page (`admin.html`) and the keep-alive GitHub Action. See the Availability calendar section of the README for how it works and how to add an owner email or a new rental.

- **Supabase project:** `dwazctmqkrnajqmswtiy` ("Bloom Events"), in its own Supabase account so it doesn't count against the zandstrading1-hash account's two free projects. The Supabase connector in Claude is still connected to the other account, so database changes go through the Supabase dashboard (SQL editor), not the connector.
- **Owner sign-in:** codes are sent by Supabase's built-in email, which only delivers to members of the project's Supabase organization and allows 2 emails an hour. For a different owner email, invite it to the organization or set up custom SMTP.
- **No automatic buffer days.** If a wall needs the day before or after for delivery and pickup, the owner marks those days too. Ask the owner whether that should be automatic.
- **Privacy page:** the draft should mention that confirmed bookings (customer name, date, items, notes) are stored with Supabase.

## Logo

- The live logo is the rose-as-"o" wordmark (PR #1). Its generator and the eight other concept directions (A-H) are in `design/logo/`; see `design/README.md`.
- The concept comparison page is also published as a private Claude artifact: https://claude.ai/artifact/QkL8pVcgFDNuHHzoR4tbLb (share it from its Share menu before sending it to anyone).

## Tests

`tests/` has four browser checks: booking flow, availability calendar, owner page, and every page at four widths with axe. See the Tests section of the README.
