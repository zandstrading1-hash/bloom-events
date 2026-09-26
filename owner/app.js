/* Bloom Bookings: the owner's app. Password sign-in, then calendar, bookings and customers, all in Detroit time. No build step. */
(() => {
  'use strict';
  const { RENTALS, DB, listNames } = window.BloomEvents;
  const ITEMS = Object.keys(RENTALS).filter(id => !id.startsWith('pkg-'));
  const itemName = id => RENTALS[id] || id;
  const itemList = ids => ITEMS.filter(id => ids.includes(id)).map(itemName).join(', ');
  const TZ = 'America/Detroit';
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...kids.flat().filter(kid => kid != null && kid !== false && kid !== ''));
    return node;
  };
  const debounce = (fn, ms) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; };

  /* Time. The database sends Detroit wall-clock times ("2026-10-17T14:00:00"). They're read as UTC here,
     so the phone's own timezone can never shift them. */
  const wall = s => new Date(`${s.slice(0, 19)}Z`);
  const show = (s, options) => wall(s).toLocaleString('en-US', { timeZone: 'UTC', ...options });
  const nowWall = () => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  };
  const shift = (s, minutes) => new Date(wall(s).getTime() + minutes * 60000).toISOString().slice(0, 19);
  const timeText = s => show(s, { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  const dayText = s => show(s, { weekday: 'short', month: 'short', day: 'numeric', ...(s.slice(0, 4) !== nowWall().slice(0, 4) && { year: 'numeric' }) });
  const whenText = row => row.start_local.slice(0, 10) === row.end_local.slice(0, 10)
    ? `${dayText(row.start_local)} · ${timeText(row.start_local)} – ${timeText(row.end_local)}`
    : `${dayText(row.start_local)}, ${timeText(row.start_local)} – ${dayText(row.end_local)}, ${timeText(row.end_local)}`;
  const STATUS = { confirmed: 'Confirmed', requested: 'On hold', cancelled: 'Cancelled', declined: 'Declined', expired: 'Hold expired' };
  const money = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  let toastTimer;
  const toast = text => {
    $('toast').textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 4500);
  };
  const say = (node, text = '', error = false) => { node.textContent = text; node.classList.toggle('error', error); };

  /* Sign-in and requests to Supabase */
  const SESSION_KEY = 'bloom-owner-session';
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
        const message = (data && (data.msg || data.message || data.error_description || data.error)) || `request failed, ${response.status}`;
        throw Object.assign(new Error(message), { status: response.status, code: data && (data.code || data.error_code), details: data && data.details });
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
  // Signed-in request. An expired or revoked sign-in goes back to the sign-in screen.
  const db = async (path, options = {}) => {
    try {
      return await request(path, { ...options, token: await accessToken() });
    } catch (e) {
      if (e.status === 401) signedOut('Please sign in again.');
      throw e;
    }
  };
  const rpc = (name, args) => db(`/rest/v1/rpc/${name}`, { method: 'POST', body: args });
  // PostgREST "or" search across columns; characters that have meaning in its syntax are dropped.
  const search = (columns, text) => {
    const q = text.replace(/[,()*"\\:]/g, ' ').trim();
    return q ? `&or=(${columns.map(c => `${c}.ilike.*${encodeURIComponent(q)}*`).join(',')})` : '';
  };

  const views = ['signin', 'not-admin', 'shell'];
  const showOnly = which => views.forEach(v => { $(v).hidden = v !== which; });
  const signedOut = message => {
    saveSession(null);
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    showOnly('signin');
    say($('signin-status'), message);
  };

  let settings = { setup_minutes: 120, pickup_minutes: 120 };
  const start = async () => {
    try {
      const allowed = await rpc('am_i_admin', {});
      if (allowed !== true) {
        $('not-admin-email').textContent = session.email;
        showOnly('not-admin');
        return;
      }
    } catch (e) {
      if (e.status === 401) return;
      if (e.status) { showOnly('signin'); say($('signin-status'), `Couldn’t connect (${e.message}). Please try again.`, true); return; }
      toast('You’re offline. Bookings will load when you’re back online.');
    }
    showOnly('shell');
    $('account-email').textContent = session.email;
    db('/rest/v1/settings?select=setup_minutes,pickup_minutes').then(rows => {
      if (rows && rows[0]) settings = rows[0];
      $('setting-setup').value = settings.setup_minutes;
      $('setting-pickup').value = settings.pickup_minutes;
    }).catch(() => {});
    go(currentTab);
  };

  $('password-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    const button = e.target.querySelector('button');
    button.disabled = true;
    say($('signin-status'), 'Signing in…');
    try {
      keep(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: $('signin-email').value.trim().toLowerCase(), password: $('signin-password').value } }));
      $('signin-password').value = '';
      say($('signin-status'));
      await start();
    } catch (err) {
      say($('signin-status'), err.status === 400 ? 'That email and password don’t match.'
        : err.status === 429 ? 'Too many tries. Wait a few minutes, then try again.'
        : err.status ? `Couldn’t sign in (${err.message}).` : 'You’re offline. Connect and try again.', true);
    } finally {
      button.disabled = false;
    }
  });

  // Supabase's built-in email can only send a link; it comes back here with the sign-in after the #.
  $('link-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      await request(`/auth/v1/otp?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { method: 'POST', body: { email: $('link-email').value.trim().toLowerCase(), create_user: true } });
      say($('signin-status'), 'Check your email for a sign-in link. It can take a minute to arrive.');
    } catch (err) {
      say($('signin-status'), err.status === 429 ? 'Too many emails have been sent. Wait an hour, then try again.'
        : /signup|not allowed/i.test(err.message) ? 'This email doesn’t have an account yet. Ask whoever looks after the website to add it.'
        : `The link couldn’t be sent (${err.message}).`, true);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll('[data-action="sign-out"]').forEach(button => button.addEventListener('click', () => {
    const token = session && session.access_token;
    signedOut('You’re signed out.');
    if (token) request('/auth/v1/logout', { method: 'POST', token }).catch(() => {});
  }));

  /* Dialogs */
  const open = dialog => { if (!dialog.open) dialog.showModal(); };
  const close = dialog => { if (dialog.open) dialog.close(); };
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  });

  const fact = (label, value) => el('div', {}, el('dt', { text: label }), el('dd', {}, value));
  const contactLinks = (phone, email) => el('div', { class: 'contact' },
    phone && el('a', { class: 'btn small', href: `tel:${phone.replace(/[^\d+]/g, '')}`, text: 'Call' }),
    phone && el('a', { class: 'btn small', href: `sms:${phone.replace(/[^\d+]/g, '')}`, text: 'Text' }),
    email && el('a', { class: 'btn small', href: `mailto:${email}`, text: 'Email' }));
  const badge = status => status === 'confirmed' ? null : el('span', { class: `badge ${status}`, text: STATUS[status] || status });

  /* Tabs */
  const TITLES = { calendar: 'Calendar', bookings: 'Bookings', customers: 'Customers', more: 'More' };
  let currentTab = 'calendar';
  const go = tab => {
    currentTab = tab;
    document.querySelectorAll('[data-tab]').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    Object.keys(TITLES).forEach(t => { $(`screen-${t}`).hidden = t !== tab; });
    $('screen-title').textContent = TITLES[tab];
    if (tab === 'calendar') showCalendar();
    if (tab === 'bookings') loadBookings(true);
    if (tab === 'customers') loadCustomers();
    if (tab === 'more') paintInstall();
  };
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  const refresh = () => {
    if (calendar) calendar.refetchEvents();
    if (currentTab === 'bookings') loadBookings(true);
    if (currentTab === 'customers') loadCustomers();
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session && !$('shell').hidden) refresh(); });

  /* Calendar. In month view, tapping a day lists that day's bookings under the calendar. */
  let calendar;
  let selectedDay = nowWall().slice(0, 10);
  const lastDayOf = event => (event.end ? new Date(event.end.getTime() - 1).toISOString() : event.startStr).slice(0, 10);
  const paintAgenda = () => {
    if (!calendar) return;
    const month = calendar.view.type === 'dayGridMonth';
    $('day-agenda').hidden = !month;
    if (!month) return;
    document.querySelectorAll('#calendar .fc-daygrid-day').forEach(cell => cell.classList.toggle('is-selected', cell.dataset.date === selectedDay));
    const rows = calendar.getEvents()
      .filter(e => e.startStr.slice(0, 10) <= selectedDay && lastDayOf(e) >= selectedDay)
      .map(e => e.extendedProps.row)
      .sort((a, b) => (a.start_local < b.start_local ? -1 : 1));
    $('agenda-title').textContent = selectedDay === nowWall().slice(0, 10) ? 'Today' : show(`${selectedDay}T12:00:00`, { weekday: 'long', month: 'long', day: 'numeric' });
    $('agenda-list').replaceChildren(...rows.map(bookingRow));
    $('agenda-empty').hidden = rows.length > 0;
  };
  const selectDay = day => { selectedDay = day; paintAgenda(); };
  const showCalendar = () => {
    if (calendar) { calendar.updateSize(); calendar.refetchEvents(); return; }
    if (!window.FullCalendar) { $('calendar').textContent = 'The calendar couldn’t load. Check your signal and reopen the app.'; return; }
    const phone = matchMedia('(max-width: 520px)').matches;
    calendar = new FullCalendar.Calendar($('calendar'), {
      timeZone: 'UTC',
      now: nowWall,
      initialView: 'dayGridMonth',
      headerToolbar: { left: 'prev', center: 'title', right: 'next' },
      footerToolbar: { left: 'today', right: 'dayGridMonth,timeGridWeek,listWeek' },
      buttonIcons: false,
      buttonText: { prev: 'Previous', next: 'Next', today: 'Today', month: 'Month', week: 'Week', list: 'List', day: 'Day' },
      height: 'auto',
      dayMaxEvents: phone ? 2 : 4,
      moreLinkClick: ({ date }) => { selectDay(date.toISOString().slice(0, 10)); },
      nowIndicator: true,
      slotMinTime: '06:00:00',
      eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
      noEventsText: 'No bookings',
      views: {
        dayGridMonth: {
          eventDisplay: 'block',
          displayEventTime: false,
          eventContent: ({ event }) => {
            const row = event.extendedProps.row;
            const name = row.customer_name || 'Booking';
            return { domNodes: [el('span', { class: 'month-event', text: phone ? name.split(' ')[0] : `${timeText(row.start_local)} ${name}` })] };
          }
        }
      },
      events: (info, success, failure) => {
        db(`/rest/v1/owner_bookings?select=*&status=in.(requested,confirmed)&start_local=lt.${info.endStr.slice(0, 19)}&end_local=gt.${info.startStr.slice(0, 19)}&order=start_local`)
          .then(rows => success(rows.map(row => ({
            id: String(row.id),
            title: `${row.customer_name || 'No name'} · ${itemList(row.items)}`,
            start: row.start_local,
            end: row.end_local,
            classNames: [`status-${row.status}`],
            extendedProps: { row }
          }))))
          .catch(e => { failure(e); if (e.status !== 401) toast(e.status ? `Bookings couldn’t load (${e.message}).` : 'You’re offline. Bookings will load when you’re back online.'); });
      },
      eventsSet: paintAgenda,
      datesSet: ({ view }) => {
        const first = view.currentStart.toISOString().slice(0, 10);
        const last = new Date(view.currentEnd.getTime() - 1).toISOString().slice(0, 10);
        const today = nowWall().slice(0, 10);
        if (selectedDay < first || selectedDay > last) selectedDay = today >= first && today <= last ? today : first;
        paintAgenda();
      },
      eventClick: ({ event, jsEvent }) => { jsEvent.preventDefault(); openBooking(event.extendedProps.row); },
      dateClick: ({ dateStr, view }) => {
        if (view.type === 'dayGridMonth') selectDay(dateStr.slice(0, 10));
        else if (view.type.startsWith('timeGrid')) openForm({ date: dateStr.slice(0, 10), start: dateStr.slice(11, 16) });
      }
    });
    calendar.render();
  };
  $('agenda-new').addEventListener('click', () => openForm({ date: selectedDay }));

  /* Booking details */
  const bookingDialog = $('booking-dialog');
  const openBooking = row => {
    $('booking-title').textContent = row.customer_name || 'Booking';
    const active = row.status === 'confirmed' || row.status === 'requested';
    const facts = el('dl', { class: 'facts' },
      fact('When', whenText(row)),
      fact('Setup and pickup', `Setup from ${timeText(shift(row.start_local, -row.setup_minutes))}, pickup by ${timeText(shift(row.end_local, row.pickup_minutes))}`),
      fact('Items', itemList(row.items)),
      row.address && fact('Address', el('a', { href: `https://maps.apple.com/?q=${encodeURIComponent(row.address)}`, target: '_blank', rel: 'noopener', text: row.address })),
      row.venue && fact('Venue', row.venue),
      (row.event_type || row.guests) && fact('Event', [row.event_type, row.guests && `${row.guests} guests`].filter(Boolean).join(' · ')),
      row.price != null && fact('Price', `${money(row.price)} · ${row.deposit_paid ? 'deposit paid' : 'deposit not paid'}`),
      row.price == null && row.deposit_paid && fact('Deposit', 'Paid'),
      row.notes && fact('Notes', row.notes),
      fact('Status', STATUS[row.status] || row.status),
      row.customer_phone && fact('Phone', row.customer_phone),
      row.customer_email && fact('Email', row.customer_email));
    const actions = el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'btn primary', text: 'Edit', onclick: () => openForm({ row }) }),
      row.status === 'requested' && el('button', { type: 'button', class: 'btn', text: 'Confirm', onclick: () => changeStatus(row, 'confirmed', 'Booking confirmed') }),
      active && el('button', { type: 'button', class: 'btn', text: 'Cancel booking', onclick: () => { if (confirm(`Cancel ${row.customer_name || 'this booking'} on ${dayText(row.start_local)}? Its items become free again.`)) changeStatus(row, 'cancelled', 'Booking cancelled'); } }),
      !active && el('button', { type: 'button', class: 'btn', text: 'Restore booking', onclick: () => changeStatus(row, 'confirmed', 'Booking restored') }),
      row.customer_id && el('button', { type: 'button', class: 'btn', text: 'Customer details', onclick: () => { close(bookingDialog); openCustomer(row.customer_id); } }),
      el('button', { type: 'button', class: 'btn danger', text: 'Delete', onclick: () => deleteBooking(row) }));
    $('booking-body').replaceChildren(facts, contactLinks(row.customer_phone, row.customer_email), actions);
    open(bookingDialog);
  };
  const changeStatus = async (row, status, done) => {
    try {
      await db(`/rest/v1/bookings?id=eq.${row.id}`, { method: 'PATCH', body: { status }, prefer: 'return=minimal' });
      close(bookingDialog);
      toast(done);
      refresh();
    } catch (e) {
      if (e.status !== 401) toast(e.code === '23P01' ? 'Those items are booked by someone else at that time now, so this can’t be restored.' : `Couldn’t update the booking (${e.message}).`);
    }
  };
  const deleteBooking = async row => {
    if (!confirm(`Delete this booking for ${row.customer_name || 'no name'} on ${dayText(row.start_local)} for good? To keep a record, cancel it instead.`)) return;
    try {
      await db(`/rest/v1/bookings?id=eq.${row.id}`, { method: 'DELETE' });
      close(bookingDialog);
      toast('Booking deleted');
      refresh();
    } catch (e) {
      if (e.status !== 401) toast(`Couldn’t delete the booking (${e.message}).`);
    }
  };

  /* Booking form */
  const formDialog = $('form-dialog');
  const form = $('booking-form');
  const f = id => $(`f-${id}`);
  let editing = null;
  let pickedCustomer = null;
  f('items').replaceChildren(...ITEMS.map(id => el('li', {}, el('label', {},
    el('input', { type: 'checkbox', name: 'items', value: id }), el('span', { text: itemName(id) }), el('small', { class: 'taken' })))));
  const boxes = () => [...form.querySelectorAll('[name="items"]')];

  const pick = customer => {
    pickedCustomer = customer && customer.id ? customer : null;
    $('picked-customer').hidden = !pickedCustomer;
    $('find-customer').hidden = Boolean(pickedCustomer);
    $('picked-customer').querySelector('span').textContent = pickedCustomer ? `Existing customer: ${pickedCustomer.name}` : '';
    f('name').value = (customer && customer.name) || '';
    f('phone').value = (customer && customer.phone) || '';
    f('email').value = (customer && customer.email) || '';
    $('customer-find').value = '';
    $('customer-finds').replaceChildren();
  };
  $('unpick-customer').addEventListener('click', () => { pick(null); $('customer-find').focus(); });
  let findId = 0;
  $('customer-find').addEventListener('input', debounce(async () => {
    const id = ++findId;
    const query = search(['name', 'phone', 'email'], $('customer-find').value);
    if (!query) { $('customer-finds').replaceChildren(); return; }
    try {
      const rows = await db(`/rest/v1/customers?select=id,name,phone,email${query}&order=name&limit=6`);
      if (id !== findId) return;
      $('customer-finds').replaceChildren(...rows.map(c => el('li', {}, el('button', { type: 'button', onclick: () => pick(c) },
        el('strong', { text: c.name }), el('span', { class: 'sub', text: [c.phone, c.email].filter(Boolean).join(' · ') })))));
    } catch { /* typing again retries */ }
  }, 250));

  const openForm = ({ row = null, date = '', start = '', customer = null } = {}) => {
    editing = row;
    form.reset();
    say($('form-status'));
    $('form-title').textContent = row ? 'Edit booking' : 'New booking';
    pick(row ? { id: row.customer_id, name: row.customer_name, phone: row.customer_phone, email: row.customer_email } : customer);
    f('date').value = row ? row.start_local.slice(0, 10) : date || nowWall().slice(0, 10);
    f('start').value = row ? row.start_local.slice(11, 16) : start;
    f('end').value = row ? row.end_local.slice(11, 16) : '';
    f('setup').value = row ? row.setup_minutes : settings.setup_minutes;
    f('pickup').value = row ? row.pickup_minutes : settings.pickup_minutes;
    boxes().forEach(box => { box.checked = Boolean(row && row.items.includes(box.value)); });
    f('address').value = (row && row.address) || '';
    f('venue').value = (row && row.venue) || '';
    f('type').value = (row && row.event_type) || '';
    f('guests').value = (row && row.guests) || '';
    f('price').value = row && row.price != null ? row.price : '';
    f('deposit').checked = Boolean(row && row.deposit_paid);
    f('status').value = row ? (row.status === 'requested' ? 'requested' : row.status === 'confirmed' ? 'confirmed' : 'cancelled') : 'confirmed';
    f('notes').value = (row && row.notes) || '';
    paintOvernight();
    paintTaken(new Map());
    checkConflicts();
    close(bookingDialog);
    open(formDialog);
  };
  $('new-booking').addEventListener('click', () => openForm({ date: calendar && currentTab === 'calendar' && calendar.view.type === 'dayGridMonth' ? selectedDay : '' }));

  const paintOvernight = () => { f('overnight').hidden = !(f('start').value && f('end').value && f('end').value < f('start').value); };
  const paintTaken = taken => boxes().forEach(box => {
    const hit = taken.get(box.value);
    const label = box.closest('label');
    label.classList.toggle('is-taken', Boolean(hit));
    label.querySelector('.taken').textContent = hit ? `Booked ${timeText(hit.start_local)}–${timeText(hit.end_local)}${hit.customer_name ? ` · ${hit.customer_name}` : ''}` : '';
    box.disabled = Boolean(hit) && !box.checked;
  });
  let conflictId = 0;
  const checkConflicts = debounce(async () => {
    const id = ++conflictId;
    const [date, startTime, endTime] = [f('date').value, f('start').value, f('end').value];
    if (!date || !startTime || !endTime || startTime === endTime) { paintTaken(new Map()); return; }
    try {
      const rows = await rpc('item_conflicts', { p_date: date, p_start: startTime, p_end: endTime, p_setup: Number(f('setup').value) || 0, p_pickup: Number(f('pickup').value) || 0, p_booking: editing ? editing.id : null });
      if (id !== conflictId) return;
      const taken = new Map();
      rows.forEach(r => { if (!taken.has(r.item_id)) taken.set(r.item_id, r); });
      paintTaken(taken);
    } catch { /* saving checks again */ }
  }, 250);
  ['date', 'start', 'end', 'setup', 'pickup'].forEach(id => f(id).addEventListener('input', () => { paintOvernight(); checkConflicts(); }));

  const saveError = err => {
    if (err.code === '23P01') {
      const ids = /^[a-z-]+(,[a-z-]+)*$/.test(err.details || '') ? err.details.split(',') : [];
      return ids.length
        ? `${listNames(ids.map(itemName))} ${ids.length === 1 ? 'is' : 'are'} already booked at that time. Change the time or the items.`
        : 'Something you chose is already booked at that time. Change the time or the items.';
    }
    if (err.code === '22023') return 'Choose at least one item.';
    if (err.status === 403) return 'This account can’t change bookings.';
    return err.status ? `Couldn’t save (${err.message}).` : 'You’re offline, so this can’t be saved yet.';
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const items = boxes().filter(box => box.checked).map(box => box.value);
    if (!form.reportValidity()) return;
    if (!items.length) { say($('form-status'), 'Choose at least one item.', true); return; }
    if (f('start').value === f('end').value) { say($('form-status'), 'The end time can’t be the same as the start time.', true); return; }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    say($('form-status'), 'Saving…');
    try {
      await rpc('save_booking', { b: {
        id: editing ? editing.id : null,
        customer_id: pickedCustomer ? pickedCustomer.id : null,
        customer_name: f('name').value, customer_phone: f('phone').value, customer_email: f('email').value,
        date: f('date').value, start: f('start').value, end: f('end').value,
        setup_minutes: f('setup').value, pickup_minutes: f('pickup').value,
        items,
        address: f('address').value, venue: f('venue').value, event_type: f('type').value, guests: f('guests').value,
        price: f('price').value, deposit_paid: f('deposit').checked, status: f('status').value, notes: f('notes').value
      } });
      close(formDialog);
      toast(editing ? 'Booking updated' : 'Booking saved');
      refresh();
    } catch (err) {
      if (err.status !== 401) say($('form-status'), saveError(err), true);
      if (err.code === '23P01') checkConflicts();
    } finally {
      button.disabled = false;
    }
  });

  /* Bookings list */
  const PAGE = 50;
  let listKind = 'upcoming';
  let listOffset = 0;
  let listId = 0;
  const bookingRow = row => el('li', {}, el('button', { type: 'button', onclick: () => openBooking(row) },
    el('span', { class: 'date-chip', 'aria-hidden': 'true' }, el('small', { text: show(row.start_local, { month: 'short' }) }), el('b', { text: show(row.start_local, { day: 'numeric' }) })),
    el('span', {},
      el('span', { class: 'line1' }, row.customer_name || 'No name', badge(row.status)),
      el('span', { class: 'sub', text: whenText(row) }),
      el('span', { class: 'sub', text: itemList(row.items) }),
      row.address && el('span', { class: 'sub', text: row.address }))));
  const loadBookings = async reset => {
    const id = ++listId;
    if (reset) listOffset = 0;
    const now = nowWall();
    const query = search(['customer_name', 'customer_phone', 'address', 'venue', 'notes'], $('booking-search').value);
    const where = {
      upcoming: `status=in.(requested,confirmed)&end_local=gte.${now}&order=start_local.asc`,
      past: `status=in.(requested,confirmed)&end_local=lt.${now}&order=start_local.desc`,
      cancelled: 'status=in.(cancelled,declined,expired)&order=start_local.desc'
    }[listKind];
    try {
      const rows = await db(`/rest/v1/owner_bookings?select=*&${where}${query}&limit=${PAGE + 1}&offset=${listOffset}`);
      if (id !== listId) return;
      const page = rows.slice(0, PAGE);
      if (reset) $('booking-list').replaceChildren(...page.map(bookingRow)); else $('booking-list').append(...page.map(bookingRow));
      listOffset += page.length;
      $('booking-more').hidden = rows.length <= PAGE;
      const empty = reset && !page.length;
      $('booking-empty').hidden = !empty;
      $('booking-empty').textContent = query ? 'No bookings match your search.'
        : { upcoming: 'No upcoming bookings. Tap “New booking” to add one.', past: 'No past bookings yet.', cancelled: 'No cancelled bookings.' }[listKind];
    } catch (e) {
      if (e.status !== 401) toast(e.status ? `Bookings couldn’t load (${e.message}).` : 'You’re offline. Bookings will load when you’re back online.');
    }
  };
  document.querySelectorAll('[data-list]').forEach(b => b.addEventListener('click', () => {
    listKind = b.dataset.list;
    document.querySelectorAll('[data-list]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    loadBookings(true);
  }));
  $('booking-search').addEventListener('input', debounce(() => loadBookings(true), 300));
  $('booking-more').addEventListener('click', () => loadBookings(false));

  /* Customers */
  const customerDialog = $('customer-dialog');
  let customersId = 0;
  const loadCustomers = async () => {
    const id = ++customersId;
    const query = search(['name', 'phone', 'email'], $('customer-search').value);
    try {
      const rows = await db(`/rest/v1/owner_customers?select=*${query}&order=name&limit=300`);
      if (id !== customersId) return;
      $('customer-list').replaceChildren(...rows.map(c => el('li', {}, el('button', { type: 'button', onclick: () => openCustomer(c.id) },
        el('span', { class: 'avatar', 'aria-hidden': 'true', text: (c.name.trim()[0] || '?').toUpperCase() }),
        el('span', {},
          el('span', { class: 'line1', text: c.name }),
          (c.phone || c.email) && el('span', { class: 'sub', text: [c.phone, c.email].filter(Boolean).join(' · ') }),
          el('span', { class: 'sub', text: `${c.booking_count} booking${c.booking_count === 1 ? '' : 's'}${c.latest_event_local ? ` · latest ${dayText(c.latest_event_local)}` : ''}` }))))));
      $('customer-empty').hidden = rows.length > 0;
      $('customer-empty').textContent = query ? 'No customers match your search.' : 'No customers yet. They’re added when you save a booking.';
    } catch (e) {
      if (e.status !== 401) toast(e.status ? `Customers couldn’t load (${e.message}).` : 'You’re offline. Customers will load when you’re back online.');
    }
  };
  $('customer-search').addEventListener('input', debounce(loadCustomers, 300));

  const customerEditor = (customer = {}) => {
    const name = el('input', { type: 'text', required: true, maxlength: '200', value: customer.name || '' });
    const phone = el('input', { type: 'tel', maxlength: '40', value: customer.phone || '' });
    const email = el('input', { type: 'email', maxlength: '254', value: customer.email || '' });
    const notes = el('textarea', { rows: '3', maxlength: '5000' });
    notes.value = customer.notes || '';
    const status = el('p', { class: 'status', role: 'status' });
    const editor = el('form', { class: 'stack', novalidate: true },
      el('label', { class: 'field' }, 'Name *', name),
      el('div', { class: 'two' }, el('label', { class: 'field' }, 'Phone', phone), el('label', { class: 'field' }, 'Email', email)),
      el('label', { class: 'field' }, 'Notes', notes),
      status,
      el('button', { type: 'submit', class: 'btn primary', text: 'Save customer' }));
    editor.addEventListener('submit', async e => {
      e.preventDefault();
      if (!editor.reportValidity()) return;
      const body = { name: name.value.trim(), phone: phone.value.trim() || null, email: email.value.trim().toLowerCase() || null, notes: notes.value.trim() || null };
      try {
        const saved = customer.id
          ? await db(`/rest/v1/customers?id=eq.${customer.id}`, { method: 'PATCH', body, prefer: 'return=representation' })
          : await db('/rest/v1/customers', { method: 'POST', body, prefer: 'return=representation' });
        toast('Customer saved');
        if (currentTab === 'customers') loadCustomers();
        openCustomer(saved[0].id);
      } catch (err) {
        if (err.status !== 401) say(status, err.status ? `Couldn’t save (${err.message}).` : 'You’re offline, so this can’t be saved yet.', true);
      }
    });
    return editor;
  };
  const openCustomer = async id => {
    try {
      const [[customer], rows] = await Promise.all([
        db(`/rest/v1/owner_customers?select=*&id=eq.${id}`),
        db(`/rest/v1/owner_bookings?select=*&customer_id=eq.${id}&order=start_local.desc&limit=200`)
      ]);
      if (!customer) { toast('That customer no longer exists.'); return; }
      $('customer-title').textContent = customer.name;
      $('customer-body').replaceChildren(
        el('dl', { class: 'facts' },
          customer.phone && fact('Phone', customer.phone),
          customer.email && fact('Email', customer.email),
          customer.notes && fact('Notes', customer.notes),
          fact('Customer since', show(new Date(customer.created_at).toISOString(), { month: 'long', year: 'numeric' }))),
        contactLinks(customer.phone, customer.email),
        el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn primary', text: 'New booking for them', onclick: () => { close(customerDialog); openForm({ customer }); } }),
          el('button', { type: 'button', class: 'btn', text: 'Edit details', onclick: () => $('customer-body').replaceChildren(customerEditor(customer)) })),
        el('h3', { class: 'section-title', text: rows.length ? `Bookings (${rows.length})` : 'No bookings yet' }),
        el('ul', { class: 'list' }, rows.map(row => { const item = bookingRow(row); item.querySelector('button').addEventListener('click', () => close(customerDialog)); return item; })));
      open(customerDialog);
    } catch (e) {
      if (e.status !== 401) toast(e.status ? `Couldn’t open the customer (${e.message}).` : 'You’re offline right now.');
    }
  };
  $('new-customer').addEventListener('click', () => {
    $('customer-title').textContent = 'New customer';
    $('customer-body').replaceChildren(customerEditor());
    open(customerDialog);
  });

  /* More: install, settings, password */
  let installPrompt = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const paintInstall = () => {
    $('install-card').hidden = standalone();
    $('install-button').hidden = !installPrompt;
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) $('install-text').textContent = 'In Safari, tap the Share button (the square with an arrow), then “Add to Home Screen”.';
    else if (installPrompt) $('install-text').textContent = 'Install Bloom Bookings to open it from your home screen like any app.';
  };
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; paintInstall(); });
  $('install-button').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    paintInstall();
  });

  $('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!e.target.reportValidity()) return;
    const body = { setup_minutes: Number($('setting-setup').value), pickup_minutes: Number($('setting-pickup').value) };
    try {
      await db('/rest/v1/settings?id=eq.true', { method: 'PATCH', body, prefer: 'return=minimal' });
      settings = body;
      toast('Saved. New bookings will use these times.');
    } catch (err) {
      if (err.status !== 401) toast(err.status ? `Couldn’t save (${err.message}).` : 'You’re offline, so this can’t be saved yet.');
    }
  });

  const passwordDialog = $('password-dialog');
  const askForPassword = intro => {
    $('password-new-form').reset();
    $('password-username').value = session ? session.email : '';
    say($('password-status'));
    $('password-intro').textContent = intro;
    open(passwordDialog);
  };
  $('change-password').addEventListener('click', () => askForPassword('Use at least 8 characters. Your phone can save it for you.'));
  $('password-new-form').addEventListener('submit', async e => {
    e.preventDefault();
    const [first, second] = [$('new-password').value, $('new-password-2').value];
    if (!e.target.reportValidity()) return;
    if (first !== second) { say($('password-status'), 'The two passwords don’t match.', true); return; }
    try {
      await request('/auth/v1/user', { method: 'PUT', token: await accessToken(), body: { password: first } });
      close(passwordDialog);
      toast('Password saved. Use it to sign in from the app.');
    } catch (err) {
      say($('password-status'), err.status === 401 ? 'Your sign-in expired. Sign in again, then change your password.' : err.status ? `Couldn’t save the password (${err.message}).` : 'You’re offline, so this can’t be saved yet.', true);
    }
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  /* Arriving from an emailed sign-in link: the sign-in (or an error) is after the # */
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

  if (!session) { showOnly('signin'); say($('signin-status'), linkMessage, Boolean(linkMessage)); return; }
  start().then(() => {
    if (fromLink.has('access_token') && !$('shell').hidden) askForPassword('Choose a password so you can sign in from the app on your home screen. Use at least 8 characters.');
  });
})();
