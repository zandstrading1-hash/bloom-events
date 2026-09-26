/* Availability calendar: booked items are marked and blocked, the date carries to the Book page, and booking still works when Supabase can't be reached. */
const { chromium } = require('playwright');
// Run with the site served locally (see the README). Supabase is faked here, so no real bookings are read.
// BASE_URL overrides the address; CHROMIUM_PATH points Playwright at a local Chromium.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const now = new Date();
const D = iso(new Date(now.getFullYear(), now.getMonth() + 1, 15)); // wall + bloom bar booked
const D2 = iso(new Date(now.getFullYear(), now.getMonth() + 1, 16)); // nothing booked
const F = iso(new Date(now.getFullYear(), now.getMonth() + 1, 20)); // every wall booked
const WALLS = ['ivory-wall', 'garden-wall', 'pink-ombre-wall', 'red-rose-wall', 'champagne-wall', 'greenery-wall', 'ivory-texture-wall'];
const ROWS = [{ item_id: 'ivory-wall', event_date: D }, { item_id: 'bloom-bar', event_date: D }, ...WALLS.map(item_id => ({ item_id, event_date: F }))];

// mode: 'ok' answers from ROWS, 'down' fails every lookup, 'slow' answers after 1.5s
const fakeSupabase = async (ctx, mode = 'ok') => {
  const calls = [];
  await ctx.route('**/rest/v1/rpc/booked_items', async route => {
    const req = route.request();
    const { from_date, to_date } = JSON.parse(req.postData());
    calls.push({ from_date, to_date, apikey: req.headers().apikey, auth: req.headers().authorization });
    if (mode === 'down') return route.fulfill({ status: 503, body: '{"message":"paused"}', contentType: 'application/json' });
    if (mode === 'slow') await new Promise(r => setTimeout(r, 1500));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS.filter(r => r.event_date >= from_date && r.event_date <= to_date)) });
  });
  return calls;
};
const smsWatcher = async (ctx, page) => {
  const navs = [];
  const cdp = await ctx.newCDPSession(page); await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation', e => navs.push(e.url));
  return navs;
};

(async () => {
  const b = await chromium.launch(launchOpts);

  /* Rentals page */
  let ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const calls = await fakeSupabase(ctx);
  let p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '/services.html', { waitUntil: 'networkidle' });
  assert(await p.isVisible('#check-date'), 'calendar section shown');
  assert(await p.textContent('#cal-month') === now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), 'opens on this month');
  assert(await p.isDisabled('#cal-prev'), 'cannot go back before this month');
  if (now.getDate() > 1) assert(await p.isDisabled(`[data-date="${iso(new Date(now.getFullYear(), now.getMonth(), 1))}"]`), 'past days disabled');
  assert(calls.length === 1 && calls[0].apikey.startsWith('sb_publishable_') && !calls[0].auth, 'month looked up with the publishable key only');
  await p.click('#cal-next');
  await p.waitForSelector(`[data-date="${F}"].walls-full`);
  assert((await p.getAttribute(`[data-date="${F}"]`, 'aria-label')).endsWith('all flower walls booked'), 'fully booked wall day is marked and labeled');
  assert(!(await p.getAttribute(`[data-date="${D}"]`, 'class')).includes('walls-full'), 'partly booked day is not marked full');

  await p.click(`[data-date="${D}"]`);
  await p.waitForFunction(() => document.getElementById('date-status').textContent.includes('booked'));
  assert(await p.getAttribute(`[data-date="${D}"]`, 'aria-pressed') === 'true', 'chosen day pressed');
  assert((await p.textContent('#date-status')).includes('2 items are booked'), 'status counts 2 booked items: ' + await p.textContent('#date-status'));
  const disabled = id => p.isDisabled(`[data-pick="${id}"]`);
  assert(await disabled('ivory-wall') && await disabled('bloom-bar'), 'booked items cannot be added');
  assert(await disabled('pkg-sweet-setup') && await disabled('pkg-bridal-suite') && await disabled('pkg-full-bloom'), 'packages needing the bloom bar are blocked');
  assert(!(await disabled('greenery-wall')) && !(await disabled('pedestals')) && !(await disabled('sweets-cart')), 'free items still available');
  assert(await p.$eval('[data-pick-card="ivory-wall"]', el => el.classList.contains('is-booked')), 'booked wall card marked');
  assert(await p.$eval('[data-pick-card="pkg-bridal-suite"]', el => el.classList.contains('package')), 'Bridal Suite marker is on the package card');
  assert((await p.textContent('[data-pick="ivory-wall"]')).includes('Booked that day'), 'button says Booked that day');
  assert(await p.evaluate(() => localStorage.getItem('bloom-date')) === D, 'date stored');
  await p.click('[data-pick="greenery-wall"]');
  assert((await p.getAttribute('.nav-cta', 'href')) === `contact.html?picks=greenery-wall&date=${D}`, 'Book link carries picks and date');

  // keyboard: arrow to the next day and choose it
  await p.focus(`[data-date="${D}"]`);
  await p.keyboard.press('ArrowRight');
  assert(await p.evaluate(() => document.activeElement.dataset.date) === D2, 'ArrowRight moves to the next day');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.getElementById('date-status').textContent.startsWith('Everything is free'));
  assert(!(await disabled('ivory-wall')), 'choosing a free day unblocks items');
  await p.keyboard.press('ArrowUp');
  assert(await p.evaluate(() => document.activeElement.dataset.date) === iso(new Date(now.getFullYear(), now.getMonth() + 1, 9)), 'ArrowUp moves back a week');

  // a picked item that turns out to be booked stays removable
  await p.click('[data-pick="ivory-wall"]');
  await p.click(`[data-date="${D}"]`);
  await p.waitForFunction(() => document.querySelector('[data-pick="ivory-wall"]').classList.contains('is-booked'));
  assert(!(await disabled('ivory-wall')) && await p.getAttribute('[data-pick="ivory-wall"]', 'aria-pressed') === 'true', 'picked but booked item can still be tapped to remove');
  await p.click('#date-clear');
  assert(await p.textContent('#date-status') === '' && !(await disabled('bloom-bar')), 'Clear date resets everything');
  assert(await p.evaluate(() => localStorage.getItem('bloom-date')) === null && await p.isHidden('#date-clear'), 'cleared date forgotten, Clear hidden');
  await p.click(`[data-date="${D}"]`);
  await p.waitForFunction(() => document.getElementById('date-status').textContent.includes('booked'));
  assert(calls.length === 2, `each month looked up once (${calls.length} lookups)`);
  assert(!errors.length, 'no page errors: ' + errors.join('; '));
  await ctx.close();

  /* Book page: conflicts block sending until fixed */
  ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await fakeSupabase(ctx);
  p = await ctx.newPage();
  let navs = await smsWatcher(ctx, p);
  await p.goto(`${BASE}/contact.html?picks=ivory-wall,greenery-wall&date=${D}`, { waitUntil: 'networkidle' });
  assert(await p.inputValue('#event_date') === D, 'date carried into the form');
  await p.waitForSelector('#picks-list li.is-booked');
  assert(await p.$eval('#picks-list li[data-id="ivory-wall"]', li => li.classList.contains('is-booked') && !li.querySelector('.pick-taken').hidden), 'booked pick flagged in the list');
  assert(await p.$eval('#picks-list li[data-id="greenery-wall"]', li => !li.classList.contains('is-booked')), 'free pick not flagged');
  assert((await p.textContent('#date-note')).startsWith('Ivory flower wall isn’t available'), 'note explains the conflict: ' + await p.textContent('#date-note'));
  await p.fill('#name', 'Test Person'); await p.fill('#email', 'test@example.com');
  await p.click('.form-submit'); await p.waitForTimeout(500);
  assert(!navs.some(u => u.startsWith('sms:')), 'request with a booked pick is not sent');
  assert(await p.$eval('#event_date', el => el.validity.customError), 'date field reports the conflict');
  await p.click('[data-remove="ivory-wall"]');
  assert((await p.textContent('#date-note')).startsWith('Everything you picked is free'), 'removing the booked pick clears the conflict');
  await p.click('.form-submit'); await p.waitForTimeout(500);
  assert(navs.some(u => u.startsWith('sms:') && decodeURIComponent(u).includes(`Date: ${D}`)), 'request sends once the conflict is fixed');
  // changing the date re-checks: bloom bar is booked on D, free on D2
  await p.goto(`${BASE}/contact.html?picks=bloom-bar`, { waitUntil: 'networkidle' });
  assert(await p.inputValue('#event_date') === D, 'stored date prefilled without a date in the link');
  await p.waitForSelector('#picks-list li.is-booked');
  await p.fill('#event_date', D2); await p.dispatchEvent('#event_date', 'change');
  await p.waitForFunction(() => document.getElementById('date-note').textContent.startsWith('Everything you picked is free'));
  assert(await p.evaluate(() => localStorage.getItem('bloom-date')) === await p.inputValue('#event_date'), 'date typed on the Book page is remembered');
  await ctx.close();

  /* A request sent while the check is still running waits for it */
  ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await fakeSupabase(ctx, 'slow');
  p = await ctx.newPage();
  navs = await smsWatcher(ctx, p);
  await p.goto(`${BASE}/contact.html?picks=ivory-wall`, { waitUntil: 'domcontentloaded' });
  await p.fill('#name', 'Test Person'); await p.fill('#email', 'test@example.com');
  await p.fill('#event_date', D); await p.dispatchEvent('#event_date', 'change');
  await p.click('.form-submit'); await p.waitForTimeout(2200);
  assert(!navs.some(u => u.startsWith('sms:')), 'slow check still blocks a booked pick');
  await ctx.close();

  /* Supabase down: nothing blocked, requests still go out */
  ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await fakeSupabase(ctx, 'down');
  p = await ctx.newPage();
  await p.goto(BASE + '/services.html', { waitUntil: 'networkidle' });
  assert((await p.textContent('#date-status')).startsWith('We couldn’t load availability'), 'Rentals says availability could not load');
  await p.click('#cal-next'); await p.click(`[data-date="${D}"]`);
  await p.waitForFunction(() => document.getElementById('date-status').textContent.startsWith('We couldn’t check'));
  assert(!(await p.isDisabled('[data-pick="ivory-wall"]')), 'nothing blocked when availability is down');
  navs = await smsWatcher(ctx, p);
  await p.goto(`${BASE}/contact.html?picks=ivory-wall&date=${D}`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.getElementById('date-note').textContent.startsWith('We couldn’t check'));
  await p.fill('#name', 'Test Person'); await p.fill('#email', 'test@example.com');
  await p.click('.form-submit'); await p.waitForTimeout(500);
  assert(navs.some(u => u.startsWith('sms:')), 'request still sends when availability is down');
  await ctx.close();

  await b.close();
})();
