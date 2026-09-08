/* Shared navigation, collection viewer, and inquiry handling. No dependencies. */
(() => {
  'use strict';
  document.documentElement.classList.add('js-ready');
  const menu = document.querySelector('.menu-toggle');
  const links = document.getElementById('primary-links');
  if (menu && links) {
    const closeMenu = () => { menu.setAttribute('aria-expanded', 'false'); links.classList.remove('is-open'); };
    menu.addEventListener('click', () => {
      const open = menu.getAttribute('aria-expanded') !== 'true';
      menu.setAttribute('aria-expanded', String(open));
      links.classList.toggle('is-open', open);
    });
    links.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
    document.addEventListener('click', e => { if (!e.target.closest('nav')) closeMenu(); });
    window.matchMedia('(min-width: 961px)').addEventListener('change', closeMenu);
  }

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
    const image = document.getElementById('lightbox-img');
    const caption = document.getElementById('lightbox-caption');
    const imageLinks = [...document.querySelectorAll('[data-lightbox]')];
    let activeLink;
    let previousOverflow = '';
    const visibleLinks = () => imageLinks.filter(link => !link.closest('.portfolio-card').hidden);
    const showImage = link => {
      activeLink = link;
      image.src = link.href;
      image.alt = link.querySelector('img').alt;
      caption.textContent = link.dataset.caption;
    };
    const step = direction => { const visible = visibleLinks(); showImage(visible[(visible.indexOf(activeLink) + direction + visible.length) % visible.length]); };
    imageLinks.forEach(link => link.addEventListener('click', e => {
      e.preventDefault(); showImage(link);
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      dialog.showModal();
      dialog.querySelector('.lightbox-close').focus();
    }));
    dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.lightbox-prev').addEventListener('click', () => step(-1));
    dialog.querySelector('.lightbox-next').addEventListener('click', () => step(1));
    dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); step(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); } });
    dialog.addEventListener('close', () => { document.body.style.overflow = previousOverflow; activeLink?.focus(); image.removeAttribute('src'); });
  }

  const videos = [...document.querySelectorAll('video')];
  videos.forEach(video => video.addEventListener('play', () => videos.forEach(other => { if (other !== video) other.pause(); })));

  const form = document.getElementById('inquire-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit.querySelector('span');
  const key = form.querySelector('[name="access_key"]');
  const ready = key && key.value.trim() && !key.value.includes('YOUR-');
  const date = form.querySelector('[type="date"]');
  const today = new Date();
  if (date) date.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (ready) { form.hidden = false; submit.disabled = false; }
  if (!ready) {
    form.classList.add('is-unconfigured');
    form.querySelectorAll('.form-row').forEach(row => { row.hidden = true; });
    submit.disabled = true;
    submit.setAttribute('aria-describedby', 'form-status');
    submitLabel.textContent = 'Online inquiries coming soon';
    status.className = 'form-status show';
    status.textContent = 'To check your date or request a quote, please call or text (586) 360-4200.';
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!ready || !form.reportValidity() || submit.disabled) return;
    submit.disabled = true; submitLabel.textContent = 'Sending…';
    status.textContent = ''; status.className = 'form-status';
    const data = new FormData(form);
    data.set('services', data.getAll('services').join(', '));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error('Submission failed');
      const result = await response.json();
      if (!result.success) throw new Error('Submission failed');
      status.className = 'form-status show success';
      status.textContent = 'Thank you! Your inquiry has been received. We’ll be in touch to talk through your event.';
      form.reset();
    } catch {
      status.className = 'form-status show error';
      status.textContent = 'Your inquiry could not be confirmed. Please try again or call (586) 360-4200.';
    } finally {
      clearTimeout(timer); submit.disabled = false; submitLabel.textContent = 'Send Inquiry';
    }
  });
})();
