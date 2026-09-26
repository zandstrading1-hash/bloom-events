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
const fakeSupabase = async page => {
  await page.route('**/rest/v1/rpc/booked_items', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(booked) }));
  await page.route('**/rest/v1/rpc/am_i_admin', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'true' }));
  await page.route('**/rest/v1/reservations**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
};
(async () => {
  const b = await chromium.launch(launchOpts);
  // "admin-signed-in" is the owner page with a (fake) sign-in, so the bookings view gets checked too.
  for (const pg of ['index','services','gallery','about','faq','contact','privacy','terms','booking-policy','accessibility','admin','admin-signed-in']) {
    for (const w of [1280, 820, 390, 350]) {
      const p = await b.newPage({ viewport: { width: w, height: 800 } });
      await fakeSupabase(p);
      if (pg === 'admin-signed-in') await p.addInitScript(() => localStorage.setItem('bloom-admin-session', JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'owner@example.com' })));
      const errs = [];
      p.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url()); });
      p.on('pageerror', e => errs.push(e.message));
      await p.goto(`${BASE}/${pg.replace('-signed-in', '')}.html`, { waitUntil: 'networkidle' });
      if (pg === 'admin-signed-in') await p.click('.admin-day');
      let axeRes = '';
      if (w === 1280 || w === 390) { await p.addScriptTag({ content: axeSrc }); axeRes = (await p.evaluate(async () => (await axe.run(document, { resultTypes: ['violations'] })).violations.map(v => v.id + ' x' + v.nodes.length + ' ' + v.nodes[0].target.join(' ')))).join('; '); }
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const bar = await p.evaluate(() => { const q = document.querySelector('.book-bar'); return !q || getComputedStyle(q).display === 'none' ? 'hidden' : 'shown'; });
      await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); }); await p.waitForTimeout(200);
      const covered = await p.evaluate(() => { const q = document.querySelector('.book-bar'); if (!q || getComputedStyle(q).display === 'none') return false; const last = [...document.querySelectorAll('footer *')].filter(e => e.children.length === 0 && e.textContent.trim()).pop(); return last.getBoundingClientRect().bottom > q.getBoundingClientRect().top; });
      const bad = errs.length || overflow > 0 || covered || axeRes;
      if (bad) process.exitCode = 1;
      console.log((bad ? 'CHECK ' : 'ok    ') + pg + '@' + w, JSON.stringify({ axe: axeRes || undefined, errs: errs.length ? errs : undefined, overflow: overflow || undefined, bar, covered: covered || undefined }));
      await p.close();
    }
  }
  await b.close();
})();
