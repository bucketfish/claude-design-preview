(function () {
  'use strict';

  const API = window.__DESIGN_OVERLAY_API__;
  if (!API) return;

  // Persist live mode across page refreshes (dev server reloads)
  let liveMode = localStorage.getItem('_dov_live') === '1';
  let paused = false;
  let comments = [];
  let activePopover = null;
  let hoveredEl = null;
  let targetOutlined = null;
  let showResolved = false;
  let hoverCard = null;
  let hoverCardTimer = null;
  let wsConn = null;
  let wsReconnectTimer = null;

  // ── Styles ───────────────────────────────────────────────────────────────────

  const style = document.createElement('style');
  style.textContent = `
    #_dov-toolbar {
      position: fixed; top: 16px; right: 16px; z-index: 2147483646;
      display: flex; align-items: center; gap: 8px;
      background: #0f0f1a; border: 1px solid #2e2e50;
      border-radius: 10px; padding: 8px 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; color: #c8c8f0;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      user-select: none;
    }
    #_dov-pause {
      display: flex; align-items: center; gap: 6px;
      background: #1e1e35; color: #9090c0;
      border: 1px solid #2e2e50; border-radius: 7px;
      padding: 5px 12px; cursor: pointer;
      font-size: 12px; font-weight: 600; transition: background 0.15s;
    }
    #_dov-pause:hover { background: #2a2a48; }
    #_dov-pause ._dot { width: 7px; height: 7px; border-radius: 50%; background: #4f46e5; flex-shrink: 0; }
    #_dov-pause._paused ._dot { background: #4b5563; }
    #_dov-pause._paused { color: #6070a0; }
    #_dov-count { font-size: 12px; color: #7070a8; min-width: 60px; }
    #_dov-live {
      display: flex; align-items: center; gap: 5px;
      background: #1e1e35; color: #6070a0;
      border: 1px solid #2e2e50; border-radius: 7px;
      padding: 5px 10px; cursor: pointer;
      font-size: 12px; font-weight: 600; transition: background 0.15s;
    }
    #_dov-live:hover { background: #2a2a48; }
    #_dov-live._live-on { background: #1a1a10; color: #fbbf24; border-color: #78600a; }
    #_dov-live ._live-dot { width: 6px; height: 6px; border-radius: 50%; background: #4b5563; }
    #_dov-live._live-on ._live-dot { background: #fbbf24; animation: _dov-live-blink 1.2s ease-in-out infinite; }
    @keyframes _dov-live-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
    #_dov-view {
      background: #1e1e35; color: #9090c0; border: 1px solid #2e2e50;
      border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; font-weight: 500;
    }
    #_dov-view:hover { background: #2a2a48; color: #c0c0e8; }

    #_dov-statusbar {
      position: fixed; top: 16px; left: 16px; z-index: 2147483646;
      display: flex; flex-direction: column; gap: 5px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px; pointer-events: none;
      max-width: 260px;
    }
    ._dov-status-item {
      display: flex; align-items: center; gap: 8px;
      background: #0f0f1a; border: 1px solid #2e2e50;
      border-radius: 8px; padding: 7px 11px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      pointer-events: auto; cursor: pointer;
      transition: background 0.12s;
      user-select: none;
    }
    ._dov-status-item:hover { background: #1a1a2e; }
    ._dov-status-item._active { border-color: #3b82f6; }
    ._dov-status-item._queued { border-color: #2e2e50; opacity: 0.75; }
    ._dov-status-dot {
      width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    }
    ._dov-status-dot._processing { background: #3b82f6; animation: _dov-bp 0.7s ease-in-out infinite; }
    ._dov-status-dot._pending    { background: #ca8a04; animation: _dov-bp 1.4s ease-in-out infinite; }
    ._dov-status-label {
      color: #9090c0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    ._dov-status-label strong { color: #c8c8f0; font-weight: 600; }
    ._dov-status-label em { color: #5b5b90; font-style: normal; font-size: 11px; }

    ._dov-hover-outline {
      outline: 2px dashed #4f46e5 !important;
      outline-offset: 3px !important;
      cursor: crosshair !important;
    }
    ._dov-target-outline {
      outline: 2px solid #4f46e5 !important;
      outline-offset: 3px !important;
      background: rgba(79,70,229,0.05) !important;
    }

    ._dov-badge {
      position: fixed; width: 22px; height: 22px; border-radius: 50%;
      background: #f97316; color: #fff;
      font-size: 10px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      z-index: 2147483645; cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,0.4);
      transform: translate(-50%,-50%);
      transition: transform 0.12s;
    }
    ._dov-badge:hover { transform: translate(-50%,-50%) scale(1.2); }
    ._dov-badge._resolved { background:#1f2937; color:#4ade80; font-size:11px; border:1px solid #374151; box-shadow:none; }
    ._dov-badge._positional { background:#7c3aed; }
    ._dov-badge._pending  { background:#b45309; animation:_dov-bp 1.4s ease-in-out infinite; }
    ._dov-badge._processing { background:#1d4ed8; animation:_dov-bp 0.7s ease-in-out infinite; }
    ._dov-badge._done { background:#15803d; font-size:14px; }
    @keyframes _dov-bp { 0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,.3)} 50%{box-shadow:0 0 0 5px rgba(255,255,255,0)} }

    /* ── Hover card ── */
    ._dov-hcard {
      position: fixed; z-index: 2147483647;
      background: #0f0f1a; border: 1px solid #2e2e50;
      border-radius: 10px; padding: 12px 14px; width: 256px;
      box-shadow: 0 6px 32px rgba(0,0,0,0.7);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      pointer-events: auto;
    }
    ._dov-hcard-status {
      font-size: 11px; font-weight: 700; margin-bottom: 6px;
      display: flex; align-items: center; gap: 5px;
    }
    ._dov-spin { display:inline-block; animation:_dov-rot 1s linear infinite; }
    @keyframes _dov-rot { to{transform:rotate(360deg)} }
    ._dov-hcard-text {
      font-size: 13px; color: #d0d0f8; line-height: 1.55; margin-bottom: 5px;
    }
    ._dov-hcard-sel {
      font-size: 10px; color: #3a3a60; font-family: 'SF Mono','Fira Code',monospace;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    ._dov-hcard-thread {
      font-size: 10px; color: #4040a0; margin-top: 3px; font-style: italic;
    }
    ._dov-hcard-actions { display:flex; gap:5px; flex-wrap:wrap; margin-top:10px; }
    ._dov-hbtn {
      border:none; border-radius:5px; padding:4px 10px;
      font-size:11px; font-weight:600; cursor:pointer; font-family:inherit;
    }
    ._dov-hbtn-approve { background:#14532d; color:#86efac; }
    ._dov-hbtn-approve:hover { background:#166534; }
    ._dov-hbtn-followup { background:#1e1e35; color:#8080b0; border:1px solid #2e2e50; }
    ._dov-hbtn-followup:hover { background:#2a2a48; }
    ._dov-hbtn-reject { background:#1e1e35; color:#f97316; border:1px solid #2e2e50; }
    ._dov-hbtn-reject:hover { background:#2a2a48; }
    ._dov-hbtn kbd { font-family:inherit; font-size:9px; opacity:0.6; margin-left:4px; font-weight:400; }
    ._dov-hcard-form { margin-top:8px; }
    ._dov-hcard-form-label { font-size:10px; color:#404070; margin-bottom:5px; }
    ._dov-hcard-form textarea {
      width:100%; box-sizing:border-box;
      background:#080812; border:1px solid #2e2e50; border-radius:6px;
      color:#d0d0f8; padding:7px 9px; font-size:12px; line-height:1.5;
      resize:none; height:60px; font-family:inherit; outline:none;
    }
    ._dov-hcard-form textarea:focus { border-color:#4f46e5; }
    ._dov-hcard-form-hint { font-size:10px; color:#303060; text-align:right; margin-top:3px; }

    /* ── Full popover (new comment / edit open) ── */
    ._dov-popover {
      position: fixed; z-index: 2147483647;
      background: #0f0f1a; border: 1px solid #2e2e50;
      border-radius: 12px; padding: 14px 16px; width: 280px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.65);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    ._dov-target-label {
      font-size:10px; color:#404060; font-family:'SF Mono','Fira Code',monospace;
      margin-bottom:9px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    ._dov-target-label._positional-label { color:#5b3d8a; font-style:italic; }
    ._dov-popover textarea {
      width:100%; box-sizing:border-box;
      background:#080812; border:1px solid #2e2e50;
      border-radius:7px; color:#d0d0f8;
      padding:9px 10px; font-size:13px; line-height:1.5; resize:vertical; min-height:72px;
      font-family:inherit; outline:none;
    }
    ._dov-popover textarea:focus { border-color:#4f46e5; }
    ._dov-popover textarea::placeholder { color:#353560; }
    ._dov-popover textarea:disabled { opacity:.5; cursor:default; }
    ._dov-hint { font-size:10px; color:#303060; margin-top:5px; text-align:right; }
    ._dov-actions { display:flex; gap:6px; margin-top:10px; justify-content:flex-end; flex-wrap:wrap; }
    ._dov-btn { border:none; border-radius:6px; padding:5px 12px; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; }
    ._dov-primary { background:#4f46e5; color:#fff; }
    ._dov-primary:hover { background:#6056f0; }
    ._dov-secondary { background:#1e1e35; color:#8080b8; border:1px solid #2e2e50; }
    ._dov-secondary:hover { background:#2a2a48; }
    ._dov-resolve-btn { background:#14532d; color:#86efac; }
    ._dov-resolve-btn:hover { background:#166534; }
    ._dov-reopen-btn { background:#1c1c35; color:#f97316; border:1px solid #2e2e50; }
    ._dov-reopen-btn:hover { background:#2a2a48; }
    ._dov-danger { background:#7f1d1d; color:#fca5a5; }
    ._dov-danger:hover { background:#991b1b; }
    ._dov-resolved-tag { font-size:10px; color:#4ade80; background:rgba(74,222,128,.1); padding:2px 7px; border-radius:4px; vertical-align:middle; margin-left:5px; }
    ._dov-meta { font-size:10px; color:#5050a0; word-break:break-all; line-height:1.5; margin-bottom:10px; }

    /* ── View all panel ── */
    ._dov-view-list { max-height:300px; overflow-y:auto; margin-bottom:2px; }
    ._dov-item { padding:8px 10px; border:1px solid #2e2e50; border-radius:8px; margin-bottom:6px; font-size:12px; color:#c0c0e8; line-height:1.5; }
    ._dov-item._res-item { opacity:.45; border-style:dashed; }
    ._dov-item._thread-item { margin-left:16px; border-left:2px solid #2e2e50; border-radius:0 8px 8px 0; }
    ._dov-item ._n { font-weight:700; margin-right:4px; }
    ._dov-item:not(._res-item) ._n { color:#f97316; }
    ._dov-item._res-item ._n { color:#4ade80; }
    ._dov-item ._s { color:#404080; font-size:10px; margin-top:2px; }
    ._dov-item ._st { font-size:10px; margin-top:2px; }
    ._dov-toggle-resolved { font-size:11px; color:#404070; cursor:pointer; display:flex; align-items:center; gap:5px; padding:8px 0 2px; margin-top:4px; border-top:1px solid #1e1e35; }
    ._dov-toggle-resolved:hover { color:#7070a0; }
    ._dov-empty { color:#4040a0; font-size:13px; padding:6px 0 10px; }
  `;
  document.head.appendChild(style);

  // ── DOM ──────────────────────────────────────────────────────────────────────

  const toolbar = document.createElement('div');
  toolbar.id = '_dov-toolbar';
  toolbar.innerHTML = `
    <button id="_dov-pause"><span class="_dot"></span><span class="_label">Commenting</span></button>
    <button id="_dov-live" class="${liveMode ? '_live-on' : ''}"><span class="_live-dot"></span><span class="_llabel">${liveMode ? 'Live on' : 'Live'}</span></button>
    <span id="_dov-count">0 open</span>
    <button id="_dov-view">View all</button>
  `;
  document.body.appendChild(toolbar);

  const pauseBtn = document.getElementById('_dov-pause');
  const liveBtn  = document.getElementById('_dov-live');
  const countEl  = document.getElementById('_dov-count');
  const viewBtn  = document.getElementById('_dov-view');

  // Status bar (top-left)
  const statusBar = document.createElement('div');
  statusBar.id = '_dov-statusbar';
  document.body.appendChild(statusBar);

  // Badges container: just a DOM anchor — actual badges use position:fixed
  const badgesRoot = document.createElement('div');
  badgesRoot.id = '_dov-badges';
  document.body.appendChild(badgesRoot);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function getSelector(el) {
    if (el === document.body) return 'body';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let seg = cur.tagName.toLowerCase();
      const cls = Array.from(cur.classList).filter(c => !c.startsWith('_dov')).slice(0, 2);
      if (cls.length) seg += '.' + cls.map(c => CSS.escape(c)).join('.');
      const sibs = cur.parentElement
        ? Array.from(cur.parentElement.children).filter(s => s.tagName === cur.tagName) : [];
      if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function isOverlayEl(el) {
    return !!(el.closest && el.closest('#_dov-toolbar, #_dov-statusbar, ._dov-popover, #_dov-badges, ._dov-hcard'));
  }

  function getElementsAtPoint(x, y) {
    return document.elementsFromPoint(x, y).filter(el => {
      if (el === document.documentElement || el === document.body) return false;
      return !isOverlayEl(el);
    }).slice(0, 8);
  }

  function setHoverOutline(el) {
    clearHoverOutline();
    if (el) { el.classList.add('_dov-hover-outline'); hoveredEl = el; }
  }
  function clearHoverOutline() {
    if (hoveredEl) { hoveredEl.classList.remove('_dov-hover-outline'); hoveredEl = null; }
  }
  function setTargetOutline(el) {
    clearTargetOutline();
    if (el) { el.classList.add('_dov-target-outline'); targetOutlined = el; }
  }
  function clearTargetOutline() {
    if (targetOutlined) { targetOutlined.classList.remove('_dov-target-outline'); targetOutlined = null; }
  }

  function updateCount() {
    const open = comments.filter(c => !c.resolved).length;
    const res  = comments.filter(c => c.resolved).length;
    countEl.textContent = open + ' open' + (res ? ` · ${res} ✓` : '');
  }

  function statusInfo(comment) {
    const s = comment.resolved ? 'resolved' : (comment.status || 'open');
    return {
      key: s,
      label: {
        open:       'Open',
        pending:    'Queued for Claude…',
        processing: 'Claude is working on this…',
        done:       'Done — awaiting your approval',
        resolved:   'Resolved',
      }[s] || s,
      color: {
        open:       '#f97316',
        pending:    '#ca8a04',
        processing: '#3b82f6',
        done:       '#22c55e',
        resolved:   '#6b7280',
      }[s] || '#888',
      spinning: s === 'processing',
    };
  }

  // ── API ──────────────────────────────────────────────────────────────────────

  async function apiFetch(path, method = 'GET', body) {
    const opts = { method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(API + path, opts);
    return res.json().catch(() => null);
  }

  async function loadComments() {
    try {
      const data = await apiFetch('/comments');
      if (!Array.isArray(data)) {
        console.error('[dov] loadComments: unexpected response', data);
        comments = [];
      } else {
        comments = data;
      }
    } catch(e) {
      console.error('[dov] loadComments failed:', e);
      comments = [];
    }
    updateCount();
    renderBadges();
    renderStatusBar();
  }

  // ── WebSocket: real-time comment updates ─────────────────────────────────────
  // Broadcasts arrive from the proxy server whenever any comment changes —
  // immediately when Claude calls mark_live_done, watch_live_comments, etc.

  function connectWS() {
    const wsUrl = window.__DESIGN_OVERLAY_WS__;
    if (!wsUrl) return;
    clearTimeout(wsReconnectTimer);

    const ws = new WebSocket(wsUrl);
    wsConn = ws;

    ws.addEventListener('message', e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'comments' && Array.isArray(msg.data)) {
          comments = msg.data;
          updateCount();
          renderBadges();
          renderStatusBar();
        }
      } catch {}
    });

    ws.addEventListener('close', () => {
      wsConn = null;
      wsReconnectTimer = setTimeout(connectWS, 2000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  // No-op stubs — kept so callers don't break; WS handles everything now
  function startStatusPolling() {}
  function stopStatusPolling() {}

  // ── Status bar ───────────────────────────────────────────────────────────────

  function renderStatusBar() {
    if (!statusBar.isConnected) document.body.appendChild(statusBar);
    statusBar.innerHTML = '';

    const processing = comments.filter(c => c.status === 'processing');
    const pending    = comments.filter(c => c.status === 'pending');
    if (processing.length === 0 && pending.length === 0) return;

    function makeItem(c) {
      const isProcessing = c.status === 'processing';
      const shortText = c.text.length > 40 ? c.text.slice(0, 38) + '…' : c.text;
      const item = document.createElement('div');
      item.className = '_dov-status-item' + (isProcessing ? ' _active' : ' _queued');
      item.innerHTML = `
        <span class="_dov-status-dot ${isProcessing ? '_processing' : '_pending'}"></span>
        <span class="_dov-status-label">
          <strong>${isProcessing ? 'Working on:' : 'Next up:'}</strong>
          ${shortText}
        </span>
      `;
      if (c.pageX !== undefined && c.pageY !== undefined) {
        item.title = 'Click to jump to this comment';
        item.addEventListener('click', () => {
          window.scrollTo({ top: c.pageY - window.innerHeight / 2, behavior: 'smooth' });
        });
      }
      return item;
    }

    // Always show processing items
    processing.forEach(c => statusBar.appendChild(makeItem(c)));

    // Pending items are hidden until hover
    const queuedEls = pending.map(c => {
      const el = makeItem(c);
      el.style.display = 'none';
      statusBar.appendChild(el);
      return el;
    });

    if (pending.length > 0) {
      // Badge on the active item showing queue count
      const firstActive = statusBar.querySelector('._dov-status-item');
      if (firstActive) {
        const badge = document.createElement('span');
        badge.style.cssText = 'margin-left:auto;font-size:10px;color:#5b5b90;flex-shrink:0;padding-left:6px;';
        badge.textContent = `+${pending.length}`;
        firstActive.appendChild(badge);
      }
      statusBar.addEventListener('mouseenter', () => queuedEls.forEach(el => el.style.display = ''));
      statusBar.addEventListener('mouseleave', () => queuedEls.forEach(el => el.style.display = 'none'));
    }
  }

  // ── Badges ───────────────────────────────────────────────────────────────────

  function renderBadges() {
    // Re-attach if something removed the container from the DOM
    if (!badgesRoot.isConnected) document.body.appendChild(badgesRoot);
    badgesRoot.innerHTML = '';
    console.log('[dov] renderBadges:', comments.length, 'comments');
    let openIdx = 0;
    comments.forEach(c => {
      if (!c.resolved) openIdx++;
      if (c.resolved) return;

      // Always use stored click coordinates — badge appears exactly where
      // you clicked, regardless of which element was targeted.
      if (c.pageX === undefined || c.pageY === undefined) {
        console.warn('[dov] comment missing coords', c.id, c.pageX, c.pageY);
        return;
      }
      const left = c.pageX - window.scrollX;
      const top  = c.pageY - window.scrollY;

      const si = statusInfo(c);
      const cls = '_dov-badge'
        + (si.key === 'resolved'   ? ' _resolved' : '')
        + (si.key === 'pending'    ? ' _pending' : '')
        + (si.key === 'processing' ? ' _processing' : '')
        + (si.key === 'done'       ? ' _done' : '')
        + (c.positional            ? ' _positional' : '');

      const label = si.key === 'resolved' || si.key === 'done' ? '✓'
        : si.key === 'pending' ? '…'
        : si.key === 'processing' ? '⟳'
        : c.parentId ? '↩' : openIdx;

      const badge = document.createElement('div');
      badge.className = cls;
      badge.textContent = label;
      badge.style.left = left + 'px';
      badge.style.top  = top + 'px';

      // Hover → show card
      badge.addEventListener('mouseenter', () => {
        clearTimeout(hoverCardTimer);
        hoverCardTimer = setTimeout(() => showHoverCard(badge, c), 250);
      });
      badge.addEventListener('mouseleave', () => {
        clearTimeout(hoverCardTimer);
        hoverCardTimer = setTimeout(hideHoverCard, 300);
      });

      // Click → primary action only
      badge.addEventListener('click', e => {
        e.stopPropagation();
        hideHoverCard();
        if (si.key === 'open') showEditPopover(e.clientX, e.clientY, c);
        // done/pending/processing → handled via hover card actions
      });

      badgesRoot.appendChild(badge);
    });
  }

  // ── Hover card ───────────────────────────────────────────────────────────────

  function hideHoverCard() {
    clearTimeout(hoverCardTimer);
    if (hoverCard) { hoverCard.dispatchEvent(new Event('_remove')); hoverCard.remove(); hoverCard = null; }
  }

  function showHoverCard(anchor, comment) {
    hideHoverCard();
    const si = statusInfo(comment);
    const parent = comment.parentId ? comments.find(c => c.id === comment.parentId) : null;
    const selector = comment.positional ? '📍 positional pin' : comment.selector;

    const card = document.createElement('div');
    card.className = '_dov-hcard';
    card.innerHTML = `
      <div class="_dov-hcard-status" style="color:${si.color}">
        ${si.spinning ? '<span class="_dov-spin">⟳</span>' : '●'} ${si.label}
      </div>
      <div class="_dov-hcard-text">${comment.text}</div>
      <div class="_dov-hcard-sel">${selector}</div>
      ${parent ? `<div class="_dov-hcard-thread">↩ reply to: "${parent.text.slice(0,50)}${parent.text.length>50?'…':''}"</div>` : ''}
      <div class="_dov-hcard-actions">
        ${si.key === 'done' ? `
          <button class="_dov-hbtn _dov-hbtn-approve" data-a="approve">✓ Approve <kbd>space</kbd></button>
          <button class="_dov-hbtn _dov-hbtn-reject" data-a="reject">↩ Reject <kbd>⌫</kbd></button>
        ` : ''}
        ${si.key !== 'resolved' ? `<button class="_dov-hbtn _dov-hbtn-followup" data-a="followup">+ Follow up <kbd>↵</kbd></button>` : ''}
      </div>
    `;

    // Position above the badge (flip below if near top)
    document.body.appendChild(card);
    hoverCard = card;
    const aRect = anchor.getBoundingClientRect();
    const cRect = card.getBoundingClientRect();
    const cx = aRect.left + aRect.width / 2;
    let cardTop = aRect.top - cRect.height - 12;
    let cardLeft = cx - cRect.width / 2;
    if (cardTop < 8) cardTop = aRect.bottom + 12;
    cardLeft = Math.max(8, Math.min(cardLeft, window.innerWidth - cRect.width - 8));
    card.style.top  = cardTop + 'px';
    card.style.left = cardLeft + 'px';

    card.addEventListener('mouseenter', () => clearTimeout(hoverCardTimer));
    card.addEventListener('mouseleave', () => {
      hoverCardTimer = setTimeout(hideHoverCard, 300);
    });

    // Keyboard shortcuts while hover card is visible
    function onCardKey(e) {
      if (hoverCard !== card) return;
      // Don't fire if user is typing in the follow-up textarea
      if (e.target.tagName === 'TEXTAREA') return;
      // Space → approve (done comments only)
      if (e.key === ' ' && si.key === 'done') {
        e.preventDefault(); e.stopPropagation();
        apiFetch(`/comments/${comment.id}`, 'PUT', { resolved: true, resolvedAt: new Date().toISOString() })
          .then(() => { hideHoverCard(); loadComments(); });
      }
      // Backspace → reject (done comments only)
      if (e.key === 'Backspace' && si.key === 'done') {
        e.preventDefault(); e.stopPropagation();
        apiFetch(`/comments/${comment.id}`, 'PUT', { status: 'open' })
          .then(() => { hideHoverCard(); loadComments(); });
      }
      // Enter → open follow-up form (non-resolved comments)
      if (e.key === 'Enter' && si.key !== 'resolved') {
        e.preventDefault(); e.stopPropagation();
        showFollowUpInCard(card, comment);
      }
    }
    document.addEventListener('keydown', onCardKey, true);
    card.addEventListener('_remove', () => document.removeEventListener('keydown', onCardKey, true));

    card.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;

      if (a === 'approve') {
        await apiFetch(`/comments/${comment.id}`, 'PUT', { resolved: true, resolvedAt: new Date().toISOString() });
        hideHoverCard(); await loadComments(); return;
      }
      if (a === 'reject') {
        await apiFetch(`/comments/${comment.id}`, 'PUT', { status: 'open' });
        hideHoverCard(); await loadComments(); return;
      }
      if (a === 'followup') {
        showFollowUpInCard(card, comment);
      }
      if (a === 'send-followup') {
        const ta = card.querySelector('._dov-hcard-form textarea');
        const text = ta?.value.trim();
        if (!text) { ta?.focus(); return; }
        await submitFollowUp(comment, text);
        hideHoverCard(); return;
      }
      if (a === 'cancel-followup') {
        hideHoverCard(); return;
      }
    });
  }

  function showFollowUpInCard(card, parentComment) {
    // Replace action area with inline follow-up form
    const existing = card.querySelector('._dov-hcard-actions');
    if (existing) existing.remove();

    const form = document.createElement('div');
    form.className = '_dov-hcard-form';
    form.innerHTML = `
      <div class="_dov-hcard-form-label">Follow up on this comment</div>
      <textarea placeholder="What else needs changing here?"></textarea>
      <div class="_dov-hcard-form-hint">↵ to send · Esc to cancel</div>
      <div class="_dov-hcard-actions" style="margin-top:6px">
        <button class="_dov-hbtn _dov-hbtn-reject" data-a="cancel-followup">Cancel</button>
        <button class="_dov-hbtn _dov-hbtn-approve" data-a="send-followup">Send</button>
      </div>
    `;
    card.appendChild(form);

    const ta = form.querySelector('textarea');
    ta.focus();
    ta.addEventListener('keydown', async e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        await submitFollowUp(parentComment, text);
        hideHoverCard();
      }
      if (e.key === 'Escape') hideHoverCard();
    });

    // Reposition card since it grew
    requestAnimationFrame(() => {
      const aRect = document.elementsFromPoint(
        parseFloat(card.style.left) + parseFloat(card.style.width) / 2,
        parseFloat(card.style.top) + 100
      );
      // Simple re-clamp to viewport
      const cRect = card.getBoundingClientRect();
      if (cRect.bottom > window.innerHeight - 8) {
        card.style.top = (window.innerHeight - cRect.height - 8) + 'px';
      }
    });
  }

  async function submitFollowUp(parentComment, text) {
    // Offset the pin slightly so it's distinct from the parent
    const offsetY = (parentComment.pageY || 0) + 28;
    await apiFetch('/comments', 'POST', {
      selector: parentComment.selector,
      positional: parentComment.positional,
      pageX: parentComment.pageX,
      pageY: offsetY,
      parentId: parentComment.id,
      status: liveMode ? 'pending' : 'open',
      text,
      url: parentComment.url || window.location.pathname,
      elementInfo: parentComment.elementInfo,
    });
    await loadComments();
    if (liveMode) startStatusPolling();
  }

  // ── Popover helpers ───────────────────────────────────────────────────────────

  function closePopover() {
    clearTargetOutline();
    if (activePopover) { activePopover.remove(); activePopover = null; }
  }

  function positionPopover(popover, x, y) {
    const W = 280, H = 180;
    let left = x + 14, top = y + 14;
    if (left + W > window.innerWidth - 10) left = x - W - 10;
    if (top + H > window.innerHeight - 10) top = y - H - 10;
    popover.style.left = Math.max(8, left) + 'px';
    popover.style.top  = Math.max(8, top) + 'px';
  }

  function attachOutsideClose(exceptions = []) {
    setTimeout(() => {
      function outside(e) {
        if (!activePopover) { document.removeEventListener('mousedown', outside); return; }
        if (activePopover.contains(e.target)) return;
        if (exceptions.some(ex => ex?.contains(e.target))) return;
        closePopover();
        document.removeEventListener('mousedown', outside);
      }
      document.addEventListener('mousedown', outside);
    }, 50);
  }

  // ── New comment popover ───────────────────────────────────────────────────────

  function showNewCommentPopover(x, y, targetEl, allAtPoint, positional) {
    closePopover();
    if (!positional && targetEl) setTargetOutline(targetEl);

    const selector = (!positional && targetEl) ? getSelector(targetEl) : null;
    const labelText = positional ? 'pin at position (no element)' : selector;
    const labelClass = positional ? '_positional-label' : '';

    const popover = document.createElement('div');
    popover.className = '_dov-popover';
    popover.innerHTML = `
      <div class="_dov-target-label ${labelClass}">${labelText}</div>
      <textarea placeholder="Add comment… e.g. 'reduce margin', 'move higher', 'bigger font'"></textarea>
      <div class="_dov-hint">↵ to save · Esc to cancel</div>
      <div class="_dov-actions">
        <button class="_dov-btn _dov-secondary" data-a="cancel">Cancel</button>
        <button class="_dov-btn _dov-primary" data-a="save">Save</button>
      </div>
    `;

    positionPopover(popover, x, y);
    document.body.appendChild(popover);
    activePopover = popover;

    const textarea = popover.querySelector('textarea');
    textarea.focus();

    const stackSelectors = allAtPoint.map(el => {
      try { return getSelector(el); } catch { return null; }
    }).filter(Boolean);

    async function doSave() {
      const text = textarea.value.trim();
      if (!text) { textarea.focus(); return; }
      console.log('[dov] doSave coords:', x, y, 'scroll:', window.scrollX, window.scrollY, '=> pageX:', x + window.scrollX, 'pageY:', y + window.scrollY);
      try {
        const result = await apiFetch('/comments', 'POST', {
          selector: selector || 'body',
          positional: positional || false,
          pageX: x + window.scrollX,
          pageY: y + window.scrollY,
          status: liveMode ? 'pending' : 'open',
          text,
          url: window.location.pathname + window.location.search,
          elementInfo: positional || !targetEl ? { positional: true, stackAtPoint: stackSelectors } : {
            tag: targetEl.tagName.toLowerCase(),
            id: targetEl.id || null,
            classes: Array.from(targetEl.classList).filter(c => !c.startsWith('_dov')),
            text: (targetEl.textContent || '').trim().slice(0, 120),
            outerHTML: targetEl.outerHTML.slice(0, 600),
            stackAtPoint: stackSelectors,
          },
        });
        console.log('[dov] comment saved:', result);
      } catch(e) {
        console.error('[dov] failed to save comment:', e);
        return;
      }
      closePopover();
      await loadComments();
      if (liveMode) startStatusPolling();
    }

    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSave(); }
    });
    popover.addEventListener('mousedown', e => e.stopPropagation());
    popover.addEventListener('click', e => {
      const a = e.target.dataset.a;
      if (a === 'cancel') closePopover();
      if (a === 'save') doSave();
    });
    attachOutsideClose();
  }

  // ── Edit existing comment popover (open comments only) ────────────────────────

  function showEditPopover(x, y, comment) {
    closePopover();
    const isResolved = !!comment.resolved;
    const popover = document.createElement('div');
    popover.className = '_dov-popover';
    popover.innerHTML = `
      <div class="_dov-meta">
        ${comment.positional ? '📍 positional pin' : comment.selector}
        ${isResolved ? '<span class="_dov-resolved-tag">resolved</span>' : ''}
      </div>
      <textarea${isResolved ? ' disabled' : ''}>${comment.text}</textarea>
      ${!isResolved ? '<div class="_dov-hint">↵ to save · Esc to cancel</div>' : ''}
      <div class="_dov-actions">
        <button class="_dov-btn _dov-danger" data-a="del">Delete</button>
        ${isResolved
          ? '<button class="_dov-btn _dov-reopen-btn" data-a="reopen">Reopen</button>'
          : '<button class="_dov-btn _dov-resolve-btn" data-a="resolve">Mark resolved ✓</button>'}
        <button class="_dov-btn _dov-secondary" data-a="cancel">Cancel</button>
        ${!isResolved ? '<button class="_dov-btn _dov-primary" data-a="save">Update</button>' : ''}
      </div>
    `;
    positionPopover(popover, x, y);
    document.body.appendChild(popover);
    activePopover = popover;

    const textarea = popover.querySelector('textarea');
    if (textarea && !isResolved) {
      textarea.focus();
      textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doUpdate(); }
      });
    }

    async function doUpdate() {
      const text = textarea?.value.trim();
      if (!text) return;
      await apiFetch(`/comments/${comment.id}`, 'PUT', { text });
      closePopover(); await loadComments();
    }

    popover.addEventListener('mousedown', e => e.stopPropagation());
    popover.addEventListener('click', async e => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === 'cancel') { closePopover(); return; }
      if (a === 'save') { await doUpdate(); return; }
      if (a === 'resolve') {
        await apiFetch(`/comments/${comment.id}`, 'PUT', { resolved: true, resolvedAt: new Date().toISOString() });
        closePopover(); await loadComments(); return;
      }
      if (a === 'reopen') {
        await apiFetch(`/comments/${comment.id}`, 'PUT', { resolved: false, resolvedAt: null });
        closePopover(); await loadComments(); return;
      }
      if (a === 'del') {
        await apiFetch(`/comments/${comment.id}`, 'DELETE');
        closePopover(); await loadComments(); return;
      }
    });
    attachOutsideClose();
  }

  // ── View all panel ────────────────────────────────────────────────────────────

  function showViewPanel() {
    closePopover();
    const popover = document.createElement('div');
    popover.className = '_dov-popover';
    popover.style.left = '16px';
    popover.style.top = '62px';
    popover.style.width = '320px';

    function render() {
      const open = comments.filter(c => !c.resolved);
      const resolved = comments.filter(c => c.resolved);
      const visible = showResolved ? comments : open;

      let listHTML;
      if (visible.length === 0) {
        const msg = !showResolved && resolved.length
          ? 'All comments resolved.'
          : 'No comments yet. Click anything on the page to add one.';
        listHTML = `<div class="_dov-empty">${msg}</div>`;
      } else {
        let openIdx = 0;
        const statusDot = { pending:'🟡', processing:'🔵', done:'🟢', open:'', resolved:'' };
        listHTML = visible.map(c => {
          if (!c.resolved) openIdx++;
          const si = statusInfo(c);
          const isThread = !!c.parentId;
          return `<div class="_dov-item${c.resolved ? ' _res-item' : ''}${isThread ? ' _thread-item' : ''}">
            <span class="_n">${c.resolved ? '✓' : isThread ? '↩' : '#' + openIdx}</span>${c.text}
            <div class="_s">${c.positional ? '📍 pin' : c.selector}</div>
            ${si.key !== 'open' && si.key !== 'resolved' ? `<div class="_st" style="color:${si.color}">${si.label}</div>` : ''}
          </div>`;
        }).join('');
      }

      popover.innerHTML = `
        <div class="_dov-view-list">${listHTML}</div>
        ${resolved.length ? `
          <div class="_dov-toggle-resolved" data-a="toggle-resolved">
            <span>${showResolved ? '▼' : '▶'}</span>
            <span>${showResolved ? 'Hide' : 'Show'} ${resolved.length} resolved</span>
          </div>
        ` : ''}
        <div class="_dov-actions" style="margin-top:10px">
          ${open.length ? '<button class="_dov-btn _dov-resolve-btn" data-a="resolve-all" style="font-size:11px">Resolve all</button>' : ''}
          <button class="_dov-btn _dov-secondary" data-a="cancel">Close</button>
        </div>
      `;
    }

    render();
    document.body.appendChild(popover);
    activePopover = popover;

    popover.addEventListener('mousedown', e => e.stopPropagation());
    popover.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'cancel') { closePopover(); return; }
      if (a === 'toggle-resolved') { showResolved = !showResolved; render(); return; }
      if (a === 'resolve-all') {
        await Promise.all(
          comments.filter(c => !c.resolved).map(c =>
            apiFetch(`/comments/${c.id}`, 'PUT', { resolved: true, resolvedAt: new Date().toISOString() })
          )
        );
        closePopover(); await loadComments(); return;
      }
    });
    attachOutsideClose([viewBtn]);
  }

  // ── Events ────────────────────────────────────────────────────────────────────

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.classList.toggle('_paused', paused);
    pauseBtn.querySelector('._dot').style.background = paused ? '#4b5563' : '#4f46e5';
    pauseBtn.querySelector('._label').textContent = paused ? 'Paused' : 'Commenting';
    if (paused) clearHoverOutline();
  });

  liveBtn.addEventListener('click', () => {
    liveMode = !liveMode;
    localStorage.setItem('_dov_live', liveMode ? '1' : '0');
    liveBtn.classList.toggle('_live-on', liveMode);
    liveBtn.querySelector('._llabel').textContent = liveMode ? 'Live on' : 'Live';

    if (liveMode) {
      const tip = document.createElement('div');
      tip.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483646;background:#1a1a10;border:1px solid #78600a;color:#fbbf24;font-size:12px;padding:10px 14px;border-radius:8px;font-family:-apple-system,sans-serif;max-width:280px;line-height:1.5;pointer-events:none';
      tip.textContent = '⚡ Live mode on. Tell Claude to "watch live comments" to process them automatically.';
      document.body.appendChild(tip);
      setTimeout(() => tip.remove(), 5000);
      // Resume polling if there are already in-flight comments
      const active = comments.some(c => c.status === 'pending' || c.status === 'processing' || c.status === 'done');
      if (active) startStatusPolling();
    } else {
      stopStatusPolling();
    }
  });

  viewBtn.addEventListener('click', showViewPanel);

  // Live hover outline
  document.addEventListener('mouseover', e => {
    if (paused || activePopover || isOverlayEl(e.target)) return;
    setHoverOutline(e.target);
  }, true);

  document.addEventListener('mouseout', e => {
    if (isOverlayEl(e.target)) return;
    clearHoverOutline();
  }, true);

  // Click → open new comment popover
  document.addEventListener('click', e => {
    if (paused || isOverlayEl(e.target)) return;
    e.preventDefault();
    e.stopPropagation();

    const el = hoveredEl || e.target;
    clearHoverOutline();
    hideHoverCard();

    const allAtPoint = getElementsAtPoint(e.clientX, e.clientY);
    if (e.shiftKey) {
      showNewCommentPopover(e.clientX, e.clientY, null, allAtPoint, true);
    } else {
      showNewCommentPopover(e.clientX, e.clientY, el, allAtPoint, false);
    }
  }, true);

  // Escape closes any open popover or hover card
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (activePopover) { e.stopPropagation(); closePopover(); }
      else if (hoverCard) hideHoverCard();
    }
  }, true);

  // Scroll/resize: re-render badges to keep fixed positions in sync with viewport
  window.addEventListener('scroll', renderBadges, { passive: true });
  window.addEventListener('resize', renderBadges, { passive: true });

  // ── Init ──────────────────────────────────────────────────────────────────────

  // Connect WebSocket first — it will receive the initial comment state from
  // the server and render badges. HTTP fetch is just a fallback if WS is slow.
  connectWS();
  // Fallback initial load in case WS takes a moment to connect
  loadComments();
})();
