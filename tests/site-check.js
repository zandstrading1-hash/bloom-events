/* Every page at four widths: accessibility (axe), failed requests, JS errors, sideways scroll, bottom bar over the footer. */
const { chromium } = require('playwright');
// Run with the site served locally (see the README), e.g.
//   python -m http.server 8765 --bind 127.0.0.1   (from the repo root)
//   cd tests && npm install && node site-check.js
// BASE_URL overrides the address; CHROMIUM_PATH points Playwright at a local Chromium.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const fs = require('fs');
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
// Supabase is faked so results don't depend on real bookings: one wall booked on the 20th of next month.
const now = new Date();
const booked = [{ item_id: 'ivory-wall', event_date: `${new Date(now.getFullYear(), now.getMonth() + 1, 20).toISOString().slice(0, 7)}-20` }];
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' }).format(now);
const ownerBooking = { id: 1, status: 'confirmed', customer_id: 1, customer_name: 'Jane Doe', customer_phone: '586-555-0100', customer_email: 'jane@example.com', start_local: `${day}T14:00:00`, end_local: `${day}T21:00:00`, setup_minutes: 120, pickup_minutes: 120, address: '12 Main St, Macomb', venue: null, event_type: 'Wedding', guests: 80, price: 450, deposit_paid: true, notes: null, items: ['bloom-bar', 'ivory-wall'] };
const calendarLib = fs.readFileSync(require('path').join(__dirname, 'node_modules/fullcalendar/index.global.min.js'));
const fakeSupabase = async page => {
  const json = (r, body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('https://cdn.jsdelivr.net/npm/fullcalendar@6.1.21/index.global.min.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: calendarLib }));
  await page.route('https://dwazctmqkrnajqmswtiy.supabase.co/**', r => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/rpc/booked_items')) return json(r, booked);
    if (path.endsWith('/rpc/am_i_admin')) return json(r, true);
    if (path.endsWith('/owner_bookings')) return json(r, [ownerBooking]);
    if (path.endsWith('/settings')) return json(r, [{ setup_minutes: 120, pickup_minutes: 120 }]);
    return json(r, []);
  });
};
(async () => {
  const b = await chromium.launch(launchOpts);
  // The owner app is checked signed out, signed in (calendar), and with the booking form open.
  for (const pg of ['index','services','gallery','about','faq','contact','privacy','terms','booking-policy','accessibility','owner/index','owner/index-signed-in','owner/index-form']) {
    for (const w of [1280, 820, 390, 350]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 800 }, serviceWorkers: 'block' });
      const p = await ctx.newPage();
      await fakeSupabase(p);
      if (pg !== 'owner/index' && pg.startsWith('owner/')) await p.addInitScript(() => localStorage.setItem('bloom-owner-session', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'owner@example.com' })));
      const errs = [];
      p.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
      p.on('pageerror', e => errs.push(e.message));
      await p.goto(`${BASE}/${pg.replace(/-(signed-in|form)$/, '')}.html`, { waitUntil: 'networkidle' });
      if (pg.startsWith('owner/index-')) await p.waitForSelector('.fc-event');
      if (pg === 'owner/index-form') { await p.click('#new-booking'); await p.waitForSelector('#form-dialog[open]'); }
      let axeRes = '';
      if (w === 1280 || w === 390) { await p.addScriptTag({ content: axeSrc }); axeRes = (await p.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => v.id + ' x' + v.nodes.length + ' ' + v.nodes[0].target.join(' ')))).join('; '); }
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const bar = await p.evaluate(() => { const q = document.querySelector('.book-bar'); return !q || getComputedStyle(q).display === 'none' ? 'hidden' : 'shown'; });
      await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); }); await p.waitForTimeout(200);
      const covered = await p.evaluate(() => { const q = document.querySelector('.book-bar'); if (!q || getComputedStyle(q).display === 'none') return false; const last = [...document.querySelectorAll('footer *')].filter(e => e.children.length === 0 && e.textContent.trim()).pop(); return last.getBoundingClientRect().bottom > q.getBoundingClientRect().top; });
      const bad = errs.length || overflow > 0 || covered || axeRes;
      if (bad) process.exitCode = 1;
      console.log((bad ? 'CHECK ' : 'ok    ') + pg + '@' + w, JSON.stringify({ axe: axeRes || undefined, errs: errs.length ? errs : undefined, overflow: overflow || undefined, bar, covered: covered || undefined }));
      await ctx.close();
    }
  }
  await b.close();
})();
