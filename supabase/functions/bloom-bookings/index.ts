// Bloom Bookings edge function, deployed from the Supabase dashboard as "bloom-bookings" with JWT verification off.
//   POST /bloom-bookings/key                  the public key phones subscribe with (made on first use)
//   POST /bloom-bookings/send                 sends waiting phone alerts; the database calls it, and anyone
//                                             calling it only sends alerts that were already waiting
//   GET  /bloom-bookings/calendar/<code>.ics  the owner's bookings as a calendar feed
// Only Web Crypto and fetch; the database is reached with the service role through supabase/schema.sql's functions.
import { withSupabase } from 'jsr:@supabase/server@^1';

// Apple refuses alerts whose contact isn't a real mailto: or https: address.
const SUBJECT = 'https://zandstrading1-hash.github.io/bloom-events/';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
const encoder = new TextEncoder();

export const toB64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = text => {
  const plain = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(plain + '='.repeat((4 - plain.length % 4) % 4)), c => c.charCodeAt(0));
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};

export const makeKeys = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { public: toB64u(await crypto.subtle.exportKey('raw', pair.publicKey)), private: { kty, crv, x, y, d } };
};

// VAPID (RFC 8292): a token signed with the private key that the push service checks. Apple allows at most 24 hours.
export const vapid = async (endpoint, keys, now = Date.now()) => {
  const part = value => toB64u(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const key = await crypto.subtle.importKey('jwk', keys.private, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned));
  return `vapid t=${unsigned}.${toB64u(signature)}, k=${keys.public}`;
};

const hkdf = async (salt, secret, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits(
  { name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']), bytes * 8));

// Web Push message encryption (RFC 8291, aes128gcm): only the phone that subscribed can read the alert.
export const encrypt = async (message, phone, salt = crypto.getRandomValues(new Uint8Array(16))) => {
  const phoneKey = fromB64u(phone.p256dh);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localKey = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: await crypto.subtle.importKey('raw', phoneKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, local.privateKey, 256));
  const secret = await hkdf(fromB64u(phone.auth), shared, concat(encoder.encode('WebPush: info\0'), phoneKey, localKey), 32);
  const cek = await hkdf(salt, secret, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, secret, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(encoder.encode(message), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localKey.length;
  return concat(header, localKey, body);
};

export const push = async (phone, message, keys) => {
  const response = await fetch(phone.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapid(phone.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body: await encrypt(JSON.stringify(message), phone),
    signal: AbortSignal.timeout(10000)
  });
  await response.arrayBuffer().catch(() => {});
  return response.status;
};

// An alert is tried again later only when every phone failed for a reason that can pass
// (no connection or no answer within 10 seconds, rate limit, push service down). Phones the push service
// no longer knows are forgotten.
const mayPass = status => status === 0 || status === 429 || status >= 500;
export const sendAlerts = async rpc => {
  const { keys, alerts } = await rpc('claim_alerts');
  const done = [];
  const gone = [];
  let sent = 0;
  await Promise.all(alerts.map(async alert => {
    if (!keys || !alert.phones.length) { done.push(alert.id); return; }
    const results = await Promise.all(alert.phones.map(phone => push(phone, alert.message, keys).catch(() => 0)));
    console.log(`alert ${alert.id}: ${results.join(', ')}`);
    results.forEach((status, i) => { if (status === 404 || status === 410) gone.push(alert.phones[i].endpoint); });
    sent += results.filter(status => status >= 200 && status < 300).length;
    if (!results.every(mayPass)) done.push(alert.id);
  }));
  if (alerts.length) await rpc('finish_alerts', { p_sent: done, p_gone: gone });
  return { alerts: alerts.length, sent };
};

// Calendar file (RFC 5545): text escaped, lines folded to 75 bytes, CRLF line ends. Its text can't hold
// control characters, and visitors can type them into a request, so they're dropped.
const escapeText = value => String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r\n?|\n/g, '\\n').replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
const fold = line => {
  const lines = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    if (size + bytes > (lines.length ? 74 : 75)) { lines.push(current); current = ''; size = 0; }
    current += ch;
    size += bytes;
  }
  lines.push(current);
  return lines.join('\r\n ');
};
export const calendar = (events, now = new Date()) => {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bloom Events//Bloom Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Bloom bookings', 'X-WR-TIMEZONE:America/Detroit', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M'];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${stamp}`, `DTSTART:${event.start}`, `DTEND:${event.end}`,
      `STATUS:${event.status}`, `SUMMARY:${escapeText(event.summary)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
};

export const handle = async (request, rpc) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const path = new URL(request.url).pathname;
  const json = (body, status = 200) => Response.json(body, { status, headers: CORS });
  try {
    if (request.method === 'POST' && path.endsWith('/key')) {
      let publicKey = await rpc('alert_public_key');
      if (!publicKey) {
        const keys = await makeKeys();
        publicKey = await rpc('save_alert_keys', { p_public: keys.public, p_private: keys.private });
      }
      return json({ publicKey });
    }
    if (request.method === 'POST' && path.endsWith('/send')) return json(await sendAlerts(rpc));
    const feed = path.match(/\/calendar\/([a-f0-9]{64})\.ics$/);
    if (request.method === 'GET' && feed) {
      const events = await rpc('calendar_feed', { p_token: feed[1] });
      if (!events) return new Response('This calendar link has been replaced. Add the new one from Bloom Bookings.', { status: 404 });
      return new Response(calendar(events), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'failed' }, 500);
  }
};

export default {
  fetch: withSupabase({ auth: 'none' }, (request, ctx) => handle(request, async (name, args) => {
    const { data, error } = await ctx.supabaseAdmin.rpc(name, args);
    if (error) throw error;
    return data;
  }))
};
