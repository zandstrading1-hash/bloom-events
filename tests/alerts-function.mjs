/* The bloom-bookings edge function, run in Node without Supabase: alert signing and encryption checked against
   independent implementations, sending through a local stand-in push service, and the calendar file read back
   with a real calendar parser. Nothing here touches the live project. */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';
import ICAL from 'ical.js';

const require = createRequire(import.meta.url);
const ece = require('http_ece');
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

// The function runs on Deno. Without its Supabase wrapper (the first import and the default export) it is plain
// JavaScript that Node can load.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../supabase/functions/bloom-bookings/index.ts'), 'utf8')
  .replace(/^import .*$/m, '').replace(/export default \{[\s\S]*$/, '');
const file = join(mkdtempSync(join(tmpdir(), 'bloom-fn-')), 'index.mjs');
writeFileSync(file, source);
const fn = await import(pathToFileURL(file).href);
assert(!source.includes('withSupabase') && typeof fn.handle === 'function', 'function code loads without its Supabase wrapper');

const b64u = buf => Buffer.from(buf).toString('base64url');
const newPhone = endpoint => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const authBytes = crypto.randomBytes(16);
  return { endpoint, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(authBytes), ecdh, authBytes };
};
const decrypt = (phone, body) => ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: phone.ecdh, authSecret: phone.authBytes }).toString('utf8');
const SUBJECT = 'https://zandstrading1-hash.github.io/bloom-events/';
const verifyVapid = (header, keys, audience) => {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header || '');
  if (!match) return 'malformed header';
  const [, head, claims, signature, publicKey] = match;
  const point = Buffer.from(publicKey, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33)) }, format: 'jwk' });
  const signed = crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
  const h = JSON.parse(Buffer.from(head, 'base64url'));
  const c = JSON.parse(Buffer.from(claims, 'base64url'));
  const hoursLeft = (c.exp - Date.now() / 1000) / 3600;
  if (!signed) return 'bad signature';
  if (publicKey !== keys.public) return 'wrong key';
  if (h.alg !== 'ES256' || h.typ !== 'JWT') return `header ${JSON.stringify(h)}`;
  if (c.aud !== audience || c.sub !== SUBJECT || !(hoursLeft > 11.9 && hoursLeft <= 12)) return `claims ${JSON.stringify(c)}`;
  return 'valid';
};

/* Keys, signing and encryption */
const keys = await fn.makeKeys();
assert(/^[\w-]{87}$/.test(keys.public) && Buffer.from(keys.public, 'base64url')[0] === 4, 'the public key is an uncompressed P-256 point, as browsers expect');
assert(keys.private.kty === 'EC' && keys.private.crv === 'P-256' && keys.private.d && Object.keys(keys.private).length === 5, 'the private key is stored as a plain JWK');
const endpoint = 'https://web.push.apple.com/QGf0example';
assert(verifyVapid(await fn.vapid(endpoint, keys), keys, 'https://web.push.apple.com') === 'valid', 'the VAPID token verifies independently: ES256 signature, push service origin, 12-hour expiry, https contact');
const phone = newPhone(endpoint);
const message = JSON.stringify({ title: 'New request: Zoë O’Neil', body: 'Sat, Oct 2, 2 PM – 6 PM · Garden flower wall 🌸' });
const sealed = await fn.encrypt(message, phone);
assert(decrypt(phone, sealed) === message, 'an independent decryptor (http_ece, RFC 8188/8291) reads the alert exactly, accents and emoji included');
assert(b64u(await fn.encrypt(message, phone)) !== b64u(sealed), 'every alert is sealed with fresh keys');
assert(Buffer.from(sealed).readUInt32BE(16) === 4096 && sealed[20] === 65, 'header carries the record size and the one-time public key');
let wrongPhone = false;
try { decrypt(newPhone(endpoint), sealed); } catch { wrongPhone = true; }
assert(wrongPhone, 'another phone cannot read it');
assert(b64u(fn.fromB64u(`${phone.auth}==`)) === phone.auth, 'keys with base64 padding are read too');

/* Sending through a stand-in push service */
const received = [];
const phonesByPath = {};
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const path = req.url;
    const target = phonesByPath[path];
    received.push({ path, headers: req.headers, text: target && path.startsWith('/ok') ? decrypt(target, Buffer.concat(chunks)) : null });
    res.statusCode = { '/gone': 410, '/busy': 503, '/bad': 400 }[path] || 201;
    res.end();
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const deadPort = await new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const at = path => { const p = newPhone(`${base}${path}`); phonesByPath[path] = p; return { endpoint: p.endpoint, p256dh: p.p256dh, auth: p.auth }; };
const [ok1, ok2, gone, busy, bad] = ['/ok1', '/ok2', '/gone', '/busy', '/bad'].map(at);
const offline = { ...newPhone(`http://127.0.0.1:${deadPort}/offline`) };
const msg = n => ({ title: `Title ${n}`, body: `Body ${n}`, url: './?open=requests', tag: `request-${n}`, badge: n });
const fakeDb = claim => {
  const log = [];
  return { log, rpc: async (name, args) => { log.push([name, args]); if (name === 'claim_alerts') return claim; return null; } };
};
const post = (path, rpc) => fn.handle(new Request(`https://example.supabase.co${path}`, { method: 'POST' }), rpc);

let db = fakeDb({ keys, alerts: [
  { id: 1, message: msg(1), phones: [ok1, ok2, gone] },
  { id: 2, message: msg(2), phones: [busy, { endpoint: offline.endpoint, p256dh: offline.p256dh, auth: offline.auth }] },
  { id: 3, message: msg(3), phones: [] },
  { id: 4, message: msg(4), phones: [bad] }
] });
let response = await post('/bloom-bookings/send', db.rpc);
assert(response.status === 200 && JSON.stringify(await response.json()) === '{"alerts":4,"sent":2}', 'send reports alerts handled and phones reached');
const finish = db.log.find(([name]) => name === 'finish_alerts');
assert(finish && JSON.stringify([...finish[1].p_sent].sort()) === '[1,3,4]', `finished: alerts that reached a phone, had no phones, or can never be delivered (${finish && finish[1].p_sent})`);
assert(finish && JSON.stringify(finish[1].p_gone) === JSON.stringify([gone.endpoint]), 'a phone the push service no longer knows (410) is forgotten');
assert(!finish[1].p_sent.includes(2), 'an alert whose phones were all unreachable or busy is left for the retry job');
const delivered = received.filter(r => r.path.startsWith('/ok'));
assert(delivered.length === 2 && delivered.every(r => r.text === JSON.stringify(msg(1))), 'each phone gets the alert and can read it');
const h = delivered[0].headers;
assert(h['content-encoding'] === 'aes128gcm' && h['content-type'] === 'application/octet-stream' && h.ttl === '86400' && h.urgency === 'high', 'push headers: aes128gcm, one-day TTL, high urgency');
assert(delivered.every(r => verifyVapid(r.headers.authorization, keys, base) === 'valid'), 'each push carries a valid VAPID token for that push service');

db = fakeDb({ keys: null, alerts: [{ id: 7, message: msg(7), phones: [ok1] }] });
received.length = 0;
await post('/bloom-bookings/send', db.rpc);
assert(!received.length && JSON.stringify(db.log.find(([n]) => n === 'finish_alerts')[1].p_sent) === '[7]', 'without a key pair nothing is sent and the alert is closed');
db = fakeDb({ keys, alerts: [] });
response = await post('/bloom-bookings/send', db.rpc);
assert(JSON.stringify(await response.json()) === '{"alerts":0,"sent":0}' && db.log.length === 1, 'nothing waiting: one quick check and nothing else');
server.close();

/* The public key for the app */
const store = { public: null, saves: 0 };
const keyDb = async (name, args) => {
  if (name === 'alert_public_key') return store.public;
  if (name === 'save_alert_keys') { store.saves++; store.saved = args; store.public = store.public || args.p_public; return store.public; }
  return null;
};
response = await post('/bloom-bookings/key', keyDb);
const first = await response.json();
assert(response.status === 200 && response.headers.get('access-control-allow-origin') === '*' && /^[\w-]{87}$/.test(first.publicKey), 'the app can fetch the public key from the website');
assert(store.saves === 1 && store.saved.p_private.d && store.saved.p_public === first.publicKey, 'the key pair is made and saved on first use');
response = await post('/bloom-bookings/key', keyDb);
assert((await response.json()).publicKey === first.publicKey && store.saves === 1, 'later calls return the same key without making another');
response = await fn.handle(new Request('https://example.supabase.co/bloom-bookings/key', { method: 'OPTIONS' }), keyDb);
assert(response.status === 204 && response.headers.get('access-control-allow-methods').includes('POST'), 'browser preflight is answered');
response = await post('/bloom-bookings/key', async () => { throw new Error('database down'); });
assert(response.status === 500 && (await response.json()).error === 'failed', 'a database error answers 500 without details');

/* Calendar feed */
const TOKEN = 'ab'.repeat(32);
const events = [
  { uid: 'booking-1@bloom-events', start: '20261205T190000Z', end: '20261205T230000Z', status: 'CONFIRMED',
    summary: 'Zoë Smith · Ivory flower wall and White pedestals', location: '9 Elm St, Macomb; side door',
    description: 'Setup from 12 PM, pickup by 8 PM\nVenue: Elm Hall\nNotes: Bring the pink runner, the tall vases, and the ✿ sign; call first \\ thanks. '.repeat(3).trim() },
  { uid: 'booking-2@bloom-events', start: '20261207T160000Z', end: '20261207T180000Z', status: 'TENTATIVE', summary: 'On hold: Web Hold · Champagne rose wall', location: null, description: 'On hold (website request) until Wed, Dec 2, 3 PM' }
];
const feedDb = async (name, args) => (name === 'calendar_feed' && args.p_token === TOKEN ? events : null);
const get = path => fn.handle(new Request(`https://example.supabase.co${path}`), feedDb);
response = await get(`/bloom-bookings/calendar/${TOKEN}.ics`);
const ics = await response.text();
assert(response.status === 200 && response.headers.get('content-type') === 'text/calendar; charset=utf-8' && response.headers.get('cache-control') === 'no-store', 'the feed is served as a calendar file, never cached');
assert(ics.endsWith('\r\n') && !/[^\r]\n/.test(ics), 'every line ends with CRLF');
assert(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75), 'no line is longer than 75 bytes (long text is folded)');
const parsed = new ICAL.Component(ICAL.parse(ics));
const vevents = parsed.getAllSubcomponents('vevent');
assert(parsed.getFirstPropertyValue('x-wr-calname') === 'Bloom bookings' && vevents.length === 2, 'a calendar parser reads the feed and both events');
const [e1, e2] = vevents.map(v => new ICAL.Event(v));
assert(e1.summary === events[0].summary && e1.location === events[0].location && e1.description === events[0].description, 'names, commas, semicolons, backslashes, line breaks and symbols survive exactly');
assert(e1.startDate.toJSDate().toISOString() === '2026-12-05T19:00:00.000Z' && e1.endDate.toJSDate().toISOString() === '2026-12-05T23:00:00.000Z', 'times are exact UTC instants');
assert(vevents[0].getFirstPropertyValue('status') === 'CONFIRMED' && vevents[1].getFirstPropertyValue('status') === 'TENTATIVE' && e2.location === null, 'status is kept; an event without a place has none');
assert((await get(`/bloom-bookings/calendar/${'cd'.repeat(32)}.ics`)).status === 404, 'a replaced or unknown link finds nothing');
assert((await get('/bloom-bookings/calendar/short.ics')).status === 404 && (await get('/bloom-bookings/nothing')).status === 404, 'other addresses find nothing');
