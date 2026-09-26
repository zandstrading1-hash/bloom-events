/* Owner bookings page: sign in with an emailed link, then book or unbook items by day. No dependencies. */
(() => {
  'use strict';
  const { RENTALS, DB, iso, parseIso, listNames } = window.BloomEvents;
  const ITEMS = Object.keys(RENTALS).filter(id => !id.startsWith('pkg-'));
  const $ = id => document.getElementById(id);
  const fullDate = s => parseIso(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const SESSION_KEY = 'bloom-admin-session';
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { session = null; }
  const saveSession = next => {
    session = next;
    try { if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next)); else localStorage.removeItem(SESSION_KEY); } catch { /* signed in for this visit only */ }
  };

  const request = async (path, { method = 'GET', body, token, prefer } = {}) => {
    const headers = { apikey: DB.key };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (prefer) headers.Prefer = prefer;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(DB.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!response.ok) {
        const message = data && (data.msg || data.message || data.error_description || data.error);
        throw Object.assign(new Error(message || `request failed, ${response.status}`), { status: response.status });
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  };
  const keep = data => saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in,
    email: (data.user && data.user.email) || (session && session.email) || ''
  });
  const accessToken = async () => {
    if (!session) throw Object.assign(new Error('signed out'), { status: 401 });
    if (session.expires_at - 60 < Date.now() / 1000) {
      try {
        keep(await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } }));
      } catch (e) {
        if (e.status >= 400 && e.status < 500) e.status = 401;
        throw e;
      }
    }
    return session.access_token;
  };

  const signIn = $('sign-in');
  const bookings = $('bookings');
  const requestForm = $('link-request');
  const linkSent = $('link-sent');
  const signInStatus = $('sign-in-status');
  const bookingsStatus = $('bookings-status');
  const busy = (form, on, label) => {
    const button = form.querySelector('[type="submit"]');
    button.disabled = on;
    button.querySelector('span').textContent = label;
  };
  const showSignIn = (message = '') => {
    signIn.hidden = false;
    bookings.hidden = true;
    requestForm.hidden = false;
    linkSent.hidden = true;
    signInStatus.textContent = message;
  };
  const signedOut = message => { saveSession(null); showSignIn(message); };

  // Database request as the signed-in owner. An expired or revoked sign-in goes back to the sign-in form.
  const db = async (path, options = {}) => {
    try {
      return await request(path, { ...options, token: await accessToken() });
    } catch (e) {
      if (e.status === 401) signedOut('Your sign-in has expired. Please sign in again.');
      throw e;
    }
  };

  /* Month view: each day shows how many items are booked; tap a day to book or free items. */
  const days = $('admin-days');
  const dayItems = $('day-items');
  const bookForm = $('book-form');
  let view = new Date();
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  let selected = '';
  let rows = [];
  let loadId = 0;
  const bookedOn = day => new Map(rows.filter(r => r.event_date === day).map(r => [r.item_id, r]));

  const renderMonth = () => {
    const year = view.getFullYear();
    const month = view.getMonth();
    $('admin-month').textContent = view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const cells = [...Array(new Date(year, month, 1).getDay()).fill('')];
    for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) cells.push(iso(new Date(year, month, d)));
    while (cells.length % 7) cells.push('');
    const today = iso(new Date());
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      const week = document.createElement('tr');
      cells.slice(i, i + 7).forEach(day => {
        const cell = document.createElement('td');
        if (day) {
          const count = bookedOn(day).size;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `cal-day admin-day${day < today ? ' is-past' : ''}`;
          b.dataset.date = day;
          b.textContent = Number(day.slice(8));
          if (count) {
            const badge = document.createElement('span');
            badge.className = 'admin-count';
            badge.textContent = count;
            b.append(badge);
          }
          b.setAttribute('aria-pressed', String(day === selected));
          b.setAttribute('aria-label', `${fullDate(day)}, ${count ? `${count} booked` : 'nothing booked'}`);
          if (day === today) b.setAttribute('aria-current', 'date');
          cell.append(b);
        }
        week.append(cell);
      });
      weeks.push(week);
    }
    days.replaceChildren(...weeks);
  };

  const renderDay = () => {
    if (!selected) {
      $('day-title').textContent = 'Choose a day';
      $('day-hint').hidden = false;
      dayItems.hidden = true;
      bookForm.hidden = true;
      return;
    }
    const booked = bookedOn(selected);
    $('day-title').textContent = fullDate(selected);
    $('day-hint').hidden = true;
    dayItems.hidden = false;
    dayItems.replaceChildren(...ITEMS.map(id => {
      const li = document.createElement('li');
      const row = booked.get(id);
      if (row) {
        li.className = 'is-booked';
        const text = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = RENTALS[id];
        const detail = document.createElement('small');
        detail.textContent = ['Booked', row.customer && `for ${row.customer}`].filter(Boolean).join(' ') + (row.note ? `. ${row.note}` : '');
        text.append(name, detail);
        const free = document.createElement('button');
        free.type = 'button';
        free.className = 'pick-remove';
        free.dataset.free = row.id;
        free.setAttribute('aria-label', `Unbook ${RENTALS[id]}`);
        free.textContent = 'Unbook';
        li.append(text, free);
      } else {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = id;
        const name = document.createElement('span');
        name.textContent = RENTALS[id];
        label.append(box, name);
        li.append(label);
      }
      return li;
    }));
    bookForm.hidden = booked.size === ITEMS.length;
  };

  const loadMonth = async () => {
    const id = ++loadId;
    const from = iso(view);
    const to = iso(new Date(view.getFullYear(), view.getMonth() + 1, 0));
    renderMonth();
    const data = await db(`/rest/v1/reservations?select=id,item_id,event_date,customer,note&event_date=gte.${from}&event_date=lte.${to}&order=event_date,item_id`);
    if (id !== loadId) return;
    rows = data;
    renderMonth();
    renderDay();
  };
  const reload = () => loadMonth().catch(e => { if (e.status !== 401) bookingsStatus.textContent = `Bookings couldn’t load (${e.message}). Refresh the page to try again.`; });

  const open = async () => {
    signIn.hidden = true;
    bookings.hidden = false;
    $('signed-in-email').textContent = session.email;
    bookingsStatus.textContent = 'Loading…';
    try {
      const allowed = await db('/rest/v1/rpc/am_i_admin', { method: 'POST', body: {} });
      $('not-admin').hidden = allowed === true;
      $('admin-calendar').hidden = allowed !== true;
      bookingsStatus.textContent = '';
      if (allowed === true) await reload();
    } catch (e) {
      if (e.status !== 401) bookingsStatus.textContent = `Bookings couldn’t load (${e.message}). Refresh the page to try again.`;
    }
  };

  // Supabase's built-in email can only send a link (no code); it returns here with the sign-in after the #.
  requestForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!requestForm.reportValidity()) return;
    const email = $('admin-email').value.trim().toLowerCase();
    busy(requestForm, true, 'Sending…');
    signInStatus.textContent = '';
    try {
      await request(`/auth/v1/otp?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { method: 'POST', body: { email, create_user: true } });
      $('link-email').textContent = email;
      requestForm.hidden = true;
      linkSent.hidden = false;
    } catch (err) {
      signInStatus.textContent = err.status === 429
        ? 'Too many sign-in emails have been requested. Wait an hour, then try again.'
        : `The link couldn’t be sent (${err.message}). Check the email address and try again.`;
    } finally {
      busy(requestForm, false, 'Email me a sign-in link');
    }
  });

  $('link-restart').addEventListener('click', () => { showSignIn(); $('admin-email').focus(); });

  $('sign-out').addEventListener('click', () => {
    const token = session && session.access_token;
    signedOut('You’re signed out.');
    if (token) request('/auth/v1/logout', { method: 'POST', token }).catch(() => {});
    $('admin-email').focus();
  });

  [['admin-prev', -1], ['admin-next', 1]].forEach(([id, step]) => $(id).addEventListener('click', () => {
    view = new Date(view.getFullYear(), view.getMonth() + step, 1);
    reload();
  }));

  days.addEventListener('click', e => {
    const b = e.target.closest('.admin-day');
    if (!b) return;
    selected = b.dataset.date;
    bookingsStatus.textContent = '';
    days.querySelectorAll('.admin-day').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderDay();
  });

  bookForm.addEventListener('submit', async e => {
    e.preventDefault();
    const ids = [...dayItems.querySelectorAll('input[type="checkbox"]:checked')].map(box => box.value);
    if (!ids.length) { bookingsStatus.textContent = 'Check at least one item to mark it booked.'; return; }
    const customer = $('booking-customer').value.trim() || null;
    const note = $('booking-note').value.trim() || null;
    const day = selected;
    busy(bookForm, true, 'Saving…');
    try {
      await db('/rest/v1/reservations', { method: 'POST', body: ids.map(item_id => ({ item_id, event_date: day, customer, note })), prefer: 'return=minimal' });
      $('booking-customer').value = '';
      $('booking-note').value = '';
      bookingsStatus.textContent = `Booked ${listNames(ids.map(id => RENTALS[id]))} on ${fullDate(day)}.`;
    } catch (err) {
      if (err.status !== 401) {
        bookingsStatus.textContent = err.status === 409
          ? 'One of those items was already booked that day, maybe from another device. Nothing was saved; the day has been refreshed.'
          : `Couldn’t save (${err.message}). Please try again.`;
      }
    } finally {
      busy(bookForm, false, 'Mark checked items booked');
    }
    await reload();
  });

  dayItems.addEventListener('click', async e => {
    const b = e.target.closest('[data-free]');
    if (!b) return;
    const row = rows.find(r => String(r.id) === b.dataset.free);
    if (!row || !confirm(`Unbook ${RENTALS[row.item_id]} on ${fullDate(row.event_date)}${row.customer ? ` (booked for ${row.customer})` : ''}?`)) return;
    b.disabled = true;
    try {
      await db(`/rest/v1/reservations?id=eq.${row.id}`, { method: 'DELETE' });
      bookingsStatus.textContent = `${RENTALS[row.item_id]} is free again on ${fullDate(row.event_date)}.`;
    } catch (err) {
      if (err.status !== 401) bookingsStatus.textContent = `Couldn’t unbook it (${err.message}). Please try again.`;
    }
    await reload();
  });

  const fromLink = new URLSearchParams(location.hash.slice(1));
  let linkMessage = '';
  if (fromLink.has('access_token') || fromLink.has('error')) history.replaceState(null, '', location.pathname + location.search);
  if (fromLink.has('access_token')) {
    const token = fromLink.get('access_token');
    let email = '';
    try { email = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch { email = ''; }
    keep({ access_token: token, refresh_token: fromLink.get('refresh_token'), expires_at: Number(fromLink.get('expires_at')) || 0, expires_in: Number(fromLink.get('expires_in')) || 3600, user: { email } });
  } else if (fromLink.has('error')) {
    linkMessage = fromLink.get('error_code') === 'otp_expired'
      ? 'That sign-in link has expired or was already used. Send a new one.'
      : `Sign-in didn’t work (${fromLink.get('error_description') || fromLink.get('error')}). Send a new link.`;
  }

  if (session) open(); else showSignIn(linkMessage);
})();
