/* Booking flow: pick rentals, one of each, carry them to the Book page, and build the request. */
const { chromium } = require('playwright');
// Run with the site served locally (see the README), e.g.
//   python -m http.server 8765 --bind 127.0.0.1   (from the repo root)
//   cd tests && npm install && node booking-flow.js
// BASE_URL overrides the address; CHROMIUM_PATH points Playwright at a local Chromium.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
(async () => {
  const b = await chromium.launch(launchOpts);
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p); await cdp.send('Page.enable');
  const navs = []; cdp.on('Page.frameRequestedNavigation', e => navs.push(e.url));
  const logs = [];
  p.on('console', m => logs.push(m.text()));
  p.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await p.goto(BASE + '/services.html', { waitUntil: 'networkidle' });
  const pressed = id => p.getAttribute(`[data-pick="${id}"]`, 'aria-pressed');
  const label = () => p.textContent('.book-bar-label');
  assert(await label() === 'Book now', 'bar says Book now with nothing picked');
  await p.click('[data-pick="ivory-wall"]');
  await p.click('[data-pick="greenery-wall"]');
  assert(await pressed('ivory-wall') === 'true' && await pressed('greenery-wall') === 'true', 'two walls picked');
  await p.click('[data-pick="ivory-wall"]');
  assert(await pressed('ivory-wall') === 'false', 'tapping again removes the wall');
  await p.click('[data-pick="ivory-wall"]');
  await p.click('[data-pick="bloom-bar"]');
  let stored = await p.evaluate(() => JSON.parse(localStorage.getItem('bloom-picks')));
  assert(JSON.stringify(stored) === JSON.stringify(['greenery-wall', 'ivory-wall', 'bloom-bar']), 'each item stored once: ' + stored);
  assert(await label() === 'Book your 3 picks' && await p.textContent('.book-bar-count') === '3', 'bar shows 3 picks');
  assert((await p.getAttribute('.book-bar-link', 'href')).includes('picks=greenery-wall,ivory-wall,bloom-bar'), 'book link carries picks');
  assert(await p.evaluate(() => document.querySelectorAll('.wall-card.is-picked').length) === 2, 'two wall cards marked picked');
  // go to the Book page through the bar
  await p.click('.book-bar-link'); await p.waitForLoadState('networkidle');
  assert(p.url().includes('contact.html'), 'bar opens the Book page');
  let items = await p.$$eval('#picks-list li span', els => els.map(e => e.textContent));
  assert(items.join('|') === 'Greenery wall|Ivory flower wall|Bloom bar', 'picks listed on Book page: ' + items);
  assert(await p.inputValue('#rentals-field') === 'Greenery wall, Ivory flower wall, Bloom bar', 'hidden rentals field filled');
  await p.click('[data-remove="bloom-bar"]');
  items = await p.$$eval('#picks-list li span', els => els.map(e => e.textContent));
  assert(items.length === 2 && await p.inputValue('#rentals-field') === 'Greenery wall, Ivory flower wall', 'remove works');
  assert(await p.isHidden('#picks-empty'), 'empty message hidden when picks exist');
  assert(await p.textContent('.form-submit span') === 'Send by text', 'submit says Send by text without a form key');
  // required fields block sending
  const before = logs.length;
  await p.click('.form-submit');
  assert(await p.evaluate(() => !document.getElementById('inquire-form').checkValidity()), 'empty form is invalid');
  // fill and send
  await p.fill('#name', 'Test Person'); await p.fill('#email', 'test@example.com'); await p.fill('#phone', '555-0100');
  await p.fill('#event_date', '2027-06-12'); await p.selectOption('#event_type', 'Bridal shower'); await p.fill('#guests', '60');
  await p.fill('#venue', 'The Palazzo Grande, Shelby Twp'); await p.fill('#message', 'Pink and ivory');
  await p.click('.form-submit'); await p.waitForTimeout(800);
  const smsUrl = navs.find(u => u.startsWith('sms:')) || '';
  const body = smsUrl ? decodeURIComponent(smsUrl.split('body=')[1] || '') : '';
  console.log('   sms body:\n' + body.split('\n').map(l => '     ' + l).join('\n'));
  assert(body.includes('Picks: Greenery wall, Ivory flower wall') && body.includes('Date: 2027-06-12') && body.includes('Name: Test Person'), 'text message filled with the request');
  // link fallback + dedupe + unknown ids
  const p2 = await ctx.newPage();
  await p2.evaluate(() => {}).catch(() => {});
  await p2.goto(BASE + '/contact.html?picks=red-rose-wall,red-rose-wall,not-a-wall', { waitUntil: 'networkidle' });
  const items2 = await p2.$$eval('#picks-list li span', els => els.map(e => e.textContent));
  assert(items2.filter(t => t === 'Red rose wall').length === 1 && !items2.some(t => /not-a-wall/.test(t)), 'link picks deduped, unknown ignored: ' + items2);
  // desktop: bar hidden until something is picked
  const d = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await d.goto(BASE + '/services.html', { waitUntil: 'networkidle' });
  assert(await d.isHidden('.book-bar'), 'desktop: no floating bar with nothing picked');
  await d.click('[data-pick="pink-ombre-wall"]');
  assert(await d.isVisible('.book-bar'), 'desktop: floating bar appears after a pick');
  console.log('page errors:', logs.filter(l => l.startsWith('PAGEERROR')));
  await b.close();
})();
