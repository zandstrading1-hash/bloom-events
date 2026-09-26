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
  // The publishable key is meant to be public: it can only call booked_items(), which returns item ids and dates, never names.
  const DB = { url: 'https://dwazctmqkrnajqmswtiy.supabase.co', key: 'sb_publishable_ZtfrALD9rvIFPSuJ7uZabw_8lTNSD2x' };

  const params = new URLSearchParams(location.search);
  const PICKS_KEY = 'bloom-picks';
  const clean = ids => [...new Set(ids)].filter(id => Object.prototype.hasOwnProperty.call(RENTALS, id));
  let picks = [];
  try { picks = clean(JSON.parse(localStorage.getItem(PICKS_KEY) || '[]')); } catch { picks = []; }
  const fromLink = params.get('picks');
  if (fromLink) picks = clean([...picks, ...fromLink.split(',')]);
  const store = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* storage blocked: the Book link still carries the picks */ } };

  // The event date travels with the picks, chosen on the Rentals calendar or the Book form.
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const longDate = s => parseIso(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const todayIso = iso(new Date());
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parseIso(s)) === s && s >= todayIso ? s : '';
  const DATE_KEY = 'bloom-date';
  let chosenDate = '';
  try { chosenDate = validDate(localStorage.getItem(DATE_KEY)); } catch { chosenDate = ''; }
  chosenDate = validDate(params.get('date')) || chosenDate;
  const storeDate = () => { try { if (chosenDate) localStorage.setItem(DATE_KEY, chosenDate); else localStorage.removeItem(DATE_KEY); } catch { /* the Book link still carries the date */ } };
  storeDate();
  const bookHref = () => {
    const query = [picks.length && `picks=${picks.join(',')}`, chosenDate && `date=${chosenDate}`].filter(Boolean).join('&');
    return query ? `contact.html?${query}` : 'contact.html';
  };

  /* Availability from Supabase. If it can't be reached, nothing is blocked and the owner confirms dates by reply, as before. */
  const months = new Map();
  const bookedInMonth = (year, month) => {
    const key = `${year}-${month}`;
    if (!months.has(key)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const request = fetch(`${DB.url}/rest/v1/rpc/booked_items`, {
        method: 'POST',
        headers: { apikey: DB.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_date: iso(new Date(year, month, 1)), to_date: iso(new Date(year, month + 1, 0)) }),
        signal: controller.signal
      }).then(r => { if (!r.ok) throw new Error(`Availability ${r.status}`); return r.json(); })
        .then(rows => rows.reduce((byDate, row) => byDate.set(row.event_date, (byDate.get(row.event_date) || new Set()).add(row.item_id)), new Map()))
        .finally(() => clearTimeout(timer));
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
  const dateStatus = document.getElementById('date-status');
  const dateNote = document.getElementById('date-note');
  const dateClear = document.getElementById('date-clear');
  const needsAvailability = Boolean(document.getElementById('date-cal') || eventDate);
  let availability = 'none'; // none | loading | ready | error
  let bookedThatDay = new Set();
  let availabilityCheck = Promise.resolve();
  let checkId = 0;
  const paintAvailability = () => {
    const booked = availability === 'ready' ? bookedThatDay : new Set();
    // A picked item stays tappable when it's booked, so it can still be removed.
    document.querySelectorAll('[data-pick]').forEach(btn => {
      const id = btn.dataset.pick;
      const taken = isBooked(id, booked);
      btn.classList.toggle('is-booked', taken);
      btn.disabled = taken && !picks.includes(id);
      if (taken && !btn.querySelector('.pick-booked')) btn.insertAdjacentHTML('beforeend', '<span class="pick-booked">Booked that day</span>');
      const card = btn.closest('[data-pick-card]');
      if (card) card.classList.toggle('is-booked', taken);
    });
    if (pickList) pickList.querySelectorAll('li').forEach(li => {
      const taken = isBooked(li.dataset.id, booked);
      li.classList.toggle('is-booked', taken);
      li.querySelector('.pick-taken').hidden = !taken;
    });
    const conflicts = picks.filter(id => isBooked(id, booked));
    const conflictText = conflicts.length ? `${listNames(conflicts.map(id => RENTALS[id]))} ${conflicts.length === 1 ? 'isn’t' : 'aren’t'} available on ${longDate(chosenDate)}. Remove ${conflicts.length === 1 ? 'it' : 'them'} or choose another date.` : '';
    const unavailableText = 'We couldn’t check availability just now. You can still send your request and we’ll confirm your date.';
    if (eventDate) eventDate.setCustomValidity(conflictText);
    if (dateNote) {
      dateNote.textContent = conflictText || (availability === 'error' ? unavailableText
        : availability === 'ready' && picks.length ? `Everything you picked is free on ${longDate(chosenDate)}.` : '');
      dateNote.className = `date-note${conflictText ? ' is-conflict' : ''}`;
    }
    if (dateStatus) {
      const count = Object.keys(RENTALS).filter(id => !PARTS[id] && booked.has(id)).length;
      dateStatus.textContent = !chosenDate ? '' : availability === 'loading' ? 'Checking availability…'
        : availability === 'error' ? unavailableText
        : count ? `${longDate(chosenDate)}: ${count} ${count === 1 ? 'item is' : 'items are'} booked and marked below. Everything else is free.`
        : `Everything is free on ${longDate(chosenDate)}.`;
    }
    if (dateClear) dateClear.hidden = !chosenDate;
  };
  const checkDate = () => {
    const id = ++checkId;
    availability = chosenDate ? 'loading' : 'none';
    paintAvailability();
    if (!chosenDate) { availabilityCheck = Promise.resolve(); return; }
    const day = chosenDate;
    const d = parseIso(day);
    availabilityCheck = bookedInMonth(d.getFullYear(), d.getMonth())
      .then(byDate => { if (id === checkId) { bookedThatDay = byDate.get(day) || new Set(); availability = 'ready'; } },
        () => { if (id === checkId) availability = 'error'; })
      .then(() => { if (id === checkId) paintAvailability(); });
  };

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
        taken.textContent = 'Booked that day';
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

  /* Rentals page calendar: choose a date to see what's booked. Days with every wall booked are marked. */
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
    const markMonth = (year, month) => bookedInMonth(year, month).then(byDate => {
      if (view.getFullYear() !== year || view.getMonth() !== month) return;
      days.querySelectorAll('.cal-day').forEach(b => {
        const booked = byDate.get(b.dataset.date);
        const full = Boolean(booked && WALLS.every(w => booked.has(w)));
        b.classList.toggle('walls-full', full);
        b.setAttribute('aria-label', `${longDate(b.dataset.date)}${full ? ', all flower walls booked' : ''}`);
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

  const form = document.getElementById('inquire-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit.querySelector('span');
  const key = form.querySelector('[name="access_key"]');
  const ready = Boolean(key && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key.value.trim()));
  const alt = document.getElementById('book-alt');
  if (eventDate) {
    eventDate.min = todayIso;
    if (!eventDate.value && chosenDate) eventDate.value = chosenDate;
    eventDate.addEventListener('change', () => { chosenDate = validDate(eventDate.value); storeDate(); renderPicks(); checkDate(); });
  }
  // A request sent while the date is still being checked waits briefly for the answer.
  const availabilityKnown = () => availability === 'loading' ? Promise.race([availabilityCheck, new Promise(r => setTimeout(r, 3000))]) : Promise.resolve();
  const idle = ready ? 'Send booking request' : 'Send by text';
  submitLabel.textContent = idle;
  if (ready && alt) alt.hidden = true;

  // Without an online form service, the request goes out through the visitor's own text or email app.
  const summary = () => {
    const d = new FormData(form);
    const line = (label, name) => (d.get(name) || '').toString().trim() ? `${label}: ${d.get(name).toString().trim()}` : '';
    return ['Booking request for Bloom Events',
      line('Name', 'name'), line('Date', 'event_date'), line('Email', 'email'), line('Phone', 'phone'),
      line('Celebrating', 'event_type'), line('Guests', 'guests'), line('Venue', 'venue'),
      picks.length ? `Picks: ${picks.map(id => RENTALS[id]).join(', ')}` : '',
      line('Notes', 'message')].filter(Boolean).join('\n');
  };
  const emailLink = document.getElementById('send-email');
  if (emailLink) emailLink.addEventListener('click', async e => {
    e.preventDefault();
    await availabilityKnown();
    if (!form.reportValidity()) return;
    location.href = `mailto:hello@bloomevents.com?subject=${encodeURIComponent('Booking request')}&body=${encodeURIComponent(summary())}`;
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    await availabilityKnown();
    if (!form.reportValidity() || submit.disabled) return;
    if (!ready) {
      location.href = `sms:+15863604200?&body=${encodeURIComponent(summary())}`;
      return;
    }
    const data = new FormData(form);
    if (data.get('botcheck')) return;
    submit.disabled = true; submitLabel.textContent = 'Sending…';
    status.textContent = ''; status.className = 'form-status';
    form.action = 'https://api.web3forms.com/submit';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error('Submission failed');
      const result = await response.json();
      if (!result.success) throw new Error('Submission failed');
      status.className = 'form-status show success';
      status.textContent = 'Thank you! Your request has been sent. We’ll confirm your date and send a quote.';
      form.reset();
      picks = []; chosenDate = ''; store(); storeDate(); renderPicks(); checkDate();
    } catch {
      status.className = 'form-status show error';
      status.textContent = 'Your request could not be sent. Please try again or call (586) 360-4200.';
    } finally {
      clearTimeout(timer); submit.disabled = false; submitLabel.textContent = idle;
    }
  });
})();
