/* Owner app (owner/): sign-in, calendar, booking form with conflicts, lists, customers, settings, password, phone alerts,
   the calendar link and home-screen install. */
const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');
// Run with the site served locally (see the README). Supabase is faked in memory, so no real bookings change.
// BASE_URL overrides the address; CHROMIUM_PATH points Playwright at a local Chromium.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const CALENDAR_LIB = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.21/index.global.min.js';
const calendarLib = fs.readFileSync(require('path').join(__dirname, 'node_modules/fullcalendar/index.global.min.js'));

const detroitToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' }).format(new Date());
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = detroitToday();
const DAY = addDays(TODAY, 3);
const PAST = addDays(TODAY, -20);
const LATER = addDays(TODAY, 10);
const w = s => Date.parse(`${s}Z`);
const jwt = email => ['{"alg":"HS256"}', JSON.stringify({ email }), 'sig'].map(p => Buffer.from(p).toString('base64url')).join('.');
const TOKEN = jwt('owner@example.com');
// The public key phones subscribe with: a real P-256 point, as the edge function hands out.
const ALERT_KEY = crypto.createECDH('prime256v1').generateKeys().toString('base64url');

// Catalog prices and packages as in supabase/schema.sql, and the same pricing rule as booking_quote().
const PRICES = { 'ivory-wall': 450, 'garden-wall': 450, 'pink-ombre-wall': 450, 'red-rose-wall': 450, 'champagne-wall': 450, 'greenery-wall': 450, 'ivory-texture-wall': 450,
  'bloom-bar': 350, 'pedestals': 275, 'sweets-cart': 325 };
['mr-and-mrs', 'happy-birthday', 'christening-day', 'congratulations', 'oh-baby', 'better-together', 'just-married', 'engaged', 'congrats'].forEach(s => { PRICES[`neon-${s}`] = 125; });
const PACKAGES = [
  { id: 'pkg-sweet-setup', name: 'The Sweet Setup package', parts: ['bloom-bar', 'sweets-cart'], needs_wall: false, saving: 75 },
  { id: 'pkg-bridal-suite', name: 'The Bridal Suite package', parts: ['bloom-bar'], needs_wall: true, saving: 80 },
  { id: 'pkg-full-bloom', name: 'The Full Bloom package', parts: ['bloom-bar', 'pedestals', 'sweets-cart'], needs_wall: true, saving: 150 }
];
const quote = (items, packages = []) => {
  let pool = [...new Set(items)].filter(i => i in PRICES);
  if (!pool.length) return null;
  let total = pool.reduce((sum, i) => sum + PRICES[i], 0);
  for (const pk of PACKAGES.filter(p => packages.includes(p.id)).sort((a, b) => b.saving - a.saving)) {
    if (!pk.parts.every(i => pool.includes(i))) continue;
    const wall = pk.needs_wall ? Object.keys(PRICES).find(i => i.endsWith('-wall') && pool.includes(i)) : null;
    if (pk.needs_wall && !wall) continue;
    pool = pool.filter(i => !pk.parts.includes(i) && i !== wall);
    total -= pk.saving;
  }
  return Math.max(total, 0);
};

// A small in-memory stand-in for the Supabase API, with the same rules as supabase/schema.sql.
const fakeSupabase = async (ctx, { admin = true, refreshOk = true, extra = [] } = {}) => {
  const s = {
    customers: [
      { id: 1, name: 'Jane Doe', phone: '586-555-0100', email: 'jane@example.com', notes: 'Prefers texts', created_at: '2026-01-05T15:00:00Z' },
      { id: 2, name: 'Maria Lopez', phone: '586-555-0199', email: null, notes: null, created_at: '2026-02-01T15:00:00Z' }
    ],
    bookings: [
      { id: 10, customer_id: 1, status: 'confirmed', start_local: `${DAY}T14:00:00`, end_local: `${DAY}T21:00:00`, setup_minutes: 120, pickup_minutes: 120, address: '12 Main St, Macomb', venue: 'Palazzo Grande', event_type: 'Wedding', guests: 120, price: 450, deposit_paid: true, notes: 'Pink and ivory', items: ['ivory-wall', 'bloom-bar'] },
      { id: 11, customer_id: 2, status: 'confirmed', start_local: `${PAST}T10:00:00`, end_local: `${PAST}T15:00:00`, setup_minutes: 60, pickup_minutes: 60, address: null, venue: null, event_type: 'Birthday', guests: null, price: null, deposit_paid: false, notes: null, items: ['sweets-cart'] },
      { id: 12, customer_id: 2, status: 'cancelled', start_local: `${LATER}T10:00:00`, end_local: `${LATER}T12:00:00`, setup_minutes: 60, pickup_minutes: 60, address: null, venue: null, event_type: null, guests: null, price: null, deposit_paid: false, notes: null, items: ['pedestals'] }
    ],
    settings: { setup_minutes: 120, pickup_minutes: 120, hold_hours: 72 },
    raceItems: [],
    phones: new Map(),
    tests: [],
    calendarToken: null,
    quoteDelay: 0,
    packagesFail: false,
    log: [],
    next: 100
  };
  s.bookings.push(...extra);
  const isActive = b => b.status === 'requested' || b.status === 'confirmed';
  const held = b => [w(b.start_local) - b.setup_minutes * 60000, w(b.end_local) + b.pickup_minutes * 60000];
  const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];
  const bookingView = b => { const c = s.customers.find(x => x.id === b.customer_id) || {}; return { source: 'owner', created_at: '2026-09-01T12:00:00Z', hold_until: null, packages: [], ...b, customer_name: c.name ?? null, customer_phone: c.phone ?? null, customer_email: c.email ?? null, items: [...b.items].sort(), item_price: quote(b.items, b.packages || []) }; };
  const customerView = c => { const mine = s.bookings.filter(b => b.customer_id === c.id && isActive(b)); return { ...c, booking_count: mine.length, latest_event_local: mine.map(b => b.start_local).sort().pop() || null }; };
  const proposed = ({ date, start, end, setup, pickup }) => {
    const startLocal = `${date}T${start}:00`;
    const endLocal = `${end <= start ? addDays(date, 1) : date}T${end}:00`;
    return { startLocal, endLocal, held: [w(startLocal) - setup * 60000, w(endLocal) + pickup * 60000] };
  };
  const conflicts = (p, exclude) => s.bookings.filter(b => isActive(b) && b.id !== exclude && overlap(held(b), p.held));
  const select = (rows, params) => {
    for (const [key, value] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
      if (key === 'or') {
        const parts = value.slice(1, -1).split(',').map(p => p.split('.ilike.'));
        rows = rows.filter(r => parts.some(([col, pat]) => String(r[col] ?? '').toLowerCase().includes(pat.replace(/\*/g, '').toLowerCase())));
        continue;
      }
      const [op, ...rest] = value.split('.');
      const arg = rest.join('.');
      const cmp = v => (typeof v === 'number' ? Number(arg) : arg);
      rows = rows.filter(r => {
        const v = r[key];
        if (op === 'eq') return String(v) === arg;
        if (op === 'in') return arg.slice(1, -1).split(',').includes(v);
        if (op === 'lt') return v < cmp(v);
        if (op === 'gt') return v > cmp(v);
        if (op === 'gte') return v >= cmp(v);
        if (op === 'lte') return v <= cmp(v);
        return true;
      });
    }
    const order = params.get('order');
    if (order) {
      const [col, dir] = order.split(',')[0].split('.');
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    const offset = Number(params.get('offset') || 0);
    return rows.slice(offset, params.has('limit') ? offset + Number(params.get('limit')) : undefined);
  };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });

  await ctx.route(CALENDAR_LIB, route => route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: calendarLib }));
  await ctx.route('https://dwazctmqkrnajqmswtiy.supabase.co/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const auth = req.headers().authorization;
    s.log.push({ method: req.method(), path, search: url.search, body, auth, apikey: req.headers().apikey });
    if (path === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        return body.email === 'owner@example.com' && body.password === 'right-password'
          ? json(route, 200, { access_token: TOKEN, refresh_token: 'refresh-1', expires_in: 3600, user: { email: body.email } })
          : json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      return refreshOk ? json(route, 200, { access_token: 'token-2', refresh_token: 'refresh-2', expires_in: 3600 }) : json(route, 400, { error_description: 'Invalid Refresh Token' });
    }
    if (path === '/auth/v1/otp') return json(route, 200, {});
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (path === '/functions/v1/bloom-bookings/key' && req.method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ publicKey: ALERT_KEY }) });
    if (auth !== `Bearer ${TOKEN}` && auth !== 'Bearer token-2') return json(route, 401, { message: 'JWT expired' });
    if (path === '/auth/v1/user') return json(route, 200, { email: 'owner@example.com' });
    if (path === '/rest/v1/rpc/am_i_admin') return json(route, 200, admin);
    if (path === '/rest/v1/rpc/booking_quote') { if (s.quoteDelay) await new Promise(r => setTimeout(r, s.quoteDelay)); return json(route, 200, quote(body.p_items, body.p_packages)); }
    if (path === '/rest/v1/packages') return s.packagesFail ? json(route, 503, { message: 'Service unavailable' }) : json(route, 200, PACKAGES);
    if (path === '/rest/v1/rpc/save_phone') { s.phones.set(body.p_endpoint, body); return route.fulfill({ status: 204 }); }
    if (path === '/rest/v1/rpc/remove_phone') { s.phones.delete(body.p_endpoint); return route.fulfill({ status: 204 }); }
    if (path === '/rest/v1/rpc/test_phone_alert') { s.tests.push(body.p_endpoint); return json(route, 200, s.phones.has(body.p_endpoint)); }
    if (path === '/rest/v1/rpc/calendar_link') { if (body.p_reset || !s.calendarToken) s.calendarToken = crypto.randomBytes(32).toString('hex'); return json(route, 200, s.calendarToken); }
    if (path === '/rest/v1/rpc/item_conflicts') {
      const p = proposed({ date: body.p_date, start: body.p_start, end: body.p_end, setup: body.p_setup, pickup: body.p_pickup });
      return json(route, 200, conflicts(p, body.p_booking).flatMap(b => b.items.map(item_id => ({ item_id, booking_id: b.id, customer_name: bookingView(b).customer_name, start_local: b.start_local, end_local: b.end_local }))));
    }
    if (path === '/rest/v1/rpc/save_booking') {
      const b = body.b;
      if ((Number(b.form_version) || 1) < 2) return json(route, 400, { code: 'P0001', message: 'This app is out of date. Close it fully and open it again.' });
      const p = proposed({ date: b.date, start: b.start, end: b.end, setup: Number(b.setup_minutes), pickup: Number(b.pickup_minutes) });
      const taken = [...new Set([...conflicts(p, b.id).flatMap(x => x.items), ...s.raceItems])].filter(i => b.items.includes(i));
      if (['requested', 'confirmed'].includes(b.status) && taken.length) return json(route, 409, { code: '23P01', message: 'Already booked at that time', details: taken.join(',') });
      let customerId = b.customer_id;
      const fields = { name: b.customer_name.trim(), phone: b.customer_phone.trim() || null, email: b.customer_email.trim().toLowerCase() || null };
      if (customerId) Object.assign(s.customers.find(c => c.id === customerId), fields);
      else { customerId = s.next++; s.customers.push({ id: customerId, ...fields, notes: null, created_at: new Date().toISOString() }); }
      const row = { customer_id: customerId, status: b.status, start_local: p.startLocal, end_local: p.endLocal, setup_minutes: Number(b.setup_minutes), pickup_minutes: Number(b.pickup_minutes), address: b.address || null, venue: b.venue || null, event_type: b.event_type || null, guests: b.guests ? Number(b.guests) : null, price: b.price === '' ? quote(b.items, b.packages || []) : Number(b.price), packages: b.packages || [], deposit_paid: b.deposit_paid, notes: b.notes || null, items: b.items };
      if (b.id) Object.assign(s.bookings.find(x => x.id === b.id), row); else s.bookings.push({ id: s.next++, ...row });
      return json(route, 200, b.id || s.next - 1);
    }
    if (path === '/rest/v1/owner_bookings') return json(route, 200, select(s.bookings.map(bookingView), url.searchParams));
    if (path === '/rest/v1/owner_customers') return json(route, 200, select(s.customers.map(customerView), url.searchParams));
    if (path === '/rest/v1/customers') {
      if (req.method() === 'GET') return json(route, 200, select(s.customers, url.searchParams));
      if (req.method() === 'POST') { const c = { id: s.next++, ...body, created_at: new Date().toISOString() }; s.customers.push(c); return json(route, 201, [c]); }
      if (req.method() === 'PATCH') { const c = s.customers.find(x => String(x.id) === url.searchParams.get('id').slice(3)); Object.assign(c, body); return json(route, 200, [c]); }
    }
    if (path === '/rest/v1/bookings') {
      const matches = select(s.bookings, url.searchParams);
      if (req.method() === 'DELETE') { s.bookings = s.bookings.filter(x => !matches.includes(x)); return route.fulfill({ status: 204 }); }
      if (req.method() === 'PATCH') {
        if (isActive(body) && matches.some(b => conflicts({ held: held(b) }, b.id).some(x => x.items.some(i => b.items.includes(i))))) return json(route, 409, { code: '23P01', message: 'conflicting key value violates exclusion constraint', details: 'Key conflicts with existing key.' });
        matches.forEach(b => Object.assign(b, body));
        return (req.headers().prefer || '').includes('return=representation') ? json(route, 200, matches) : route.fulfill({ status: 204 });
      }
    }
    if (path === '/rest/v1/settings') {
      if (req.method() === 'PATCH') { Object.assign(s.settings, body); return route.fulfill({ status: 204 }); }
      return json(route, 200, [s.settings]);
    }
    return json(route, 404, { message: `no fake for ${req.method()} ${path}` });
  });
  return s;
};

(async () => {
  const b = await chromium.launch(launchOpts);
  // A phone in Tokyo: every time must still show in Detroit time.
  let ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
  let s = await fakeSupabase(ctx);
  let p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  assert(await p.isVisible('#signin') && await p.isHidden('#shell'), 'starts at sign-in');
  assert(await p.getAttribute('meta[name="robots"]', 'content') === 'noindex, nofollow', 'app hidden from search engines');

  await p.fill('#signin-email', 'owner@example.com');
  await p.fill('#signin-password', 'wrong');
  await p.click('#password-form button');
  await p.waitForFunction(() => document.getElementById('signin-status').textContent.includes('don’t match'));
  assert(true, 'wrong password explained');
  await p.fill('#signin-password', 'right-password');
  await p.click('#password-form button');
  await p.waitForSelector('#shell', { state: 'visible' });
  assert(await p.textContent('#screen-title') === 'Calendar', 'signed in to the calendar');
  assert(s.log.filter(l => l.path.startsWith('/rest/')).every(l => l.auth === `Bearer ${TOKEN}` && l.apikey.startsWith('sb_publishable_')), 'data read with the owner’s sign-in');

  // Calendar
  await p.waitForSelector(`.fc-daygrid-day[data-date="${DAY}"] .fc-event`);
  assert((await p.textContent(`.fc-daygrid-day[data-date="${DAY}"] .fc-event`)).trim() === 'Jane', 'booking appears on its Detroit date in month view, first name on a phone');
  assert(!(await p.$(`.fc-daygrid-day[data-date="${LATER}"] .fc-event`)), 'cancelled bookings stay off the calendar');
  await p.click(`.fc-daygrid-day[data-date="${DAY}"] .fc-event`);
  await p.waitForSelector('#booking-dialog[open]');
  const detail = await p.textContent('#booking-body');
  assert(detail.includes('2 PM – 9 PM') && detail.includes('Setup from 12 PM, pickup by 11 PM'), 'times shown in Detroit time on a Tokyo phone: ' + detail.match(/·[^A-Z]*PM/)?.[0]);
  assert(detail.includes('Ivory flower wall, Bloom bar') && detail.includes('$450.00 · deposit paid') && detail.includes('Palazzo Grande') && detail.includes('120 guests'), 'details show items, price, venue and guests');
  assert((await p.getAttribute('#booking-body a[href^="https://maps.apple.com"]', 'href')).includes(encodeURIComponent('12 Main St, Macomb')), 'address opens in Maps');
  assert(await p.getAttribute('#booking-body a[href^="tel:"]', 'href') === 'tel:5865550100' && await p.getAttribute('#booking-body a[href^="sms:"]', 'href') === 'sms:5865550100', 'call and text buttons use the customer’s number');
  await p.click('#booking-dialog [data-close]');
  await p.click(`.fc-daygrid-day[data-date="${DAY}"] .fc-daygrid-day-top`);
  await p.waitForFunction(() => document.getElementById('agenda-list').textContent.includes('Jane Doe'));
  assert(await p.$eval(`.fc-daygrid-day[data-date="${DAY}"]`, c => c.classList.contains('is-selected')) && !(await p.textContent('#agenda-title')).includes('Today'), 'tapping a day lists its bookings under the calendar');

  // New booking: existing customer, live conflicts, save
  await p.click('#new-booking');
  await p.waitForSelector('#form-dialog[open]');
  assert(await p.inputValue('#f-date') === DAY, 'new booking starts on the chosen day');
  assert(await p.inputValue('#f-setup') === '120' && await p.inputValue('#f-pickup') === '120', 'setup and pickup default from settings');
  await p.fill('#customer-find', 'jan');
  await p.waitForSelector('#customer-finds button');
  await p.click('#customer-finds button');
  assert(await p.isVisible('#picked-customer') && await p.inputValue('#f-name') === 'Jane Doe' && await p.inputValue('#f-phone') === '586-555-0100', 'existing customer picked and filled in');
  await p.fill('#f-start', '10:00');
  await p.fill('#f-end', '13:00');
  await p.waitForFunction(() => document.querySelectorAll('#f-items label.is-taken').length === 2);
  const takenText = await p.textContent('#f-items label.is-taken');
  assert(takenText.includes('Booked 2 PM–9 PM · Jane Doe'), 'items held around that time are marked: ' + takenText);
  assert(await p.isDisabled('#f-items input[value="ivory-wall"]') && !(await p.isDisabled('#f-items input[value="pedestals"]')), 'held items can’t be checked, free ones can');
  await p.click('#booking-form [type="submit"]');
  assert((await p.textContent('#form-status')).includes('Choose at least one item'), 'saving needs an item');
  await p.check('#f-items input[value="pedestals"]');
  await p.check('#f-items input[value="sweets-cart"]');
  await p.fill('#f-address', '40 Hall Rd, Macomb');
  await p.fill('#f-price', '300');
  await p.selectOption('#f-status', 'requested');
  await p.click('#booking-form [type="submit"]');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking saved');
  const saved = s.log.filter(l => l.path === '/rest/v1/rpc/save_booking').pop().body.b;
  assert(saved.customer_id === 1 && saved.date === DAY && saved.start === '10:00' && saved.end === '13:00' && saved.items.join() === 'pedestals,sweets-cart' && saved.address === '40 Hall Rd, Macomb' && saved.price === '300' && saved.status === 'requested' && saved.id === null, 'booking saved with customer, times, items, address, price and hold status');
  assert(await p.isHidden('#form-dialog'), 'form closes after saving');

  // Overnight hint and a booking taken on another device between the check and saving
  await p.click('#new-booking');
  await p.fill('#f-name', 'Race Test');
  await p.fill('#f-date', LATER);
  await p.fill('#f-start', '20:00');
  await p.fill('#f-end', '01:00');
  assert(await p.isVisible('#f-overnight'), 'an end time before the start says it ends the next day');
  await p.fill('#f-end', '20:00');
  assert(await p.isVisible('#f-overnight'), 'the same start and end time reads as 24 hours');
  await p.fill('#f-end', '01:00');
  await p.check('#f-items input[value="greenery-wall"]');
  s.raceItems = ['greenery-wall'];
  await p.click('#booking-form [type="submit"]');
  await p.waitForFunction(() => document.getElementById('form-status').textContent.includes('already booked'));
  assert((await p.textContent('#form-status')) === 'Greenery wall is already booked at that time. Change the time or the items.', 'a clash found while saving is explained with the item name');
  s.raceItems = [];
  await p.click('#form-dialog [data-close]');

  // Bookings list
  await p.click('[data-tab="bookings"]');
  await p.waitForSelector('#booking-list li');
  let names = await p.$$eval('#booking-list .line1', els => els.map(e => e.textContent));
  assert(names.length === 2 && names[0].startsWith('Jane Doe') && names.some(n => n.includes('On hold')), 'upcoming shows both future bookings, with the hold marked: ' + names);
  await p.fill('#booking-search', 'hall rd');
  await p.waitForFunction(() => document.querySelectorAll('#booking-list li').length === 1);
  assert((await p.textContent('#booking-list')).includes('40 Hall Rd'), 'search finds bookings by address');
  await p.fill('#booking-search', '');
  await p.click('[data-list="past"]');
  await p.waitForFunction(() => document.getElementById('booking-list').textContent.includes('Maria Lopez'));
  assert((await p.$$('#booking-list li')).length === 1, 'past shows past bookings');
  await p.click('[data-list="cancelled"]');
  await p.waitForFunction(() => document.getElementById('booking-list').textContent.includes('Cancelled'));
  assert(true, 'cancelled bookings have their own list');

  // Detail actions: restore, cancel, confirm hold, edit, delete
  await p.click('#booking-list button');
  await p.click('#booking-body >> text=Restore booking');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking restored');
  assert(s.bookings.find(x => x.id === 12).status === 'confirmed', 'a cancelled booking can be restored');
  await p.click('[data-list="upcoming"]');
  await p.waitForFunction(() => document.querySelectorAll('#booking-list li').length === 3);
  await p.click('#booking-list li:has-text("On hold") button');
  await p.click('#booking-body >> text=Confirm');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Booking confirmed'));
  assert(s.bookings.find(x => x.customer_id === 1 && x.items.includes('pedestals')).status === 'confirmed', 'a hold can be confirmed');
  await p.click('#booking-list li:has-text("Ivory flower wall") button');
  await p.click('#booking-body >> text=Edit');
  await p.waitForSelector('#form-dialog[open]');
  assert(await p.inputValue('#f-start') === '14:00' && await p.inputValue('#f-end') === '21:00' && await p.isChecked('#f-items input[value="ivory-wall"]') && await p.inputValue('#f-address') === '12 Main St, Macomb', 'edit form is filled in from the booking');
  await p.fill('#f-end', '22:00');
  await p.click('#booking-form [type="submit"]');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking updated');
  const edited = s.log.filter(l => l.path === '/rest/v1/rpc/save_booking').pop().body.b;
  assert(edited.id === 10 && edited.end === '22:00' && edited.customer_id === 1, 'editing saves over the same booking');
  await p.click('#booking-list li:has-text("Ivory flower wall") button');
  await p.click('#booking-body >> text=Cancel booking');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking cancelled');
  assert(s.bookings.find(x => x.id === 10).status === 'cancelled', 'a booking can be cancelled');
  await p.click('[data-list="cancelled"]');
  await p.waitForSelector('#booking-list li:has-text("Ivory flower wall")');
  await p.click('#booking-list li:has-text("Ivory flower wall") button');
  await p.click('#booking-body >> text=Delete');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking deleted');
  assert(!s.bookings.some(x => x.id === 10), 'a booking can be deleted');

  // Customers
  await p.click('[data-tab="customers"]');
  await p.waitForSelector('#customer-list li');
  const people = await p.textContent('#customer-list');
  assert(people.includes('Jane Doe') && people.includes('1 booking') && people.includes('Maria Lopez'), 'customers listed with booking counts');
  await p.click('#customer-list li:has-text("Maria Lopez") button');
  await p.waitForSelector('#customer-dialog[open]');
  const maria = await p.textContent('#customer-body');
  assert(maria.includes('Bookings (2)') && maria.includes('Birthday') === false && maria.includes('Sweets cart') && maria.includes('White pedestals'), 'customer shows their booking history: ' + maria.match(/Bookings \(\d+\)/)?.[0]);
  assert(await p.getAttribute('#customer-body a[href^="tel:"]', 'href') === 'tel:5865550199' && !(await p.$('#customer-body a[href^="mailto:"]')), 'contact buttons only for details they have');
  await p.click('#customer-body >> text=Edit details');
  await p.fill('#customer-body input[type="email"]', 'Maria@Example.com');
  await p.click('#customer-body >> text=Save customer');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Customer saved');
  assert(s.customers.find(c => c.id === 2).email === 'maria@example.com', 'customer details can be edited');
  await p.click('#customer-body >> text=New booking for them');
  await p.waitForSelector('#form-dialog[open]');
  assert(await p.inputValue('#f-name') === 'Maria Lopez' && await p.isVisible('#picked-customer'), 'new booking for a customer starts with them picked');
  await p.click('#form-dialog [data-close]');
  await p.click('#new-customer');
  await p.fill('#customer-body input[type="text"]', 'Nina Park');
  await p.fill('#customer-body input[type="tel"]', '248-555-0111');
  await p.click('#customer-body >> text=Save customer');
  await p.waitForFunction(() => document.getElementById('customer-title').textContent === 'Nina Park');
  assert(s.customers.some(c => c.name === 'Nina Park' && c.phone === '248-555-0111'), 'a customer can be added on their own');
  await p.click('#customer-dialog [data-close]');

  // More: settings, password, sign out
  await p.click('[data-tab="more"]');
  assert(await p.inputValue('#setting-setup') === '120', 'settings loaded');
  await p.fill('#setting-setup', '90');
  await p.click('#settings-form button');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Saved'));
  assert(s.settings.setup_minutes === 90, 'setup time saved');
  await p.click('#new-booking');
  assert(await p.inputValue('#f-setup') === '90', 'new bookings use the new setup time');
  await p.click('#form-dialog [data-close]');
  await p.click('#change-password');
  await p.fill('#new-password', 'blooming-2026');
  await p.fill('#new-password-2', 'blooming-2027');
  await p.click('#password-new-form button[type="submit"]');
  assert((await p.textContent('#password-status')).includes('don’t match'), 'mismatched passwords caught');
  await p.fill('#new-password-2', 'blooming-2026');
  await p.click('#password-new-form button[type="submit"]');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Password saved'));
  assert(s.log.some(l => l.method === 'PUT' && l.path === '/auth/v1/user' && l.body.password === 'blooming-2026'), 'password change sent to Supabase');
  await p.click('#screen-more [data-action="sign-out"]');
  assert(await p.isVisible('#signin') && await p.evaluate(() => localStorage.getItem('bloom-owner-session')) === null, 'sign out clears the session');
  assert(!errors.length, 'no page errors: ' + errors.join('; '));
  await ctx.close();

  /* First time: emailed link, then choose a password */
  ctx = await b.newContext({ serviceWorkers: 'block' });
  s = await fakeSupabase(ctx);
  p = await ctx.newPage();
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.click('.help summary');
  await p.fill('#link-email', 'Owner@Example.com');
  await p.click('#link-form button');
  await p.waitForFunction(() => document.getElementById('signin-status').textContent.includes('Check your email'));
  const otp = s.log.find(l => l.path === '/auth/v1/otp');
  assert(otp.body.email === 'owner@example.com' && otp.search.includes(encodeURIComponent(`${BASE}/owner/`)), 'sign-in link returns to the app');
  assert(otp.body.create_user === false, 'the app never asks Supabase to create an account');
  await p.goto('about:blank');
  await p.goto(`${BASE}/owner/#access_token=${TOKEN}&expires_in=3600&refresh_token=refresh-1&token_type=bearer&type=magiclink`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#password-dialog[open]');
  assert(await p.isVisible('#shell') && !(await p.evaluate(() => location.hash)), 'signed in from the link, sign-in removed from the address');
  assert((await p.textContent('#password-intro')).includes('home screen'), 'asked to choose a password for the app');
  await ctx.close();

  /* Not on the admin list; expired sign-ins */
  ctx = await b.newContext({ serviceWorkers: 'block' });
  await fakeSupabase(ctx, { admin: false });
  await ctx.addInitScript(t => localStorage.setItem('bloom-owner-session', JSON.stringify({ access_token: t, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'someone@example.com' })), TOKEN);
  p = await ctx.newPage();
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  assert(await p.isVisible('#not-admin') && (await p.textContent('#not-admin-email')) === 'someone@example.com', 'an email not on the list gets the not-set-up screen');
  await ctx.close();
  for (const refreshOk of [true, false]) {
    ctx = await b.newContext({ serviceWorkers: 'block' });
    s = await fakeSupabase(ctx, { refreshOk });
    await ctx.addInitScript(() => localStorage.setItem('bloom-owner-session', JSON.stringify({ access_token: 'old', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) - 10, email: 'owner@example.com' })));
    p = await ctx.newPage();
    await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
    if (refreshOk) assert(await p.isVisible('#shell') && s.log.some(l => l.auth === 'Bearer token-2'), 'an expired sign-in refreshes itself');
    else assert(await p.isVisible('#signin') && (await p.textContent('#signin-status')).includes('sign in again'), 'a sign-in that can’t refresh goes back to sign-in');
    await ctx.close();
  }

  /* A busy day on a phone: "+ more" picks the day; declined bookings keep their status when edited */
  const busy = n => ({ id: 200 + n, customer_id: 1, status: 'confirmed', start_local: `${LATER}T0${n}:00:00`, end_local: `${LATER}T0${n}:30:00`, setup_minutes: 0, pickup_minutes: 0, address: null, venue: null, event_type: null, guests: null, price: null, deposit_paid: false, notes: null, items: ['champagne-wall'] });
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  s = await fakeSupabase(ctx, { extra: [busy(1), busy(3), busy(5), { ...busy(7), id: 299, status: 'declined', customer_id: 2 }] });
  await ctx.addInitScript(t => localStorage.setItem('bloom-owner-session', JSON.stringify({ access_token: t, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'owner@example.com' })), TOKEN);
  p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  if (!(await p.$(`.fc-daygrid-day[data-date="${LATER}"]`))) await p.click('.fc-next-button');
  await p.waitForSelector(`.fc-daygrid-day[data-date="${LATER}"] .fc-daygrid-more-link`);
  await p.click(`.fc-daygrid-day[data-date="${LATER}"] .fc-daygrid-more-link`);
  await p.waitForFunction(() => document.querySelectorAll('#agenda-list li').length === 3);
  assert(!(await p.$('.fc-popover')), '"+ more" lists the day underneath instead of opening a popover');
  await p.click('[data-tab="bookings"]');
  await p.click('[data-list="cancelled"]');
  await p.waitForSelector('#booking-list li:has-text("Declined") button');
  await p.click('#booking-list li:has-text("Declined") button');
  await p.click('#booking-body >> text=Edit');
  assert(await p.inputValue('#f-status') === 'declined', 'editing a declined booking keeps it declined');
  await p.fill('#f-name', '   ');
  await p.click('#booking-form [type="submit"]');
  assert((await p.textContent('#form-status')).includes('Enter the customer’s name'), 'a name of only spaces is caught');
  await ctx.close();

  /* Requests from the website: badge, Requests list, confirm and decline, hold setting */
  const request = (id, start, item, extra = {}) => ({ id, customer_id: 2, status: 'requested', source: 'website', created_at: new Date(Date.now() - 2 * 3600000).toISOString(), hold_until: new Date(Date.now() + 70 * 3600000).toISOString(), start_local: `${LATER}T${start}:00`, end_local: `${LATER}T${start.replace(/^\d\d/, h => String(Number(h) + 2).padStart(2, '0'))}:00`, setup_minutes: 120, pickup_minutes: 120, address: '9 Elm St, Warren', venue: null, event_type: 'Birthday', guests: 30, price: null, deposit_paid: false, notes: 'Package: The Sweet Setup package\nPink please', items: [item], ...extra });
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  s = await fakeSupabase(ctx, { extra: [request(300, '12:00', 'garden-wall'), request(301, '16:00', 'red-rose-wall'), request(302, '08:00', 'champagne-wall'), request(303, '08:00', 'pedestals', { source: 'owner', hold_until: null })] });
  await ctx.addInitScript(t => localStorage.setItem('bloom-owner-session', JSON.stringify({ access_token: t, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'owner@example.com' })), TOKEN);
  p = await ctx.newPage();
  p.on('dialog', d => d.accept());
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.getElementById('tab-requests').hidden);
  assert(await p.textContent('#tab-requests') === '3' && (await p.getAttribute('#tab-requests', 'aria-label')) === '3 requests waiting', 'Bookings tab shows 3 website requests waiting (not her own holds)');
  await p.click('[data-tab="bookings"]');
  assert(await p.textContent('#requests-count') === '3', 'the Requests button shows the count too');
  await p.click('[data-list="requests"]');
  await p.waitForFunction(() => document.querySelectorAll('#booking-list li').length === 3);
  assert(!(await p.textContent('#booking-list')).includes('White pedestals') && await p.isVisible('#decline-all'), 'her own holds stay out of Requests; Decline all is offered');
  assert((await p.textContent('#booking-list')).includes('Website request · holding until'), 'requests show how long they’re held');
  await p.click('#booking-list li:has-text("Garden flower wall") button');
  const req = await p.textContent('#booking-body');
  assert(req.includes('Sent from the website on') && req.includes('Holding its items until') && req.includes('Package: The Sweet Setup package'), 'request details show where it came from, the hold and the notes');
  assert(decodeURIComponent(await p.getAttribute('#booking-body a[href^="sms:"]', 'href')).includes('Hi Maria, this is Bloom Events about your booking request for'), 'Text button starts a reply to the customer');
  assert(await p.isVisible('#booking-body button:has-text("Decline")') && !(await p.$('#booking-body button:has-text("Cancel booking")')), 'a website request can be confirmed or declined');
  await p.click('#booking-body button:has-text("Confirm")');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Booking confirmed'));
  const confirmed = s.log.filter(l => l.method === 'PATCH' && l.path === '/rest/v1/bookings').pop();
  assert(confirmed.body.status === 'confirmed' && confirmed.body.hold_until === null && confirmed.search.includes('id=eq.300') && confirmed.search.includes('status=eq.requested'), 'confirming saves it as confirmed and ends the hold, only if still waiting');
  await p.waitForFunction(() => document.getElementById('tab-requests').textContent === '2');
  assert(true, 'the count drops to 2');
  s.bookings.find(x => x.id === 302).status = 'expired';
  await p.click('#booking-list li:has-text("Champagne rose wall") button');
  await p.click('#booking-body button:has-text("Confirm")');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('This request changed'));
  assert(s.bookings.find(x => x.id === 302).status === 'expired', 'a request that expired meanwhile isn’t confirmed by mistake');
  s.bookings.find(x => x.id === 302).status = 'requested';
  await p.click('[data-list="requests"]');
  await p.waitForFunction(() => document.querySelectorAll('#booking-list li').length === 2);
  await p.click('#booking-list li:has-text("Red rose wall") button');
  await p.click('#booking-body button:has-text("Decline")');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Request declined');
  assert(s.log.filter(l => l.method === 'PATCH' && l.path === '/rest/v1/bookings').pop().body.status === 'declined', 'declining saves it as declined');
  await p.waitForFunction(() => document.getElementById('tab-requests').textContent === '1');
  // The badge and the list reload separately; Decline all follows the list.
  await p.waitForFunction(() => document.querySelectorAll('#booking-list li').length === 1);
  assert(await p.isHidden('#decline-all'), 'Decline all only shows when there’s more than one');
  await p.click('[data-list="upcoming"]');
  await p.click('[data-list="requests"]');
  await p.waitForFunction(() => document.querySelectorAll('#booking-list li').length === 1);
  s.bookings.push({ ...request(304, '20:00', 'greenery-wall'), created_at: new Date().toISOString() });
  await p.click('[data-list="upcoming"]');
  await p.click('[data-list="requests"]');
  await p.waitForSelector('#decline-all', { state: 'visible' });
  await p.click('#decline-all');
  await p.waitForFunction(() => document.getElementById('toast').textContent === '2 requests declined');
  assert([302, 304].every(id => s.bookings.find(x => x.id === id).status === 'declined') && s.bookings.find(x => x.id === 303).status === 'requested', 'Decline all declines waiting website requests only');
  await p.waitForFunction(() => document.getElementById('tab-requests').hidden);
  assert((await p.textContent('#booking-empty')).startsWith('No requests waiting'), 'no requests left, and the badge is gone');
  await p.click('[data-tab="more"]');
  assert(await p.inputValue('#setting-hold') === '72', 'hold time setting loaded');
  await p.fill('#setting-hold', '48');
  await p.click('#settings-form button');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Saved'));
  assert(s.settings.hold_hours === 48, 'hold time saved');
  await ctx.close();

  /* Alerts on this phone, the app icon badge, opening Requests from an alert, and the calendar link */
  const signedIn = t => localStorage.setItem('bloom-owner-session', JSON.stringify({ access_token: t, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'owner@example.com' }));
  // Stand-ins for the phone's push subscription and app icon badge; the service worker itself is real.
  const fakePhone = () => {
    window.__badges = [];
    navigator.setAppBadge = n => { window.__badges.push(n); return Promise.resolve(); };
    navigator.clearAppBadge = () => { window.__badges.push(0); return Promise.resolve(); };
    if (!window.PushManager) return;
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/this-phone',
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'C'.repeat(22) } }; },
      unsubscribe() { localStorage.removeItem('fake-subscription'); return Promise.resolve(true); }
    };
    PushManager.prototype.subscribe = function (options) {
      window.__subscribedWith = btoa(String.fromCharCode(...new Uint8Array(options.applicationServerKey)));
      localStorage.setItem('fake-subscription', 'on');
      return Promise.resolve(subscription);
    };
    PushManager.prototype.getSubscription = () => Promise.resolve(localStorage.getItem('fake-subscription') ? subscription : null);
  };
  const until = async (test, ms = 5000) => { const end = Date.now() + ms; while (!test() && Date.now() < end) await new Promise(r => setTimeout(r, 50)); return test(); };
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['notifications', 'clipboard-read', 'clipboard-write'] });
  s = await fakeSupabase(ctx, { extra: [request(310, '12:00', 'garden-wall'), request(311, '16:00', 'red-rose-wall')] });
  await ctx.addInitScript(signedIn, TOKEN);
  await ctx.addInitScript(fakePhone);
  p = await ctx.newPage();
  const alertErrors = [];
  p.on('pageerror', e => alertErrors.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__badges.includes(2));
  assert(true, 'the app icon badge shows the 2 waiting requests');
  await p.click('[data-tab="more"]');
  await p.waitForSelector('#alerts-on', { state: 'visible' });
  assert((await p.textContent('#alerts-text')).startsWith('Get an alert on this phone') && await p.isHidden('#alerts-test') && await p.isHidden('#alerts-off'), 'alerts start off, with a button to turn them on');
  await p.waitForFunction(() => !document.getElementById('calendar-add').disabled);
  assert(s.log.some(l => l.path === '/rest/v1/rpc/calendar_link' && l.body.p_reset === false), 'the calendar link is fetched when More opens');
  assert(s.log.some(l => l.path === '/functions/v1/bloom-bookings/key' && l.method === 'POST' && !l.auth), 'the alert key is fetched before the tap, without the sign-in');
  await p.click('#alerts-on');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Alerts are on'));
  const savedPhone = s.phones.get('https://fcm.googleapis.com/fcm/send/this-phone');
  assert(savedPhone && savedPhone.p_p256dh === 'B'.repeat(87) && savedPhone.p_auth === 'C'.repeat(22), 'turning alerts on saves this phone’s subscription');
  assert(Buffer.from(await p.evaluate(() => window.__subscribedWith), 'base64').toString('base64url') === ALERT_KEY, 'the phone subscribes with the key from the edge function');
  await p.waitForSelector('#alerts-test', { state: 'visible' });
  assert(await p.isHidden('#alerts-on') && await p.isVisible('#alerts-off') && (await p.textContent('#alerts-text')).startsWith('Alerts are on for this phone'), 'then it offers a test and turning them off');
  await p.click('#alerts-test');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Test alert sent'));
  assert(s.tests[0] === 'https://fcm.googleapis.com/fcm/send/this-phone', 'a test goes to this phone');

  // The real service worker shows an alert pushed to it (delivered through DevTools instead of a push service).
  const cdp = await ctx.newCDPSession(p);
  const registrations = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', e => registrations.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  await until(() => registrations.some(r => r.scopeURL === `${BASE}/owner/`));
  const pushed = { title: 'New request: Maria Lopez', body: 'Sat, Oct 2, 2 PM – 6 PM · Garden flower wall', url: './?open=requests', tag: 'request-310', badge: 2 };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(BASE).origin, registrationId: registrations.find(r => r.scopeURL === `${BASE}/owner/`).registrationId, data: JSON.stringify(pushed) });
  let shown = [];
  for (let tries = 0; tries < 100 && !shown.length; tries++) {
    shown = await p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, tag: n.tag, url: n.data && n.data.url })));
    if (!shown.length) await p.waitForTimeout(100);
  }
  assert(shown.length === 1 && shown[0].title === pushed.title && shown[0].body === pushed.body && shown[0].tag === 'request-310' && shown[0].url === './?open=requests', `the service worker shows the pushed alert with its text: ${JSON.stringify(shown)}`);

  // An alert arriving while the app is open refreshes the counts; tapping one opens Requests.
  const counted = () => s.log.filter(l => l.path === '/rest/v1/owner_bookings' && l.search.includes('select=id&status=eq.requested')).length;
  const countedBefore = counted();
  await p.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { refresh: true } })));
  assert(await until(() => counted() > countedBefore), 'an alert arriving while the app is open refreshes the request count');
  await p.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { open: 'requests' } })));
  await p.waitForFunction(() => !document.getElementById('screen-bookings').hidden && document.querySelectorAll('#booking-list li').length === 2);
  assert(await p.getAttribute('[data-list="requests"]', 'aria-pressed') === 'true', 'tapping an alert while the app is open shows the Requests list');
  await p.goto(`${BASE}/owner/?open=requests`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.getElementById('screen-bookings').hidden && document.querySelectorAll('#booking-list li').length === 2);
  assert(await p.getAttribute('[data-list="requests"]', 'aria-pressed') === 'true' && !p.url().includes('open='), 'opening the app from an alert shows the Requests list, and the address is tidied');

  await p.click('[data-tab="more"]');
  await p.waitForSelector('#alerts-off', { state: 'visible' });
  await p.click('#alerts-off');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Alerts are off for this phone.');
  assert(!s.phones.size && await p.evaluate(() => localStorage.getItem('fake-subscription') === null) && await p.isVisible('#alerts-on'), 'turning alerts off forgets the phone and unsubscribes it');

  // Calendar link: copy, add as a subscription, make a new one.
  await p.waitForFunction(() => !document.getElementById('calendar-copy').disabled);
  const feedUrl = token => `https://dwazctmqkrnajqmswtiy.supabase.co/functions/v1/bloom-bookings/calendar/${token}.ics`;
  await p.click('#calendar-copy');
  await p.waitForFunction(() => document.getElementById('calendar-status').textContent.startsWith('Link copied'));
  assert(await p.evaluate(() => navigator.clipboard.readText()) === feedUrl(s.calendarToken), 'Copy puts the private calendar link on the clipboard');
  const oldToken = s.calendarToken;
  await p.click('#calendar-reset');
  await p.waitForFunction(() => document.getElementById('calendar-status').textContent.startsWith('New link made'));
  assert(s.calendarToken !== oldToken && s.log.some(l => l.path === '/rest/v1/rpc/calendar_link' && l.body.p_reset === true), 'Make a new link replaces the code after asking');
  await p.click('#calendar-copy');
  await p.waitForFunction(() => document.getElementById('calendar-status').textContent.startsWith('Link copied'));
  assert(await p.evaluate(() => navigator.clipboard.readText()) === feedUrl(s.calendarToken), 'and the new link is the one copied');
  // Last, because the page hands this link to the phone's Calendar app.
  const navs = [];
  await cdp.send('Page.enable');
  cdp.on('Page.frameRequestedNavigation', e => navs.push(e.url));
  await p.click('#calendar-add');
  assert(await until(() => navs.length > 0) && navs[0] === feedUrl(s.calendarToken).replace('https:', 'webcal:'), `Add opens the link as a calendar subscription: ${navs[0]}`);
  assert(!alertErrors.length, 'no page errors: ' + alertErrors.join('; '));
  await ctx.close();

  /* Signing out turns alerts off on that phone */
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['notifications'] });
  s = await fakeSupabase(ctx);
  await ctx.addInitScript(signedIn, TOKEN);
  await ctx.addInitScript(fakePhone);
  p = await ctx.newPage();
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.click('[data-tab="more"]');
  await p.waitForSelector('#alerts-on', { state: 'visible' });
  await p.click('#alerts-on');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Alerts are on'));
  assert(s.phones.size === 1, 'alerts on before signing out');
  await p.click('#screen-more [data-action="sign-out"]');
  await p.waitForSelector('#signin', { state: 'visible' });
  assert(!s.phones.size && await p.evaluate(() => localStorage.getItem('fake-subscription') === null), 'signing out turns alerts off: the phone is forgotten and unsubscribed');
  await ctx.close();

  /* Where alerts can't work yet: blocked in the phone's settings, and iPhone Safari before Add to Home Screen */
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await fakeSupabase(ctx);
  await ctx.addInitScript(signedIn, TOKEN);
  await ctx.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied' }));
  p = await ctx.newPage();
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.click('[data-tab="more"]');
  await p.waitForFunction(() => document.getElementById('alerts-text').textContent.startsWith('Alerts are blocked'));
  assert(await p.isHidden('#alerts-on') && await p.isHidden('#alerts-test') && await p.isHidden('#alerts-off'), 'blocked alerts say where to allow them, with no buttons');
  await ctx.close();
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await fakeSupabase(ctx);
  await ctx.addInitScript(signedIn, TOKEN);
  await ctx.addInitScript(() => { delete window.PushManager; });
  p = await ctx.newPage();
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.click('[data-tab="more"]');
  await p.waitForFunction(() => document.getElementById('alerts-text').textContent.startsWith('On iPhone, alerts work in the app on your Home Screen'));
  assert(await p.isHidden('#alerts-on'), 'iPhone Safari is told to add the app to the Home Screen first');
  await ctx.close();

  /* Android: a server problem with alerts says so; "Add to my calendar" opens Google Calendar */
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', permissions: ['notifications'], userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' });
  s = await fakeSupabase(ctx);
  await ctx.route('https://dwazctmqkrnajqmswtiy.supabase.co/functions/v1/bloom-bookings/key', r => r.fulfill({ status: 500, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"failed"}' }));
  const google = [];
  await ctx.route('https://calendar.google.com/**', r => { google.push(r.request().url()); return r.abort(); });
  await ctx.addInitScript(signedIn, TOKEN);
  p = await ctx.newPage();
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.click('[data-tab="more"]');
  await p.waitForSelector('#alerts-on', { state: 'visible' });
  await p.click('#alerts-on');
  await p.waitForFunction(() => document.getElementById('toast').textContent.startsWith('Alerts couldn’t be turned on'));
  assert(await p.textContent('#toast') === 'Alerts couldn’t be turned on (request failed, 500).', 'a server problem is reported as one, not as weak signal');
  await p.waitForFunction(() => !document.getElementById('calendar-add').disabled);
  await p.click('#calendar-add');
  assert(await until(() => google.length > 0) && new URL(google[0]).searchParams.get('cid') === `webcal://dwazctmqkrnajqmswtiy.supabase.co/functions/v1/bloom-bookings/calendar/${s.calendarToken}.ics`,
    `on Android, Add to my calendar opens Google Calendar with the link: ${google[0]}`);
  await ctx.close();

  /* Prices: worked out from the items and package, her own price kept, shown in the lists and details */
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  s = await fakeSupabase(ctx);
  await ctx.addInitScript(signedIn, TOKEN);
  p = await ctx.newPage();
  const priceErrors = [];
  p.on('pageerror', e => priceErrors.push(e.message));
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.click('#new-booking');
  await p.waitForSelector('#form-dialog[open]');
  await p.waitForSelector('#f-packages-group:not([hidden])');
  const groups = await p.$$eval('#booking-form .item-group-title', els => els.map(e => e.textContent));
  assert(groups.join('|') === 'Flower walls|Neon signs|Extras|Package', 'items are grouped into walls, neon signs, extras and packages: ' + groups);
  assert(await p.getByRole('group', { name: 'Neon signs' }).getByRole('checkbox').count() === 9 && await p.getByRole('group', { name: 'Package' }).getByRole('checkbox').count() === 3
    && await p.getAttribute('#f-price', 'aria-describedby') === 'price-hint', 'screen readers hear each group’s name, and the price field is linked to its hint');
  assert(await p.$$eval('#f-items [name="items"]', els => els.length) === 19 && await p.isVisible('[name="items"][value="neon-just-married"]'), 'all 19 items can be chosen, the neon signs included');
  assert((await p.textContent('#f-packages')).includes('Save $80.00 with a flower wall and Bloom bar'), 'packages say what they save and include');
  const priceIs = v => p.waitForFunction(want => document.getElementById('f-price').value === want, v);
  await p.check('[name="items"][value="garden-wall"]');
  await priceIs('450.00');
  assert((await p.textContent('#price-hint')).startsWith('Worked out from the items'), 'the price fills itself in from the items');
  await p.check('[name="items"][value="neon-just-married"]');
  await priceIs('575.00');
  await p.check('[name="items"][value="bloom-bar"]');
  await p.check('[name="packages"][value="pkg-bridal-suite"]');
  await priceIs('845.00');
  assert(true, 'a neon sign and a package update the price, with the package saving taken off');
  await p.fill('#f-price', '800');
  await p.waitForFunction(() => document.getElementById('price-hint').textContent.includes('Use the item prices ($845.00)'));
  await p.check('[name="items"][value="neon-engaged"]');
  await p.waitForFunction(() => document.getElementById('price-hint').textContent.includes('($970.00)'));
  assert(await p.inputValue('#f-price') === '800', 'a price she types stays when the items change');
  await p.click('#price-hint button');
  await priceIs('970.00');
  assert((await p.textContent('#price-hint')).startsWith('Worked out'), '“Use the item prices” brings the worked-out price back');
  await p.fill('#f-price', '');
  await p.locator('#f-price').blur();
  await priceIs('970.00');
  assert((await p.textContent('#price-hint')).startsWith('Worked out'), 'clearing the price puts the worked-out price back');
  await p.fill('#f-name', 'Price Person');
  await p.fill('#f-date', LATER);
  await p.fill('#f-start', '12:00');
  await p.fill('#f-end', '16:00');
  await p.click('#booking-form [type="submit"]');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking saved');
  const priced = s.log.filter(l => l.path === '/rest/v1/rpc/save_booking').pop().body.b;
  assert(priced.price === '' && priced.form_version === 2 && JSON.stringify(priced.packages) === '["pkg-bridal-suite"]' && priced.items.includes('neon-engaged') && priced.items.includes('neon-just-married'),
    'saved with its package and neon signs, the worked-out price left for the database to fill in: ' + JSON.stringify({ price: priced.price, v: priced.form_version }));
  await p.click('[data-tab="bookings"]');
  await p.waitForFunction(() => document.getElementById('booking-list').textContent.includes('$970.00'));
  const rowText = await p.textContent('#booking-list li:has-text("Price Person")');
  assert(rowText.includes('Just Married neon sign') && rowText.includes('· $970.00'), 'the booking list shows the items and price: ' + rowText.replace(/\s+/g, ' ').slice(0, 160));
  await p.click('#booking-list li:has-text("Price Person") button');
  const pricedDetail = await p.textContent('#booking-body');
  assert(pricedDetail.includes('The Bridal Suite package') && pricedDetail.includes('$970.00'), 'details show the package and price');
  await p.click('#booking-dialog [data-close]');
  await p.click('#booking-list li:has-text("Jane Doe") button');
  await p.click('#booking-body >> text=Edit');
  await p.waitForFunction(() => document.getElementById('price-hint').textContent.includes('Use the item prices ($800.00)'));
  assert(await p.inputValue('#f-price') === '450.00', 'editing a booking whose price was set by hand keeps that price');
  await p.click('#form-dialog [data-close]');
  // On a slow connection: saving before the new price arrives still saves the right one, and a booking whose
  // price was worked out keeps working it out when items change before the first price arrives.
  s.quoteDelay = 1500;
  await p.click('#new-booking');
  await p.fill('#f-name', 'Quick Saver');
  await p.fill('#f-date', LATER);
  await p.fill('#f-start', '08:00');
  await p.fill('#f-end', '09:00');
  await p.fill('#f-setup', '0');
  await p.fill('#f-pickup', '0');
  await p.check('[name="items"][value="greenery-wall"]');
  await priceIs('450.00');
  await p.check('[name="items"][value="sweets-cart"]');
  await p.click('#booking-form [type="submit"]');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking saved');
  const quick = s.log.filter(l => l.path === '/rest/v1/rpc/save_booking').pop().body.b;
  const quickRow = s.bookings.find(x => x.items.includes('sweets-cart') && x.start_local === `${LATER}T08:00:00`);
  assert(quick.price === '' && quickRow && quickRow.price === 775,
    'saving before the new price arrives still saves the price of what was saved ($775), not the old $450: ' + JSON.stringify({ sent: quick.price, saved: quickRow && quickRow.price }));
  await p.click('#booking-list li:has-text("Price Person") button');
  await p.click('#booking-body >> text=Edit');
  assert(await p.inputValue('#f-price') === '970.00' && (await p.textContent('#price-hint')).startsWith('Worked out'), 'a worked-out price opens as worked out, straight away');
  await p.check('[name="items"][value="pedestals"]');
  await priceIs('1245.00');
  assert((await p.textContent('#price-hint')).startsWith('Worked out'), 'and follows the items when they change before any price has arrived');
  await p.click('#form-dialog [data-close]');
  s.quoteDelay = 0;
  assert(!priceErrors.length, 'no page errors: ' + priceErrors.join('; '));
  await ctx.close();

  /* Package list unreachable: editing a package booking keeps its package and price */
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  s = await fakeSupabase(ctx, { extra: [{ id: 30, customer_id: 1, status: 'confirmed', start_local: `${LATER}T12:00:00`, end_local: `${LATER}T16:00:00`, setup_minutes: 120, pickup_minutes: 120,
    address: null, venue: null, event_type: 'Bridal shower', guests: null, price: 720, packages: ['pkg-bridal-suite'], deposit_paid: false, notes: null, items: ['garden-wall', 'bloom-bar'] }] });
  s.packagesFail = true;
  await ctx.addInitScript(signedIn, TOKEN);
  p = await ctx.newPage();
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  await p.click('[data-tab="bookings"]');
  await p.click('#booking-list li:has-text("$720.00") button');
  await p.click('#booking-body >> text=Edit');
  await p.waitForSelector('#form-dialog[open]');
  assert(await p.isHidden('#f-packages-group') && await p.inputValue('#f-price') === '720.00' && (await p.textContent('#price-hint')).startsWith('Worked out'),
    'without the package list, the package price still shows as worked out');
  await p.fill('#f-notes', 'Changed only the notes');
  await p.click('#booking-form [type="submit"]');
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking updated');
  const kept = s.log.filter(l => l.path === '/rest/v1/rpc/save_booking').pop().body.b;
  assert(JSON.stringify(kept.packages) === '["pkg-bridal-suite"]' && s.bookings.find(x => x.id === 30).price === 720, 'saving keeps the package and its $720 price');
  s.packagesFail = false;
  await p.click('#new-booking');
  await p.waitForSelector('#f-packages-group:not([hidden])');
  assert(true, 'the package list is fetched again when the form opens');
  await ctx.close();

  /* Old address */
  ctx = await b.newContext({ serviceWorkers: 'block' });
  await fakeSupabase(ctx);
  p = await ctx.newPage();
  await p.goto(`${BASE}/admin.html#error=access_denied&error_code=otp_expired`, { waitUntil: 'networkidle' });
  assert(p.url().startsWith(`${BASE}/owner/`) && (await p.textContent('#signin-status')).includes('expired'), 'admin.html forwards to the app, keeping any sign-in details');
  await ctx.close();

  /* Home-screen app: manifest, icons, offline start */
  ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  p = await ctx.newPage();
  await p.goto(`${BASE}/owner/`, { waitUntil: 'networkidle' });
  const manifestUrl = new URL(await p.getAttribute('link[rel="manifest"]', 'href'), p.url()).href;
  const manifest = await (await ctx.request.get(manifestUrl)).json();
  assert(manifest.name === 'Bloom Bookings' && manifest.display === 'standalone' && manifest.start_url === './' && manifest.icons.some(i => i.purpose === 'maskable'), 'manifest describes an installable app');
  for (const icon of [...manifest.icons.map(i => i.src), 'apple-touch-icon.png']) {
    const r = await ctx.request.get(new URL(icon, manifestUrl).href);
    assert(r.ok() && r.headers()['content-type'].includes('image/png'), `icon ${icon} loads`);
  }
  const scope = await p.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  assert(scope === `${BASE}/owner/`, 'service worker installed for the app: ' + scope);
  await p.reload({ waitUntil: 'networkidle' });
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#signin', { state: 'visible' });
  assert(await p.isVisible('#password-form'), 'the app opens without signal');
  await ctx.close();

  await b.close();
})();
