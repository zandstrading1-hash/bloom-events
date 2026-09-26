/* Owner bookings page: emailed-link sign-in, month view, booking and unbooking, non-admin and expired sign-ins. */
const { chromium } = require('playwright');
// Run with the site served locally (see the README). Supabase is faked here, so no real bookings change.
// BASE_URL overrides the address; CHROMIUM_PATH points Playwright at a local Chromium.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const DAY = iso(new Date(now.getFullYear(), now.getMonth(), 20));
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
// Supabase access tokens are JWTs; the page reads the email from the middle part.
const TOKEN1 = ['{"alg":"HS256"}', '{"email":"owner@example.com"}', 'sig'].map(p => Buffer.from(p).toString('base64url')).join('.');

const fakeSupabase = async (ctx, { admin = true, refreshOk = true } = {}) => {
  const log = [];
  let rows = [{ id: 7, item_id: 'ivory-wall', event_date: DAY, customer: 'Jane Doe', note: 'Pink palette' }];
  await ctx.route('**/auth/v1/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    log.push({ path: url.pathname + url.search, body: req.postData() });
    if (url.pathname.endsWith('/otp')) return json(route, 200, {});
    if (url.pathname.endsWith('/token')) return refreshOk ? json(route, 200, { access_token: 'token-2', refresh_token: 'refresh-2', expires_in: 3600 }) : json(route, 400, { error_description: 'Invalid Refresh Token' });
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
    return json(route, 404, {});
  });
  await ctx.route('**/rest/v1/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    log.push({ path: url.pathname + url.search, method: req.method(), body: req.postData(), auth: req.headers().authorization, apikey: req.headers().apikey });
    if (req.headers().authorization !== `Bearer ${TOKEN1}` && req.headers().authorization !== 'Bearer token-2') return json(route, 401, { message: 'JWT expired' });
    if (url.pathname.endsWith('/rpc/am_i_admin')) return json(route, 200, admin);
    if (req.method() === 'GET') return json(route, 200, rows.filter(r => r.event_date >= url.searchParams.getAll('event_date')[0].slice(4) && r.event_date <= url.searchParams.getAll('event_date')[1].slice(4)));
    if (req.method() === 'POST') { let next = 100; JSON.parse(req.postData()).forEach(r => rows.push({ id: next++, ...r })); return route.fulfill({ status: 201 }); }
    if (req.method() === 'DELETE') { const id = Number(url.searchParams.get('id').slice(3)); rows = rows.filter(r => r.id !== id); return route.fulfill({ status: 204 }); }
    return json(route, 405, {});
  });
  return log;
};

(async () => {
  const b = await chromium.launch(launchOpts);

  /* Sign in and manage a day */
  let ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  let log = await fakeSupabase(ctx);
  let p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
  assert(await p.getAttribute('meta[name="robots"]', 'content') === 'noindex, nofollow', 'owner page hidden from search engines');
  assert(await p.isVisible('#link-request') && await p.isHidden('#bookings'), 'starts at sign-in');
  await p.fill('#admin-email', ' Owner@Example.com ');
  await p.click('#link-request .form-submit');
  await p.waitForSelector('#link-sent', { state: 'visible' });
  const otp = log.find(l => l.path.includes('/otp'));
  assert(otp && JSON.parse(otp.body).email === 'owner@example.com', 'link requested for the trimmed, lowercased email');
  assert(otp.path.includes(`redirect_to=${encodeURIComponent(BASE + '/admin.html')}`), 'link returns to this page: ' + otp.path);
  assert(await p.textContent('#link-email') === 'owner@example.com', 'shows where the link went');
  // the emailed link comes back with the sign-in after the #, as a fresh page load
  await p.goto('about:blank');
  await p.goto(`${BASE}/admin.html#access_token=${TOKEN1}&expires_at=${Math.floor(Date.now() / 1000) + 3600}&expires_in=3600&refresh_token=refresh-1&token_type=bearer&type=magiclink`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#admin-calendar', { state: 'visible' });
  assert(await p.textContent('#signed-in-email') === 'owner@example.com', 'signed in from the link');
  assert(!(await p.evaluate(() => location.hash)), 'sign-in removed from the address bar');
  const reads = log.filter(l => l.method === 'GET');
  assert(reads.length && reads.every(l => l.auth === `Bearer ${TOKEN1}` && l.apikey.startsWith('sb_publishable_')), 'bookings read with the owner’s sign-in');
  assert(await p.textContent(`[data-date="${DAY}"] .admin-count`) === '1', 'day shows 1 booked item');
  await p.click(`[data-date="${DAY}"]`);
  const booked = await p.textContent('#day-items li.is-booked');
  assert(booked.includes('Ivory flower wall') && booked.includes('Booked for Jane Doe. Pink palette') && booked.includes('Unbook'), 'booked item shows customer and note: ' + booked);
  assert(await p.$$eval('#day-items input[type="checkbox"]', els => els.length) === 9, 'the 9 free items can be checked');
  await p.check('#day-items input[value="bloom-bar"]');
  await p.check('#day-items input[value="sweets-cart"]');
  await p.fill('#booking-customer', 'Maria <b>Lopez</b>');
  await p.click('#book-form .form-submit');
  await p.waitForFunction(() => document.getElementById('bookings-status').textContent.startsWith('Booked'));
  const post = log.find(l => l.method === 'POST' && l.path.endsWith('/reservations'));
  assert(JSON.stringify(JSON.parse(post.body)) === JSON.stringify([{ item_id: 'bloom-bar', event_date: DAY, customer: 'Maria <b>Lopez</b>', note: null }, { item_id: 'sweets-cart', event_date: DAY, customer: 'Maria <b>Lopez</b>', note: null }]), 'booking saved for both items');
  await p.waitForFunction(day => document.querySelector(`[data-date="${day}"] .admin-count`)?.textContent === '3', DAY);
  assert(await p.$$eval('#day-items li.is-booked', els => els.length) === 3, 'day refreshed with 3 booked');
  assert((await p.textContent('#day-items')).includes('Booked for Maria <b>Lopez</b>') && !(await p.$('#day-items b')), 'customer names shown as text, not HTML');
  p.once('dialog', d => d.accept());
  await p.click('#day-items [aria-label="Unbook Ivory flower wall"]');
  await p.waitForFunction(() => document.getElementById('bookings-status').textContent.includes('is free again'));
  assert(log.some(l => l.method === 'DELETE' && l.path.endsWith('/reservations?id=eq.7')), 'unbooking deletes that booking');
  p.once('dialog', d => d.dismiss());
  const deletes = log.filter(l => l.method === 'DELETE').length;
  await p.click('#day-items [aria-label="Unbook Bloom bar"]');
  await p.waitForTimeout(300);
  assert(log.filter(l => l.method === 'DELETE').length === deletes, 'cancelling the confirmation keeps the booking');
  await p.click('#admin-next');
  await p.waitForFunction(() => document.getElementById('admin-month').textContent !== '');
  assert(log.filter(l => l.method === 'GET').pop().path.includes(`gte.${iso(new Date(now.getFullYear(), now.getMonth() + 1, 1))}`), 'next month loads its bookings');
  // reload keeps the sign-in
  await p.reload({ waitUntil: 'networkidle' });
  assert(await p.isVisible('#admin-calendar'), 'still signed in after reload');
  await p.click('#sign-out');
  assert(await p.isVisible('#link-request') && await p.evaluate(() => localStorage.getItem('bloom-admin-session')) === null, 'sign out clears the session');
  assert(!errors.length, 'no page errors: ' + errors.join('; '));
  await ctx.close();

  /* Expired or used link */
  ctx = await b.newContext();
  await fakeSupabase(ctx);
  p = await ctx.newPage();
  await p.goto(`${BASE}/admin.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: 'networkidle' });
  assert(await p.isVisible('#link-request') && (await p.textContent('#sign-in-status')).includes('expired or was already used'), 'expired link explained');
  await ctx.close();

  /* Email not on the admin list */
  ctx = await b.newContext();
  await fakeSupabase(ctx, { admin: false });
  await ctx.addInitScript(t => localStorage.setItem('bloom-admin-session', JSON.stringify({ access_token: t, refresh_token: 'refresh-1', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'someone@example.com' })), TOKEN1);
  p = await ctx.newPage();
  await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
  assert(await p.isVisible('#not-admin') && await p.isHidden('#admin-calendar'), 'non-admin email gets the not-set-up message');
  await ctx.close();

  /* Expired sign-in: refreshed when possible, otherwise back to sign-in */
  for (const refreshOk of [true, false]) {
    ctx = await b.newContext();
    log = await fakeSupabase(ctx, { refreshOk });
    await ctx.addInitScript(() => localStorage.setItem('bloom-admin-session', JSON.stringify({ access_token: 'old', refresh_token: 'refresh-1', expires_at: Math.floor(Date.now() / 1000) - 10, email: 'owner@example.com' })));
    p = await ctx.newPage();
    await p.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
    if (refreshOk) assert(await p.isVisible('#admin-calendar') && log.some(l => l.auth === 'Bearer token-2'), 'expired token refreshed silently');
    else assert(await p.isVisible('#link-request') && (await p.textContent('#sign-in-status')).includes('expired'), 'failed refresh returns to sign-in with a message');
    await ctx.close();
  }

  await b.close();
})();
