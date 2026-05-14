/* ───── Experience block · sticky scroll, 4 шага ───── */
(function () {
  const root = document.querySelector('.experience');
  if (!root) return;

  /* ── ELEMENTS ─────────────────────────────────── */
  const tlDots   = root.querySelectorAll('.tl-dot');
  const tlFill   = root.querySelector('.tl-fill');
  const tlDescs  = root.querySelectorAll('.tl-desc');
  const headings = root.querySelectorAll('.exp-h-slide');

  const chatPairs = root.querySelectorAll('.chat-pair');
  const chatBody  = root.querySelector('#chatBody');

  const board    = root.querySelector('#expBoard');
  const boardSvg = root.querySelector('#boardWires');

  const sats = {
    tasks: root.querySelector('.sat-tasks'),
    notes: root.querySelector('.sat-notes'),
    cal:   root.querySelector('.sat-cal'),
    int:   root.querySelector('.sat-int'),
  };

  const taskList = root.querySelector('.task-list');
  const noteList = root.querySelector('.note-list');
  const scanLine = root.querySelector('.scan-line');

  const tgIc   = root.querySelector('.int-ic[data-int="tg"]');
  const gcalIc = root.querySelector('.int-ic[data-int="gcal"]');

  /* ── STATE ────────────────────────────────────── */
  let current = 0;
  let timers = [];
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function delay(ms, fn) { const id = setTimeout(fn, ms); timers.push(id); return id; }

  /* ── WIRE GEOMETRY ────────────────────────────── */
  const R = 8; // corner radius

  /*
   * Build an SVG path for a horizontal wire with a rounded corner.
   * fromEl/toEl — DOM elements; fromSide/toSide — 'right' | 'left'.
   * The wire exits fromEl horizontally, makes a rounded bend, enters toEl.
   */
  function buildWirePath(fromEl, toEl, fromSide, toSide) {
    if (!board || !fromEl || !toEl) return '';
    const boardRect = board.getBoundingClientRect();
    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();

    const x1 = (fromSide === 'right' ? fr.right : fr.left) - boardRect.left;
    const y1 = fr.top + fr.height * 0.5 - boardRect.top;
    const x2 = (toSide === 'right' ? tr.right : tr.left) - boardRect.left;
    const y2 = tr.top + tr.height * 0.5 - boardRect.top;

    /* Wire goes horizontally then bends toward target */
    const midX = (x1 + x2) / 2;

    if (Math.abs(y1 - y2) < 4) {
      /* Same height — straight line */
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    const goRight = x2 > x1;
    const goDown  = y2 > y1;

    /* Horizontal segment, corner, vertical segment, corner, horizontal to target */
    const hEnd  = goRight ? midX - R : midX + R;
    const vDir  = goDown ? R : -R;
    const vEnd  = goDown ? y2 - R : y2 + R;
    const hDir  = goRight ? R : -R;

    return [
      `M ${x1} ${y1}`,
      `L ${hEnd} ${y1}`,
      `Q ${midX} ${y1} ${midX} ${y1 + vDir}`,
      `L ${midX} ${vEnd}`,
      `Q ${midX} ${y2} ${midX + hDir} ${y2}`,
      `L ${x2} ${y2}`,
    ].join(' ');
  }

  /* Wire configs: step → { from, to, fromSide, toSide } */
  function wireConfigs() {
    const phone = root.querySelector('.phone-wrap');
    return [
      { step: 1, from: sats.tasks, to: phone, fromSide: 'right', toSide: 'left' },
      { step: 2, from: phone, to: sats.int,   fromSide: 'right', toSide: 'left' },
      { step: 3, from: sats.notes, to: phone, fromSide: 'right', toSide: 'left' },
    ];
  }

  function updateWires() {
    if (!boardSvg) return;
    wireConfigs().forEach(cfg => {
      const d = buildWirePath(cfg.from, cfg.to, cfg.fromSide, cfg.toSide);
      const bg = root.querySelector(`#wire${cfg.step}bg`);
      const fg = root.querySelector(`#wire${cfg.step}fg`);
      if (bg) bg.setAttribute('d', d);
      if (fg) {
        fg.setAttribute('d', d);
        /* Set dasharray to path length for accurate animation */
        try {
          const len = fg.getTotalLength();
          fg.style.strokeDasharray = len;
          fg.style.strokeDashoffset = len;
        } catch (_) { /* noop if not rendered yet */ }
      }
    });
  }

  /* ── BORDER RECT SIZES ────────────────────────── */
  function updateBorderRects() {
    root.querySelectorAll('.sat-border-rect').forEach(rect => {
      const sat = rect.closest('.sat');
      if (!sat) return;
      const w = sat.offsetWidth;
      const h = sat.offsetHeight;
      rect.setAttribute('width', w - 1);
      rect.setAttribute('height', h - 1);

      /* Start dashoffset from midpoint of right edge (wire touch point) */
      const perim = 2 * ((w - 1) + (h - 1));
      /* Midpoint of right edge = y + h/2 → from top-right corner that's h/2 along right side */
      const halfRight = (h - 1) / 2;
      rect.style.strokeDasharray = perim;
      rect.style.strokeDashoffset = perim / 2 + halfRight;
      rect.dataset.perim = perim;
      rect.dataset.halfRight = halfRight;
    });
  }

  /* ── WIRE ACTIVATION ──────────────────────────── */
  function activateWire(step) {
    /* Deactivate all */
    for (let i = 1; i <= 3; i++) {
      const fg = root.querySelector(`#wire${i}fg`);
      if (fg) {
        fg.classList.remove('active');
        try { fg.style.strokeDashoffset = fg.getTotalLength(); } catch (_) {}
      }
    }

    if (step < 1 || step > 3) return; /* step 4 reuses step 3's wire */
    const wireStep = step === 4 ? 3 : step;
    const fg = root.querySelector(`#wire${wireStep}fg`);
    if (!fg) return;
    /* Trigger reflow then animate */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { fg.classList.add('active'); });
    });
  }

  /* ── BORDER ACTIVATION ────────────────────────── */
  function activateBorder(satEl) {
    if (!satEl) return;
    const rect = satEl.querySelector('.sat-border-rect');
    if (!rect) return;
    satEl.classList.add('lit');
    rect.classList.add('drawing');
  }

  function deactivateAllBorders() {
    Object.values(sats).forEach(sat => {
      if (!sat) return;
      sat.classList.remove('lit');
      const rect = sat.querySelector('.sat-border-rect');
      if (rect) rect.classList.remove('drawing');
    });
  }

  /* ── CHAT ACCUMULATION ────────────────────────── */
  function showChatPairs(n) {
    chatPairs.forEach(p => {
      const s = +p.dataset.step;
      p.classList.toggle('visible', s <= n);
    });
    /* Scroll to last visible */
    if (chatBody) {
      delay(50, () => { chatBody.scrollTop = chatBody.scrollHeight; });
    }
  }

  /* ── STEP MANAGER ─────────────────────────────── */
  function setStep(n) {
    if (n === current) return;
    current = n;

    headings.forEach(h => h.classList.toggle('active', +h.dataset.step === n));
    tlDots.forEach(d => d.classList.toggle('active', +d.dataset.step === n));
    tlDescs.forEach(d => d.classList.toggle('active', +d.dataset.step === n));

    /* Reset integration icons */
    if (tgIc) tgIc.classList.remove('lit');
    if (gcalIc) gcalIc.classList.remove('lit');

    /* Reset note rows */
    if (noteList) noteList.querySelectorAll('.note-row').forEach(r => r.classList.remove('match', 'miss', 'flying-in'));
    if (scanLine) scanLine.classList.remove('go');

    clearTimers();
    showChatPairs(n);
    activateWire(n);
    deactivateAllBorders();

    /* Activate border after wire animation completes */
    delay(500, () => {
      if (n === 1) activateBorder(sats.tasks);
      if (n === 2) activateBorder(sats.int);
      if (n === 3) activateBorder(sats.notes);
      if (n === 4) activateBorder(sats.notes);
      playStep(n);
    });
  }

  /* ── STEP PLAYERS ─────────────────────────────── */
  function playStep(n) {
    if (n === 1) playStep1();
    if (n === 2) playStep2();
    if (n === 3) playStep3();
    if (n === 4) playStep4();
  }

  /* Step 1 — Делегируй: 3 задачи fly-in */
  function playStep1() {
    if (!taskList) return;
    const base = taskList.dataset.base;
    if (base) taskList.innerHTML = base;

    const newTasks = [
      { text: 'подготовить презентацию',   time: '' },
      { text: 'созвон в 14:00',            time: '14:00' },
      { text: 'забронировать переговорку', time: '' },
    ];

    delay(200, () => {
      newTasks.forEach((t, i) => {
        delay(i * 280, () => {
          const li = document.createElement('li');
          li.className = 'task-row fresh';
          li.innerHTML = `
            <button class="task-check" aria-label="готово">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 12 10 18 20 6"/>
              </svg>
            </button>
            <span class="task-text">${t.text}</span>
            <span class="task-time">${t.time}</span>
          `;
          taskList.insertBefore(li, taskList.firstChild);
          requestAnimationFrame(() => requestAnimationFrame(() => li.classList.add('in')));

          li.querySelector('.task-check').addEventListener('click', () => {
            if (li.classList.contains('done')) { li.classList.remove('done'); return; }
            li.classList.add('done');
            delay(500, () => li.classList.add('removing'));
            delay(900, () => { li.style.display = 'none'; });
          });
        });
      });
    });
  }

  /* Step 2 — Диктуй: Telegram lit, затем GCal lit */
  function playStep2() {
    delay(200, () => { if (tgIc) tgIc.classList.add('lit'); });
    delay(600, () => { if (gcalIc) gcalIc.classList.add('lit'); });
  }

  /* Step 3 — Добавляй: заметка fly-in сверху */
  function playStep3() {
    if (!noteList) return;
    const base = noteList.dataset.base;
    if (base) noteList.innerHTML = base;

    delay(300, () => {
      const li = document.createElement('li');
      li.className = 'note-row flying-in';
      li.textContent = 'о редизайне продукта';
      noteList.insertBefore(li, noteList.firstChild);
    });
  }

  /* Step 4 — Доставай: scan-line + match/miss */
  function playStep4() {
    if (!noteList) return;
    const base = noteList.dataset.base;
    if (base) noteList.innerHTML = base;

    if (scanLine) {
      scanLine.classList.remove('go');
      void scanLine.offsetWidth;
      delay(100, () => scanLine.classList.add('go'));
    }

    delay(900, () => {
      const rows = noteList.querySelectorAll('.note-row');
      rows.forEach(r => {
        const txt = r.textContent.toLowerCase();
        const isMatch = txt.includes('маркетинг') || txt.includes('цел') || txt.includes('market');
        r.classList.add(isMatch ? 'match' : 'miss');
      });
    });
  }

  /* ── SCROLL DRIVER ────────────────────────────── */
  function updateFromScroll() {
    const rect    = root.getBoundingClientRect();
    const total   = root.offsetHeight - window.innerHeight;
    const scrolled = -rect.top;
    const p = Math.max(0, Math.min(1, scrolled / total));
    const step = Math.min(4, Math.floor(p * 4 - 1e-6) + 1);

    if (tlFill) {
      const dotP = Math.max(0, Math.min(1, (p * 4 - 0.5) / 3));
      tlFill.style.width = `calc(${(dotP * 100).toFixed(2)}%)`;
    }

    setStep(step);
  }

  let raf = null;
  window.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; updateFromScroll(); });
  }, { passive: true });

  window.addEventListener('resize', () => {
    updateWires();
    updateBorderRects();
    updateFromScroll();
  }, { passive: true });

  /* ── TIMELINE CLICKS ──────────────────────────── */
  tlDots.forEach(d => {
    d.addEventListener('click', () => {
      const n     = +d.dataset.step;
      const top   = root.offsetTop;
      const stepH = root.offsetHeight / 4;
      window.scrollTo({ top: top + stepH * (n - 1) + 4, behavior: 'smooth' });
    });
  });

  /* ── СОХРАНИТЬ БАЗОВОЕ СОСТОЯНИЕ СПИСКОВ ─────── */
  if (taskList) taskList.dataset.base = taskList.innerHTML;
  if (noteList) noteList.dataset.base = noteList.innerHTML;

  /* ── INIT ─────────────────────────────────────── */
  /* Wait for layout then compute wire geometry */
  requestAnimationFrame(() => {
    updateWires();
    updateBorderRects();
    updateFromScroll();
    if (current === 0) setStep(1);
  });
})();
