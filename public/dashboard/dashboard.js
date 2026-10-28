'use strict';

(() => {
  const API = '/api/v1';
  const REFRESH_MS = 15000;
  const STORAGE_KEY = 'servora.dashboard';

  const $ = (id) => document.getElementById(id);

  const state = {
    token: null,
    restaurantId: null,
    restaurant: null,
    date: null,
    activeTab: 'reservations',
    selectedCallId: null,
    timer: null,
  };

  // --- session storage (cleared when the tab closes; the staff JWT is short-lived anyway) ---
  function saveAuth() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: state.token, restaurantId: state.restaurantId }));
    } catch { /* storage unavailable: stay signed in for this page load only */ }
  }
  function loadAuth() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.token && saved.restaurantId) {
        state.token = saved.token;
        state.restaurantId = saved.restaurantId;
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }
  function clearAuth() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  // --- API ---
  class SessionExpired extends Error {}

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(API + path, { ...options, headers });
    if (res.status === 401 && state.token) throw new SessionExpired();
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !body || body.success === false) {
      throw new Error((body && body.error && body.error.message) || `Request failed (${res.status})`);
    }
    return body;
  }

  // --- formatting ---
  function todayIn(timeZone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function formatTime(hhmmss) {
    const [h, m] = String(hhmmss).split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
  }
  function formatMoney(paisa) {
    return `Rs ${(paisa / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
  function formatDateTime(iso) {
    const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    if (state.restaurant && state.restaurant.timezone) opts.timeZone = state.restaurant.timezone;
    return new Intl.DateTimeFormat('en-US', opts).format(new Date(iso));
  }

  const STATUS_TONE = {
    CONFIRMED: 'ok', COMPLETED: 'ok', SUCCESS: 'ok',
    PENDING: 'warn', PREPARING: 'warn', ACTIVE: 'warn',
    CANCELLED: 'bad', NO_SHOW: 'bad', ABANDONED: 'bad', FAILURE: 'bad',
  };

  // --- DOM helpers (all user/customer text goes through textContent, never innerHTML) ---
  function el(tag, { text, className, attrs } = {}, children = []) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    children.forEach((child) => node.appendChild(child));
    return node;
  }
  function pill(status) {
    return el('span', { text: status, className: `pill pill-${STATUS_TONE[status] || 'neutral'}` });
  }
  function td(content, className) {
    const cell = el('td', { className });
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content === null || content === undefined || content === '' ? '–' : String(content);
    return cell;
  }
  function fillTable(tbodyId, emptyId, rows) {
    const tbody = $(tbodyId);
    tbody.replaceChildren(...rows);
    $(emptyId).hidden = rows.length > 0;
  }
  function showError(message) {
    const banner = $('app-error');
    banner.textContent = message || '';
    banner.hidden = !message;
  }

  // --- views ---
  function showLogin(message) {
    stopRefresh();
    $('app-view').hidden = true;
    $('login-view').hidden = false;
    $('login-error').textContent = message || '';
  }

  async function showApp() {
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    const { restaurant } = await api(`/restaurants/${state.restaurantId}`);
    state.restaurant = restaurant;
    $('restaurant-name').textContent = restaurant.name;
    $('restaurant-meta').textContent = [restaurant.address, restaurant.phone].filter(Boolean).join(' · ');
    if (!state.date) state.date = todayIn(restaurant.timezone);
    $('date-input').value = state.date;
    await refresh();
    startRefresh();
  }

  // --- data ---
  async function loadReservations() {
    const { reservations } = await api(`/restaurants/${state.restaurantId}/reservations?date=${state.date}`);
    const rows = reservations.map((r) =>
      el('tr', {}, [
        td(formatTime(r.time)),
        td(r.customer.name),
        td(r.customer.phone),
        td(r.partySize, 'num'),
        td(r.tables.join(', ')),
        td(pill(r.status)),
        td(r.specialRequests, 'wrap'),
      ])
    );
    fillTable('reservations-body', 'reservations-empty', rows);
    const active = reservations.filter((r) => r.status !== 'CANCELLED' && r.status !== 'NO_SHOW');
    $('stat-reservations').textContent = active.length;
    $('stat-guests').textContent = active.reduce((sum, r) => sum + r.partySize, 0);
  }

  async function loadOrders() {
    const { orders } = await api(`/restaurants/${state.restaurantId}/orders?date=${state.date}`);
    const rows = orders.map((o) =>
      el('tr', {}, [
        td(formatDateTime(o.createdAt)),
        td(o.customer.name),
        td(o.customer.phone),
        td(o.items.map((i) => `${i.quantity}× ${i.name}`).join(', '), 'wrap'),
        td(formatMoney(o.totalCents), 'num'),
        td(pill(o.status)),
      ])
    );
    fillTable('orders-body', 'orders-empty', rows);
    const active = orders.filter((o) => o.status !== 'CANCELLED');
    $('stat-orders').textContent = active.length;
    $('stat-revenue').textContent = formatMoney(active.reduce((sum, o) => sum + o.totalCents, 0));
  }

  async function loadCalls() {
    const { sessions } = await api(`/restaurants/${state.restaurantId}/sessions`);
    const rows = sessions.map((s) => {
      const row = el('tr', { className: 'selectable' }, [
        td(formatDateTime(s.startedAt)),
        td(s.customerPhone || 'Unknown caller'),
        td(pill(s.status)),
        td(s.actionCount, 'num'),
      ]);
      if (s.id === state.selectedCallId) row.classList.add('selected');
      row.addEventListener('click', () => selectCall(s.id));
      return row;
    });
    fillTable('calls-body', 'calls-empty', rows);
    $('stat-calls').textContent = sessions.length;
  }

  async function selectCall(sessionId) {
    state.selectedCallId = sessionId;
    document.querySelectorAll('#calls-body tr').forEach((row) => row.classList.remove('selected'));
    await Promise.all([loadCalls(), loadCallDetail()]);
  }

  async function loadCallDetail() {
    if (!state.selectedCallId) return;
    const base = `/restaurants/${state.restaurantId}/sessions/${state.selectedCallId}`;
    const [{ messages }, { actions }] = await Promise.all([api(`${base}/messages`), api(`${base}/ai-actions`)]);

    const transcript = el('div', { className: 'transcript' },
      messages.length
        ? messages.map((m) => el('div', { className: `bubble bubble-${m.role}` }, [
            el('span', { className: 'bubble-role', text: m.role === 'ai' ? 'Servora' : m.role === 'customer' ? 'Caller' : 'System' }),
            document.createTextNode(m.content),
          ]))
        : [el('p', { className: 'muted', text: 'No transcript recorded for this call.' })]
    );

    const actionList = el('ul', { className: 'actions' },
      actions.length
        ? actions.map((a) => el('li', { className: 'action' }, [
            el('div', { className: 'action-head' }, [
              el('span', { text: a.toolName }),
              el('span', {}, [pill(a.status), document.createTextNode(a.durationMs !== null ? ` ${a.durationMs} ms` : '')]),
            ]),
            el('pre', { text: `input:  ${JSON.stringify(a.sanitizedInput)}\nresult: ${JSON.stringify(a.sanitizedResult)}` }),
          ]))
        : [el('li', { className: 'muted', text: 'No AI actions on this call.' })]
    );

    $('call-detail').replaceChildren(
      el('h3', { text: 'Transcript' }), transcript,
      el('h3', { text: 'AI actions' }), actionList
    );
  }

  async function refresh() {
    try {
      await Promise.all([loadReservations(), loadOrders(), loadCalls(), loadCallDetail()]);
      showError('');
    } catch (err) {
      if (err instanceof SessionExpired) return signOut('Your session expired. Please sign in again.');
      showError(err.message);
    }
  }

  function startRefresh() {
    stopRefresh();
    state.timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  }
  function stopRefresh() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  function signOut(message) {
    clearAuth();
    Object.assign(state, { token: null, restaurantId: null, restaurant: null, date: null, selectedCallId: null });
    showLogin(message);
  }

  // --- events ---
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('login-error').textContent = '';
    try {
      const body = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('login-email').value.trim(), password: $('login-password').value }),
      });
      if (!body.restaurants || body.restaurants.length === 0) {
        $('login-error').textContent = 'This account is not linked to any restaurant.';
        return;
      }
      state.token = body.token;
      state.restaurantId = body.restaurants[0].restaurantId;
      saveAuth();
      $('login-password').value = '';
      await showApp();
    } catch (err) {
      $('login-error').textContent = err.message;
    }
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.activeTab = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.hidden = panel.id !== `tab-${state.activeTab}`;
      });
    });
  });

  $('date-input').addEventListener('change', () => {
    if ($('date-input').value) {
      state.date = $('date-input').value;
      refresh();
    }
  });
  $('refresh-btn').addEventListener('click', refresh);
  $('logout-btn').addEventListener('click', () => signOut());

  // --- boot ---
  if (loadAuth()) {
    showApp().catch((err) => {
      if (err instanceof SessionExpired) signOut('Your session expired. Please sign in again.');
      else signOut(err.message);
    });
  } else {
    showLogin();
  }
})();
