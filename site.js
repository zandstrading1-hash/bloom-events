/* Shared navigation, collection viewer, rental picks, availability calendar and booking requests. No dependencies. */
(() => {
  'use strict';
  document.documentElement.classList.add('js-ready');
  const filters = [...document.querySelectorAll('.gallery-filter')];
  const cards = [...document.querySelectorAll('.portfolio-card')];
  const films = document.getElementById('films');
  const count = document.querySelector('.gallery-count');
  filters.forEach(button => button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    filters.forEach(b => { const active = b === button; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
    cards.forEach(card => { card.hidden = filter !== 'all' && card.dataset.cats !== filter; });
    if (films) {
      films.hidden = !['all', 'videos'].includes(filter);
      if (films.hidden) films.querySelectorAll('video').forEach(v => v.pause());
    }
    const photos = cards.filter(c => !c.hidden).length;
    if (count) count.textContent = filter === 'all' ? `${photos} photos · 2 films` : filter === 'videos' ? '2 films' : `${photos} photos`;
    document.querySelector('.portfolio-grid').hidden = photos === 0;
  }));

  const dialog = document.getElementById('lightbox');
  if (dialog && typeof dialog.showModal === 'function') {
    let image = document.getElementById('lightbox-img');
    const caption = document.getElementById('lightbox-caption');
    const position = document.getElementById('lightbox-position');
    const status = document.getElementById('lightbox-status');
    const imageLinks = [...document.querySelectorAll('[data-lightbox]')];
    let activeLink;
    let opener;
    let scrollY = 0;
    let bodyStyles;
    let request = 0;
    let gesture;
    const cache = new Map();
    const visibleLinks = () => imageLinks.filter(link => !link.closest('.portfolio-card').hidden);
    const loadImage = link => {
      if (!cache.has(link.href)) {
        const photo = new Image();
        photo.alt = link.querySelector('img').alt;
        photo.draggable = false;
        photo.src = link.href;
        cache.set(link.href, photo.decode().then(() => photo).catch(error => {
          cache.delete(link.href);
          throw error;
        }));
      }
      return cache.get(link.href);
    };
    const showImage = async link => {
      activeLink = link;
      const currentRequest = ++request;
      status.textContent = 'Loading photo…';
      try {
        const photo = await loadImage(link);
        if (currentRequest !== request || !dialog.open) return;
        // Swap an already decoded image; keep the previous photo during loading.
        if (photo !== image) {
          image.removeAttribute('id');
          photo.id = 'lightbox-img';
          image.replaceWith(photo);
          image = photo;
        }
        caption.textContent = link.dataset.caption;
        const visible = visibleLinks();
        const index = visible.indexOf(link);
        position.textContent = `${index + 1} / ${visible.length}`;
        status.textContent = '';
        for (const offset of [-1, 1]) {
          loadImage(visible[(index + offset + visible.length) % visible.length]).catch(() => {});
        }
      } catch {
        if (currentRequest === request && dialog.open) status.textContent = 'Photo could not load. Try Previous or Next again.';
      }
    };
    const step = direction => { const visible = visibleLinks(); showImage(visible[(visible.indexOf(activeLink) + direction + visible.length) % visible.length]); };
    imageLinks.forEach(link => link.addEventListener('click', e => {
      e.preventDefault();
      opener = link;
      scrollY = window.scrollY;
      bodyStyles = ['position', 'top', 'width', 'overflow'].map(property => [property, document.body.style[property]]);
      document.documentElement.classList.add('viewer-open');
      Object.assign(document.body.style, { position: 'fixed', top: `-${scrollY}px`, width: '100%', overflow: 'hidden' });
      const thumbnail = link.querySelector('img');
      const preview = new Image();
      preview.id = 'lightbox-img';
      preview.alt = thumbnail.alt;
      preview.draggable = false;
      preview.src = thumbnail.currentSrc || thumbnail.src;
      image.removeAttribute('id');
      image.replaceWith(preview);
      image = preview;
      caption.textContent = link.dataset.caption;
      position.textContent = '';
      dialog.showModal();
      showImage(link);
      dialog.querySelector('.lightbox-close').focus();
    }));
    dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.lightbox-prev').addEventListener('click', () => step(-1));
    dialog.querySelector('.lightbox-next').addEventListener('click', () => step(1));
    dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } });
    dialog.addEventListener('wheel', e => { if (!e.ctrlKey) e.preventDefault(); }, { passive: false });
    dialog.addEventListener('pointerdown', e => {
      gesture = e.isPrimary && !e.target.closest('button') ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    });
    dialog.addEventListener('pointerup', e => {
      if (!gesture || gesture.id !== e.pointerId) return;
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      gesture = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    });
    dialog.addEventListener('pointercancel', () => { gesture = null; });
    dialog.addEventListener('close', () => {
      ++request;
      gesture = null;
      bodyStyles.forEach(([property, value]) => { document.body.style[property] = value; });
      document.documentElement.classList.remove('viewer-open');
      window.scrollTo({ top: scrollY, behavior: 'instant' });
      opener?.focus({ preventScroll: true });
      status.textContent = '';
    });
  }

  const videos = [...document.querySelectorAll('video')];
  videos.forEach(video => video.addEventListener('play', () => videos.forEach(other => { if (other !== video) other.pause(); })));

  /* Rental picks: each item can be picked once. Kept in localStorage (and the Book link) so they reach the Book page. */
  const RENTALS = {
    'ivory-wall': 'Ivory flower wall',
    'garden-wall': 'Garden flower wall',
    'pink-ombre-wall': 'Pink ombre wall',
    'red-rose-wall': 'Red rose wall',
    'champagne-wall': 'Champagne rose wall',
    'greenery-wall': 'Greenery wall',
    'ivory-texture-wall': 'Ivory textured wall',
    'bloom-bar': 'Bloom bar',
    'pedestals': 'White pedestals',
    'sweets-cart': 'Sweets cart',
    'pkg-sweet-setup': 'The Sweet Setup package',
    'pkg-bridal-suite': 'The Bridal Suite package',
    'pkg-full-bloom': 'The Full Bloom package'
  };
  // Packages are booked as their parts; the wall in a package is picked separately.
  const PARTS = {
    'pkg-sweet-setup': ['bloom-bar', 'sweets-cart'],
    'pkg-bridal-suite': ['bloom-bar'],
    'pkg-full-bloom': ['bloom-bar', 'pedestals', 'sweets-cart']
  };
  const WALLS = Object.keys(RENTALS).filter(id => id.endsWith('-wall'));
  const ITEMS = Object.keys(RENTALS).filter(id => !PARTS[id]);
  // The publishable key is meant to be public: it can only read when items are held (never names) and send booking requests.
  const DB = { url: 'https://dwazctmqkrnajqmswtiy.supabase.co', key: 'sb_publishable_ZtfrALD9rvIFPSuJ7uZabw_8lTNSD2x' };

  const params = new URLSearchParams(location.search);
  const PICKS_KEY = 'bloom-picks';
  const clean = ids => [...new Set(ids)].filter(id => Object.prototype.hasOwnProperty.call(RENTALS, id));
  let picks = [];
  try { picks = clean(JSON.parse(localStorage.getItem(PICKS_KEY) || '[]')); } catch { picks = []; }
  const fromLink = params.get('picks');
  if (fromLink) picks = clean([...picks, ...fromLink.split(',')]);
  const store = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* storage blocked: the Book link still carries the picks */ } };

  // The event date and times travel with the picks, chosen on the Rentals calendar or the Book form.
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const longDate = s => parseIso(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const todayIso = iso(new Date());
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parseIso(s)) === s && s >= todayIso ? s : '';
  const validTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
  const timeLabel = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
  // Start times run 6 AM to 11:30 PM; an event can end up to 2 AM the next day.
  const TIMES = Array.from({ length: 36 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  const NEXT_DAY = ['00:00', '00:30', '01:00', '01:30', '02:00'];
  const splitTimes = s => { const [a = '', b = ''] = String(s || '').split('-'); return validTime(a) && validTime(b) ? [a, b] : ['', '']; };
  const DATE_KEY = 'bloom-date';
  const TIME_KEY = 'bloom-time';
  let chosenDate = '';
  let [chosenStart, chosenEnd] = ['', ''];
  try {
    chosenDate = validDate(localStorage.getItem(DATE_KEY));
    [chosenStart, chosenEnd] = splitTimes(localStorage.getItem(TIME_KEY));
  } catch { /* storage blocked: the Book link still carries the date and times */ }
  chosenDate = validDate(params.get('date')) || chosenDate;
  if (params.get('time')) [chosenStart, chosenEnd] = splitTimes(params.get('time'));
  const storeDate = () => {
    try {
      if (chosenDate) localStorage.setItem(DATE_KEY, chosenDate); else localStorage.removeItem(DATE_KEY);
      if (chosenStart && chosenEnd) localStorage.setItem(TIME_KEY, `${chosenStart}-${chosenEnd}`); else localStorage.removeItem(TIME_KEY);
    } catch { /* the Book link still carries them */ }
  };
  storeDate();
  const timesInOrder = () => Boolean(chosenStart && chosenEnd && (chosenEnd > chosenStart || NEXT_DAY.includes(chosenEnd)));
  const hasTimes = () => Boolean(chosenDate && timesInOrder());
  const bookHref = () => {
    const query = [picks.length && `picks=${picks.join(',')}`, chosenDate && `date=${chosenDate}`, chosenStart && chosenEnd && `time=${chosenStart}-${chosenEnd}`].filter(Boolean).join('&');
    return query ? `contact.html?${query}` : 'contact.html';
  };
  const fillTimes = (select, end) => {
    if (!select) return;
    select.replaceChildren(new Option('Choose a time', ''), ...TIMES.slice(end ? 1 : 0).map(t => new Option(timeLabel(t), t)),
      ...(end ? NEXT_DAY.map(t => new Option(`${timeLabel(t)} (next day)`, t)) : []));
  };

  /* Availability from Supabase: when each item is held (setup to pickup), as Detroit wall-clock times.
     If it can't be reached, nothing is blocked and requests can go out by text or email instead. */
  const rest = (path, body, ms) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(`${DB.url}/rest/v1/${path}`, {
      method: 'POST',
      headers: { apikey: DB.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    }).then(async r => {
      const data = await r.json().catch(() => null);
      if (!r.ok) throw Object.assign(new Error((data && data.message) || `request failed, ${r.status}`), { status: r.status, code: data && data.code, details: data && data.details });
      return data;
    }).finally(() => clearTimeout(timer));
  };
  // Wall-clock times are compared as if they were UTC, so the visitor's own timezone never shifts them.
  const DAY_MS = 86400000;
  const wallMs = s => Date.parse(`${s.slice(0, 19)}Z`);
  const clock = ms => timeLabel(new Date(ms).toISOString().slice(11, 16));
  const toRanges = rows => rows.map(r => ({ item: r.item_id, from: wallMs(r.busy_from), until: wallMs(r.busy_until) }));
  let rulesRequest = null;
  const loadRules = () => {
    rulesRequest = rulesRequest || rest('rpc/booking_rules', {}, 8000).then(rows => rows[0]);
    rulesRequest.catch(() => { rulesRequest = null; });
    return rulesRequest;
  };
  const months = new Map();
  // For the calendar: which items have any hold on each day of a month.
  const monthAvailability = (year, month) => {
    const key = `${year}-${month}`;
    if (!months.has(key)) {
      const request = rest('rpc/availability', { from_date: iso(new Date(year, month, 1)), to_date: iso(new Date(year, month + 1, 0)) }, 8000)
        .then(rows => toRanges(rows).reduce((byDate, r) => {
          for (let t = Date.parse(`${new Date(r.from).toISOString().slice(0, 10)}T00:00:00Z`); t < r.until; t += DAY_MS) {
            const day = new Date(t).toISOString().slice(0, 10);
            byDate.set(day, (byDate.get(day) || new Set()).add(r.item));
          }
          return byDate;
        }, new Map()));
      request.catch(() => months.delete(key));
      months.set(key, request);
    }
    return months.get(key);
  };
  const isBooked = (id, booked) => (PARTS[id] || [id]).some(part => booked.has(part));
  const listNames = names => names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  window.BloomEvents = { RENTALS, PARTS, DB, iso, parseIso, listNames };

  const pickList = document.getElementById('picks-list');
  const eventDate = document.getElementById('event_date');
  const eventStart = document.getElementById('event_start');
  const eventEnd = document.getElementById('event_end');
  const pickStart = document.getElementById('pick-start');
  const pickEnd = document.getElementById('pick-end');
  const timePick = document.getElementById('time-pick');
  const dateStatus = document.getElementById('date-status');
  const dateNote = document.getElementById('date-note');
  const dateClear = document.getElementById('date-clear');
  const needsAvailability = Boolean(document.getElementById('date-cal') || eventDate);
  let availability = 'none'; // none | loading | ready | error
  let rules = { setup_minutes: 120, pickup_minutes: 120 };
  let dayRanges = [];
  let availabilityCheck = Promise.resolve();
  let checkId = 0;
  const onChosenDay = () => { const start = Date.parse(`${chosenDate}T00:00:00Z`); return dayRanges.filter(r => r.from < start + DAY_MS && r.until > start); };
  // What's held around the customer's event, including our setup and pickup time.
  const takenAtTime = () => {
    if (!hasTimes()) return new Set();
    const start = wallMs(`${chosenDate}T${chosenStart}:00`);
    let end = wallMs(`${chosenDate}T${chosenEnd}:00`);
    if (end <= start) end += DAY_MS;
    const [from, until] = [start - rules.setup_minutes * 60000, end + rules.pickup_minutes * 60000];
    return new Set(dayRanges.filter(r => r.from < until && r.until > from).map(r => r.item));
  };
  const busyText = id => [...new Set(onChosenDay().filter(r => (PARTS[id] || [id]).includes(r.item)).map(r => `${clock(r.from)}–${clock(r.until)}`))].join(', ');
  const paintAvailability = () => {
    const ready = availability === 'ready';
    const timed = ready && hasTimes();
    const taken = ready ? takenAtTime() : new Set();
    // A picked item stays tappable when it's taken, so it can still be removed.
    document.querySelectorAll('[data-pick]').forEach(btn => {
      const id = btn.dataset.pick;
      const blocked = timed && isBooked(id, taken);
      const busy = ready ? busyText(id) : '';
      btn.classList.toggle('is-booked', blocked);
      btn.disabled = blocked && !picks.includes(id);
      if (blocked && !btn.querySelector('.pick-booked')) btn.insertAdjacentHTML('beforeend', '<span class="pick-booked">Booked at that time</span>');
      const card = btn.closest('[data-pick-card]');
      if (card) card.classList.toggle('is-booked', blocked);
      let note = btn.parentElement.querySelector(`.pick-note[data-for="${id}"]`);
      if (busy && !note) {
        note = document.createElement('div');
        note.className = 'pick-note';
        note.dataset.for = id;
        btn.before(note);
      }
      if (note) {
        note.textContent = busy && (!timed || blocked) ? `Taken ${busy}` : '';
        note.hidden = !note.textContent;
      }
    });
    if (pickList) pickList.querySelectorAll('li').forEach(li => {
      const blocked = timed && isBooked(li.dataset.id, taken);
      li.classList.toggle('is-booked', blocked);
      const tag = li.querySelector('.pick-taken');
      tag.textContent = blocked ? `Taken ${busyText(li.dataset.id)}` : '';
      tag.hidden = !blocked;
    });
    const when = hasTimes() ? `${longDate(chosenDate)}, ${timeLabel(chosenStart)} to ${timeLabel(chosenEnd)}` : '';
    const conflicts = timed ? picks.filter(id => isBooked(id, taken)) : [];
    const conflictText = conflicts.length ? `${listNames(conflicts.map(id => RENTALS[id]))} ${conflicts.length === 1 ? 'isn’t' : 'aren’t'} available at that time. Remove ${conflicts.length === 1 ? 'it' : 'them'} or choose another time.` : '';
    const orderText = chosenStart && chosenEnd && !timesInOrder() ? 'The end time needs to be after the start time.' : '';
    const unavailableText = 'We couldn’t check availability just now. You can still send your request and we’ll confirm your date.';
    if (eventStart) eventStart.setCustomValidity(conflictText);
    if (eventEnd) eventEnd.setCustomValidity(orderText);
    if (dateNote) {
      dateNote.textContent = conflictText || orderText || (availability === 'error' ? unavailableText
        : timed && picks.length ? `Everything you picked is free on ${when}.`
        : ready && picks.length ? 'Choose your start and end time to check your picks.' : '');
      dateNote.className = `date-note${conflictText || orderText ? ' is-conflict' : ''}`;
    }
    if (dateStatus) {
      const busyCount = ITEMS.filter(id => onChosenDay().some(r => r.item === id)).length;
      const takenCount = ITEMS.filter(id => taken.has(id)).length;
      dateStatus.textContent = !chosenDate ? '' : availability === 'loading' ? 'Checking availability…'
        : availability === 'error' ? unavailableText
        : orderText ? orderText
        : timed ? (takenCount ? `${when}: ${takenCount} ${takenCount === 1 ? 'item is' : 'items are'} booked at that time and marked below. Everything else is free.` : `Everything is free on ${when}.`)
        : busyCount ? `${longDate(chosenDate)}: ${busyCount} ${busyCount === 1 ? 'item has a booking' : 'items have bookings'} that day, with the times below. Choose your event times to see what’s free then.`
        : `Everything is free on ${longDate(chosenDate)}.`;
    }
    if (dateClear) dateClear.hidden = !chosenDate;
    if (timePick) timePick.hidden = !chosenDate;
  };
  const checkDate = () => {
    const id = ++checkId;
    availability = chosenDate ? 'loading' : 'none';
    paintAvailability();
    if (!chosenDate) { availabilityCheck = Promise.resolve(); return; }
    const d = parseIso(chosenDate);
    // The day before and after too, for events and setup that cross midnight.
    const around = { from_date: iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)), to_date: iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) };
    availabilityCheck = Promise.all([loadRules(), rest('rpc/availability', around, 8000)])
      .then(([current, rows]) => { if (id === checkId) { if (current) rules = current; dayRanges = toRanges(rows); availability = 'ready'; } },
        () => { if (id === checkId) availability = 'error'; })
      .then(() => { if (id === checkId) paintAvailability(); });
  };
  const setTimes = (start, end) => { chosenStart = start; chosenEnd = end; storeDate(); renderPicks(); };
  [[pickStart, pickEnd], [eventStart, eventEnd]].forEach(([startSelect, endSelect]) => {
    if (!startSelect) return;
    fillTimes(startSelect, false);
    fillTimes(endSelect, true);
    startSelect.value = chosenStart;
    endSelect.value = chosenEnd;
    startSelect.addEventListener('change', () => setTimes(startSelect.value, endSelect.value));
    endSelect.addEventListener('change', () => setTimes(startSelect.value, endSelect.value));
  });

  const renderPicks = () => {
    document.querySelectorAll('[data-pick]').forEach(btn => {
      const on = picks.includes(btn.dataset.pick);
      btn.setAttribute('aria-pressed', String(on));
      const card = btn.closest('[data-pick-card]');
      if (card) card.classList.toggle('is-picked', on);
    });
    document.body.classList.toggle('has-picks', picks.length > 0);
    document.querySelectorAll('.book-bar-link, .nav-cta').forEach(link => { link.href = bookHref(); });
    const label = document.querySelector('.book-bar-label');
    const count = document.querySelector('.book-bar-count');
    if (label) label.textContent = picks.length ? `Book ${picks.length === 1 ? 'your pick' : `your ${picks.length} picks`}` : 'Book now';
    if (count) { count.hidden = !picks.length; count.textContent = picks.length; }
    if (pickList) {
      pickList.replaceChildren(...picks.map(id => {
        const li = document.createElement('li');
        li.dataset.id = id;
        const name = document.createElement('span');
        name.textContent = RENTALS[id];
        const taken = document.createElement('small');
        taken.className = 'pick-taken';
        taken.hidden = true;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'pick-remove';
        remove.dataset.remove = id;
        remove.setAttribute('aria-label', `Remove ${RENTALS[id]}`);
        remove.textContent = 'Remove';
        li.append(name, taken, remove);
        return li;
      }));
      const empty = document.getElementById('picks-empty');
      if (empty) empty.hidden = picks.length > 0;
      const more = document.getElementById('picks-more');
      if (more) more.textContent = picks.length ? 'Add more rentals' : 'Browse rentals';
      const field = document.getElementById('rentals-field');
      if (field) field.value = picks.map(id => RENTALS[id]).join(', ');
    }
    paintAvailability();
  };
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-pick]');
    const remove = e.target.closest('[data-remove]');
    if (!btn && !remove) return;
    const id = btn ? btn.dataset.pick : remove.dataset.remove;
    picks = picks.includes(id) ? picks.filter(p => p !== id) : (btn ? [...picks, id] : picks);
    store(); renderPicks();
  });
  store(); renderPicks();

  /* Rentals page calendar: choose a date (and times) to see what's free. Days with bookings are marked. */
  const cal = document.getElementById('date-cal');
  if (cal) {
    document.getElementById('check-date').hidden = false;
    const monthLabel = document.getElementById('cal-month');
    const days = cal.querySelector('tbody');
    const prev = document.getElementById('cal-prev');
    const next = document.getElementById('cal-next');
    const MONTHS_AHEAD = 18;
    const now = new Date();
    const firstMonth = now.getFullYear() * 12 + now.getMonth();
    const lastDay = iso(new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD, 0));
    let view = chosenDate ? parseIso(chosenDate) : now;
    view = new Date(view.getFullYear(), view.getMonth(), 1);
    let focusDay = '';
    const selectable = day => day >= todayIso && day <= lastDay;
    const markMonth = (year, month) => monthAvailability(year, month).then(byDate => {
      if (view.getFullYear() !== year || view.getMonth() !== month) return;
      days.querySelectorAll('.cal-day').forEach(b => {
        const busy = byDate.get(b.dataset.date);
        const full = Boolean(busy && WALLS.every(w => busy.has(w)));
        b.classList.toggle('walls-full', full);
        b.classList.toggle('has-bookings', Boolean(busy) && !full);
        b.setAttribute('aria-label', `${longDate(b.dataset.date)}${full ? ', every flower wall has a booking' : busy ? ', some items have bookings' : ''}`);
      });
    }, () => {
      if (!chosenDate && dateStatus) dateStatus.textContent = 'We couldn’t load availability just now. You can still send a request and we’ll confirm your date.';
    });
    const renderMonth = () => {
      const year = view.getFullYear();
      const month = view.getMonth();
      const index = year * 12 + month;
      monthLabel.textContent = view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      prev.disabled = index <= firstMonth;
      next.disabled = index >= firstMonth + MONTHS_AHEAD - 1;
      const cells = [...Array(new Date(year, month, 1).getDay()).fill('')];
      for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d++) cells.push(iso(new Date(year, month, d)));
      while (cells.length % 7) cells.push('');
      const inView = day => day && parseIso(day).getMonth() === month && parseIso(day).getFullYear() === year && selectable(day);
      const tabStop = [focusDay, chosenDate, todayIso].find(inView) || cells.find(day => day && selectable(day));
      const rows = [];
      for (let i = 0; i < cells.length; i += 7) {
        const row = document.createElement('tr');
        cells.slice(i, i + 7).forEach(day => {
          const cell = document.createElement('td');
          if (day) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cal-day';
            b.dataset.date = day;
            b.textContent = Number(day.slice(8));
            b.disabled = !selectable(day);
            b.tabIndex = day === tabStop ? 0 : -1;
            b.setAttribute('aria-pressed', String(day === chosenDate));
            b.setAttribute('aria-label', longDate(day));
            if (day === todayIso) b.setAttribute('aria-current', 'date');
            cell.append(b);
          }
          row.append(cell);
        });
        rows.push(row);
      }
      days.replaceChildren(...rows);
      markMonth(year, month);
    };
    const choose = day => {
      chosenDate = day;
      if (day) focusDay = day;
      days.querySelectorAll('.cal-day').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.date === day));
        if (day) b.tabIndex = b.dataset.date === day ? 0 : -1;
      });
      storeDate(); renderPicks(); checkDate();
    };
    days.addEventListener('click', e => {
      const b = e.target.closest('.cal-day');
      if (b && !b.disabled) choose(b.dataset.date);
    });
    days.addEventListener('keydown', e => {
      const b = e.target.closest('.cal-day');
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!b || !step) return;
      e.preventDefault();
      const d = parseIso(b.dataset.date);
      d.setDate(d.getDate() + step);
      const target = iso(d);
      if (!selectable(target)) return;
      focusDay = target;
      if (d.getMonth() !== view.getMonth()) { view = new Date(d.getFullYear(), d.getMonth(), 1); renderMonth(); }
      days.querySelectorAll('.cal-day').forEach(x => { x.tabIndex = x.dataset.date === target ? 0 : -1; });
      days.querySelector(`[data-date="${target}"]`).focus();
    });
    [[prev, -1], [next, 1]].forEach(([button, step]) => button.addEventListener('click', () => {
      view = new Date(view.getFullYear(), view.getMonth() + step, 1);
      focusDay = '';
      renderMonth();
    }));
    dateClear.addEventListener('click', () => { choose(''); days.querySelector('.cal-day[tabindex="0"]')?.focus(); });
    renderMonth();
  }
  if (needsAvailability) checkDate();

  /* Book page: the request is saved straight into the owner's app and holds the picks while she confirms. */
  const form = document.getElementById('inquire-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit.querySelector('span');
  const key = form.querySelector('[name="access_key"]');
  const emailCopy = Boolean(key && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key.value.trim()));
  const alt = document.getElementById('book-alt');
  if (eventDate) {
    eventDate.min = todayIso;
    if (!eventDate.value && chosenDate) eventDate.value = chosenDate;
    eventDate.addEventListener('change', () => { chosenDate = validDate(eventDate.value); storeDate(); renderPicks(); checkDate(); });
  }
  // A request sent while the date is still being checked waits briefly for the answer.
  const availabilityKnown = () => availability === 'loading' ? Promise.race([availabilityCheck, new Promise(r => setTimeout(r, 3000))]) : Promise.resolve();
  const idle = 'Send booking request';
  submitLabel.textContent = idle;
  const held = () => [...new Set(picks.flatMap(id => PARTS[id] || [id]))];
  const holdText = s => new Date(`${s}Z`).toLocaleString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // If the request can't be sent online, it can still go out through the visitor's own text or email app.
  const summary = () => {
    const d = new FormData(form);
    const line = (label, name) => (d.get(name) || '').toString().trim() ? `${label}: ${d.get(name).toString().trim()}` : '';
    return ['Booking request for Bloom Events',
      line('Name', 'name'), line('Date', 'event_date'), hasTimes() ? `Time: ${timeLabel(chosenStart)} to ${timeLabel(chosenEnd)}` : '',
      line('Email', 'email'), line('Phone', 'phone'), line('Celebrating', 'event_type'), line('Guests', 'guests'),
      line('Venue', 'venue'), line('Address', 'address'),
      picks.length ? `Picks: ${picks.map(id => RENTALS[id]).join(', ')}` : '',
      line('Notes', 'message')].filter(Boolean).join('\n');
  };
  [['send-text', () => `sms:+15863604200?&body=${encodeURIComponent(summary())}`],
    ['send-email', () => `mailto:hello@bloomevents.com?subject=${encodeURIComponent('Booking request')}&body=${encodeURIComponent(summary())}`]].forEach(([id, href]) => {
    const link = document.getElementById(id);
    if (link) link.addEventListener('click', async e => {
      e.preventDefault();
      await availabilityKnown();
      if (form.reportValidity()) location.href = href();
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    await availabilityKnown();
    if (!form.reportValidity() || submit.disabled) return;
    const data = new FormData(form);
    const value = name => (data.get(name) || '').toString().trim();
    const packages = picks.filter(id => PARTS[id]).map(id => RENTALS[id]);
    const items = held();
    submit.disabled = true;
    submitLabel.textContent = 'Sending…';
    status.textContent = '';
    status.className = 'form-status';
    try {
      const result = await rest('rpc/request_booking', { r: {
        name: value('name'), email: value('email'), phone: value('phone'),
        date: value('event_date'), start: value('event_start'), end: value('event_end'), items,
        event_type: value('event_type'), guests: value('guests'), venue: value('venue'), address: value('address'),
        notes: [packages.length && `Package: ${packages.join(', ')}`, value('message')].filter(Boolean).join('\n'),
        trap: value('botcheck')
      } }, 15000);
      status.className = 'form-status show success';
      status.textContent = result && result.hold_until && items.length
        ? `Thank you! Your request is in. We’re holding ${listNames(items.map(id => RENTALS[id]))} for you until ${holdText(result.hold_until)} while we confirm, and we’ll reply by email or text.`
        : 'Thank you! Your request is in. We’ll reply by email or text to confirm your date and send a quote.';
      if (emailCopy) fetch('https://api.web3forms.com/submit', { method: 'POST', body: data, headers: { Accept: 'application/json' } }).catch(() => {});
      if (alt) alt.hidden = true;
      form.reset();
      picks = []; chosenDate = ''; chosenStart = ''; chosenEnd = '';
      store(); storeDate(); renderPicks(); checkDate();
    } catch (err) {
      status.className = 'form-status show error';
      if (err.code === '23P01') {
        const ids = /^[a-z-]+(,[a-z-]+)*$/.test(err.details || '') ? err.details.split(',') : [];
        status.textContent = ids.length
          ? `${listNames(ids.map(id => RENTALS[id]))} ${ids.length === 1 ? 'was' : 'were'} just booked at that time. Remove ${ids.length === 1 ? 'it' : 'them'} or choose another time.`
          : 'Something you picked was just booked at that time. Remove it or choose another time.';
        months.clear();
        checkDate();
      } else if (err.message === 'pending_limit') {
        status.textContent = 'You already have two requests waiting for us to confirm. We’ll reply soon, or call or text (586) 360-4200.';
      } else if (err.message === 'busy') {
        status.textContent = 'We’re getting a lot of requests right now. Please try again a little later, or call or text (586) 360-4200.';
      } else if (err.code === '22023') {
        status.textContent = 'Please check your date, times and email, then try again.';
      } else {
        status.textContent = 'Your request couldn’t be sent online right now. You can send it by text or email instead, or call (586) 360-4200.';
        if (alt) alt.hidden = false;
      }
    } finally {
      submit.disabled = false;
      submitLabel.textContent = idle;
      status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
})();
