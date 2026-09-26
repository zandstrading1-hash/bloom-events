/* Owner app (owner/): sign-in, calendar, booking form with conflicts, lists, customers, settings, password, home-screen install. */
const { chromium } = require('playwright');
const fs = require('fs');
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

// A small in-memory stand-in for the Supabase API, with the same rules as supabase/schema.sql.
const fakeSupabase = async (ctx, { admin = true, refreshOk = true } = {}) => {
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
    settings: { setup_minutes: 120, pickup_minutes: 120 },
    raceItems: [],
    log: [],
    next: 100
  };
  const isActive = b => b.status === 'requested' || b.status === 'confirmed';
  const held = b => [w(b.start_local) - b.setup_minutes * 60000, w(b.end_local) + b.pickup_minutes * 60000];
  const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];
  const bookingView = b => { const c = s.customers.find(x => x.id === b.customer_id) || {}; return { ...b, customer_name: c.name ?? null, customer_phone: c.phone ?? null, customer_email: c.email ?? null, items: [...b.items].sort() }; };
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

  await ctx.route(CALENDAR_LIB, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: calendarLib }));
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
    if (auth !== `Bearer ${TOKEN}` && auth !== 'Bearer token-2') return json(route, 401, { message: 'JWT expired' });
    if (path === '/auth/v1/user') return json(route, 200, { email: 'owner@example.com' });
    if (path === '/rest/v1/rpc/am_i_admin') return json(route, 200, admin);
    if (path === '/rest/v1/rpc/item_conflicts') {
      const p = proposed({ date: body.p_date, start: body.p_start, end: body.p_end, setup: body.p_setup, pickup: body.p_pickup });
      return json(route, 200, conflicts(p, body.p_booking).flatMap(b => b.items.map(item_id => ({ item_id, booking_id: b.id, customer_name: bookingView(b).customer_name, start_local: b.start_local, end_local: b.end_local }))));
    }
    if (path === '/rest/v1/rpc/save_booking') {
      const b = body.b;
      const p = proposed({ date: b.date, start: b.start, end: b.end, setup: Number(b.setup_minutes), pickup: Number(b.pickup_minutes) });
      const taken = [...new Set([...conflicts(p, b.id).flatMap(x => x.items), ...s.raceItems])].filter(i => b.items.includes(i));
      if (['requested', 'confirmed'].includes(b.status) && taken.length) return json(route, 409, { code: '23P01', message: 'Already booked at that time', details: taken.join(',') });
      let customerId = b.customer_id;
      const fields = { name: b.customer_name.trim(), phone: b.customer_phone.trim() || null, email: b.customer_email.trim().toLowerCase() || null };
      if (customerId) Object.assign(s.customers.find(c => c.id === customerId), fields);
      else { customerId = s.next++; s.customers.push({ id: customerId, ...fields, notes: null, created_at: new Date().toISOString() }); }
      const row = { customer_id: customerId, status: b.status, start_local: p.startLocal, end_local: p.endLocal, setup_minutes: Number(b.setup_minutes), pickup_minutes: Number(b.pickup_minutes), address: b.address || null, venue: b.venue || null, event_type: b.event_type || null, guests: b.guests ? Number(b.guests) : null, price: b.price === '' ? null : Number(b.price), deposit_paid: b.deposit_paid, notes: b.notes || null, items: b.items };
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
      const b = s.bookings.find(x => String(x.id) === url.searchParams.get('id').slice(3));
      if (req.method() === 'DELETE') { s.bookings = s.bookings.filter(x => x !== b); return route.fulfill({ status: 204 }); }
      if (req.method() === 'PATCH') {
        if (isActive(body) && conflicts({ held: held(b) }, b.id).some(x => x.items.some(i => b.items.includes(i)))) return json(route, 409, { code: '23P01', message: 'conflicting key value violates exclusion constraint', details: 'Key conflicts with existing key.' });
        Object.assign(b, body);
        return route.fulfill({ status: 204 });
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
  await p.waitForFunction(() => document.getElementById('toast').textContent === 'Booking confirmed');
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
