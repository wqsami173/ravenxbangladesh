(() => {
  'use strict';

  const EVENT = {
    name: 'Shadow Sprint Run 2026', slug: 'shadow-sprint-2026',
    description: 'A virtual Halloween running challenge from RavenX Bangladesh. Choose your distance, run anywhere, and submit a link from your running app for review.',
    bannerUrl: '/assets/shadow-sprint-banner.png', startDate: '2026-10-01', endDate: '2026-10-31',
    metadata: {
      location: 'Virtual — Run Anywhere, Anytime',
      distances: [
        { value: '3.1km', label: '3.1 KM', category: 'Silver', medal_image: '/assets/3.1KM.jpeg' },
        { value: '6.66km', label: '6.66 KM', category: 'Golden', medal_image: '/assets/6.66km.jpg' },
        { value: '13km', label: '13 KM', category: 'Black', medal_image: '/assets/13KM.jpg' }
      ], fees: { student: 599, regular: 649, currency: 'BDT', courier_charge_applies: true },
      payment_methods: ['Bkash', 'Nagad', 'Rocket'],
      payment_accounts: {
        Bkash: { number: '01805749874', mode: 'Payment' },
        Nagad: { number: '01687414286', mode: 'Send Money' },
        Rocket: { number: '01624577374', mode: 'Send Money' }
      },
      student_id_categories: ['student'],
      rules: ['Record your run with Strava or another running app.', 'Submit your activity link for review.', 'The RavenX administrator reviews each run before a certificate is issued.'],
      rewards: ['Exclusive China finisher medal', 'Surprise gift', 'Personalized e-certificate', 'Official e-BIB']
    }, workflow: { registrationOpen: true, runSubmissionEnabled: true }
  };
  const app = document.getElementById('app');
  const toast = document.getElementById('toast');
  let user = null;
  let csrfToken = null;
  let passwordResetEmail = '';
  let toastTimer;
  let chatConversation = null;
  let chatMessages = [];
  let chatOpen = false;
  let chatError = '';
  let chatPollTimer = null;
  let chatDraft = '';
  let chatContactDraft = { name: '', email: '' };
  let analyticsCurrentVisitId = null;
  let analyticsPageStartedAt = 0;
  let analyticsLastPath = null;
  let analyticsQueue = Promise.resolve();
  let analyticsDataVisible = true;
  let metaLastPage = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const date = (value, options = { year: 'numeric', month: 'short', day: 'numeric' }) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? esc(value) : new Intl.DateTimeFormat('en', options).format(d);
  };
  const money = (value) => `৳${new Intl.NumberFormat('en-BD').format(Number(value || 0))}`;
  const durationText = (value) => {
    const seconds = Math.max(0, Number(value || 0));
    if (seconds < 60) return seconds + ' sec';
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes >= 60 ? Math.floor(minutes / 60) + ' hr ' + (minutes % 60) + ' min' : minutes + ' min ' + remainder + ' sec';
  };
  const statusPill = (value) => {
    const normalized = String(value || 'PENDING').toLowerCase().replaceAll('_', ' ');
    return `<span class="pill pill-status ${esc(normalized.split(' ')[0])}">${esc(normalized)}</span>`;
  };
  const routeInfo = () => {
    const raw = location.hash.replace(/^#/, '') || '/';
    const parsed = new URL(raw, location.origin);
    return { path: parsed.pathname.replace(/\/$/, '') || '/', query: parsed.searchParams };
  };
  const link = (href, label, cls = '') => `<a class="${cls}" href="#${href}">${label}</a>`;

  async function fetchRavenX(path, options) {
    try {
      return await fetch(path, options);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('RavenX could not reach its server from this page. Keep the local server running and open http://localhost:3000.');
      }
      throw error;
    }
  }

  async function csrf() {
    if (csrfToken) return csrfToken;
    const response = await fetchRavenX('/api/csrf-token', { credentials: 'same-origin' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Unable to start a secure session.');
    csrfToken = body.csrfToken;
    return csrfToken;
  }

  async function api(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-CSRF-Token', await csrf());
    const response = await fetchRavenX(path, { ...options, method, body, headers, credentials: 'same-origin' });
    const contentType = response.headers.get('content-type') || '';
    const result = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const detail = result?.fields?.map((item) => item.message).filter(Boolean).join(' ') || result?.error;
      throw new Error(detail || `Request failed (${response.status}).`);
    }
    return result || {};
  }

  async function loadUser() {
    try {
      const result = await api('/api/auth/me');
      user = result.user || null;
      csrfToken = result.csrfToken || csrfToken;
    } catch {
      user = null;
    }
  }

  async function reportAnalyticsDuration(keepalive = false) {
    if (!analyticsCurrentVisitId || !analyticsPageStartedAt) return;
    const seconds = Math.min(86400, Math.max(0, Math.floor((Date.now() - analyticsPageStartedAt) / 1000)));
    if (!seconds) return;
    try {
      await api('/api/analytics/visits/' + encodeURIComponent(analyticsCurrentVisitId), {
        method: 'PATCH', body: { durationSeconds: seconds }, keepalive
      });
    } catch { /* Analytics must never interrupt page navigation or chat. */ }
  }

  function trackAnalyticsPage(path) {
    const isPublicPage = user?.role !== 'admin' && /^\/(?:|events(?:\/[a-z0-9][a-z0-9-]*)?|shop)$/i.test(path);
    if (analyticsLastPath === path) return;
    analyticsLastPath = path;
    analyticsQueue = analyticsQueue.then(async () => {
      await reportAnalyticsDuration(true);
      analyticsCurrentVisitId = null;
      analyticsPageStartedAt = 0;
      if (!isPublicPage) return;
      try {
        const result = await api('/api/analytics/visits', { method: 'POST', body: { pagePath: path } });
        analyticsCurrentVisitId = result.visitId;
        analyticsPageStartedAt = Date.now();
      } catch { /* Analytics is optional; keep the public site available if it fails. */ }
    }).catch(() => {});
  }

  function trackMetaPage(path) {
    const isPublicPage = user?.role !== 'admin' && /^\/(?:|home|events(?:\/[a-z0-9][a-z0-9-]*)?|shop)$/i.test(path);
    const pageKey = location.hash || '#/';
    if (metaLastPage === pageKey) return;
    metaLastPage = pageKey;
    if (isPublicPage && typeof window.fbq === 'function') window.fbq('track', 'PageView');
  }

  function trackMetaRegistration(registrationId) {
    if (!registrationId || typeof window.fbq !== 'function') return;
    window.fbq('track', 'CompleteRegistration', {}, { eventID: 'registration_' + registrationId });
  }

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  function cookieValue(name) {
    const prefix = name + '=';
    const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    if (!item) return '';
    try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ''; }
  }

  function publicHeader(active = '') {
    const items = [
      ['/','Home'], ['/events','Events'], ['/shop','Shop'],
      [user ? '/my-events' : '/login', user ? 'My Events' : 'My Events'],
      [user ? (user.role === 'admin' ? '/admin' : '/profile') : '/login', user ? (user.role === 'admin' ? 'Admin' : 'Account') : 'Login / Signup']
    ];
    return `<a class="skip-link" href="#main">Skip to content</a>
      <header class="site-header"><div class="page-wrap site-header-inner">
        <a class="brand" href="#/" aria-label="RavenX home"><img class="brand-logo" src="/assets/ravenx-logo.png" alt=""><span class="brand-word"><strong>RAVENX</strong><small>Fly Like Raven</small></span></a>
        <button class="mobile-menu" type="button" aria-label="Open navigation" aria-expanded="false" data-action="menu">☰</button>
        <nav class="site-nav" aria-label="Main navigation">${items.map(([href,label]) => `<a class="${active === href ? 'active ' : ''}${href === '/login' && !user ? 'nav-cta' : ''}" href="#${href}">${esc(label)}</a>`).join('')}${user ? '<button type="button" data-action="logout">Log out</button>' : ''}</nav>
      </div></header>`;
  }

  function footer() {
    return `<footer class="site-footer"><div class="page-wrap footer-inner"><div><strong>RAVENX</strong><div>Fly Like Raven</div><small>© ${new Date().getFullYear()} RavenX Bangladesh</small><small>Anonymous page visit and time-spent analytics help us improve the site.</small></div><div class="footer-links"><a href="#/events">Events</a><a href="#/shop">Shop</a><a href="https://www.facebook.com/ravenxofficialbd" target="_blank" rel="noreferrer">Facebook</a><a href="https://www.facebook.com/share/g/19TkYk8Mph/" target="_blank" rel="noreferrer">Community group</a><a href="mailto:ravenxbdofficial@gmail.com">Contact</a><a href="https://wa.me/8801805749874">WhatsApp</a></div></div></footer>`;
  }

  function layout(content, active = '') {
    app.querySelectorAll('[data-local-image][data-object-url]').forEach((input) => URL.revokeObjectURL(input.dataset.objectUrl));
    app.innerHTML = `${publicHeader(active)}<main id="main">${content}</main>${footer()}`;
    app.insertAdjacentHTML('beforeend', chatWidget());
    syncPaymentDetails();
    syncStudentIdRequirement();
  }

  function chatMessageView(message) {
    const kind = String(message.sender || '').toLowerCase();
    const label = kind === 'ai' ? 'RavenX support' : kind === 'admin' ? 'RavenX admin' : kind === 'system' ? 'Update' : 'You';
    const messageClass = kind === 'ai' ? 'support' : kind;
    return '<article class="chat-message ' + messageClass + '"><small>' + label + '</small><div>' + esc(message.body).replace(/\n/g, '<br>') + '</div></article>';
  }

  function chatMessagesMarkup() {
    const messages = chatMessages.length
      ? chatMessages.map(chatMessageView).join('')
      : '<article class="chat-message support"><small>RavenX support</small><div>Send a message and the RavenX admin will reply here.</div></article>';
    return messages + (chatError ? '<div class="chat-error">' + esc(chatError) + '</div>' : '');
  }

  function chatRenderState() {
    return [chatConversation?.status || 'ADMIN_REQUESTED', chatOpen ? 'open' : 'closed', user?.role || 'guest', Boolean(!user && (!chatConversation?.visitorName || !chatConversation?.visitorEmail))].join(':');
  }

  function chatWidget() {
    if (user?.role === 'admin') return '';
    const status = chatConversation?.status || 'ADMIN_REQUESTED';
    const statusLabel = status === 'ADMIN_REQUESTED' ? 'Messages go directly to RavenX admin'
      : status === 'ADMIN_ACCEPTED' ? 'Chatting with RavenX admin'
        : status === 'CLOSED' ? 'Chat closed' : 'Message RavenX admin';
    const needsContact = !user && (!chatConversation?.visitorName || !chatConversation?.visitorEmail);
    const disabled = status === 'CLOSED';
    return '<div id="chat-root" class="chat-widget ' + (chatOpen ? 'open' : '') + '" data-render-state="' + esc(chatRenderState()) + '">' +
      '<button class="chat-launcher" type="button" data-action="toggle-chat" aria-expanded="' + String(chatOpen) + '" aria-label="' + (chatOpen ? 'Close' : 'Open') + ' RavenX chat"><span>✦</span><strong>' + (chatOpen ? 'Close chat' : 'Chat with Raven') + '</strong></button>' +
      '<section class="chat-panel" aria-label="RavenX admin text support" ' + (chatOpen ? '' : 'hidden') + '>' +
      '<header class="chat-header"><div><strong>RavenX support</strong><small>' + statusLabel + '</small></div><button type="button" data-action="toggle-chat" aria-label="Close chat">×</button></header>' +
      '<div class="chat-privacy">Text only · Please don’t send passwords, PINs, images, or voice notes.</div>' +
      '<div class="chat-messages" role="log" aria-live="polite">' + chatMessagesMarkup() + '</div>' +
      '<form class="chat-composer" data-form="chat-message">' +
      (needsContact ? '<label class="visually-hidden" for="chat-contact-name">Your name</label><input class="input" id="chat-contact-name" name="name" autocomplete="name" placeholder="Your name" value="' + esc(chatContactDraft.name) + '" minlength="2" maxlength="100" required><label class="visually-hidden" for="chat-contact-email">Enter your email</label><input class="input" id="chat-contact-email" name="email" type="email" autocomplete="email" placeholder="Enter your email" value="' + esc(chatContactDraft.email) + '" maxlength="254" required>' : '') +
      '<label class="visually-hidden" for="raven-chat-input">Message RavenX admin</label><textarea id="raven-chat-input" name="message" rows="2" maxlength="2000" placeholder="Message RavenX admin…" ' + (disabled ? 'disabled' : '') + ' required>' + esc(chatDraft) + '</textarea><button class="button button-primary button-small" type="submit" ' + (disabled ? 'disabled' : '') + '>Send</button><div class="error-text" data-error></div></form>' +
      (status === 'CLOSED' ? '<button class="chat-human-link" type="button" data-action="new-chat">Start a new chat</button>' : '') +
      '</section></div>';
  }

  function renderChatWidget() {
    const current = document.getElementById('chat-root');
    if (!current) return;
    if (current.dataset.renderState === chatRenderState()) {
      const messages = current.querySelector('.chat-messages');
      if (messages) messages.innerHTML = chatMessagesMarkup();
      if (chatOpen && messages) messages.scrollTop = messages.scrollHeight;
      return;
    }
    const active = current.contains(document.activeElement) ? document.activeElement : null;
    const activeId = active?.id || '';
    const selection = active && typeof active.selectionStart === 'number'
      ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
      : null;
    current.outerHTML = chatWidget();
    if (activeId) {
      const replacement = document.getElementById(activeId);
      if (replacement) {
        replacement.focus({ preventScroll: true });
        if (selection && typeof replacement.setSelectionRange === 'function') {
          replacement.setSelectionRange(selection.start, selection.end, selection.direction);
        }
      }
    }
    if (chatOpen) {
      const messages = document.querySelector('#chat-root .chat-messages');
      if (messages) messages.scrollTop = messages.scrollHeight;
    }
  }

  async function refreshChat({ quiet = false } = {}) {
    try {
      const result = await api('/api/chat/conversation');
      chatConversation = result.conversation || null;
      chatMessages = result.messages || [];
      if (!quiet) chatError = '';
    } catch (error) {
      chatError = error.message || 'Chat is temporarily unavailable.';
      if (!quiet) chatMessages = [];
    }
    if (chatOpen) renderChatWidget();
  }

  function scheduleChatPoll() {
    clearTimeout(chatPollTimer);
    if (!chatOpen) return;
    chatPollTimer = setTimeout(async () => {
      await refreshChat({ quiet: true });
      scheduleChatPoll();
    }, 7000);
  }

  function syncPaymentDetails() {
    const form = app.querySelector('form[data-form="registration"]');
    const box = form?.querySelector('.payment-help');
    if (!box) return;
    let accounts = {};
    try { accounts = JSON.parse(box.dataset.paymentAccounts || '{}'); } catch {}
    const method = form.querySelector('[name="payment_method"]')?.value;
    const account = accounts[method];
    const number = box.querySelector('[data-payment-number]');
    const button = box.querySelector('[data-action="copy-payment"]');
    if (number) number.textContent = account ? `${account.number} (${account.mode})` : 'Payment account unavailable';
    if (button) {
      button.dataset.number = account?.number || '';
      button.disabled = !account?.number;
    }
  }

  function syncStudentIdRequirement() {
    const form = app.querySelector('form[data-form="registration"]');
    const field = form?.querySelector('[data-student-id-field]');
    const input = form?.querySelector('#student-id-image');
    if (!form || !field || !input) return;
    let requiredCategories = ['student'];
    try { requiredCategories = JSON.parse(form.dataset.studentIdCategories || '["student"]'); } catch {}
    const category = form.querySelector('[name="category"]:checked')?.value;
    const required = requiredCategories.includes(String(category || '').toLowerCase());
    field.hidden = !required;
    input.required = required;
    if (!required) input.setCustomValidity('');
  }

  function syncLocalImagePreview(input) {
    const preview = document.getElementById(input.dataset.imagePreview || '');
    const file = input.files?.[0];
    if (input.dataset.objectUrl) URL.revokeObjectURL(input.dataset.objectUrl);
    delete input.dataset.objectUrl;
    if (!file) {
      input.setCustomValidity('');
      if (preview) { preview.hidden = true; preview.removeAttribute('src'); }
      return;
    }
    if (!file.type.startsWith('image/')) {
      input.setCustomValidity('Choose an image file.');
      if (preview) { preview.hidden = true; preview.removeAttribute('src'); }
      return;
    }
    input.setCustomValidity('');
    input.dataset.objectUrl = URL.createObjectURL(file);
    if (preview) { preview.src = input.dataset.objectUrl; preview.hidden = false; }
  }

  function textFieldsOnly(values) {
    const text = new FormData();
    for (const [key, value] of values.entries()) {
      if (!(value instanceof File)) text.append(key, value);
    }
    return text;
  }

  const eventDistances = (metadata = EVENT.metadata, event = EVENT) => (metadata.distances || []).map((item) => `<article class="medal-card"><div class="medal-image"><img src="${esc(item.medal_image || event.bannerUrl || EVENT.bannerUrl)}" alt="${esc(item.label || item.value)} ${esc(item.category || 'RavenX')} finisher medal"></div><div class="medal-copy"><div class="medal-line"><strong class="distance">${esc(item.label || item.value)}</strong>${item.category ? `<span class="category">${esc(item.category)}</span>` : ''}</div><p>Finisher medal for the ${esc(item.label || item.value)} challenge.</p></div></article>`).join('');

  function eventFeature(event = EVENT) {
    const metadata = event.metadata || EVENT.metadata;
    const registrationOpen = event.workflow?.registrationOpen !== false && event.workflow?.registration_open !== false;
    return `<article class="event-feature"><div class="event-feature-image"><img src="${esc(event.bannerUrl || EVENT.bannerUrl)}" alt="${esc(event.name)} event cover"></div><div class="event-feature-copy"><span class="eyebrow">Featured event · ${registrationOpen ? 'Registration open' : 'Registration closed'}</span><h3>${esc(event.name)}</h3><p>${esc(event.description)}</p><div class="meta-row"><span class="pill">${esc(metadata.location || 'RavenX event')}</span><span class="pill pill-accent">${(metadata.distances || []).length} categories</span></div>${link('/events/' + encodeURIComponent(event.slug),'Explore event','button button-primary')}</div></article>`;
  }

  async function renderHome() {
    let events = [EVENT];
    try { const result = await api('/api/events'); if (Array.isArray(result.events)) events = result.events; } catch {}
    const featured = events[0] || EVENT;
    const metadata = featured.metadata || EVENT.metadata;
    const cards = events.length ? events.map((event) => eventFeature(event)).join('') : '<div class="empty-state"><div><h2>New challenges are on the way.</h2><p>Check back soon for a RavenX event.</p></div></div>';
    layout(`<section class="hero"><div class="page-wrap hero-grid"><div class="hero-copy"><span class="eyebrow">RavenX Bangladesh · Virtual running community</span><h1>Make every run <span>count.</span></h1><p>Take on the miles, earn your BIB, share your run, and celebrate the finish with RavenX. Your next challenge is waiting.</p><div class="hero-actions">${link(events.length ? '/events/' + encodeURIComponent(featured.slug) : '/events','Discover an event','button button-primary')}${link(user ? '/my-events' : '/signup','Join RavenX','button button-dark')}</div><div class="meta-row"><span class="pill">One community</span><span class="pill">${(metadata.distances || []).length} categories</span><span class="pill">Every pace welcome</span></div></div><div class="hero-art"><div class="hero-art-frame"><img src="${esc(featured.bannerUrl || EVENT.bannerUrl)}" alt="${esc(featured.name)} event cover"></div><div class="hero-stamp"><span>Fly Like Raven</span>${esc(featured.name)}</div><div class="hero-orbit" aria-hidden="true"></div></div></div></section>
      <section class="section"><div class="page-wrap"><div class="section-heading"><div><span class="eyebrow">RavenX challenges</span><h2>Find your next event.</h2></div><p>Explore the current RavenX events.</p></div><div class="event-list">${cards}</div></div></section>
      <section class="section"><div class="page-wrap"><div class="section-heading"><div><span class="eyebrow">Choose your finish</span><h2>${esc(featured.name)} categories.</h2></div></div><div class="medal-grid">${eventDistances(metadata, featured)}</div></div></section>
      <section class="section"><div class="page-wrap"><div class="community-panel"><span class="eyebrow">RavenX community</span><h2>Run your way. Celebrate together.</h2><p>RavenX brings runners together through approachable virtual challenges. Join from wherever you run, share your effort, and be part of a community that celebrates showing up.</p>${link(user ? '/my-events' : '/signup','Get started','button button-primary')}</div></div></section>`, '/');
  }

  async function getEvent(slug = EVENT.slug) {
    try { return (await api('/api/events/' + encodeURIComponent(slug))).event || null; }
    catch { return slug === EVENT.slug ? EVENT : null; }
  }

  function registrationForm(event = EVENT) {
    const metadata = event.metadata || EVENT.metadata;
    const distances = metadata.distances || EVENT.metadata.distances;
    const fees = metadata.fees || EVENT.metadata.fees;
    const feeCategories = Object.entries(fees).filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
    const paymentMethods = metadata.payment_methods || ['Bkash', 'Nagad', 'Rocket'];
    const paymentAccounts = metadata.payment_accounts || {};
    if (event.workflow?.registrationOpen === false || event.workflow?.registration_open === false) return '<div class=\'notice\'>Registration is currently closed for this event.</div>';
    if (user?.role === 'admin') return '<div class=\'notice\'>You are signed in as an administrator. Participant registrations are submitted from a participant account.</div>';
    const studentIdCategories = metadata.student_id_categories || EVENT.metadata.student_id_categories;
    const earlyBird = metadata.early_bird || {};
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    const earlyBirdActive = Boolean(earlyBird.valid_until && earlyBird.valid_until >= today);
    const categoryFee = (category, base) => Math.max(0, Number(base) - (earlyBirdActive ? Number(earlyBird[category + '_discount_tk'] || 0) : 0));
    const participantFields = user
      ? `<div class='form-grid'><div class='form-field'><label for='reg-name'>Participant</label><input class='input' id='reg-name' name='name' value='${esc(user.name)}' readonly required></div><div class='form-field'><label for='reg-email'>Email</label><input class='input' id='reg-email' name='email' type='email' value='${esc(user.email)}' readonly required></div><div class='form-field'><label for='reg-phone'>Phone / WhatsApp</label><input class='input' id='reg-phone' name='phone' type='tel' value='${esc(user.phone || '')}' readonly required></div></div>`
      : `<div class='form-grid'><div class='form-field'><label for='reg-name'>Full name</label><input class='input' id='reg-name' name='name' autocomplete='name' minlength='2' maxlength='100' required></div><div class='form-field'><label for='reg-email'>Email address</label><input class='input' id='reg-email' name='email' type='email' autocomplete='email' maxlength='254' required></div><div class='form-field'><label for='reg-phone'>Phone / WhatsApp</label><input class='input' id='reg-phone' name='phone' type='tel' autocomplete='tel' minlength='6' maxlength='32' required></div><div class='form-field'><label for='reg-password'>Choose a login password</label><input class='input' id='reg-password' name='password' type='password' autocomplete='new-password' minlength='8' maxlength='128' required></div><div class='form-field'><label for='reg-confirm-password'>Confirm password</label><input class='input' id='reg-confirm-password' name='confirmPassword' type='password' autocomplete='new-password' minlength='8' maxlength='128' required></div><div class='form-field full'><small class='help-text'>Your RavenX account will be created when you submit this registration. Use this password for future sign-ins.</small></div></div>`;
    return `<form class='registration-form' data-form='registration' data-event-slug='${esc(event.slug || EVENT.slug)}' data-student-id-categories='${esc(JSON.stringify(studentIdCategories))}' enctype='multipart/form-data'>
      <h2>Register for ${esc(event.name || EVENT.name)}</h2><p>${user ? (event.workflow?.registrationRequiresApproval === false ? 'Submit your registration to join this event.' : 'Your request will appear under Pending Registrations until an administrator reviews it.') : 'Register without creating an account first. Your RavenX account will be created with this registration.'}</p>
      ${participantFields}
      <span class='form-label'>Choose your distance and medal</span><div class='distance-select'>${distances.map((item,i)=>`<label class='distance-option'><input type='radio' name='distance' value='${esc(item.value)}' ${i===0?'checked':''} required><img src='${esc(item.medal_image || EVENT.bannerUrl)}' alt='${esc(item.label || item.value)} ${esc(item.category || '')} medal'><span class='distance-option-copy'><strong>${esc(item.label || item.value)}</strong><small>${esc(item.category || 'DISTANCE')}</small></span></label>`).join('')}</div>
      <div class='form-grid'><div class='form-field full'><span class='form-label'>Registration fee</span><div class='category-options'>${feeCategories.map(([category,amount],index)=>{const finalFee=categoryFee(category,amount);return `<label class='category-option'><input type='radio' name='category' value='${esc(category)}' ${index===feeCategories.length-1?'checked':''} required> ${esc(category[0].toUpperCase()+category.slice(1))} · ${money(finalFee)}${finalFee<amount?` <del>${money(amount)}</del>`:''}</label>`;}).join('')}</div><small class='help-text'>${earlyBirdActive ? 'Early-bird prices valid through ' + date(earlyBird.valid_until) + '. ' : ''}${fees.courier_charge_applies ? 'Courier charge applies. ' : ''}Student pricing requires selecting an ID image in this browser.</small></div>
      <div class='form-field full' data-student-id-field hidden><label for='student-id-image'>Student ID image</label><input class='input' id='student-id-image' type='file' accept='image/*' data-local-image data-image-preview='student-id-preview'><small class='help-text'>Choose any image of your student ID. It is previewed here only and is never sent or stored.</small><img class='local-image-preview' id='student-id-preview' alt='Local student ID image preview' hidden></div>
      <div class='form-field'><label for='gender'>Gender</label><select class='select' id='gender' name='gender' required><option value=''>Choose</option><option value='male'>Male</option><option value='female'>Female</option><option value='other'>Other</option></select></div>
      <div class='form-field'><label for='payment-method'>Payment method</label><select class='select' id='payment-method' name='payment_method' required>${paymentMethods.map((method,index)=>`<option ${index===0?'selected':''}>${esc(method)}</option>`).join('')}</select></div>
      <div class='form-field full'><span class='form-label'>Send payment to</span><div class='payment-help' data-payment-accounts='${esc(JSON.stringify(paymentAccounts))}'><strong data-payment-number></strong><button class='button button-quiet button-small' type='button' data-action='copy-payment'>Copy number</button></div></div>
      <div class='form-field'><label for='payment-number'>Payment sender number</label><input class='input' id='payment-number' name='payment_number' type='tel' minlength='8' maxlength='32' placeholder='01XXXXXXXXX' required></div><div class='form-field'><label for='transaction-id'>Transaction ID</label><input class='input' id='transaction-id' name='transaction_id' minlength='3' maxlength='100' required></div></div>
      <div class='notice'>By submitting, you confirm your payment details. ${event.workflow?.registrationRequiresApproval === false ? 'Registration will follow this event’s automatic approval workflow.' : 'Registration is pending until RavenX review.'}</div><button class='button button-primary auth-submit' type='submit'>Register Now</button><div class='error-text' data-error></div></form>`;
  }

  async function renderEvent() {
    const route = routeInfo();
    const slug = decodeURIComponent(route.path.split('/')[2] || EVENT.slug);
    const event = await getEvent(slug);
    if (!event) {
      layout(`<section class="section page-wrap"><div class="empty-state"><div><h2>Event not found</h2><p>This event is not currently available.</p>${link('/events','Explore Events','button button-primary')}</div></div></section>`, '/events');
      return;
    }
    const meta = event.metadata || EVENT.metadata;
    const fees = meta.fees || EVENT.metadata.fees;
    const categories = Object.entries(fees).filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
    const earlyBird = meta.early_bird || {};
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    const earlyBirdActive = Boolean(earlyBird.valid_until && earlyBird.valid_until >= today);
    const currentFee = (category, amount) => Math.max(0, Number(amount) - (earlyBirdActive ? Number(earlyBird[category + '_discount_tk'] || 0) : 0));
    const registrationOpen = event.workflow?.registrationOpen !== false;
    layout(`<section class="section"><div class="page-wrap"><article class="event-detail-hero"><div class="event-detail-banner"><img src="${esc(event.bannerUrl || EVENT.bannerUrl)}" alt="${esc(event.name || EVENT.name)} event cover"><div class="event-detail-title"><span class="eyebrow">${registrationOpen ? 'Virtual run · Registration open' : 'Virtual run · Registration closed'}</span><h1>${esc(event.name || EVENT.name)}</h1></div></div><div class="event-detail-body"><div class="details-grid"><div><h2>Fly Like Raven</h2><p>${esc(event.description || EVENT.description)}</p><div class="meta-row"><span class="pill">${esc(meta.location || 'Virtual — Run Anywhere, Anytime')}</span><span class="pill">${date(event.startDate)} – ${date(event.endDate)}</span><span class="pill pill-accent">${registrationOpen ? 'Registration open' : 'Registration closed'}</span></div><p>Run anywhere safe during the event period, record the full distance in Strava or another running app, and submit your activity link for review.</p><h2>Participation rules</h2><ul>${(meta.rules || EVENT.metadata.rules).map((rule)=>`<li>${esc(rule)}</li>`).join('')}</ul><h2 class="subsection-title">Finisher rewards</h2><ul>${(meta.rewards || EVENT.metadata.rewards || []).map((reward)=>`<li>${esc(reward)}</li>`).join('')}</ul></div><aside class="fee-box"><span class="eyebrow">Registration fees</span>${categories.map(([category,amount])=>`<div class="fee-line"><span>${esc(category[0].toUpperCase()+category.slice(1))}</span><strong>${money(currentFee(category,amount))}${currentFee(category,amount)<amount?` <del>${money(amount)}</del>`:''}</strong></div>`).join('')}${earlyBirdActive?`<p class="help-text">Early-bird pricing is valid through ${date(earlyBird.valid_until)}.</p>`:''}<div class="fee-line"><span>Delivery</span><strong>${fees.courier_charge_applies ? 'Courier charge applies' : 'Included'}</strong></div><p class="help-text">Registration follows the workflow set for this event.</p></aside></div><h2 class="subsection-title">Choose a distance</h2><div class="medal-grid">${eventDistances(meta,event)}</div><section id="event-registration" tabindex="-1">${registrationForm(event)}</section></div></article></div></section>`, '/events');
    if (route.query.get('register') === '1') {
      requestAnimationFrame(() => document.getElementById('event-registration')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  async function renderEvents() {
    let events = [EVENT];
    try { const result = await api('/api/events'); if (Array.isArray(result.events)) events = result.events; } catch {}
    const cards = events.length ? events.map((event)=>eventFeature(event)).join('') : '<div class="empty-state"><div><h2>No events published right now.</h2><p>RavenX events will show here when they are ready.</p></div></div>';
    layout(`<section class="page-title page-wrap"><span class="eyebrow">RavenX challenges</span><h1>Events</h1><p>Browse current RavenX events and choose your next challenge.</p></section><section class="section"><div class="page-wrap event-list">${cards}</div></section>`, '/events');
  }

  async function renderShop() {
    let products = [];
    let error = '';
    try { products = (await api('/api/shop/products')).products || []; }
    catch (e) { error = e.message; }
    const content = error
      ? `<div class="db-banner">${esc(error)}</div>`
      : products.length
        ? `<div class="shop-grid">${products.map((product)=>`<article class="shop-product"><div class="shop-product-image"><img src="${esc(product.imageUrl)}" alt="${esc(product.name)}"></div><div class="shop-product-copy"><span class="eyebrow">RavenX official gear</span><h2>${esc(product.name)}</h2><p>${esc(product.description)}</p><div class="shop-price">${money(product.unitPrice)} <small>per item</small></div><div class="shop-order-panel" data-shop-order-panel><form class="shop-order-form" data-form="shop-order" data-product-slug="${esc(product.slug)}" data-unit-price="${esc(product.unitPrice)}"><input type="hidden" name="productSlug" value="${esc(product.slug)}"><h3>Place an order</h3><p class="help-text">Submit an order request. RavenX will contact you to confirm delivery and payment arrangements.</p><div class="form-grid"><div class="form-field"><label for="shop-customer-name">Full name</label><input class="input" id="shop-customer-name" name="customerName" autocomplete="name" minlength="2" maxlength="100" required></div><div class="form-field"><label for="shop-customer-phone">Phone / WhatsApp</label><input class="input" id="shop-customer-phone" name="customerPhone" type="tel" autocomplete="tel" minlength="7" maxlength="24" placeholder="+880 1XXXXXXXXX" required></div><div class="form-field full"><label for="shop-customer-email">Email <span class="optional-label">optional</span></label><input class="input" id="shop-customer-email" name="customerEmail" type="email" autocomplete="email" maxlength="254"></div><div class="form-field"><label for="shop-district">District</label><input class="input" id="shop-district" name="district" autocomplete="address-level1" minlength="2" maxlength="100" required></div>${product.hasSizes ? `<div class="form-field"><label for="shop-size-${esc(product.slug)}">Item size</label><select class="select" id="shop-size-${esc(product.slug)}" name="size" required><option value="">Choose size</option>${['S','M','L','XL','XXL'].map((size)=>`<option value="${size}">${size}</option>`).join('')}</select></div>` : ''}<div class="form-field full"><label for="shop-address">Full delivery address</label><textarea class="textarea" id="shop-address" name="deliveryAddress" autocomplete="street-address" minlength="8" maxlength="1000" required placeholder="House, road, area, and any directions"></textarea></div><div class="form-field"><label for="shop-quantity">Quantity</label><input class="input" id="shop-quantity" name="quantity" type="number" min="1" max="10" value="1" data-shop-quantity required></div><div class="form-field"><label for="shop-note">Delivery note <span class="optional-label">optional</span></label><input class="input" id="shop-note" name="deliveryNote" maxlength="500" placeholder="Landmark or instructions"></div></div><div class="shop-total"><span>Items total</span><strong data-order-total>${money(product.unitPrice)}</strong></div><button class="button button-primary auth-submit" type="submit">Request order</button><div class="error-text" data-error></div></form></div></div></article>`).join('')}</div>`
        : '<div class="empty-state"><div><div class="empty-state-icon">✦</div><h2>RavenX Shop is Coming Soon.</h2><p>We’ll share updates when the next item is available.</p></div></div>';
    layout(`<section class="page-title page-wrap"><span class="eyebrow">RavenX gear</span><h1>Shop</h1><p>RavenX items, ordered directly from the team.</p></section><section class="section"><div class="page-wrap">${content}</div></section>`, '/shop');
  }

  function authPage(mode) {
    const signup = mode === 'signup';
    const reset = mode === 'reset-password';
    const forgot = mode === 'forgot-password';
    const title = signup ? 'Create your account' : reset ? 'Set a new password' : forgot ? 'Reset your password' : 'Welcome back';
    const requestCodeForm = `<form data-form="password-reset-request"><div class="form-grid"><div class="form-field full"><label for="reset-email">Email address</label><input class="input" id="reset-email" name="email" type="email" autocomplete="email" maxlength="254" required></div></div><button class="button button-primary auth-submit" type="submit">Email me a reset code</button><div class="error-text" data-error></div><p class="auth-switch"><a href="#/login">Back to sign in</a></p></form>`;
    const verifyCodeForm = `<form data-form="password-reset-verify"><input type="hidden" name="email" value="${esc(passwordResetEmail)}"><div class="notice">If this email has a RavenX account, we sent a six-digit code. It expires in 10 minutes. Check your spam folder too.</div><div class="form-grid"><div class="form-field full"><label for="reset-code">Email code</label><input class="input reset-code-input" id="reset-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></div><div class="form-field full"><label for="reset-new-password">New password</label><input class="input" id="reset-new-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><div class="form-field full"><label for="reset-confirm-password">Confirm new password</label><input class="input" id="reset-confirm-password" name="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div></div><button class="button button-primary auth-submit" type="submit">Verify code and update password</button><div class="error-text" data-error></div><div class="auth-links"><button class="text-link" type="button" data-action="reset-use-different-email">Use a different email</button><a href="#/login">Back to sign in</a></div></form>`;
    const legacyResetForm = `<form data-form="reset-password"><input type="hidden" name="token"><div class="form-grid"><div class="form-field full"><label for="new-password">New password</label><input class="input" id="new-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><div class="form-field full"><label for="confirm-password">Confirm password</label><input class="input" id="confirm-password" name="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div></div><button class="button button-primary auth-submit">Update password</button><div class="error-text" data-error></div></form>`;
    const signupForm = `<form data-form="signup"><div class="form-grid"><div class="form-field full"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" minlength="2" maxlength="100" required></div><div class="form-field full"><label for="email">Email address</label><input class="input" id="email" name="email" type="email" autocomplete="email" maxlength="254" required></div><div class="form-field full"><label for="phone">Phone number</label><input class="input" id="phone" name="phone" type="tel" autocomplete="tel" minlength="6" maxlength="32" required></div><div class="form-field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><div class="form-field"><label for="confirmPassword">Confirm password</label><input class="input" id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div></div><button class="button button-primary auth-submit">Create account</button><div class="error-text" data-error></div></form>`;
    const loginForm = `<form data-form="login"><div class="form-grid"><div class="form-field full"><label for="email">Email address</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div><div class="form-field full"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" required minlength="8"></div></div><label class="checkbox-row"><input type="checkbox" name="remember"> Keep me signed in on this device</label><button class="button button-primary auth-submit">Sign in</button><div class="error-text" data-error></div><div class="auth-links"><a href="#/forgot-password">Forgot password?</a><a href="#/signup">Create an account</a></div></form>`;
    const form = reset ? legacyResetForm : forgot ? (passwordResetEmail ? verifyCodeForm : requestCodeForm) : signup ? signupForm : loginForm;
    const subtitle = signup ? 'Join the community and manage your event registrations.' : reset ? 'Choose a password of at least 8 characters.' : forgot ? 'We’ll send a one-time code to your email so you can choose a new password.' : 'Sign in to access your events, BIB, and certificates.';
    layout(`<section class="auth-page"><div class="auth-card"><span class="eyebrow">RavenX account</span><h1>${title}</h1><p>${subtitle}</p>${form}${!signup && !reset && !forgot ? '<p class="auth-switch">New to RavenX? <a href="#/signup">Create an account</a></p>' : ''}</div></section>`, '/login');
    if (reset) app.querySelector('[name="token"]').value = routeInfo().query.get('token') || '';
  }

  function dashSidebar(active) {
    const links = user.role === 'admin'
      ? [['/admin','◈','Overview'],['/admin/events','◉','Events & details'],['/admin/registrations','▤','Registrations'],['/admin/submissions','↗','Run submissions'],['/admin/emails','✉','Email drafts'],['/admin/chats','✦','Chat inbox'],['/admin/analytics','◷','Visitor analytics'],['/admin/shop-products','▦','Shop items'],['/admin/shop-orders','▣','Shop delivery'],['/admin/notifications','◉','Notifications']]
      : [['/dashboard','◈','Overview'],['/my-events','◫','My Events'],['/certificates','◇','Certificates'],['/notifications','◉','Notifications'],['/profile','◎','Profile']];
    return `<aside class="dashboard-sidebar"><div class="sidebar-user"><span class="avatar">${esc((user.name || 'R').slice(0,1).toUpperCase())}</span><div><strong>${esc(user.name)}</strong><small>${user.role === 'admin' ? 'Administrator' : 'Participant'}</small></div></div><div class="sidebar-label">Workspace</div><nav class="sidebar-nav">${links.map(([href,icon,label])=>`<a class="${active === href ? 'active' : ''}" href="#${href}"><span class="nav-icon">${icon}</span>${label}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="sidebar-nav"><button type="button" data-action="logout"><span class="nav-icon">↪</span>Log out</button></div></div></aside>`;
  }

  function mobileDashNav(active) {
    const links = user.role === 'admin'
      ? [['/admin','◈','Home'],['/admin/events','◉','Events'],['/admin/registrations','▤','Registrations'],['/admin/emails','✉','Emails'],['/admin/chats','✦','Chats'],['/admin/shop-orders','▣','Orders']]
      : [['/dashboard','◈','Home'],['/my-events','◫','Events'],['/certificates','◇','Awards'],['/notifications','◉','Alerts']];
    return `<nav class="mobile-bottom-nav" aria-label="Dashboard navigation">${links.map(([href,icon,label])=>`<a class="${active === href ? 'active' : ''}" href="#${href}"><span class="nav-icon">${icon}</span>${label}</a>`).join('')}</nav>`;
  }

  function dashLayout(content, active, title = '', subtitle = '') {
    layout(`<div class="dashboard-layout">${dashSidebar(active)}<section class="dashboard-main"><div class="dashboard-top"><div><span class="eyebrow">${user.role === 'admin' ? 'RavenX administration' : 'Participant dashboard'}</span><h1>${title}</h1><p>${subtitle}</p></div>${user.role !== 'admin' ? `<a class="button button-dark button-small" href="#/profile">${esc(user.name)}</a>` : ''}</div>${content}</section></div>${mobileDashNav(active)}`);
  }

  function registrationCard(item, pending = false) {
    const progress = item.certificateIssuedAt ? 4 : item.submission?.status === 'APPROVED' ? 4 : item.submission?.status === 'PENDING' ? 3 : item.bibNumber ? 2 : 1;
    return `<article class="registration-card"><div class="registration-image"><img src="${esc(item.bannerUrl || EVENT.bannerUrl)}" alt=""></div><div><span class="eyebrow">${pending ? 'Pending registration' : 'Your event'}</span><h3>${esc(item.eventName)}</h3><p>${esc(item.distance || '')} · Registered ${date(item.registrationDate)}</p><p class="bib-large">${item.bibNumber ? 'BIB ' + esc(item.bibNumber) : 'BIB assigned after approval'}</p>${statusPill(item.status)}<div class="event-progress" aria-label="Event progress">${[1,2,3,4].map((n)=>`<span class="progress-step ${n<=progress?'done':''}"></span>`).join('')}</div></div><a class="button ${pending?'button-dark':'button-primary'} button-small" href="#/my-events/${encodeURIComponent(item.registrationId || item.id)}">${pending ? 'View status' : 'View details'}</a></article>`;
  }

  async function renderMyEvents() {
    if (!user) return authPage('login');
    if (user.role === 'admin') return renderAdmin();
    let result;
    try { result = await api('/api/me/events'); }
    catch (error) {
      return dashLayout(`<div class="db-banner">${esc(error.message)}</div><div class="empty-state"><div><h2>Events are unavailable right now.</h2><p>Try again after the RavenX database is connected.</p></div></div>`, '/my-events', 'My Events', 'Your approved registrations and registration requests.');
    }
    const approved = result.approved || [];
    const pending = result.pending || [];
    const rejected = result.rejected || [];
    let content = '';
    if (!approved.length) content += `<div class="empty-state"><div><div class="empty-state-icon">↗</div><h2>You haven't joined any events yet.</h2><p>Approved event registrations will appear here. Pending registrations are shown separately below.</p>${link('/events','Explore Events','button button-primary')}</div></div>`;
    else content += `<div class="section-heading"><div><span class="eyebrow">Approved registrations</span><h2>Your events</h2></div></div><div class="event-list">${approved.map((item)=>registrationCard(item)).join('')}</div>`;
    if (pending.length) content += `<section class="panel"><div class="panel-heading"><h2>Pending Registrations</h2><span class="pill pill-status pending">${pending.length} awaiting review</span></div><div class="panel-content event-list">${pending.map((item)=>registrationCard(item,true)).join('')}</div></section>`;
    if (rejected.length) content += `<section class="panel"><div class="panel-heading"><h2>Needs attention</h2></div><div class="panel-content event-list">${rejected.map((item)=>`<div>${registrationCard(item,true)}<p class="notice error">${esc(item.rejectionReason || 'This registration was not approved.')}</p></div>`).join('')}</div></section>`;
    dashLayout(content, '/my-events', 'My Events', 'Approved events, pending requests, and next steps.');
  }

  async function renderDashboard() {
    if (!user) return authPage('login');
    if (user.role === 'admin') return renderAdmin();
    let result = { approved: [], pending: [], rejected: [] };
    let issue = '';
    try { result = await api('/api/me/events'); } catch (error) { issue = error.message; }
    const approved = result.approved || [];
    const pending = result.pending || [];
    const next = approved[0];
    const content = `${issue ? `<div class="db-banner">${esc(issue)}</div>` : ''}<div class="stat-grid"><article class="stat-card"><span class="stat-label">Approved events</span><strong>${approved.length}</strong><small>Visible in My Events</small></article><article class="stat-card"><span class="stat-label">Pending registrations</span><strong>${pending.length}</strong><small>Awaiting review</small></article><article class="stat-card"><span class="stat-label">Certificates</span><strong>${approved.filter((item)=>item.certificateIssuedAt).length}</strong><small>Unlocked after run approval</small></article><article class="stat-card"><span class="stat-label">Account</span><strong>Active</strong><small>Since ${date(user.createdAt,{year:'numeric',month:'short'})}</small></article></div>${next ? `<section class="panel"><div class="panel-heading"><h2>Pick up where you left off</h2>${statusPill(next.status)}</div><div class="panel-content">${registrationCard(next)}</div></section>` : `<section class="panel"><div class="panel-content"><div class="empty-state"><div><div class="empty-state-icon">↗</div><h2>Ready for your first RavenX event?</h2><p>Register for Shadow Sprint Run 2026 and your dashboard will track approval, BIB collection, your run, and certificate.</p>${link('/events/'+EVENT.slug,'Explore Shadow Sprint','button button-primary')}</div></div></div></section>`}${pending.length ? `<section class="panel"><div class="panel-heading"><h2>Pending Registrations</h2></div><div class="panel-content event-list">${pending.map((item)=>registrationCard(item,true)).join('')}</div></section>` : ''}`;
    dashLayout(content, '/dashboard', `Hello, ${esc(user.name.split(' ')[0])}`, 'Your RavenX activity at a glance.');
  }

  async function renderRegistration(registrationId) {
    if (!user) return authPage('login');
    if (user.role === 'admin') return renderAdmin();
    let response;
    try { response = await api('/api/me/events/' + encodeURIComponent(registrationId)); }
    catch (error) { return dashLayout(`<div class="db-banner">${esc(error.message)}</div>${link('/my-events','Back to My Events','button button-dark')}`, '/my-events', 'Event details', 'Registration details are private to your account.'); }
    const item = response.registration || {};
    const query = routeInfo().query;
    const section = query.get('section') || 'overview';
    const tabs = [['overview','Overview'],['bib','BIB Collection'],...(item.run_submission_enabled === false ? [] : [['run','Run Submission']]),['certificate','Certificate']];
    let panel = '';
    if (item.status !== 'APPROVED') {
      panel = `<div class="empty-state"><div><div class="empty-state-icon">◷</div><h2>${item.status === 'REJECTED' ? 'Registration not approved' : 'Registration pending approval'}</h2><p>${esc(item.rejection_reason || 'Once approved, your event dashboard, BIB, run submission, and certificate steps will unlock.')}</p>${statusPill(item.status)}</div></div>`;
    } else if (section === 'run' && item.run_submission_enabled === false) {
      panel = `<div class="empty-state"><div><div class="empty-state-icon">✓</div><h2>Run submission is not required</h2><p>This event’s workflow does not ask participants to submit a run.</p></div></div>`;
    } else if (section === 'bib') {
      panel = `<section class="panel"><div class="panel-heading"><h2>Your BIB</h2>${statusPill('APPROVED')}</div><div class="panel-content"><p>Assigned BIB number: <strong class="bib-large">${esc(item.bib_number || 'Pending assignment')}</strong></p>${item.bib_number ? `<img class="bib-preview" src="/api/me/events/${encodeURIComponent(registrationId)}/bib" alt="Your RavenX participant BIB"><a class="button button-primary" href="/api/me/events/${encodeURIComponent(registrationId)}/bib?download=1">Download BIB</a>` : ''}<p class="help-text">Registration date: ${date(item.created_at)} · ${esc(item.distance || '')} · ${esc(item.category || '')}</p></div></section>`;
    } else if (section === 'run') {
      const submission = item.submission_status ? { status: item.submission_status, feedback: item.admin_feedback, url: item.activity_url } : null;
      const canSubmit = !submission || submission.status === 'REJECTED';
      panel = `<section class="panel"><div class="panel-heading"><h2>Run submission</h2>${statusPill(submission?.status || 'Not submitted')}</div><div class="panel-content"><p class="help-text">${submission?.status === 'PENDING' ? 'Your activity is waiting for admin review.' : submission?.status === 'REJECTED' ? 'Please review the admin feedback, then submit again below.' : submission?.status === 'APPROVED' ? 'Your activity was approved.' : 'Share your activity from Strava or any other running app. Your selected screenshot stays in this browser and is not uploaded.'}</p>${submission ? `${submission.url ? `<a class="run-link" href="${esc(submission.url)}" target="_blank" rel="noreferrer">Open submitted activity ↗</a>` : ''}${submission.feedback ? `<div class="notice ${submission.status === 'REJECTED' ? 'error' : ''}">${esc(submission.feedback)}</div>` : ''}` : ''}${canSubmit ? `<form class="registration-form" data-form="submission" enctype="multipart/form-data"><div class="form-grid"><div class="form-field"><label>Participant</label><input class="input" value="${esc(item.name || user?.name || '')}" readonly></div><div class="form-field"><label>Email</label><input class="input" value="${esc(item.email || user?.email || '')}" readonly></div><div class="form-field"><label>Phone</label><input class="input" value="${esc(item.phone || user?.phone || '')}" readonly></div><div class="form-field"><label>BIB number</label><input class="input" value="${esc(item.bib_number || '')}" readonly></div><div class="form-field"><label>Distance</label><input class="input" value="${esc(item.distance || '')}" readonly></div><div class="form-field full"><label for="activity-url">Activity link</label><input class="input" id="activity-url" name="activity_url" type="url" inputmode="url" autocomplete="url" value="${esc(item.activity_url || '')}" placeholder="Paste your Strava, Garmin, Nike Run Club, or other activity link" required><small class="help-text">Use the share link from the app where you recorded your run. Any valid web link is accepted.</small></div><div class="form-field full"><label for="activity-profile-url">Running app profile link <span class="help-text">(optional)</span></label><input class="input" id="activity-profile-url" name="strava_profile_url" type="url" inputmode="url" value="${esc(item.strava_profile_url || '')}" placeholder="https://..."></div><div class="form-field"><label for="delivery-district">District</label><input class="input" id="delivery-district" name="district" value="${esc(item.district || '')}" maxlength="100" placeholder="Your district" required></div><div class="form-field"><label for="delivery-address">Delivery address</label><input class="input" id="delivery-address" name="delivery_address" value="${esc(item.delivery_address || '')}" maxlength="1000" placeholder="Full delivery address" required></div><div class="form-field full"><label for="activity-screenshot">Running screenshot</label><input class="input" id="activity-screenshot" type="file" accept="image/*" data-local-image data-image-preview="activity-screenshot-preview" required><small class="help-text">Choose an image showing your run. It is previewed here only and is never sent or stored.</small><img class="local-image-preview" id="activity-screenshot-preview" alt="Local running screenshot preview" hidden></div><div class="form-field full"><label for="submission-information">Additional information <span class="help-text">(optional)</span></label><textarea class="input" id="submission-information" name="additional_information" rows="3" maxlength="2000" placeholder="Anything else you would like the reviewer to know">${esc(item.additional_information || '')}</textarea></div></div><button class="button button-primary" type="submit">Send run for review</button><div class="error-text" data-error></div></form>` : ''}</div></section>`;
    } else if (section === 'certificate') {
      const unlocked = item.submission_status === 'APPROVED' && item.certificate_issued_at;
      panel = unlocked ? `<section class="panel"><div class="panel-heading"><h2>Verified finisher certificate</h2><span class="pill pill-status approved">Issued ${date(item.certificate_issued_at)}</span></div><div class="panel-content"><img class="certificate-preview" src="/api/me/events/${encodeURIComponent(registrationId)}/certificate" alt="Your RavenX finisher certificate"><a class="button button-primary" href="/api/me/events/${encodeURIComponent(registrationId)}/certificate?download=1">Download certificate</a></div></section>` : `<div class="empty-state"><div><div class="empty-state-icon">◇</div><h2>Certificate is locked</h2><p>Your certificate unlocks after the administrator approves your run submission. Submit your activity from the Run Submission section.</p>${link('/my-events/'+encodeURIComponent(registrationId)+'?section=run','Go to run submission','button button-dark')}</div></div>`;
    } else {
      const steps = [['Registration',item.status],['BIB collection',item.bib_number ? 'READY' : 'WAITING'],['Run submission',item.submission_status || 'NOT SUBMITTED'],['Certificate',item.certificate_issued_at ? 'UNLOCKED' : 'LOCKED']];
      panel = `<section class="panel"><div class="panel-heading"><h2>Registration overview</h2>${statusPill(item.status)}</div><div class="panel-content"><div class="details-grid"><div><p><strong>${esc(item.event_name)}</strong></p><p>Registration ID: <code>${esc(item.id || item.platform_id)}</code></p><p>Distance: ${esc(item.distance || '—')} · Category: ${esc(item.category || '—')}</p><p>Submitted ${date(item.created_at)} · BIB ${esc(item.bib_number || 'assigned after approval')}</p></div><div class="fee-box"><span class="eyebrow">Your progress</span>${steps.map(([name,state])=>`<div class="fee-line"><span>${esc(name)}</span><strong>${esc(state)}</strong></div>`).join('')}</div></div></div></section>`;
    }
    dashLayout(`<div class="event-detail-hero"><div class="event-detail-banner"><img src="${esc(item.banner_url || EVENT.bannerUrl)}" alt=""><div class="event-detail-title"><span class="eyebrow">${esc(item.distance || '')} · ${esc(item.bib_number || item.status)}</span><h1>${esc(item.event_name || EVENT.name)}</h1></div></div><div class="event-detail-body"><nav class="event-tabs" aria-label="Registration sections">${tabs.map(([key,label])=>`<a class="${section===key?'active':''}" href="#/my-events/${encodeURIComponent(registrationId)}?section=${key}">${label}</a>`).join('')}</nav>${panel}</div></div>`, '/my-events', 'Event dashboard', 'Each registration has its own BIB and progress.');
  }

  async function renderCertificates() {
    if (!user) return authPage('login');
    if (user.role === 'admin') return renderAdmin();
    let certificates = [];
    let error = '';
    try { certificates = (await api('/api/me/certificates')).certificates || []; } catch (e) { error = e.message; }
    const content = error ? `<div class="db-banner">${esc(error)}</div>` : certificates.length ? `<div class="certificate-grid">${certificates.map((item)=>`<article class="panel"><div class="panel-content"><span class="eyebrow">Verified finisher · ${date(item.issueDate)}</span><h2>${esc(item.eventName)}</h2><p>${esc(item.participantName)} · ${esc(item.distance)} · BIB ${esc(item.bibNumber)}</p><img class="certificate-preview" src="${esc(item.previewUrl)}" alt="Certificate for ${esc(item.eventName)}"><div class="hero-actions"><a class="button button-dark" href="${esc(item.previewUrl)}" target="_blank" rel="noreferrer">View certificate</a><a class="button button-primary" href="${esc(item.downloadUrl)}">Download certificate</a></div></div></article>`).join('')}</div>` : `<div class="empty-state"><div><div class="empty-state-icon">◇</div><h2>No certificates available yet.</h2><p>Certificates appear here after your run submission has been approved.</p>${link('/my-events','View My Events','button button-dark')}</div></div>`;
    dashLayout(content, '/certificates', 'Certificates', 'Your approved RavenX finish certificates.');
  }

  async function renderNotifications(admin = false) {
    if (!user) return authPage('login');
    const endpoint = admin ? '/api/admin/notifications' : '/api/me/notifications';
    let items = [];
    let error = '';
    try { items = (await api(endpoint)).notifications || []; } catch (e) { error = e.message; }
    const content = error ? `<div class="db-banner">${esc(error)}</div>` : items.length ? `<section class="panel"><div class="panel-heading"><h2>Recent activity</h2>${!admin ? '<button class="button button-quiet button-small" data-action="read-all">Mark all read</button>' : ''}</div><div class="panel-content notification-list">${items.map((item)=>`<article class="notification-item ${item.is_read?'read':''}"><span class="notification-dot"></span><div><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p>${item.link_path ? `<a class="inline-link" href="${esc(item.link_path)}">Open related page</a>` : ''}</div><div><time>${date(item.created_at)}</time>${!item.is_read ? `<button class="button button-quiet button-small" data-action="read-notification" data-id="${esc(item.id)}">Mark read</button>` : ''}</div></article>`).join('')}</div></section>` : `<div class="empty-state"><div><div class="empty-state-icon">◉</div><h2>No notifications yet.</h2><p>Updates about registrations, BIB assignment, run reviews, and certificates will appear here.</p></div></div>`;
    dashLayout(content, admin ? '/admin/notifications' : '/notifications', 'Notifications', 'RavenX account updates.');
  }

  async function renderProfile() {
    if (!user) return authPage('login');
    if (user.role === 'admin') return renderAdmin();
    let profile = user;
    try { profile = (await api('/api/me/profile')).profile || user; } catch {}
    const content = `<section class="panel"><div class="panel-heading"><h2>Personal information</h2></div><div class="panel-content"><form data-form="profile"><div class="form-grid"><div class="form-field"><label for="profile-name">Full name</label><input class="input" id="profile-name" name="name" value="${esc(profile.name)}" minlength="2" maxlength="100" required></div><div class="form-field"><label for="profile-email">Email</label><input class="input" id="profile-email" value="${esc(profile.email)}" readonly></div><div class="form-field"><label for="profile-phone">Phone</label><input class="input" id="profile-phone" name="phone" value="${esc(profile.phone || '')}" type="tel" minlength="6" maxlength="32" required></div><div class="form-field"><label>User ID</label><input class="input" value="${esc(profile.id)}" readonly></div><div class="form-field"><label>Account created</label><input class="input" value="${date(profile.createdAt)}" readonly></div></div><button class="button button-primary auth-submit">Save profile</button><div class="error-text" data-error></div></form></div></section>`;
    dashLayout(content, '/profile', 'Profile', 'Manage your participant details.');
  }

  const stat = (label, value, note = '') => `<article class="stat-card"><span class="stat-label">${esc(label)}</span><strong>${esc(value ?? 0)}</strong><small>${esc(note)}</small></article>`;

  async function renderAdmin() {
    if (!user) return authPage('login');
    if (user.role !== 'admin') return dashLayout('<div class="db-banner">Administrator access is required.</div>', '/admin', 'Access denied', 'This area is restricted.');
    let stats = {};
    let error = '';
    try { stats = (await api('/api/admin/summary')).stats || {}; } catch (e) { error = e.message; }
    const content = `${error ? `<div class="db-banner">${esc(error)}</div>` : ''}<div class="stat-grid">${stat('Participants',stats.participants,'Registered accounts')}${stat('Registrations',stats.registrations,'All event requests')}${stat('Pending registrations',stats.pending_registrations,'Awaiting review')}${stat('Approved registrations',stats.approved_registrations,'BIBs available')}${stat('Run submissions',stats.submissions,'Submitted activities')}${stat('Pending runs',stats.pending_submissions,'Awaiting review')}${stat('Approved runs',stats.approved_runs,'Passed review')}${stat('Certificates issued',stats.certificates_issued,'Unlocked certificates')}${stat('Shop orders',stats.shop_orders,'Jersey orders')}</div><div class="rules-grid"><article class="info-card"><span class="eyebrow">Registration queue</span><h3>Review participant requests</h3><p>Approve to assign a unique BIB, or reject with a reason.</p>${link('/admin/registrations','Open registrations','button button-dark button-small')}</article><article class="info-card"><span class="eyebrow">Run review</span><h3>Verify activity submissions</h3><p>Open activity links from any running app, then approve or reject.</p>${link('/admin/submissions','Open submissions','button button-dark button-small')}</article><article class="info-card"><span class="eyebrow">Email drafts</span><h3>Review before sending</h3><p>Every system email waits here for your approval. Preview it, send it, or delete it.</p>${link('/admin/emails','Open email drafts','button button-dark button-small')}</article><article class="info-card"><span class="eyebrow">Shop delivery</span><h3>Prepare jersey orders</h3><p>Review customer details and select orders to hand to your courier platform.</p>${link('/admin/shop-orders','Open delivery orders','button button-dark button-small')}</article><article class="info-card"><span class="eyebrow">Admin alerts</span><h3>Recent platform activity</h3><p>Notifications for new registrations, runs, and shop orders.</p>${link('/admin/notifications','Open notifications','button button-dark button-small')}</article></div>`;
    dashLayout(content, '/admin', 'Admin overview', 'Registration, run review, and certificate activity.');
  }

  async function renderAdminEmails() {
    if (!user) return authPage('login');
    if (user.role !== 'admin') return dashLayout('<div class="db-banner">Administrator access is required.</div>', '/admin/emails', 'Access denied', 'This area is restricted.');
    const query = routeInfo().query;
    const status = query.get('status') || 'AWAITING_APPROVAL';
    let result = { messages: [], emailConfigured: false };
    let error = '';
    try { result = await api('/api/admin/email-outbox?status=' + encodeURIComponent(status)); } catch (e) { error = e.message; }
    const filters = [['AWAITING_APPROVAL','Needs review'],['FAILED','Failed'],['SENT','Sent'],['ALL','All']];
    const rows = (result.messages || []).map((mail) => `<tr><td><strong>${esc(mail.recipient)}</strong><small>${esc(mail.template_name)}</small></td><td>${esc(mail.status)}</td><td>${date(mail.created_at)}</td><td>${mail.last_error ? esc(mail.last_error) : '—'}</td><td class="email-actions"><button class="button button-quiet button-small" data-action="preview-email" data-id="${esc(mail.id)}">Preview</button>${['AWAITING_APPROVAL','FAILED'].includes(mail.status) ? `<button class="button button-primary button-small" data-action="send-email" data-id="${esc(mail.id)}" ${result.emailConfigured ? '' : 'disabled'}>Send</button><button class="button button-quiet button-small" data-action="delete-email" data-id="${esc(mail.id)}">Delete</button>` : ''}</td></tr>`).join('');
    const content = `${error ? `<div class="db-banner">${esc(error)}</div>` : ''}<section class="panel"><div class="panel-content"><p>System emails are saved as drafts. Nothing is sent until you press Send. Failed messages can be reviewed and sent again.</p><p class="help-text">Password reset drafts start their 10-minute code validity window when sent. Send those promptly.</p>${!result.emailConfigured ? '<div class="notice error">Email provider is not configured, so Send is unavailable.</div>' : ''}</div><div class="data-toolbar"><div class="toolbar-group">${filters.map(([key,label]) => `<a class="button ${status===key?'button-primary':'button-quiet'} button-small" href="#/admin/emails?status=${key}">${label}</a>`).join('')}</div><span class="eyebrow">${(result.messages || []).length} messages</span></div><div class="table-wrap"><table><thead><tr><th>Recipient / template</th><th>Status</th><th>Prepared</th><th>Delivery note</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No emails in this view.</td></tr>'}</tbody></table></div></section>`;
    dashLayout(content, '/admin/emails', 'Email drafts', 'Review, preview, send, or delete system email drafts.');
  }

  function adminImageField(name, label, currentUrl = '', required = false) {
    const previewId = 'admin-image-' + name.replace(/[^a-z0-9_-]/gi, '-');
    return `<div class="form-field full admin-media-field"><label for="${previewId}">${esc(label)}${required ? ' · required' : ''}</label><input class="input" id="${previewId}" name="${esc(name)}" type="file" accept="image/png,image/jpeg,image/webp" ${required ? 'required' : ''} data-local-image data-image-preview="${previewId}-preview"><input type="hidden" name="${esc(name)}Url" value="${esc(currentUrl)}"><small class="help-text">PNG, JPEG, or WebP image, up to 8 MB. Images upload securely to RavenX storage.</small><img class="admin-image-preview" id="${previewId}-preview" src="${esc(currentUrl)}" alt="${esc(label)} preview" ${currentUrl ? '' : 'hidden'}></div>`;
  }

  function adminDistanceRow(item = {}, index = 0) {
    const previewId = `event-medal-preview-${index}`;
    return `<div class="admin-distance-row" data-event-distance-row data-medal-url="${esc(item.medal_image || '')}"><div class="form-grid"><div class="form-field"><label>Distance value</label><input class="input" data-distance-value value="${esc(item.value || '')}" maxlength="40" placeholder="3.1km" required></div><div class="form-field"><label>Public label</label><input class="input" data-distance-label value="${esc(item.label || '')}" maxlength="60" placeholder="3.1 KM" required></div><div class="form-field"><label>Medal category</label><input class="input" data-distance-category value="${esc(item.category || '')}" maxlength="60" placeholder="Silver" required></div><div class="form-field"><label>BIB number prefix</label><input class="input" data-distance-prefix value="${esc(item.bib_prefix || '')}" maxlength="12" pattern="[A-Za-z0-9]{2,12}" placeholder="SR31" required></div><div class="form-field full"><label>Category medal image</label><input class="input" name="medal_${index}" type="file" accept="image/png,image/jpeg,image/webp" data-local-image data-image-preview="${previewId}"><small class="help-text">Choose the medal image for this distance category.</small><img class="admin-image-preview" id="${previewId}" src="${esc(item.medal_image || '')}" alt="${esc(item.category || 'Medal')} image preview" ${item.medal_image ? '' : 'hidden'}></div><div class="form-field"><button class="button button-quiet button-small" type="button" data-action="remove-event-distance">Remove category</button></div></div></div>`;
  }

  function reindexEventDistances(list) {
    Array.from(list.querySelectorAll('[data-event-distance-row]')).forEach((row,index) => {
      const input = row.querySelector('input[type="file"]');
      const preview = row.querySelector('.admin-image-preview');
      const previewId = `event-medal-preview-${index}`;
      if (input) { input.name = `medal_${index}`; input.dataset.imagePreview = previewId; }
      if (preview) preview.id = previewId;
    });
  }

  async function renderAdminEvents() {
    if (!user || user.role !== 'admin') return renderAdmin();
    const { query } = routeInfo();
    const selectedId = query.get('id') || '';
    let events = [];
    let error = '';
    try { events = (await api('/api/admin/events')).events || []; } catch (e) { error = e.message; }
    const selected = events.find((event) => event.id === selectedId) || null;
    const metadata = selected?.metadata || {};
    const designs = metadata.designs || {};
    const workflow = selected?.workflow || {};
    const paymentAccounts = metadata.payment_accounts || EVENT.metadata.payment_accounts;
    const paymentMethods = metadata.payment_methods || ['Bkash', 'Nagad', 'Rocket'];
    const distances = metadata.distances?.length ? metadata.distances : selected ? [] : [
      { value: '3.1km', label: '3.1 KM', category: 'Silver', bib_prefix: 'RX31' },
      { value: '6.66km', label: '6.66 KM', category: 'Golden', bib_prefix: 'RX66' },
      { value: '13km', label: '13 KM', category: 'Black', bib_prefix: 'RX13' }
    ];
    const fees = metadata.fees || {};
    const earlyBird = metadata.early_bird || {};
    const paymentForm = ['Bkash','Nagad','Rocket'].map((method) => {
      const account = paymentAccounts[method] || {};
      const key = method.toLowerCase();
      return `<div class="admin-payment-row"><label class="checkbox-row"><input type="checkbox" name="paymentMethod" value="${method}" ${paymentMethods.includes(method) ? 'checked' : ''}> Accept ${method}</label><div class="form-grid"><div class="form-field"><label>${method} payment number</label><input class="input" name="${key}Number" value="${esc(account.number || '')}" inputmode="tel" maxlength="32" placeholder="01XXXXXXXXX"></div><div class="form-field"><label>${method} payment mode</label><select class="select" name="${key}Mode"><option ${account.mode === 'Payment' ? 'selected' : ''}>Payment</option><option ${account.mode === 'Send Money' || !account.mode ? 'selected' : ''}>Send Money</option></select></div></div></div>`;
    }).join('');
    const list = events.length ? events.map((event) => `<tr><td><strong>${esc(event.name)}</strong><small>${esc(event.slug)}</small></td><td>${date(event.startDate)} – ${date(event.endDate)}</td><td>${statusPill(event.status)}</td><td>${(event.metadata?.distances || []).length} categories</td><td><a class="button button-quiet button-small" href="#/admin/events?id=${encodeURIComponent(event.id)}">Edit</a><a class="inline-link" href="#/events/${encodeURIComponent(event.slug)}" target="_blank">Preview</a></td></tr>`).join('') : '<tr><td colspan="5">No events created yet.</td></tr>';
    const categoryRows = distances.map((item,index)=>adminDistanceRow(item,index)).join('');
    const form = `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">${selected ? 'Edit event' : 'New event'}</span><h2>${selected ? esc(selected.name) : 'Create an event'}</h2></div>${selected ? '<a class="button button-quiet button-small" href="#/admin/events">New event</a>' : ''}</div><div class="panel-content"><form class="admin-editor-form" data-form="event-admin" data-event-id="${esc(selected?.id || '')}" enctype="multipart/form-data"><div class="form-grid"><div class="form-field"><label>Event name</label><input class="input" name="name" value="${esc(selected?.name || '')}" data-slug-source minlength="2" maxlength="160" required></div><div class="form-field"><label>Event URL name</label><input class="input" name="slug" value="${esc(selected?.slug || '')}" data-slug-target pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="100" required></div><div class="form-field full"><label>Event details</label><textarea class="textarea" name="description" minlength="5" maxlength="6000" required>${esc(selected?.description || '')}</textarea></div><div class="form-field"><label>Location / format</label><input class="input" name="location" value="${esc(metadata.location || 'Virtual — Run Anywhere, Anytime')}" maxlength="180" required></div><div class="form-field"><label>Event status</label><select class="select" name="status"><option value="PUBLISHED" ${selected?.status === 'PUBLISHED' || !selected ? 'selected' : ''}>Published</option><option value="DRAFT" ${selected?.status === 'DRAFT' ? 'selected' : ''}>Draft</option><option value="ARCHIVED" ${selected?.status === 'ARCHIVED' ? 'selected' : ''}>Archived</option></select></div><div class="form-field"><label>Start date</label><input class="input" name="startDate" type="date" value="${esc(String(selected?.startDate || '').slice(0,10))}"></div><div class="form-field"><label>Event completion date</label><input class="input" name="endDate" type="date" value="${esc(String(selected?.endDate || '').slice(0,10))}" required></div></div>
      <div class="admin-editor-section"><div class="panel-heading"><div><span class="eyebrow">Event categories</span><h3>Distances and medal designs</h3></div><button class="button button-dark button-small" type="button" data-action="add-event-distance">Add category</button></div><div class="admin-distance-list" data-event-distance-list>${categoryRows}</div></div>
      <div class="admin-editor-section"><span class="eyebrow">Registration pricing</span><h3>Student, regular, and early-bird pricing</h3><div class="form-grid"><div class="form-field"><label>Student price (৳)</label><input class="input" name="studentFee" type="number" min="0" max="1000000" value="${esc(fees.student ?? '')}" required></div><div class="form-field"><label>Regular price (৳)</label><input class="input" name="regularFee" type="number" min="0" max="1000000" value="${esc(fees.regular ?? '')}" required></div><div class="form-field"><label>Student early-bird discount (৳)</label><input class="input" name="earlyBirdStudentDiscount" type="number" min="0" max="1000000" value="${esc(earlyBird.student_discount_tk ?? 0)}" required></div><div class="form-field"><label>Regular early-bird discount (৳)</label><input class="input" name="earlyBirdRegularDiscount" type="number" min="0" max="1000000" value="${esc(earlyBird.regular_discount_tk ?? 0)}" required></div><div class="form-field"><label>Discount valid through</label><input class="input" name="earlyBirdValidUntil" type="date" value="${esc(String(earlyBird.valid_until || '').slice(0,10))}"><small class="help-text">The discount stops after this date.</small></div><div class="form-field"><label class="checkbox-row"><input type="checkbox" name="studentIdRequired" ${metadata.student_id_categories?.includes('student') ? 'checked' : ''}> Require a student ID preview for student pricing</label></div></div></div>
      <div class="admin-editor-section"><span class="eyebrow">Registration payment</span><h3>Payment methods and delivery</h3><label class="checkbox-row"><input type="checkbox" name="courierChargeApplies" ${fees.courier_charge_applies ? 'checked' : ''}> Courier charge applies</label><div class="admin-payment-grid">${paymentForm}</div></div>
      <div class="admin-editor-section"><span class="eyebrow">Event workflow</span><h3>What participants can do</h3><div class="admin-check-grid"><label class="checkbox-row"><input type="checkbox" name="registrationOpen" ${workflow.registrationOpen !== false ? 'checked' : ''}> Accept registrations</label><label class="checkbox-row"><input type="checkbox" name="registrationRequiresApproval" ${workflow.registrationRequiresApproval !== false ? 'checked' : ''}> Require registration approval</label><label class="checkbox-row"><input type="checkbox" name="allowMultipleRegistrations" ${workflow.allowMultipleRegistrations !== false ? 'checked' : ''}> Allow multiple distances per participant</label><label class="checkbox-row"><input type="checkbox" name="automaticBibAssignment" ${workflow.automaticBibAssignment !== false ? 'checked' : ''}> Assign BIB on approval</label><label class="checkbox-row"><input type="checkbox" name="runSubmissionEnabled" ${workflow.runSubmissionEnabled !== false ? 'checked' : ''}> Allow run submissions</label><label class="checkbox-row"><input type="checkbox" name="runApprovalRequired" ${workflow.runApprovalRequired !== false ? 'checked' : ''}> Require run approval</label><label class="checkbox-row"><input type="checkbox" name="certificateAfterApproval" ${workflow.certificateAfterApproval !== false ? 'checked' : ''}> Unlock certificate after approval</label></div></div>
      <div class="admin-editor-section"><span class="eyebrow">Event artwork</span><h3>Cover, BIB, and certificate images</h3><p class="help-text">The example images are stored for admin reference. Clean BIB and certificate designs are personalized for each participant.</p><div class="form-grid">${adminImageField('banner','Event cover image',selected?.bannerUrl || '',!selected)}${adminImageField('bibTemplate','Clean BIB design',designs.bib_template_url || '',!selected)}${adminImageField('bibExample','BIB example with sample text',designs.bib_example_url || '',!selected)}${adminImageField('certificateTemplate','Clean certificate design',designs.certificate_template_url || '',!selected)}${adminImageField('certificateExample','Certificate example with sample name',designs.certificate_example_url || '',!selected)}</div></div>
      <div class="admin-editor-section"><div class="form-grid"><div class="form-field full"><label>Participation rules (one per line)</label><textarea class="textarea" name="rules" maxlength="12000">${esc((metadata.rules || []).join('\n'))}</textarea></div><div class="form-field full"><label>Finisher rewards (one per line)</label><textarea class="textarea" name="rewards" maxlength="12000">${esc((metadata.rewards || []).join('\n'))}</textarea></div></div></div><button class="button button-primary" type="submit">${selected ? 'Save event changes' : 'Create event'}</button><div class="error-text" data-error></div></form></div></section>`;
    const content = `${error ? `<div class="db-banner">${esc(error)}</div>` : ''}<section class="panel"><div class="panel-heading"><div><span class="eyebrow">Participant event catalogue</span><h2>Events</h2></div><a class="button button-primary button-small" href="#/admin/events">Create new event</a></div><div class="table-wrap"><table><thead><tr><th>Event</th><th>Dates</th><th>Visibility</th><th>Categories</th><th>Actions</th></tr></thead><tbody>${list}</tbody></table></div></section>${form}`;
    dashLayout(content, '/admin/events', 'Event management', 'Create, publish, and update the details participants see.');
  }

  async function renderAdminShopProducts() {
    if (!user || user.role !== 'admin') return renderAdmin();
    const { query } = routeInfo();
    const selectedId = query.get('id') || '';
    let products = [];
    let error = '';
    try { products = (await api('/api/admin/shop/products')).products || []; } catch (e) { error = e.message; }
    const selected = products.find((product) => product.id === selectedId) || null;
    const rows = products.length ? products.map((product)=>`<tr><td><div class="shop-order-item"><img src="${esc(product.imageUrl)}" alt=""><div><strong>${esc(product.name)}</strong><small>${esc(product.slug)}</small></div></div></td><td>${money(product.unitPrice)}</td><td>${product.hasSizes ? 'Sized item' : 'One size'}</td><td>${statusPill(product.isActive ? 'ACTIVE' : 'PAUSED')}</td><td><a class="button button-quiet button-small" href="#/admin/shop-products?id=${encodeURIComponent(product.id)}">Edit</a></td></tr>`).join('') : '<tr><td colspan="5">No shop items yet.</td></tr>';
    const form = `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">${selected ? 'Edit shop item' : 'New item'}</span><h2>${selected ? esc(selected.name) : 'Add a shop item'}</h2></div>${selected ? '<a class="button button-quiet button-small" href="#/admin/shop-products">New item</a>' : ''}</div><div class="panel-content"><form class="admin-editor-form" data-form="shop-product-admin" data-product-id="${esc(selected?.id || '')}" enctype="multipart/form-data"><div class="form-grid"><div class="form-field"><label>Item name</label><input class="input" name="name" value="${esc(selected?.name || '')}" data-slug-source minlength="2" maxlength="160" required></div><div class="form-field"><label>Item URL name</label><input class="input" name="slug" value="${esc(selected?.slug || '')}" data-slug-target pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="100" required></div><div class="form-field"><label>Price (৳)</label><input class="input" name="unitPrice" type="number" min="0" max="1000000" value="${esc(selected?.unitPrice ?? '')}" required></div><div class="form-field"><label class="checkbox-row"><input type="checkbox" name="hasSizes" ${selected?.hasSizes !== false ? 'checked' : ''}> Customer selects size (S–XXL)</label></div><div class="form-field full"><label>Item details</label><textarea class="textarea" name="description" maxlength="3000">${esc(selected?.description || '')}</textarea></div><div class="form-field"><label class="checkbox-row"><input type="checkbox" name="isActive" ${selected?.isActive !== false ? 'checked' : ''}> Show this item in the public shop</label></div>${adminImageField('image','Item image',selected?.imageUrl || '',!selected)}</div><button class="button button-primary" type="submit">${selected ? 'Save item changes' : 'Add item to shop'}</button><div class="error-text" data-error></div></form></div></section>`;
    const content = `${error ? `<div class="db-banner">${esc(error)}</div>` : ''}<section class="panel"><div class="panel-heading"><div><span class="eyebrow">RavenX catalogue</span><h2>Shop items</h2></div><a class="button button-primary button-small" href="#/admin/shop-products">Add item</a></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Price</th><th>Options</th><th>Visibility</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div></section>${form}`;
    dashLayout(content, '/admin/shop-products', 'Shop item management', 'Add items, set prices, and control which items customers can order.');
  }

  async function renderAdminRegistrations() {
    if (!user || user.role !== 'admin') return renderAdmin();
    const { query } = routeInfo();
    const status = query.get('status') || 'ALL';
    const search = query.get('search') || '';
    let rows = [];
    let error = '';
    try { rows = (await api('/api/admin/registrations?status=' + encodeURIComponent(status) + '&search=' + encodeURIComponent(search))).registrations || []; } catch (e) { error = e.message; }
    const filters = [['ALL','All'],['PENDING_APPROVAL','Pending'],['APPROVED','Approved'],['REJECTED','Rejected']];
    const content = `${error ? `<div class="db-banner">${esc(error)}</div>` : ''}<section class="panel"><div class="data-toolbar"><div class="toolbar-group">${filters.map(([key,label])=>`<a class="button ${status===key?'button-primary':'button-quiet'} button-small" href="#/admin/registrations?status=${key}">${label}</a>`).join('')}</div><form class="toolbar-group" data-form="registration-search"><input class="input search-input" name="search" value="${esc(search)}" placeholder="Search name, email, phone, BIB"><input type="hidden" name="status" value="${esc(status)}"><button class="button button-dark button-small">Search</button></form></div><div class="table-wrap"><table><thead><tr><th>Participant</th><th>Event / registration</th><th>Distance</th><th>BIB</th><th>Payment</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.length ? rows.map((row)=>`<tr><td><strong>${esc(row.name)}</strong><small>${esc(row.email)} · ${esc(row.phone)}</small></td><td>${esc(row.event_name)}<small>${esc(row.id)}</small></td><td>${esc(row.distance)} · ${esc(row.category)}</td><td>${esc(row.bib_number || '—')}</td><td>${esc(row.payment_method || '—')} · ${money(row.registration_fee)}<small>${esc(row.payment_number || '')} · ${esc(row.transaction_id || '')}</small></td><td>${date(row.created_at)}</td><td>${statusPill(row.status)}</td><td><div class="table-actions"><button class="button button-quiet button-small" data-action="view-registration" data-id="${esc(row.id)}">View</button>${row.status === 'PENDING_APPROVAL' ? `<button class="button button-primary button-small" data-action="approve-registration" data-id="${esc(row.id)}">Approve</button><button class="button button-danger button-small" data-action="reject-registration" data-id="${esc(row.id)}">Reject</button>` : esc(row.rejection_reason || '')}</div></td></tr>`).join('') : '<tr><td colspan="8">No registration requests match this filter.</td></tr>'}</tbody></table></div></section>`;
    dashLayout(content, '/admin/registrations', 'Registration management', 'Review requests and assign BIBs on approval.');
  }

  async function renderAdminSubmissions() {
    if (!user || user.role !== 'admin') return renderAdmin();
    const { query } = routeInfo();
    const status = query.get('status') || 'ALL';
    const search = query.get('search') || '';
    let rows = [];
    let error = '';
    try { rows = (await api('/api/admin/submissions?status=' + encodeURIComponent(status) + '&search=' + encodeURIComponent(search))).submissions || []; }
    catch (e) { error = e.message; }
    const filters = [['ALL','All'],['PENDING','Pending'],['APPROVED','Approved'],['REJECTED','Rejected']];
    const cards = rows.map((row) => {
      const feedback = row.admin_feedback
        ? '<div class="notice ' + (row.submission_status === 'REJECTED' ? 'error' : '') + '">' + esc(row.admin_feedback) + '</div>'
        : '';
      const reviewDate = row.reviewed_at ? '<span class="pill">Reviewed ' + date(row.reviewed_at) + '</span>' : '';
      const actions = row.submission_status === 'PENDING'
        ? '<div class="table-actions"><button class="button button-primary button-small" data-action="approve-submission" data-id="' + esc(row.id) + '">Approve run</button><button class="button button-danger button-small" data-action="reject-submission" data-id="' + esc(row.id) + '">Reject with feedback</button></div>'
        : '';
      return '<article class="submission-card"><div><span class="eyebrow">' + esc(row.event_name) + ' · ' + date(row.submitted_at) + '</span><h3>' + esc(row.name) + ' · BIB ' + esc(row.bib_number) + '</h3><p>' + esc(row.email) + ' · Registration ' + esc(row.registration_id) + '</p><a class="run-link" href="' + esc(row.activity_url) + '" target="_blank" rel="noreferrer">Open activity link ↗</a>' + (row.strava_profile_url ? '<p><a class="run-link" href="' + esc(row.strava_profile_url) + '" target="_blank" rel="noreferrer">Open running app profile ↗</a></p>' : '') + '<p><strong>Category:</strong> ' + esc(row.distance) + ' · <strong>Phone:</strong> ' + esc(row.phone) + '</p>' + (row.district || row.delivery_address ? '<p><strong>Delivery:</strong> ' + esc([row.district,row.delivery_address].filter(Boolean).join(' · ')) + '</p>' : '') + (row.additional_information ? '<p><strong>Participant note:</strong> ' + esc(row.additional_information) + '</p>' : '') + '<p class="help-text">Screenshot image is not sent to or stored by RavenX.</p>' + feedback + '<div class="meta-row">' + statusPill(row.submission_status) + reviewDate + '</div>' + actions + '</div></article>';
    }).join('');
    const content = `${error ? `<div class="db-banner">${esc(error)}</div>` : ''}<section class="panel"><div class="data-toolbar"><div class="toolbar-group">${filters.map(([key,label]) => `<a class="button ${status === key ? 'button-primary' : 'button-quiet'} button-small" href="#/admin/submissions?status=${key}">${label}</a>`).join('')}</div><form class="toolbar-group" data-form="submission-search"><input class="input search-input" name="search" value="${esc(search)}" placeholder="Search name, email, BIB"><input type="hidden" name="status" value="${esc(status)}"><button class="button button-dark button-small">Search</button></form></div>${cards || '<div class="panel-content">No submissions match this filter.</div>'}</section>`;
    dashLayout(content, '/admin/submissions', 'Run submission review', 'Open the activity link, then approve or reject the run.');
  }
  function adminChatMessageMarkup(message) {
    return '<article class="admin-chat-message ' + (message.sender === 'AI' ? 'support' : String(message.sender).toLowerCase()) + '"><small>' + esc(message.sender === 'AI' ? 'RAVENX SUPPORT' : message.sender) + ' · ' + date(message.created_at) + '</small><div>' + esc(message.body).replace(/\n/g, '<br>') + '</div></article>';
  }

  function adminChatListMarkup(conversations, selectedId, filter) {
    return conversations.map((item) =>
      '<a class="admin-chat-list-item ' + (selectedId === item.id ? 'selected' : '') + '" href="#/admin/chats?id=' + encodeURIComponent(item.id) + '&status=' + encodeURIComponent(filter) + '">' +
      '<span class="admin-chat-list-top"><strong>' + esc(item.visitor_name || 'Visitor') + '</strong>' + statusPill(item.status) + '</span>' +
      '<small>' + esc(item.visitor_email || 'Email not provided') + '</small><span class="admin-chat-last">' + esc(item.last_message || 'No messages') + '</span><small>' + date(item.updated_at) + '</small></a>'
    ).join('');
  }

  let adminChatPollTimer = null;
  function scheduleAdminChatPoll() {
    clearTimeout(adminChatPollTimer);
    if (!user || user.role !== 'admin' || routeInfo().path !== '/admin/chats') return;
    adminChatPollTimer = setTimeout(async () => {
      const route = routeInfo();
      const filter = route.query.get('status') || 'ADMIN_REQUESTED';
      const selectedId = route.query.get('id') || '';
      try {
        const result = await api('/api/admin/chats?status=' + encodeURIComponent(filter));
        const conversations = result.conversations || [];
        const list = document.querySelector('.admin-chat-list');
        if (list) list.innerHTML = adminChatListMarkup(conversations, selectedId, filter) || '<div class="panel-content">No chats in this filter.</div>';
        if (selectedId) {
          const detail = await api('/api/admin/chats/' + encodeURIComponent(selectedId));
          const thread = document.querySelector('.admin-chat-messages');
          if (thread) thread.innerHTML = (detail.messages || []).map(adminChatMessageMarkup).join('') || '<p class="help-text">This chat has no messages yet.</p>';
        }
      } catch { /* Keep the current inbox visible if a background refresh fails. */ }
      scheduleAdminChatPoll();
    }, 7000);
  }

  async function renderAdminChats() {
    if (!user || user.role !== 'admin') return renderAdmin();
    const route = routeInfo();
    const filter = route.query.get('status') || 'ADMIN_REQUESTED';
    const selectedId = route.query.get('id') || '';
    let conversations = [];
    let selected = null;
    let messages = [];
    let error = '';
    try {
      conversations = (await api('/api/admin/chats?status=' + encodeURIComponent(filter))).conversations || [];
      if (selectedId) {
        const result = await api('/api/admin/chats/' + encodeURIComponent(selectedId));
        selected = result.conversation;
        messages = result.messages || [];
      }
    } catch (e) { error = e.message; }
    const filters = [['ADMIN_REQUESTED','Needs response'],['ADMIN_ACCEPTED','Active'],['CLOSED','Closed'],['ALL','All']];
    const list = adminChatListMarkup(conversations, selectedId, filter);
    const thread = selected
      ? '<section class="panel admin-chat-thread"><div class="panel-heading"><div><span class="eyebrow">' + esc(selected.visitorEmail || selected.accountEmail || 'Visitor') + '</span><h2>' + esc(selected.visitorName || selected.accountName || 'RavenX visitor') + '</h2></div><div class="toolbar-group">' +
        (['ADMIN_ACCEPTED','ADMIN_REQUESTED'].includes(selected.status) ? '<button class="button button-quiet button-small" data-action="admin-chat-close" data-id="' + esc(selected.id) + '">Close chat</button>' : '') +
        '<button class="button button-danger button-small" data-action="admin-chat-delete" data-id="' + esc(selected.id) + '">Delete conversation</button>' +
        '<button class="button button-quiet button-small" data-action="refresh-admin-chat">Refresh</button></div></div>' +
        '<div class="admin-chat-messages">' + (messages.map(adminChatMessageMarkup).join('') || '<p class="help-text">This chat has no messages yet.</p>') + '</div>' +
        (['ADMIN_ACCEPTED','ADMIN_REQUESTED'].includes(selected.status)
          ? '<form class="chat-admin-reply" data-form="admin-chat-reply"><input type="hidden" name="conversationId" value="' + esc(selected.id) + '"><label for="admin-chat-reply">Your text reply</label><textarea class="textarea" id="admin-chat-reply" name="message" maxlength="2000" rows="3" required></textarea><button class="button button-primary button-small" type="submit">Send reply</button><div class="error-text" data-error></div></form>'
          : '<div class="panel-content"><p class="help-text">This conversation is closed.</p></div>') +
        '</section>'
      : '<section class="panel"><div class="empty-state"><div><h2>Select a conversation</h2><p>Choose a request from the inbox to review and reply.</p></div></div></section>';
    const content = (error ? '<div class="db-banner">' + esc(error) + '</div>' : '') +
      '<div class="data-toolbar"><div class="toolbar-group">' + filters.map(([key,label]) => '<a class="button ' + (filter === key ? 'button-primary' : 'button-quiet') + ' button-small" href="#/admin/chats?status=' + key + '">' + label + '</a>').join('') + '</div><div class="toolbar-group"><button class="button button-danger button-small" data-action="admin-chat-clear" data-status="' + esc(filter) + '" ' + (conversations.length ? '' : 'disabled') + '>Delete inbox</button><button class="button button-quiet button-small" data-action="refresh-admin-chats">Refresh inbox</button></div></div>' +
      '<div class="admin-chat-layout"><section class="panel admin-chat-list">' + (list || '<div class="panel-content">No chats in this filter.</div>') + '</section>' + thread + '</div>';
    dashLayout(content, '/admin/chats', 'RavenX chat inbox', 'Read visitor messages and reply directly by text.');
    scheduleAdminChatPoll();
  }

  async function renderAdminAnalytics() {
    if (!user || user.role !== 'admin') return renderAdmin();
    const { query } = routeInfo();
    const days = Number(query.get('days') || 30);
    let data = null;
    let error = '';
    try { data = await api('/api/admin/analytics?days=' + encodeURIComponent(days)); }
    catch (e) { error = e.message; }
    const summary = data?.summary || {};
    const daily = data?.daily || [];
    const recent = data?.recent || [];
    const maxVisits = Math.max(1, ...daily.map((row) => Number(row.visits || 0)));
    const dailyRows = daily.map((row) => '<div class="analytics-day"><time>' + esc(row.visit_date) + '</time><div class="analytics-bar"><span style="width:' + Math.round(Number(row.visits || 0) / maxVisits * 100) + '%"></span></div><strong>' + esc(row.visits) + '</strong><small>' + esc(row.visitors) + ' visitors · avg ' + durationText(row.average_seconds) + '</small></div>').join('');
    const recentRows = recent.map((row) => '<tr><td>' + esc(row.visitor_label) + '</td><td><code>' + esc(row.page_path) + '</code></td><td>' + date(row.started_at, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</td><td>' + durationText(row.duration_seconds) + '</td></tr>').join('');
    const visibleData = analyticsDataVisible
      ? '<div class="stat-grid visitor-analytics-stats"><article class="stat-card"><span class="stat-label">Page visits</span><strong>' + new Intl.NumberFormat().format(Number(summary.total_visits || 0)) + '</strong><small>Public pages in this period</small></article><article class="stat-card"><span class="stat-label">Anonymous visitors</span><strong>' + new Intl.NumberFormat().format(Number(summary.anonymous_visitors || 0)) + '</strong><small>Unique first-party browser sessions</small></article><article class="stat-card"><span class="stat-label">Average time</span><strong>' + durationText(summary.average_seconds) + '</strong><small>Per public page visit</small></article><article class="stat-card"><span class="stat-label">Total time</span><strong>' + durationText(summary.total_seconds) + '</strong><small>Time across public page visits</small></article></div>' +
        '<div class="analytics-grid"><section class="panel"><div class="panel-heading"><h2>Visits by date</h2><span class="help-text">Bangladesh time</span></div><div class="analytics-daily">' + (dailyRows || '<p class="panel-content help-text">No public page visits recorded in this date range.</p>') + '</div></section><section class="panel"><div class="panel-heading"><h2>Recent page visits</h2><span class="help-text">Last 100</span></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Anonymous visitor</th><th>Page</th><th>Date and time</th><th>Time spent</th></tr></thead><tbody>' + (recentRows || '<tr><td colspan="4">No visit data yet.</td></tr>') + '</tbody></table></div></section></div>'
      : '<section class="panel"><div class="panel-content help-text">Visitor data is hidden on this screen. Select “Show visitor data” to view it.</div></section>';
    const ranges = [7, 30, 90].map((range) => '<a class="button ' + (days === range ? 'button-primary' : 'button-quiet') + ' button-small" href="#/admin/analytics?days=' + range + '">Last ' + range + ' days</a>').join('');
    const content = (error ? '<div class="db-banner">' + esc(error) + '</div>' : '') +
      '<div class="data-toolbar"><div class="toolbar-group">' + ranges + '</div><button class="button button-dark button-small" data-action="toggle-analytics-data">' + (analyticsDataVisible ? 'Hide visitor data' : 'Show visitor data') + '</button></div>' +
      '<p class="help-text analytics-privacy">First-party anonymous analytics for public Home, Events, event details, and Shop pages only. RavenX does not record names, email addresses, or IP addresses here.</p>' + visibleData;
    dashLayout(content, '/admin/analytics', 'Visitor analytics', 'Anonymous visit counts and time spent on public pages.');
  }

  async function renderAdminShopOrders() {
    if (!user || user.role !== 'admin') return renderAdmin();
    const { query } = routeInfo();
    const status = query.get('status') || 'ALL';
    const search = query.get('search') || '';
    let orders = [];
    let error = '';
    try { orders = (await api('/api/admin/shop/orders?status=' + encodeURIComponent(status) + '&search=' + encodeURIComponent(search))).orders || []; }
    catch (e) { error = e.message; }
    const filters = [['ALL','All'],['NEW','New'],['READY_FOR_COURIER','Ready for courier'],['DISPATCHED','Dispatched'],['DELIVERED','Delivered'],['CANCELLED','Cancelled']];
    const nextStatus = { NEW: ['READY_FOR_COURIER','Ready for courier'], READY_FOR_COURIER: ['DISPATCHED','Mark dispatched'], DISPATCHED: ['DELIVERED','Mark delivered'] };
    const rows = orders.map((order)=>{
      const itemList = (order.items || []).map((item)=>`<div class="shop-order-item"><img src="${esc(item.imageUrl)}" alt=""><div><strong>${esc(item.productName)}</strong><small>Size ${esc(item.size)} · Qty ${esc(item.quantity)}</small><small>${money(item.unitPrice)} each</small></div></div>`).join('');
      const next = nextStatus[order.status];
      return `<tr><td><input type="checkbox" data-shop-order-select value="${esc(order.id)}" aria-label="Select order ${esc(order.order_code)}"></td><td><strong>${esc(order.order_code)}</strong><small>${date(order.created_at)}</small></td><td><strong>${esc(order.customer_name)}</strong><small><a href="tel:${esc(order.customer_phone)}">${esc(order.customer_phone)}</a></small>${order.customer_email ? `<small><a href="mailto:${esc(order.customer_email)}">${esc(order.customer_email)}</a></small>` : ''}</td><td>${itemList}</td><td><strong>${esc(order.district)}</strong><small>${esc(order.delivery_address)}</small>${order.delivery_note ? `<small>Note: ${esc(order.delivery_note)}</small>` : ''}</td><td><strong>${money(order.total_tk)}</strong></td><td>${statusPill(order.status)}${order.delivery_reference ? `<small>Ref: ${esc(order.delivery_reference)}</small>` : ''}</td><td><div class="table-actions">${next ? `<button class="button button-primary button-small" data-action="shop-order-status" data-id="${esc(order.id)}" data-status="${next[0]}">${next[1]}</button>` : ''}${!['CANCELLED','DELIVERED'].includes(order.status) ? `<button class="button button-danger button-small" data-action="shop-order-status" data-id="${esc(order.id)}" data-status="CANCELLED">Cancel</button>` : ''}</div></td></tr>`;
    }).join('');
    const content = `${error ? `<div class="db-banner">${esc(error)}</div>` : ''}<section class="panel"><div class="panel-content"><p class="help-text">Select new orders to mark them ready for your external courier platform. Delivery is coordinated outside RavenX.</p></div><div class="data-toolbar"><div class="toolbar-group">${filters.map(([key,label])=>`<a class="button ${status===key?'button-primary':'button-quiet'} button-small" href="#/admin/shop-orders?status=${key}">${label}</a>`).join('')}</div><form class="toolbar-group" data-form="shop-order-search"><input class="input search-input" name="search" value="${esc(search)}" placeholder="Search order, customer, phone, address"><input type="hidden" name="status" value="${esc(status)}"><button class="button button-dark button-small">Search</button></form></div><div class="bulk-actions"><label><input type="checkbox" data-shop-select-all> Select all shown</label><button class="button button-dark button-small" data-action="bulk-shop-orders" data-status="READY_FOR_COURIER">Mark selected ready for courier</button><button class="button button-quiet button-small" data-action="bulk-shop-orders" data-status="DISPATCHED">Mark selected dispatched</button></div><div class="table-wrap"><table class="shop-order-table"><thead><tr><th>Select</th><th>Order</th><th>Customer</th><th>Item</th><th>Delivery address</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="8">${orders.length ? '' : 'No shop orders match this filter.'}</td></tr>`}</tbody></table></div></section>`;
    dashLayout(content, '/admin/shop-orders', 'Shop delivery', 'Review customer orders and prepare selected jerseys for delivery.');
  }

  async function render() {
    const { path } = routeInfo();
    trackAnalyticsPage(path);
    trackMetaPage(path);
    if (path !== '/forgot-password') passwordResetEmail = '';
    if (path === '/' || path === '/home') return renderHome();
    if (path === '/events') return renderEvents();
    if (path.startsWith('/events/')) return renderEvent();
    if (path === '/shop') return renderShop();
    if (path === '/signup') return authPage('signup');
    if (path === '/login') return authPage('login');
    if (path === '/forgot-password') return authPage('forgot-password');
    if (path === '/reset-password') return authPage('reset-password');
    if (path === '/dashboard') return renderDashboard();
    if (path === '/my-events') return renderMyEvents();
    if (path.startsWith('/my-events/')) return renderRegistration(decodeURIComponent(path.split('/')[2]));
    if (path === '/certificates') return renderCertificates();
    if (path === '/notifications') return renderNotifications(false);
    if (path === '/profile') return renderProfile();
    if (path === '/admin') return renderAdmin();
    if (path === '/admin/events') return renderAdminEvents();
    if (path === '/admin/registrations') return renderAdminRegistrations();
    if (path === '/admin/submissions') return renderAdminSubmissions();
    if (path === '/admin/emails') return renderAdminEmails();
    if (path === '/admin/chats') return renderAdminChats();
    if (path === '/admin/analytics') return renderAdminAnalytics();
    if (path === '/admin/shop-products') return renderAdminShopProducts();
    if (path === '/admin/shop-orders') return renderAdminShopOrders();
    if (path === '/admin/notifications') return renderNotifications(true);
    layout(`<section class="section page-wrap"><div class="empty-state"><div><div class="empty-state-icon">?</div><h2>Page not found</h2><p>The page may have moved. Return to RavenX home.</p>${link('/','Go home','button button-primary')}</div></div></section>`);
  }

  function setError(form, message) {
    const target = form.querySelector('[data-error]');
    if (target) target.textContent = message;
    else notify(message);
  }

  async function submitForm(form) {
    const formType = form.dataset.form;
    const values = new FormData(form);
    const button = form.querySelector('button[type="submit"],button:not([type])');
    if (button) { button.disabled = true; button.dataset.original = button.textContent; button.textContent = 'Please wait…'; }
    try {
      if (formType === 'chat-message') {
        const body = { message: String(values.get('message') || '') };
        if (values.get('name')) body.name = String(values.get('name'));
        if (values.get('email')) body.email = String(values.get('email'));
        const result = await api('/api/chat/messages', { method: 'POST', body });
        chatConversation = result.conversation || { ...(chatConversation || {}), id: result.conversationId, status: result.status };
        chatMessages = result.messages || [];
        chatError = '';
        chatDraft = '';
        chatContactDraft = { name: '', email: '' };
        const composerInput = document.querySelector('#chat-root #raven-chat-input');
        if (composerInput) composerInput.value = '';
        chatOpen = true;
        renderChatWidget();
        scheduleChatPoll();
        return;
      }
      if (formType === 'admin-chat-reply') {
        const id = String(values.get('conversationId') || '');
        await api('/api/admin/chats/' + encodeURIComponent(id) + '/messages', {
          method: 'POST', body: { message: String(values.get('message') || '') }
        });
        notify('Your reply was sent.');
        await renderAdminChats();
        return;
      }
      if (formType === 'event-admin') {
        const rows = Array.from(form.querySelectorAll('[data-event-distance-row]'));
        const eventData = {
          name: values.get('name'), slug: values.get('slug'), description: values.get('description'),
          location: values.get('location'), startDate: values.get('startDate') || '', endDate: values.get('endDate'),
          status: values.get('status'),
          distances: rows.map((row) => ({
            value: row.querySelector('[data-distance-value]').value,
            label: row.querySelector('[data-distance-label]').value,
            category: row.querySelector('[data-distance-category]').value,
            bib_prefix: row.querySelector('[data-distance-prefix]').value.toUpperCase(),
            medal_image: row.dataset.medalUrl || ''
          })),
          studentFee: Number(values.get('studentFee')), regularFee: Number(values.get('regularFee')),
          earlyBirdStudentDiscount: Number(values.get('earlyBirdStudentDiscount') || 0),
          earlyBirdRegularDiscount: Number(values.get('earlyBirdRegularDiscount') || 0),
          earlyBirdValidUntil: values.get('earlyBirdValidUntil') || '',
          paymentMethods: Array.from(form.querySelectorAll('[name="paymentMethod"]:checked')).map((input) => input.value),
          bkashNumber: values.get('bkashNumber') || '', bkashMode: values.get('bkashMode'),
          nagadNumber: values.get('nagadNumber') || '', nagadMode: values.get('nagadMode'),
          rocketNumber: values.get('rocketNumber') || '', rocketMode: values.get('rocketMode'),
          courierChargeApplies: values.get('courierChargeApplies') === 'on',
          rules: String(values.get('rules') || '').split(/\r?\n/).map((line)=>line.trim()).filter(Boolean),
          rewards: String(values.get('rewards') || '').split(/\r?\n/).map((line)=>line.trim()).filter(Boolean),
          registrationOpen: values.get('registrationOpen') === 'on',
          registrationRequiresApproval: values.get('registrationRequiresApproval') === 'on',
          allowMultipleRegistrations: values.get('allowMultipleRegistrations') === 'on',
          automaticBibAssignment: values.get('automaticBibAssignment') === 'on',
          runSubmissionEnabled: values.get('runSubmissionEnabled') === 'on',
          runApprovalRequired: values.get('runApprovalRequired') === 'on',
          certificateAfterApproval: values.get('certificateAfterApproval') === 'on',
          studentIdRequired: values.get('studentIdRequired') === 'on',
          bannerUrl: values.get('bannerUrl') || '', bibTemplateUrl: values.get('bibTemplateUrl') || '',
          bibExampleUrl: values.get('bibExampleUrl') || '',
          certificateTemplateUrl: values.get('certificateTemplateUrl') || '',
          certificateExampleUrl: values.get('certificateExampleUrl') || ''
        };
        const payload = new FormData();
        payload.append('eventData', JSON.stringify(eventData));
        for (const input of form.querySelectorAll('input[type="file"]')) {
          if (input.files?.[0]) payload.append(input.name, input.files[0]);
        }
        const eventId = form.dataset.eventId;
        const result = await api(eventId ? '/api/admin/events/' + encodeURIComponent(eventId) : '/api/admin/events', {
          method: eventId ? 'PATCH' : 'POST', body: payload
        });
        notify(eventId ? 'Event details saved. Participants now see the updated event.' : 'Event created and published to the participant event catalogue.');
        location.hash = '#/admin/events?id=' + encodeURIComponent(result.event.id);
        await renderAdminEvents();
        return;
      }
      if (formType === 'shop-product-admin') {
        const productData = {
          name: values.get('name'), slug: values.get('slug'), description: values.get('description') || '',
          unitPrice: Number(values.get('unitPrice')), isActive: values.get('isActive') === 'on',
          hasSizes: values.get('hasSizes') === 'on', imageUrl: values.get('imageUrl') || ''
        };
        const payload = new FormData();
        payload.append('productData', JSON.stringify(productData));
        const image = form.querySelector('input[type="file"][name="image"]')?.files?.[0];
        if (image) payload.append('image', image);
        const productId = form.dataset.productId;
        const result = await api(productId ? '/api/admin/shop/products/' + encodeURIComponent(productId) : '/api/admin/shop/products', {
          method: productId ? 'PATCH' : 'POST', body: payload
        });
        notify(productId ? 'Shop item saved.' : 'Shop item added to the public catalogue.');
        location.hash = '#/admin/shop-products?id=' + encodeURIComponent(result.product.id);
        await renderAdminShopProducts();
        return;
      }
      if (formType === 'shop-order') {
        const result = await api('/api/shop/orders', { method: 'POST', body: Object.fromEntries(values) });
        const panel = form.closest('[data-shop-order-panel]');
        if (panel) panel.innerHTML = `<div class="order-success"><span class="eyebrow">Order received</span><div class="empty-state-icon">✓</div><h2>Thanks for your order request.</h2><p>Order number <strong>${esc(result.orderCode)}</strong></p><p>Items total: <strong>${money(result.total)}</strong></p><p>RavenX will contact you to confirm delivery and payment arrangements.</p><button class="button button-dark" type="button" data-action="shop-order-again">Back to shop</button></div>`;
        notify(result.message || 'Your jersey order has been received.');
        return;
      }
      if (formType === 'signup') {
        const result = await api('/api/auth/signup', { method: 'POST', body: Object.fromEntries(values) });
        user = result.user; csrfToken = result.csrfToken; notify('Your RavenX account is ready.'); location.hash = '#/dashboard'; return;
      }
      if (formType === 'login') {
        const result = await api('/api/auth/login', { method: 'POST', body: { email: values.get('email'), password: values.get('password'), remember: values.get('remember') === 'on' } });
        user = result.user; csrfToken = result.csrfToken; notify('Signed in successfully.'); location.hash = user.role === 'admin' ? '#/admin' : '#/dashboard'; return;
      }
      if (formType === 'password-reset-request') {
        const email = String(values.get('email') || '').trim();
        await api('/api/auth/password-reset/request', { method: 'POST', body: { email } });
        passwordResetEmail = email;
        authPage('forgot-password');
        return;
      }
      if (formType === 'password-reset-verify') {
        await api('/api/auth/password-reset/verify-code', { method: 'POST', body: Object.fromEntries(values) });
        passwordResetEmail = '';
        notify('Password updated. Sign in with your new password.'); location.hash = '#/login'; return;
      }
      if (formType === 'reset-password') {
        await api('/api/auth/password-reset/confirm', { method: 'POST', body: Object.fromEntries(values) });
        notify('Password updated. Sign in with your new password.'); location.hash = '#/login'; return;
      }
      if (formType === 'registration') {
        const payload = textFieldsOnly(values);
        payload.append('fbp', cookieValue('_fbp'));
        payload.append('fbc', cookieValue('_fbc'));
        const result = await api('/api/events/' + encodeURIComponent(form.dataset.eventSlug || EVENT.slug) + '/registrations', { method: 'POST', body: payload });
        trackMetaRegistration(result.registrationId);
        if (result.accountCreated) {
          user = result.user || user;
          csrfToken = result.csrfToken || csrfToken;
          notify('Your event registration and RavenX account are ready.');
          location.hash = '#/my-events';
          return;
        }
        notify(result.message || 'Registration submitted.'); location.hash = '#/my-events'; return;
      }
      if (formType === 'submission') {
        const registrationId = decodeURIComponent(routeInfo().path.split('/')[2]);
        const result = await api('/api/me/events/' + encodeURIComponent(registrationId) + '/submissions', { method: 'POST', body: textFieldsOnly(values) });
        notify(result.message || 'Run submission received.'); location.hash = '#/my-events/' + encodeURIComponent(registrationId) + '?section=run'; return;
      }
      if (formType === 'profile') {
        const result = await api('/api/me/profile', { method: 'PATCH', body: { name: values.get('name'), phone: values.get('phone') } });
        user = { ...user, ...result.profile }; notify('Profile saved.'); await render(); return;
      }
      if (formType === 'registration-search' || formType === 'submission-search' || formType === 'shop-order-search') {
        const path = formType === 'registration-search' ? '/admin/registrations' : formType === 'submission-search' ? '/admin/submissions' : '/admin/shop-orders';
        location.hash = `${path}?status=${encodeURIComponent(values.get('status'))}&search=${encodeURIComponent(values.get('search'))}`; return;
      }
    } catch (error) {
      setError(form, error.message || 'The request could not be completed.');
    } finally {
      if (button && button.isConnected) { button.disabled = false; button.textContent = button.dataset.original || 'Submit'; }
    }
  }

  app.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    submitForm(form);
  });

  app.addEventListener('change', (event) => {
    if (event.target.name === 'category') {
      syncStudentIdRequirement();
    }
    if (event.target.matches('[data-local-image]')) syncLocalImagePreview(event.target);
    if (event.target.name === 'payment_method') syncPaymentDetails();
    if (event.target.matches('[data-shop-quantity]')) {
      const form = event.target.closest('form[data-form="shop-order"]');
      const amount = form?.querySelector('[data-order-total]');
      if (form && amount) amount.textContent = money(Number(form.dataset.unitPrice) * Number(event.target.value || 1));
    }
    if (event.target.matches('[data-shop-select-all]')) {
      app.querySelectorAll('[data-shop-order-select]').forEach((checkbox) => { checkbox.checked = event.target.checked; });
    }
  });

  app.addEventListener('input', (event) => {
    if (event.target.id === 'raven-chat-input') chatDraft = event.target.value;
    if (event.target.id === 'chat-contact-name') chatContactDraft.name = event.target.value;
    if (event.target.id === 'chat-contact-email') chatContactDraft.email = event.target.value;
  });

  app.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) return;
    const name = action.dataset.action;
    if (name === 'toggle-chat') {
      chatOpen = !chatOpen;
      if (chatOpen) await refreshChat();
      else clearTimeout(chatPollTimer);
      renderChatWidget();
      scheduleChatPoll();
      if (chatOpen) document.querySelector('#chat-root #raven-chat-input')?.focus();
      return;
    }
    if (name === 'new-chat') {
      chatContactDraft = {
        name: chatConversation?.visitorName || chatContactDraft.name,
        email: chatConversation?.visitorEmail || chatContactDraft.email
      };
      chatConversation = null;
      chatMessages = [];
      chatDraft = '';
      chatError = '';
      chatOpen = true;
      renderChatWidget();
      scheduleChatPoll();
      return;
    }
    if (name === 'refresh-admin-chats' || name === 'refresh-admin-chat') {
      await renderAdminChats();
      return;
    }
    if (name === 'toggle-analytics-data') {
      analyticsDataVisible = !analyticsDataVisible;
      await renderAdminAnalytics();
      return;
    }
    if (name === 'admin-chat-delete') {
      if (!window.confirm('Delete this conversation and its messages permanently?')) return;
      try {
        await api('/api/admin/chats/' + encodeURIComponent(action.dataset.id), { method: 'DELETE' });
        notify('Conversation deleted.');
        const status = routeInfo().query.get('status') || 'ADMIN_REQUESTED';
        const nextHash = '#/admin/chats?status=' + encodeURIComponent(status);
        if (location.hash === nextHash) await renderAdminChats();
        else location.hash = nextHash;
      } catch (error) { notify(error.message); }
      return;
    }
    if (name === 'admin-chat-clear') {
      const status = action.dataset.status || 'ALL';
      const label = { ALL: 'all chats', ADMIN_REQUESTED: 'chats needing a reply', ADMIN_ACCEPTED: 'active chats', CLOSED: 'closed chats' }[status] || 'chats';
      if (!window.confirm('Delete ' + label + ' from the inbox permanently? This also deletes their messages.')) return;
      try {
        const result = await api('/api/admin/chats?status=' + encodeURIComponent(status), { method: 'DELETE' });
        notify((result.deletedCount || 0) + ' conversation(s) deleted.');
        const nextHash = '#/admin/chats?status=' + encodeURIComponent(status);
        if (location.hash === nextHash) await renderAdminChats();
        else location.hash = nextHash;
      } catch (error) { notify(error.message); }
      return;
    }
    if (name === 'admin-chat-accept' || name === 'admin-chat-close') {
      const operation = name === 'admin-chat-accept' ? 'accept' : 'close';
      try {
        await api('/api/admin/chats/' + encodeURIComponent(action.dataset.id), {
          method: 'PATCH', body: { action: operation }
        });
        notify(operation === 'accept' ? 'You accepted the chat request.' : 'Chat closed.');
        await renderAdminChats();
      } catch (error) { notify(error.message); }
      return;
    }
    if (name === 'add-event-distance') {
      const list = action.closest('.panel')?.querySelector('[data-event-distance-list]');
      if (!list) return;
      list.insertAdjacentHTML('beforeend', adminDistanceRow({ value: '', label: '', category: '', bib_prefix: 'RX' }, list.querySelectorAll('[data-event-distance-row]').length));
      return;
    }
    if (name === 'remove-event-distance') {
      const row = action.closest('[data-event-distance-row]');
      const list = row?.parentElement;
      row?.remove();
      if (list) reindexEventDistances(list);
      return;
    }
    if (name === 'menu') {
      const nav = app.querySelector('.site-nav');
      const opened = nav?.classList.toggle('open');
      action.setAttribute('aria-expanded', String(Boolean(opened)));
      return;
    }
    if (name === 'shop-order-again') {
      location.hash = '#/shop';
      await renderShop();
      return;
    }
    if (name === 'reset-use-different-email') {
      passwordResetEmail = '';
      authPage('forgot-password');
      return;
    }
    if (name === 'copy-payment') {
      const number = action.dataset.number;
      if (!number) return;
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(number);
        else {
          const temporary = document.createElement('textarea');
          temporary.value = number;
          temporary.style.position = 'fixed';
          temporary.style.opacity = '0';
          document.body.append(temporary);
          temporary.select();
          const copied = document.execCommand('copy');
          temporary.remove();
          if (!copied) throw new Error('Copy is unavailable in this browser.');
        }
        notify('Payment number copied.');
      } catch { notify('Copy failed. Use the payment number shown.'); }
      return;
    }
    if (name === 'logout') {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
      user = null; csrfToken = null; notify('You have signed out.'); location.hash = '#/'; return;
    }
    if (name === 'read-notification') {
      try { await api((user.role === 'admin' ? '/api/admin/notifications/' : '/api/me/notifications/') + encodeURIComponent(action.dataset.id) + '/read', { method: 'PATCH', body: {} }); await render(); }
      catch (error) { notify(error.message); }
      return;
    }
    if (name === 'read-all') {
      try { await api('/api/me/notifications/read-all', { method: 'POST', body: {} }); await render(); }
      catch (error) { notify(error.message); }
      return;
    }
    if (name === 'preview-email') {
      try {
        const message = (await api('/api/admin/email-outbox/' + encodeURIComponent(action.dataset.id))).message;
        const dialog = document.createElement('dialog');
        dialog.className = 'details-dialog email-preview-dialog';
        dialog.innerHTML = `<div class="details-dialog-inner"><div class="panel-heading"><div><span class="eyebrow">${esc(message.templateName)} · ${esc(message.status)}</span><h2>${esc(message.subject)}</h2><p>To: ${esc(message.recipient)}</p></div><button class="button button-quiet button-small" data-action="close-details">Close</button></div><div class="panel-content"><iframe class="email-preview-frame" title="Email preview" sandbox=""></iframe></div><div class="panel-content email-actions">${['AWAITING_APPROVAL','FAILED'].includes(message.status) ? `<button class="button button-primary" data-action="send-email" data-id="${esc(message.id)}">Send email</button><button class="button button-quiet" data-action="delete-email" data-id="${esc(message.id)}">Delete draft</button>` : ''}</div></div>`;
        dialog.querySelector('iframe').srcdoc = message.previewHtml;
        app.append(dialog);
        dialog.addEventListener('click', (event) => { if (event.target === dialog) { dialog.close(); dialog.remove(); } });
        dialog.showModal();
      } catch (error) { notify(error.message); }
      return;
    }
    if (name === 'send-email') {
      if (!window.confirm('Send this email now?')) return;
      try {
        const result = await api('/api/admin/email-outbox/' + encodeURIComponent(action.dataset.id) + '/send', { method: 'POST', body: {} });
        notify(result.message || 'Email sent.');
        action.closest('dialog')?.close(); action.closest('dialog')?.remove();
        await renderAdminEmails();
      } catch (error) { notify(error.message); await renderAdminEmails(); }
      return;
    }
    if (name === 'delete-email') {
      if (!window.confirm('Delete this unsent email draft?')) return;
      try {
        await api('/api/admin/email-outbox/' + encodeURIComponent(action.dataset.id), { method: 'DELETE' });
        notify('Email draft deleted.');
        action.closest('dialog')?.close(); action.closest('dialog')?.remove();
        await renderAdminEmails();
      } catch (error) { notify(error.message); }
      return;
    }
    if (name === 'close-details') {
      const dialog = action.closest('dialog');
      dialog?.close();
      dialog?.remove();
      return;
    }
    if (name === 'view-registration') {
      try {
        const row = (await api('/api/admin/registrations/' + encodeURIComponent(action.dataset.id))).registration;
        const dialog = document.createElement('dialog');
        dialog.className = 'details-dialog';
        dialog.innerHTML = `<div class="details-dialog-inner"><div class="panel-heading"><div><span class="eyebrow">Registration details</span><h2>${esc(row.event_name)}</h2></div><button class="button button-quiet button-small" data-action="close-details" aria-label="Close details">Close</button></div><div class="panel-content"><div class="detail-list"><div><span>Participant</span><strong>${esc(row.name)}</strong></div><div><span>Email</span><strong>${esc(row.email)}</strong></div><div><span>Phone</span><strong>${esc(row.phone)}</strong></div><div><span>Registration ID</span><strong>${esc(row.id)}</strong></div><div><span>Distance / medal</span><strong>${esc(row.distance)} · ${esc(row.category)}</strong></div><div><span>Gender</span><strong>${esc(row.gender)}</strong></div><div><span>BIB</span><strong>${esc(row.bib_number || 'Not assigned')}</strong></div><div><span>Registration date</span><strong>${date(row.created_at)}</strong></div><div><span>Status</span><strong>${esc(row.status)}</strong></div><div><span>Payment method</span><strong>${esc(row.payment_method || '—')}</strong></div><div><span>Sender number</span><strong>${esc(row.payment_number || '—')}</strong></div><div><span>Transaction ID</span><strong>${esc(row.transaction_id || '—')}</strong></div><div><span>Fee</span><strong>${money(row.registration_fee)}</strong></div>${row.rejection_reason ? `<div class="detail-full"><span>Rejection reason</span><strong>${esc(row.rejection_reason)}</strong></div>` : ''}</div></div></div>`;
        app.append(dialog);
        dialog.addEventListener('click', (dialogEvent) => { if (dialogEvent.target === dialog) { dialog.close(); dialog.remove(); } });
        dialog.showModal();
      } catch (error) { notify(error.message); }
      return;
    }
    if (name === 'approve-registration' || name === 'reject-registration') {
      const actionName = name === 'approve-registration' ? 'approve' : 'reject';
      const reason = actionName === 'reject' ? window.prompt('Enter a rejection reason for the participant:') : '';
      if (actionName === 'reject' && !reason) return;
      if (actionName === 'approve' && !window.confirm('Approve this registration and assign a unique BIB?')) return;
      try { await api('/api/admin/registrations/' + encodeURIComponent(action.dataset.id), { method: 'PATCH', body: { action: actionName, reason: reason || undefined } }); notify(actionName === 'approve' ? 'Registration approved and BIB assigned.' : 'Registration rejected.'); await renderAdminRegistrations(); }
      catch (error) { notify(error.message); }
      return;
    }
    if (name === 'approve-submission' || name === 'reject-submission') {
      const actionName = name === 'approve-submission' ? 'approve' : 'reject';
      const feedback = actionName === 'reject' ? window.prompt('Enter feedback explaining what the participant should update:') : '';
      if (actionName === 'reject' && !feedback) return;
      if (actionName === 'approve' && !window.confirm('Approve this run and unlock the certificate?')) return;
      try { await api('/api/admin/submissions/' + encodeURIComponent(action.dataset.id), { method: 'PATCH', body: { action: actionName, feedback: feedback || undefined } }); notify(actionName === 'approve' ? 'Run approved and certificate unlocked.' : 'Run rejected with feedback.'); await renderAdminSubmissions(); }
      catch (error) { notify(error.message); }
      return;
    }
    if (name === 'bulk-shop-orders') {
      const ids = Array.from(app.querySelectorAll('[data-shop-order-select]:checked')).map((input) => input.value);
      if (!ids.length) { notify('Select at least one order first.'); return; }
      const status = action.dataset.status;
      if (!window.confirm(`Update ${ids.length} selected order${ids.length === 1 ? '' : 's'} for delivery?`)) return;
      try {
        const result = await api('/api/admin/shop/orders/bulk-status', { method: 'PATCH', body: { ids, status } });
        notify(`${result.updated} order${result.updated === 1 ? '' : 's'} updated.`);
        await renderAdminShopOrders();
      } catch (error) { notify(error.message); }
      return;
    }
    if (name === 'shop-order-status') {
      const status = action.dataset.status;
      let deliveryReference;
      if (status === 'DISPATCHED') {
        deliveryReference = window.prompt('Optional courier-platform reference or tracking number. Leave blank if unavailable:', '');
        if (deliveryReference === null) return;
      }
      const label = status.replaceAll('_', ' ').toLowerCase();
      if (!window.confirm(`Set this order to ${label}?`)) return;
      try {
        await api('/api/admin/shop/orders/' + encodeURIComponent(action.dataset.id), {
          method: 'PATCH', body: { status, deliveryReference }
        });
        notify('Shop order updated.');
        await renderAdminShopOrders();
      } catch (error) { notify(error.message); }
    }
  });

  app.addEventListener('input', (event) => {
    if (event.target.matches('[data-slug-target]')) event.target.dataset.userEdited = 'true';
    if (event.target.matches('[data-slug-source]')) {
      const slug = event.target.closest('form')?.querySelector('[data-slug-target]');
      if (slug && slug.dataset.userEdited !== 'true') {
        slug.value = event.target.value.normalize('NFKD').toLowerCase().replace(/[^\x00-\x7f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      }
    }
    if (event.target.matches('[data-shop-quantity]')) {
      const form = event.target.closest('form[data-form="shop-order"]');
      const amount = form?.querySelector('[data-order-total]');
      if (form && amount) amount.textContent = money(Number(form.dataset.unitPrice) * Number(event.target.value || 1));
    }
  });

  window.addEventListener('hashchange', () => { render(); });
  window.addEventListener('pagehide', () => { void reportAnalyticsDuration(true); });
  setInterval(() => { void reportAnalyticsDuration(true); }, 15000);
  const boot = async () => { await loadUser(); await render(); };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
