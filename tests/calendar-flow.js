/* Availability with times: the Rentals calendar and time pickers, the Book page check, and requests that are
   saved straight into the owner's app. Also the fallback to text and email when Supabase can't be reached. */
const { chromium } = require('playwright');
// Run with the site served locally (see the README). Supabase is faked here, so no real bookings are read or made.
// BASE_URL overrides the address; CHROMIUM_PATH points Playwright at a local Chromium.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const now = new Date();
const D = iso(new Date(now.getFullYear(), now.getMonth() + 1, 15)); // ivory wall + bloom bar held 12 PM to 11 PM
const F = iso(new Date(now.getFullYear(), now.getMonth() + 1, 20)); // every wall held 10 AM to 8 PM
const G = iso(new Date(now.getFullYear(), now.getMonth() + 1, 22)); // sweets cart held 6 AM to 10 AM
const WALLS = ['ivory-wall', 'garden-wall', 'pink-ombre-wall', 'red-rose-wall', 'champagne-wall', 'greenery-wall', 'ivory-texture-wall'];
const HOLDS = [
  { item_id: 'ivory-wall', busy_from: `${D}T12:00:00`, busy_until: `${D}T23:00:00` },
  { item_id: 'bloom-bar', busy_from: `${D}T12:00:00`, busy_until: `${D}T23:00:00` },
  ...WALLS.map(item_id => ({ item_id, busy_from: `${F}T10:00:00`, busy_until: `${F}T20:00:00` })),
  { item_id: 'sweets-cart', busy_from: `${G}T06:00:00`, busy_until: `${G}T10:00:00` }
];
const w = s => Date.parse(`${s}Z`);
const addDay = day => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// mode: 'ok', 'down' (every call fails), 'slow' (availability answers after 1.5 s)
const fakeSupabase = async (ctx, mode = 'ok') => {
  const s = { log: [], raceItems: [] };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('https://dwazctmqkrnajqmswtiy.supabase.co/**', async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    s.log.push({ path, body, apikey: req.headers().apikey, auth: req.headers().authorization });
    if (mode === 'down') return json(route, 503, { message: 'paused' });
    if (path.endsWith('/rpc/booking_rules')) return json(route, 200, [{ setup_minutes: 120, pickup_minutes: 120 }]);
    if (path.endsWith('/rpc/availability')) {
      if (mode === 'slow') await new Promise(r => setTimeout(r, 1500));
      const [from, until] = [w(`${body.from_date}T00:00:00`), w(`${addDay(body.to_date)}T00:00:00`)];
      return json(route, 200, HOLDS.filter(h => w(h.busy_from) < until && w(h.busy_until) > from));
    }
    if (path.endsWith('/rpc/request_booking')) {
      const r = body.r;
      if (r.email === 'pending@example.com') return json(route, 400, { code: 'P0001', message: 'pending_limit' });
      if (r.email === 'busy@example.com') return json(route, 400, { code: 'P0001', message: 'busy' });
      const start = w(`${r.date}T${r.start}:00`);
      let end = w(`${r.date}T${r.end}:00`);
      if (end <= start) end += 86400000;
      const taken = HOLDS.filter(h => w(h.busy_from) < end + 7200000 && w(h.busy_until) > start - 7200000).map(h => h.item_id).concat(s.raceItems).filter(i => r.items.includes(i));
      if (taken.length) return json(route, 409, { code: '23P01', message: 'Already booked at that time', details: [...new Set(taken)].join(',') });
      return json(route, 200, { hold_until: `${addDay(addDay(addDay(r.date)))}T15:00:00` });
    }
    return json(route, 404, { message: 'no fake' });
  });
  return s;
};
const navWatcher = async (ctx, page) => {
  const navs = [];
  const cdp = await ctx.newCDPSession(page); await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation', e => navs.push(e.url));
  return navs;
};
const requests = s => s.log.filter(l => l.path.endsWith('/rpc/request_booking'));

(async () => {
  const b = await chromium.launch(launchOpts);

  /* Rentals page */
  let ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  let s = await fakeSupabase(ctx);
  let p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '/services.html', { waitUntil: 'networkidle' });
  assert(await p.isVisible('#check-date') && await p.isHidden('#time-pick'), 'calendar shown, time pickers wait for a date');
  assert(await p.textContent('#cal-month') === now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), 'opens on this month');
  assert(await p.isDisabled('#cal-prev'), 'cannot go back before this month');
  if (now.getDate() > 1) assert(await p.isDisabled(`[data-date="${iso(new Date(now.getFullYear(), now.getMonth(), 1))}"]`), 'past days disabled');
  assert(s.log.every(l => l.apikey.startsWith('sb_publishable_') && !l.auth), 'availability read with the publishable key only');
  await p.click('#cal-next');
  await p.waitForSelector(`[data-date="${F}"].walls-full`);
  assert((await p.getAttribute(`[data-date="${F}"]`, 'aria-label')).endsWith('every flower wall has a booking'), 'a day with every wall booked is marked and labeled');
  assert(await p.$eval(`[data-date="${D}"]`, el => el.classList.contains('has-bookings') && !el.classList.contains('walls-full')), 'a day with some bookings gets a dot');
  assert((await p.getAttribute(`[data-date="${D}"]`, 'aria-label')).endsWith('some items have bookings'), 'and says so to screen readers');

  await p.click(`[data-date="${D}"]`);
  await p.waitForFunction(() => document.getElementById('date-status').textContent.includes('bookings that day'));
  assert(await p.isVisible('#time-pick'), 'time pickers appear once a date is chosen');
  assert((await p.textContent('#date-status')).includes('2 items have bookings that day'), 'status counts items with bookings: ' + await p.textContent('#date-status'));
  assert((await p.textContent('[data-pick-card="ivory-wall"] .pick-note')).trim() === 'Taken 12 PM–11 PM', 'item shows when it’s taken');
  assert(!(await p.isDisabled('[data-pick="ivory-wall"]')), 'without times, a partly booked item can still be picked');
  const disabled = id => p.isDisabled(`[data-pick="${id}"]`);
  await p.selectOption('#pick-start', '09:00');
  await p.selectOption('#pick-end', '10:00');
  await p.waitForFunction(() => document.getElementById('date-status').textContent.startsWith('Everything is free'));
  assert(!(await disabled('ivory-wall')) && await p.isHidden('[data-pick-card="ivory-wall"] .pick-note'), 'a morning event before the setup time is free');
  await p.selectOption('#pick-end', '11:00');
  await p.waitForFunction(() => document.getElementById('date-status').textContent.includes('booked at that time'));
  assert(await disabled('ivory-wall') && await disabled('bloom-bar'), 'an event that runs into setup time blocks those items');
  assert(await disabled('pkg-sweet-setup') && await disabled('pkg-bridal-suite') && await disabled('pkg-full-bloom'), 'packages needing the bloom bar are blocked');
  assert(!(await disabled('greenery-wall')) && !(await disabled('sweets-cart')), 'free items still available');
  assert((await p.textContent('[data-pick="ivory-wall"]')).includes('Booked at that time') && await p.isVisible('[data-pick-card="ivory-wall"] .pick-note'), 'blocked item says why');
  assert((await p.textContent('#date-status')).includes('9 AM to 11 AM: 2 items are booked at that time'), 'status names the time: ' + await p.textContent('#date-status'));
  assert(await p.evaluate(() => localStorage.getItem('bloom-time')) === '09:00-11:00', 'times remembered');
  await p.click('[data-pick="greenery-wall"]');
  assert((await p.getAttribute('.nav-cta', 'href')) === `contact.html?picks=greenery-wall&date=${D}&time=09:00-11:00`, 'Book link carries picks, date and times');
  await p.selectOption('#pick-start', '15:00');
  await p.selectOption('#pick-end', '14:00');
  assert((await p.textContent('#date-status')) === 'The end time needs to be after the start time.', 'an end before the start is caught');
  await p.selectOption('#pick-end', '01:00');
  await p.waitForFunction(() => document.getElementById('date-status').textContent.includes('3 PM to 1 AM'));
  assert(await disabled('ivory-wall'), 'an event running past midnight is checked');
  await p.focus(`[data-date="${D}"]`);
  await p.keyboard.press('ArrowRight');
  assert(await p.evaluate(() => document.activeElement.dataset.date) === iso(new Date(now.getFullYear(), now.getMonth() + 1, 16)), 'ArrowRight moves to the next day');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.getElementById('date-status').textContent.startsWith('Everything is free'));
  assert(!(await disabled('ivory-wall')), 'choosing a free day unblocks items');
  await p.click('#date-clear');
  assert(await p.textContent('#date-status') === '' && await p.isHidden('#time-pick'), 'Clear date resets the check');
  assert(!errors.length, 'no page errors: ' + errors.join('; '));
  await ctx.close();

  /* Book page: times, the check, and the request going into the owner's app */
  ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  s = await fakeSupabase(ctx);
  p = await ctx.newPage();
  await p.goto(`${BASE}/contact.html?picks=ivory-wall,greenery-wall&date=${D}&time=15:00-16:00`, { waitUntil: 'networkidle' });
  assert(await p.inputValue('#event_date') === D && await p.inputValue('#event_start') === '15:00' && await p.inputValue('#event_end') === '16:00', 'date and times carried into the form');
  await p.waitForSelector('#picks-list li.is-booked');
  assert((await p.textContent('#picks-list li[data-id="ivory-wall"] .pick-taken')) === 'Taken 12 PM–11 PM', 'taken pick flagged with its times');
  assert((await p.textContent('#date-note')).startsWith('Ivory flower wall isn’t available at that time'), 'note explains the clash');
  await p.fill('#name', 'Test Person');
  await p.fill('#email', 'test@example.com');
  await p.click('.form-submit');
  await p.waitForTimeout(400);
  assert(!requests(s).length && await p.$eval('#event_start', el => el.validity.customError), 'a request with a taken pick isn’t sent');
  await p.click('[data-remove="ivory-wall"]');
  assert((await p.textContent('#date-note')).includes('Everything you picked is free'), 'removing it clears the clash');
  await p.fill('#phone', '586-555-0100');
  await p.fill('#venue', 'Oak Hall');
  await p.fill('#address', '5 Oak St, Macomb');
  await p.fill('#guests', '40');
  await p.selectOption('#event_type', 'Birthday');
  await p.fill('#message', 'Pink please');
  await p.click('.form-submit');
  await p.waitForFunction(() => document.getElementById('form-status').classList.contains('success'));
  const sent = requests(s)[0].body.r;
  assert(sent.name === 'Test Person' && sent.email === 'test@example.com' && sent.phone === '586-555-0100' && sent.date === D && sent.start === '15:00' && sent.end === '16:00' && sent.items.join() === 'greenery-wall' && sent.venue === 'Oak Hall' && sent.address === '5 Oak St, Macomb' && sent.guests === '40' && sent.event_type === 'Birthday' && sent.notes === 'Pink please' && sent.trap === '', 'request sent with everything: ' + JSON.stringify(sent));
  assert((await p.textContent('#form-status')).includes('We’re holding Greenery wall for you until'), 'visitor told their pick is held: ' + await p.textContent('#form-status'));
  assert(await p.inputValue('#name') === '' && await p.evaluate(() => localStorage.getItem('bloom-picks')) === '[]' && await p.evaluate(() => localStorage.getItem('bloom-time')) === null, 'form, picks and times cleared after sending');

  // Packages are held as their parts and named in the notes
  await p.goto(`${BASE}/contact.html?picks=pkg-sweet-setup,garden-wall&date=${G}&time=11:00-13:00`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#picks-list li.is-booked');
  assert((await p.textContent('#date-note')).startsWith('The Sweet Setup package isn’t available'), 'a package with a taken part is flagged');
  await p.selectOption('#event_start', '13:00');
  await p.selectOption('#event_end', '15:00');
  await p.fill('#name', 'Package Person');
  await p.fill('#email', 'pkg@example.com');
  await p.click('.form-submit');
  await p.waitForFunction(() => document.getElementById('form-status').classList.contains('success'));
  const pkg = requests(s).pop().body.r;
  assert(pkg.items.join() === 'bloom-bar,sweets-cart,garden-wall' && pkg.notes === 'Package: The Sweet Setup package', 'package held as its parts and named in the notes: ' + JSON.stringify(pkg));

  // Answers from Supabase: booked meanwhile, too many waiting, too busy
  const fill = async (email, pick = 'pink-ombre-wall') => {
    await p.goto(`${BASE}/contact.html?picks=${pick}&date=${G}&time=13:00-15:00`, { waitUntil: 'networkidle' });
    await p.fill('#name', 'Someone');
    await p.fill('#email', email);
    await p.click('.form-submit');
    await p.waitForFunction(() => document.getElementById('form-status').classList.contains('error'));
    return p.textContent('#form-status');
  };
  s.raceItems = ['pink-ombre-wall'];
  const reads = s.log.filter(l => l.path.endsWith('/rpc/availability')).length;
  assert((await fill('race@example.com')).startsWith('Pink ombre wall was just booked at that time'), 'booked meanwhile is explained');
  await p.waitForTimeout(300);
  assert(s.log.filter(l => l.path.endsWith('/rpc/availability')).length > reads, 'and availability is checked again');
  s.raceItems = [];
  assert((await fill('pending@example.com')).includes('already have two requests waiting'), 'too many waiting requests explained');
  assert((await fill('busy@example.com')).includes('a lot of requests right now'), 'too busy explained');
  await ctx.close();

  /* A request sent while the check is still running waits for it */
  ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  s = await fakeSupabase(ctx, 'slow');
  p = await ctx.newPage();
  await p.goto(`${BASE}/contact.html?picks=ivory-wall`, { waitUntil: 'domcontentloaded' });
  await p.fill('#name', 'Test Person');
  await p.fill('#email', 'test@example.com');
  await p.selectOption('#event_start', '15:00');
  await p.selectOption('#event_end', '16:00');
  await p.fill('#event_date', D);
  await p.dispatchEvent('#event_date', 'change');
  await p.click('.form-submit');
  await p.waitForTimeout(2200);
  assert(!requests(s).length, 'slow check still stops a request with a taken pick');
  await ctx.close();

  /* Supabase down: nothing blocked, and the request can go by text or email */
  ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  s = await fakeSupabase(ctx, 'down');
  p = await ctx.newPage();
  await p.goto(BASE + '/services.html', { waitUntil: 'networkidle' });
  assert((await p.textContent('#date-status')).startsWith('We couldn’t load availability'), 'Rentals says availability could not load');
  await p.click('#cal-next');
  await p.click(`[data-date="${D}"]`);
  await p.waitForFunction(() => document.getElementById('date-status').textContent.startsWith('We couldn’t check'));
  assert(!(await p.isDisabled('[data-pick="ivory-wall"]')), 'nothing blocked when availability is down');
  const navs = await navWatcher(ctx, p);
  await p.goto(`${BASE}/contact.html?picks=ivory-wall&date=${D}&time=15:00-16:00`, { waitUntil: 'networkidle' });
  assert(await p.isHidden('#book-alt'), 'text and email options stay out of the way until needed');
  await p.fill('#name', 'Test Person');
  await p.fill('#email', 'test@example.com');
  await p.click('.form-submit');
  await p.waitForFunction(() => document.getElementById('form-status').textContent.includes('couldn’t be sent online'));
  assert(await p.isVisible('#book-alt'), 'offered text or email when the request can’t be sent online');
  await p.click('#send-text');
  await p.waitForTimeout(400);
  const sms = decodeURIComponent(navs.find(u => u.startsWith('sms:')) || '');
  assert(sms.includes(`Date: ${D}`) && sms.includes('Time: 3 PM to 4 PM') && sms.includes('Picks: Ivory flower wall'), 'text message filled with the request');
  await ctx.close();

  await b.close();
})();
