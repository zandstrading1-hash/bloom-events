/* Shared navigation, collection viewer, and inquiry handling. No dependencies. */
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
  const PICKS_KEY = 'bloom-picks';
  const clean = ids => [...new Set(ids)].filter(id => Object.prototype.hasOwnProperty.call(RENTALS, id));
  let picks = [];
  try { picks = clean(JSON.parse(localStorage.getItem(PICKS_KEY) || '[]')); } catch { picks = []; }
  const fromLink = new URLSearchParams(location.search).get('picks');
  if (fromLink) picks = clean([...picks, ...fromLink.split(',')]);
  const store = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* storage blocked: the Book link still carries the picks */ } };
  const bookHref = () => picks.length ? `contact.html?picks=${picks.join(',')}` : 'contact.html';

  const pickList = document.getElementById('picks-list');
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
        const name = document.createElement('span');
        name.textContent = RENTALS[id];
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'pick-remove';
        remove.dataset.remove = id;
        remove.setAttribute('aria-label', `Remove ${RENTALS[id]}`);
        remove.textContent = 'Remove';
        li.append(name, remove);
        return li;
      }));
      const empty = document.getElementById('picks-empty');
      if (empty) empty.hidden = picks.length > 0;
      const more = document.getElementById('picks-more');
      if (more) more.textContent = picks.length ? 'Add more rentals' : 'Browse rentals';
      const field = document.getElementById('rentals-field');
      if (field) field.value = picks.map(id => RENTALS[id]).join(', ');
    }
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

  const form = document.getElementById('inquire-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit.querySelector('span');
  const key = form.querySelector('[name="access_key"]');
  const ready = Boolean(key && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key.value.trim()));
  const alt = document.getElementById('book-alt');
  const date = form.querySelector('[type="date"]');
  const today = new Date();
  if (date) date.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
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
  if (emailLink) emailLink.addEventListener('click', e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    location.href = `mailto:hello@bloomevents.com?subject=${encodeURIComponent('Booking request')}&body=${encodeURIComponent(summary())}`;
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
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
      picks = []; store(); renderPicks();
    } catch {
      status.className = 'form-status show error';
      status.textContent = 'Your request could not be sent. Please try again or call (586) 360-4200.';
    } finally {
      clearTimeout(timer); submit.disabled = false; submitLabel.textContent = idle;
    }
  });
})();
