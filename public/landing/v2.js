/* ═══════════════ Мысль · Landing v2 — интеракции ═══════════════ */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Sticky nav ── */
  var nav = document.getElementById('nav');
  var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 20); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── Reveal on scroll ── */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.14 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ── HERO «мыслесос» ── */
  var cardsRoot = document.getElementById('heroCards');
  var mascot = document.getElementById('heroMascot');
  var heroTitle = document.getElementById('heroTitle');
  var pupilL = document.getElementById('pupilL');
  var pupilR = document.getElementById('pupilR');

  // Контент карточек: тип user|agent, метка, текст (живые тексты из брифа)
  var CARDS = [
    ['user', 'Задача', 'Слушай, а помоги-ка мне составить текст для креативов в канал. Самому лень делать'],
    ['user', 'Событие', 'Попросили выступить на одном крупном форуме, рассказать про себя и про компанию. Накидай идей'],
    ['user', 'Дедлайн', 'Три дня. Строго три дня сделай мне на то чтобы сдать презентацию. Напомни мне за два дня'],
    ['agent', 'Подсказка', 'Вадим, доброе утро! Я увидел у тебя в расписании семь задач на сегодня. Потянешь?'],
    ['agent', 'Мысль', 'А что, если всё-таки сработает? Говорят, что успех — случайность, значит шансы у нас должны быть'],
    ['user', 'Встреча', 'Завтра в два созвон с командой по релизу — не дай мне про него забыть'],
    ['user', 'Вебинар', 'Записался на вебинар по найму в четверг вечером, надо не проспать'],
    ['agent', 'Подсказка', 'Между встречами в 14:00 и 16:00 есть окно — успеешь закрыть задачу по презентации'],
    ['user', 'Заметка', 'Идея: добавить в продукт еженедельный разбор — что успел, что перенеслось'],
    ['agent', 'Мысль', 'Ты три дня откладываешь звонок подрядчику. Поставить на завтра 10:00, чтобы закрыть?'],
  ];

  // Целевые позиции в % контейнера (разброс по экрану), угол наклона
  var LAYOUT = [
    { x: 16, y: 22, r: -7 },  { x: 82, y: 18, r: 6 },
    { x: 12, y: 62, r: 5 },   { x: 86, y: 60, r: -6 },
    { x: 26, y: 86, r: -4 },  { x: 72, y: 84, r: 7 },
    { x: 50, y: 14, r: 3 },   { x: 8,  y: 42, r: 8 },
    { x: 92, y: 40, r: -8 },  { x: 50, y: 90, r: -3 },
  ];

  var cardEls = [];
  if (cardsRoot) {
    CARDS.forEach(function (c, i) {
      var L = LAYOUT[i % LAYOUT.length];
      var el = document.createElement('div');
      el.className = 'hcard hcard-' + c[0];
      el.style.left = L.x + '%';
      el.style.top = L.y + '%';
      el.style.setProperty('--rot', L.r + 'deg');
      el.innerHTML = '<span class="hcard-tag">' + c[1] + '</span>' +
                     '<div class="hcard-text">' + c[2] + '</div>';
      cardsRoot.appendChild(el);
      cardEls.push({ el: el, x: L.x, y: L.y, r: L.r,
                     fx: (Math.random() * 2 - 1), fy: (Math.random() * 2 - 1),
                     ph: Math.random() * Math.PI * 2, sp: 0.5 + Math.random() * 0.5 });
    });
  }

  // Idle-дрейф карточек + мягкое «дыхание»
  var t0 = performance.now();
  function drift(now) {
    var t = (now - t0) / 1000;
    var prog = scrollProgress();
    cardEls.forEach(function (c) {
      // притяжение к центру (50,50) по мере скролла
      var cx = c.x + (50 - c.x) * prog;
      var cy = c.y + (50 - c.y) * prog;
      var driftX = Math.sin(t * c.sp + c.ph) * 1.1 * (1 - prog);
      var driftY = Math.cos(t * c.sp * 0.8 + c.ph) * 1.1 * (1 - prog);
      var rot = c.r + Math.sin(t * 0.5 + c.ph) * 1.5 + prog * 220 * (c.fx);
      var scale = 1 - prog * 0.45;
      c.el.style.left = (cx + driftX) + '%';
      c.el.style.top = (cy + driftY) + '%';
      c.el.style.transform = 'translate(-50%, -50%) rotate(' + rot + 'deg) scale(' + scale + ')';
      c.el.style.opacity = String(1 - prog * 0.85);
    });
    if (!reduce) rafId = requestAnimationFrame(drift);
  }

  // Прогресс «всасывания»: 0 в начале, 1 когда герой ушёл вверх на ~70%
  function scrollProgress() {
    var h = window.innerHeight;
    var y = window.scrollY;
    return Math.max(0, Math.min(1, y / (h * 0.7)));
  }

  var rafId;
  if (cardEls.length && !reduce) {
    rafId = requestAnimationFrame(drift);
    // маскот проявляется после первого скролла
    window.addEventListener('scroll', function () {
      if (scrollProgress() > 0.05) mascot.classList.add('show');
      // заголовок тает при всасывании
      var p = scrollProgress();
      if (heroTitle) { heroTitle.style.opacity = String(1 - p * 1.3); heroTitle.style.transform = 'translateY(' + (-p * 30) + 'px)'; }
    }, { passive: true });
  } else if (mascot) {
    mascot.classList.add('show');
  }

  // Eye-tracking: зрачки следят за курсором
  if (pupilL && pupilR && !reduce) {
    var maxShift = 3.2;
    window.addEventListener('mousemove', function (e) {
      var rect = mascot.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var d = Math.max(1, Math.hypot(dx, dy));
      var sx = (dx / d) * maxShift, sy = (dy / d) * maxShift;
      pupilL.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
      pupilR.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
    }, { passive: true });
  }
})();
