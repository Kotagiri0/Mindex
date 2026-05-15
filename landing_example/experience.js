/* ───── Experience block · v2 — sticky scroll, 4 шага ───── */
(function () {
  const root = document.querySelector('.experience');
  if (!root) return;

  /* ── DATA ─────────────────────────────────────── */
  const HEADINGS = {
    1: { grey: 'Агент-планировщик',           white: 'управляет задачами' },
    2: { grey: 'Голосовой ввод и тг бот',     white: 'всегда под рукой' },
    3: { grey: 'Динамическое хранилище заметок', white: 'собирает базу знаний' },
    4: { grey: 'Ассистент по заметкам',       white: 'достанет любую мысль' }
  };

  const TL_LABELS = {
    1: 'делегируй',
    2: 'диктуй',
    3: 'добавляй',
    4: 'доставай'
  };

  const TL_DESC = {
    1: 'Агент управляет планировщиком через чат: ставит задачи, видит связи и знает контекст, делая планирование проще с каждым днём',
    2: 'Если неудобно печатать — скажи голосом, и Мысль услышит тебя. Неудобно заходить в приложение? У нас есть тг-коннектор',
    3: 'Каждый чат, задача и заметка — часть общей картины. Мысль использует твои заметки как контекст для будущих бесед, создаёт саммари каждого чата и сохраняет в памяти',
    4: 'Твои записи перестают быть мёртвым грузом — Мысль ищет по смыслу, а не ключевым словам. Достаточно дать направление, и вся информация будет у тебя в руках через мгновения'
  };

  /* ── ELEMENTS ─────────────────────────────────── */
  const headings = root.querySelectorAll('.exp-h-slide');
  const stepMarkers = root.querySelectorAll('.exp-step');
  const tlDots = root.querySelectorAll('.tl-dot');
  const tlFill = root.querySelector('.tl-fill');
  const tlDescs = root.querySelectorAll('.tl-desc');

  const sats = {
    tasks: root.querySelector('.sat-tasks'),
    notes: root.querySelector('.sat-notes'),
    cal: root.querySelector('.sat-cal'),
    profile: root.querySelector('.sat-profile'),
    catcher: root.querySelector('.sat-catcher'),
    int: root.querySelector('.sat-int'),
    wave: root.querySelector('.sat-wave'),
    chat: root.querySelector('.sat-chat')
  };

  const chatScenes = root.querySelectorAll('.chat-scene');
  const taskList = root.querySelector('.task-list');
  const noteList = root.querySelector('.note-list');
  const scanLine = root.querySelector('.scan-line');

  /* ── STATE ────────────────────────────────────── */
  let current = 0;
  let timers = [];
  function clearTimers() { timers.forEach(t => clearTimeout(t)); timers = []; }
  function delay(ms, fn) { const id = setTimeout(fn, ms); timers.push(id); return id; }

  /* ── STEP MANAGER ─────────────────────────────── */
  function setStep(n, scrollProgress) {
    if (n === current) {
      // Update progress fill smoothly even if step didn't change
      if (tlFill && typeof scrollProgress === 'number') {
        tlFill.style.width = `calc(${(scrollProgress * 100).toFixed(2)}% - 16px * ${scrollProgress})`;
      }
      return;
    }
    current = n;

    // headings crossfade
    headings.forEach(h => h.classList.toggle('active', +h.dataset.step === n));

    // timeline dots
    tlDots.forEach(d => d.classList.toggle('active', +d.dataset.step === n));

    // timeline descriptions
    tlDescs.forEach(d => d.classList.toggle('active', +d.dataset.step === n));

    // chat scene
    chatScenes.forEach(c => c.classList.toggle('active', +c.dataset.step === n));

    // reset all sat states
    Object.values(sats).forEach(s => {
      if (!s) return;
      s.classList.remove('lit', 'dim', 'pulse');
    });
    root.querySelectorAll('.int-ic').forEach(i => i.classList.remove('lit'));
    root.querySelectorAll('.note-row').forEach(r => r.classList.remove('match', 'miss', 'flying-in'));

    clearTimers();
    delay(80, () => playStep(n));
  }

  /* ── SCROLL DRIVER ────────────────────────────── */
  function updateFromScroll() {
    const rect = root.getBoundingClientRect();
    const total = root.offsetHeight - window.innerHeight;
    const scrolled = -rect.top;
    const p = Math.max(0, Math.min(1, scrolled / total));
    const step = Math.min(4, Math.floor(p * 4 - 1e-6) + 1);

    // progress fill: 0 at start of step1 ... 1 at end of step4
    if (tlFill) {
      // dot positions are evenly spaced; map step progress: dot1 at 0, dot4 at 1
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
  window.addEventListener('resize', updateFromScroll, { passive: true });

  /* ── TIMELINE CLICKS ──────────────────────────── */
  tlDots.forEach(d => {
    d.addEventListener('click', () => {
      const n = +d.dataset.step;
      const top = root.offsetTop;
      const stepH = root.offsetHeight / 4;
      window.scrollTo({ top: top + stepH * (n - 1) + 4, behavior: 'smooth' });
    });
  });

  /* ── STEP PLAYERS ─────────────────────────────── */
  function playStep(n) {
    if (n === 1) playStep1();
    if (n === 2) playStep2();
    if (n === 3) playStep3();
    if (n === 4) playStep4();
  }

  // ───── Step 1: Делегируй → подсветка трекера + новые задачи появляются
  function playStep1() {
    sats.tasks.classList.add('lit');
    // reset task list to base 2 tasks; then animate 3 new in
    if (!taskList) return;
    const baseHTML = taskList.dataset.base;
    if (baseHTML) taskList.innerHTML = baseHTML;
    const newTasks = [
      { text: 'подготовить материалы', time: '' },
      { text: 'созвон в 14:00',         time: '14:00' },
      { text: 'зарядить ноутбук',       time: '' }
    ];
    delay(1200, () => {
      newTasks.forEach((t, i) => {
        delay(i * 300, () => {
          const li = document.createElement('li');
          li.className = 'task-row fresh';
          li.innerHTML = `
            <button class="task-check" aria-label="готово"><svg viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg></button>
            <span class="task-text">${t.text}</span>
            <span class="task-time">${t.time}</span>
          `;
          taskList.insertBefore(li, taskList.firstChild);
          requestAnimationFrame(() => requestAnimationFrame(() => li.classList.add('in')));
          li.querySelector('.task-check').addEventListener('click', () => {
            if (li.classList.contains('done')) {
              li.classList.remove('done');
              return;
            }
            li.classList.add('done');
            delay(500, () => li.classList.add('removing'));
            delay(900, () => { li.style.display = 'none'; });
          });
        });
      });
    });
  }

  // ───── Step 2: Диктуй → волна + tg
  function playStep2() {
    sats.wave.classList.add('lit');
    sats.int.classList.add('lit');
    const tgIc = root.querySelector('.int-ic[data-int="tg"]');
    if (tgIc) tgIc.classList.add('lit');
  }

  // ───── Step 3: Добавляй → новая заметка прилетает в архив
  function playStep3() {
    sats.notes.classList.add('lit');
    sats.catcher.classList.add('lit', 'pulse');
    if (!noteList) return;
    const baseHTML = noteList.dataset.base;
    if (baseHTML) noteList.innerHTML = baseHTML;
    delay(1300, () => {
      const li = document.createElement('li');
      li.className = 'note-row flying-in';
      li.textContent = 'о редизайне продукта';
      noteList.insertBefore(li, noteList.firstChild);
    });
  }

  // ───── Step 4: Доставай → сканирование + матч
  function playStep4() {
    sats.notes.classList.add('lit');
    sats.profile.classList.add('lit');
    if (scanLine) {
      scanLine.classList.remove('go');
      // force reflow
      void scanLine.offsetWidth;
      scanLine.classList.add('go');
    }
    const rows = noteList.querySelectorAll('.note-row');
    delay(900, () => {
      rows.forEach(r => {
        const txt = r.textContent.toLowerCase();
        if (txt.includes('маркетинг')) r.classList.add('match');
        else r.classList.add('miss');
      });
    });
  }

  /* ── PRESERVE base lists ──────────────────────── */
  if (taskList) taskList.dataset.base = taskList.innerHTML;
  if (noteList) noteList.dataset.base = noteList.innerHTML;

  /* ── INIT ─────────────────────────────────────── */
  updateFromScroll();
  if (current === 0) setStep(1);

  /* ── MOBILE: simple in-view triggers ──────────── */
  if (window.matchMedia('(max-width: 880px)').matches) {
    // For mobile we don't have sticky; use IO to trigger animations per section.
    // (Mobile DOM is generated separately in index.html if needed.)
  }
})();
