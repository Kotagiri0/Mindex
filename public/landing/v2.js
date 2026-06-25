/* ═══════════════ Мысль · Landing v2 — интеракции ═══════════════
   Две ключевые механики:
   1. Средний блок — scroll-scrubbed: прогресс прокрутки внутри
      запинненной секции кроссфейдит сетку иконок в таймлайн дня.
   2. Лента «Делегируй» — scroll-jack: вертикальный скролл внутри
      запинненной секции тянет карточки горизонтально + меняет слово.
   На мобиле (<=860px) обе механики отключаются — там нативный скролл.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var isMobile = window.matchMedia('(max-width: 860px)');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  // линейная нормализация t в окне [a,b] → [0,1]
  function range(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }

  /* ── Nav: тень при скролле ──────────────────────────────────── */
  var nav = document.getElementById('nav');
  function onNav() { nav.classList.toggle('scrolled', window.scrollY > 8); }
  onNav();

  /* ── Акт 1: Hero → сцена (заметки летят из hero в плитки) ────── */
  var act = document.querySelector('[data-act]');
  var aHero = act && act.querySelector('[data-hero-text]');
  var aSol = act && act.querySelector('[data-sol-text]');
  var aGrid = act && act.querySelector('[data-grid]');
  var gNotes = act ? Array.prototype.slice.call(act.querySelectorAll('.g-note')) : [];
  var gTiles = act ? Array.prototype.slice.call(act.querySelectorAll('.g-tile')) : [];
  var gIcos = act ? Array.prototype.slice.call(act.querySelectorAll('.g-ico')) : [];
  var gMascot = act && act.querySelector('.g-mascot');
  var mEyes = act && act.querySelector('[data-mascot-eyes]');
  var stage = act && act.querySelector('[data-stage]');   // холст-обёртка (для замера размера)
  // block2-2: слой «день» (память / события / таймлайн)
  var sMemory = act && act.querySelector('.s2-memory');
  var sTimeline = act && act.querySelector('.s2-timeline');
  var sEvents = act ? Array.prototype.slice.call(act.querySelectorAll('.s2-event')) : [];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // Замер дельты «заметка → её плитка». Обе внутри одного sticky —
  // двигаются вместе, поэтому дельта постоянна и меряется единожды.
  // Параметры «оживления» полёта
  var NOTE_REST = 1;       // масштаб заметок в hero (1 = без увеличения, чтобы не мылило)
  var NOTE_LAND = 0.86;    // масштаб при посадке на плитку
  var NOTE_BLUR = 2;       // пик смаза (px) на максимальной скорости
  var NOTE_W = 0.16;       // длина полёта одной заметки по прогрессу (короче → быстрее)
  // случайные сдвиги старта (не равномерный каскад) + углы — «живее», без сырости
  var NOTE_PHASES = [0.00, 0.07, 0.02, 0.05, 0.09, 0.01, 0.06, 0.03];
  var NOTE_ROTS   = [-6, 5, -4, 7, -5, 6, -7, 4];

  gNotes.forEach(function (n, i) {
    n._start = 0.16 + NOTE_PHASES[i % NOTE_PHASES.length];   // момент старта заметки
    n._rot = NOTE_ROTS[i % NOTE_ROTS.length];
  });

  // Акцент: кольцо слотов (по часовой) в % холста. Блоки едут по этим рельсам,
  // оставаясь прямыми. Порядок плиток/иконок в DOM = порядок слотов.
  var RING = [
    [57.856, 27.264], [68.990, 27.264], [80.124, 27.264], [80.124, 50.007],
    [80.124, 72.750], [68.990, 72.750], [57.856, 72.750], [57.856, 50.007]
  ];
  var RING_STEP = 2;       // на сколько слотов проезжают (2 = чисто, без диагоналей)
  // позиция блока, стартовавшего в слоте k, проехавшего долю f пути в RING_STEP слотов
  function ringPos(k, f) {
    var t = k + f * RING_STEP, seg = Math.floor(t), fr = t - seg;
    var a = RING[((seg % 8) + 8) % 8], b = RING[(((seg + 1) % 8) + 8) % 8];
    return [lerp(a[0], b[0], fr), lerp(a[1], b[1], fr)];
  }

  function measureAct() {
    if (!act) return;
    gNotes.forEach(function (n) { n.style.transform = 'none'; });
    gNotes.forEach(function (n) {
      var mk = aGrid.querySelector('.g-mark[data-mark="' + n.getAttribute('data-to') + '"]');
      if (!mk) { n._dx = 0; n._dy = 0; return; }
      var nr = n.getBoundingClientRect();
      var mr = mk.getBoundingClientRect();
      n._dx = (mr.left + mr.width / 2) - (nr.left + nr.width / 2);
      n._dy = (mr.top + mr.height / 2) - (nr.top + nr.height / 2);
    });
  }

  function updateAct() {
    if (!act || isMobile.matches) return;
    var rect = act.getBoundingClientRect();
    var total = act.offsetHeight - window.innerHeight;
    var p = clamp(-rect.top / total, 0, 1);

    // Тексты: hero гаснет, решения проявляются (по ease-кривой, не линейно)
    if (aHero) aHero.style.opacity = String(1 - easeInOut(range(p, 0.10, 0.28)));
    if (aSol) aSol.style.opacity = String(easeInOut(range(p, 0.34, 0.52)));

    // Заметки летят из hero в центр своей плитки: случайный старт, смаз, доворот
    var nFade = String(1 - range(p, 0.5, 0.6));
    gNotes.forEach(function (n) {
      var lin = range(p, n._start, n._start + NOTE_W);  // линейный прогресс заметки
      var t = easeInOut(lin);
      var dx = (n._dx || 0) * t;
      var dy = (n._dy || 0) * t;
      var s = lerp(NOTE_REST, NOTE_LAND, t);
      var rot = n._rot * (1 - t);
      // смаз ∝ скорости: строго 0 в покое и на посадке, пик в середине полёта
      var blur = (lin > 0.04 && lin < 0.96) ? NOTE_BLUR * Math.sin(Math.PI * lin) : 0;
      n.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ') rotate(' + rot + 'deg)';
      n.style.filter = blur > 0.3 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
      n.style.opacity = nFade;
    });

    // Плитки, иконки, маскот проявляются по мере приземления заметок (по ease-кривой)
    var tileIn = easeInOut(range(p, 0.46, 0.62));
    gTiles.forEach(function (el) { el.style.opacity = String(tileIn); });
    var icoIn = easeInOut(range(p, 0.54, 0.7));
    gIcos.forEach(function (el) { el.style.opacity = String(icoIn); });

    /* ── Акцент: блоки едут по кольцу как по рельсам (прямые, без поворота
       конструкции). Маскот не наклоняется — двигаются только глаза. */
    var ride = easeInOut(range(p, 0.60, 0.70));            // 0 → 1: проезд по рельсам
    var sb = stage ? stage.getBoundingClientRect() : { width: 0, height: 0 };
    gTiles.forEach(function (el, i) {
      var pos = ringPos(i, ride);
      var dx = (pos[0] - RING[i][0]) / 100 * sb.width;
      var dy = (pos[1] - RING[i][1]) / 100 * sb.height;
      el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
    });
    gIcos.forEach(function (el, i) {
      var pos = ringPos(i, ride);
      var dx = (pos[0] - RING[i][0]) / 100 * sb.width;
      var dy = (pos[1] - RING[i][1]) / 100 * sb.height;
      el.style.transform = 'translate(-50%, -50%) translate(' + dx + 'px, ' + dy + 'px)';
    });
    if (gMascot) gMascot.style.opacity = String(easeInOut(range(p, 0.44, 0.6)));
    // Глаза: смотрят вверх и ведут по часовой за блоками, затем возвращаются
    if (mEyes) {
      var mag = 52 * Math.sin(Math.PI * ride);             // 0 → пик → 0 (взгляд возвращается)
      var ang = ride * 2.8;                                // дуга по часовой (~160°)
      var ex = mag * Math.sin(ang);
      var ey = -mag * Math.cos(ang);                       // старт — вверх
      mEyes.setAttribute('transform', 'translate(' + ex.toFixed(1) + ' ' + ey.toFixed(1) + ')');
    }

    /* ── Part 2: плитки → день. Строго последовательно, без перелётов:
       сначала плитки чисто уходят, затем день собирается НА МЕСТЕ.
       На любом шаге колеса — цельный кадр, ничего не наслаивается. */
    // 1) Плитки/иконки/маскот уходят целиком (часть «в следующие дни»)
    if (aGrid) aGrid.style.opacity = String(1 - easeInOut(range(p, 0.72, 0.80)));
    // 2) Память проявляется сверху
    if (sMemory) sMemory.style.opacity = String(easeInOut(range(p, 0.80, 0.87)));
    // 3) Таймлайн въезжает снизу
    if (sTimeline) {
      var tl = easeInOut(range(p, 0.81, 0.89));
      sTimeline.style.opacity = String(tl);
      sTimeline.style.transform = 'translateY(' + lerp(16, 0, tl) + 'px)';
    }
    // 4) События проявляются на своих местах (лёгкий подъём + укрупнение), каскадом
    sEvents.forEach(function (e, i) {
      var w0 = 0.82 + i * 0.03;
      var te = easeInOut(range(p, w0, w0 + 0.10));
      e.style.opacity = String(te);
      e.style.transform = 'translateY(' + lerp(14, 0, te) + 'px) scale(' + lerp(0.94, 1, te) + ')';
    });
  }

  function initActStatic() {
    // мобайл/reduced-motion: hero-текст и заметки видны, грид — финальный ниже
    if (!act) return;
    if (aHero) aHero.style.opacity = '1';
    if (aSol) aSol.style.opacity = '1';
    gNotes.forEach(function (n) { n.style.transform = 'none'; n.style.opacity = '1'; });
    gTiles.forEach(function (el) { el.style.opacity = '1'; });
    gIcos.forEach(function (el) { el.style.opacity = '1'; });
    if (gMascot) gMascot.style.opacity = '1';
  }

  /* ── Блок 3: scroll-jack (вертикаль → горизонталь) ──────────── */
  var rail = document.querySelector('[data-rail]');
  var track = rail && rail.querySelector('[data-rail-track]');
  var wordEl = rail && rail.querySelector('[data-rail-word]');
  var cards = rail ? Array.prototype.slice.call(rail.querySelectorAll('.rail-card')) : [];
  var words = cards.map(function (c) { return c.getAttribute('data-word'); });
  var maxShift = 0;       // на сколько px нужно сдвинуть ленту
  var curWord = '';
  var jackTarget = 0;     // целевой прогресс при клике стрелок (доля 0..1)

  function measureRail() {
    if (!rail || isMobile.matches) { if (rail) rail.style.height = ''; return; }
    // ширина, которую нужно «проехать» горизонтально
    var viewport = rail.querySelector('.rail-viewport').clientWidth;
    maxShift = Math.max(0, track.scrollWidth - viewport);
    // высота секции = экран + дистанция проезда (1px вертикали ≈ 1px горизонтали)
    rail.style.height = (window.innerHeight + maxShift) + 'px';
  }

  // слово в шапке меняется по наведению на карточку (дефолт — первое слово)
  function setWordHTML(word) {
    if (!word || !wordEl || word === curWord) return;
    curWord = word;
    wordEl.style.opacity = '0';
    wordEl.style.transform = 'translateY(-6px)';
    setTimeout(function () {
      wordEl.innerHTML = curWord;
      wordEl.style.opacity = '1';
      wordEl.style.transform = 'none';
    }, 150);
  }

  function updateRail() {
    if (!rail || isMobile.matches) return;
    var rect = rail.getBoundingClientRect();
    var total = rail.offsetHeight - window.innerHeight;
    var p = clamp(-rect.top / total, 0, 1);
    track.style.transform = 'translateX(' + (-p * maxShift) + 'px)';
  }

  // стрелки: прокручиваем страницу так, чтобы прогресс ленты сместился к нужной карточке
  function railScrollTo(dir) {
    if (!rail || isMobile.matches || !words.length) return;
    var total = rail.offsetHeight - window.innerHeight;
    var rect = rail.getBoundingClientRect();
    var p = clamp(-rect.top / total, 0, 1);
    var step = 1 / (words.length - 1);
    var nextP = clamp(Math.round(p / step) * step + dir * step, 0, 1);
    var pageTop = window.scrollY + rect.top;          // абсолютный top секции
    window.scrollTo({ top: pageTop + nextP * total, behavior: 'smooth' });
  }

  /* ── Общий rAF-цикл на скролл ───────────────────────────────── */
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      onNav();
      updateAct();
      updateRail();
      ticking = false;
    });
  }

  function onResize() {
    measureRail();
    if (isMobile.matches || reduce.matches) { initActStatic(); }
    else { measureAct(); }
    onScroll();
  }

  /* ── Squircle (iOS smooth corners) — алгоритм из figma-squircle,
     равные углы. Применяем clip-path к [data-squircle] по факт. размеру. */
  function squirclePath(w, h, radius, smoothing) {
    var budget = Math.min(w, h) / 2;
    var r = Math.min(radius, budget);
    var s = Math.min(smoothing, budget / r - 1);
    var p = Math.min((1 + s) * r, budget);
    var rad = Math.PI / 180;
    var arc = 90 * (1 - s);
    var arcLen = Math.sin((arc / 2) * rad) * r * Math.SQRT2;
    var alpha = (90 - arc) / 2;
    var p3p4 = r * Math.tan((alpha / 2) * rad);
    var beta = 45 * s;
    var c = p3p4 * Math.cos(beta * rad);
    var d = c * Math.tan(beta * rad);
    var b = (p - arcLen - c - d) / 3;
    var a = 2 * b;
    function n(x) { return x.toFixed(4); }
    return 'path("M ' + n(w - p) + ' 0 ' +
      'c ' + n(a) + ' 0 ' + n(a + b) + ' 0 ' + n(a + b + c) + ' ' + n(d) + ' ' +
      'a ' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(arcLen) + ' ' + n(arcLen) + ' ' +
      'c ' + n(d) + ' ' + n(c) + ' ' + n(d) + ' ' + n(b + c) + ' ' + n(d) + ' ' + n(a + b + c) + ' ' +
      'L ' + n(w) + ' ' + n(h - p) + ' ' +
      'c 0 ' + n(a) + ' 0 ' + n(a + b) + ' ' + n(-d) + ' ' + n(a + b + c) + ' ' +
      'a ' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(-arcLen) + ' ' + n(arcLen) + ' ' +
      'c ' + n(-c) + ' ' + n(d) + ' ' + n(-(b + c)) + ' ' + n(d) + ' ' + n(-(a + b + c)) + ' ' + n(d) + ' ' +
      'L ' + n(p) + ' ' + n(h) + ' ' +
      'c ' + n(-a) + ' 0 ' + n(-(a + b)) + ' 0 ' + n(-(a + b + c)) + ' ' + n(-d) + ' ' +
      'a ' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(-arcLen) + ' ' + n(-arcLen) + ' ' +
      'c ' + n(-d) + ' ' + n(-c) + ' ' + n(-d) + ' ' + n(-(b + c)) + ' ' + n(-d) + ' ' + n(-(a + b + c)) + ' ' +
      'L 0 ' + n(p) + ' ' +
      'c 0 ' + n(-a) + ' 0 ' + n(-(a + b)) + ' ' + n(d) + ' ' + n(-(a + b + c)) + ' ' +
      'a ' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(arcLen) + ' ' + n(-arcLen) + ' ' +
      'c ' + n(c) + ' ' + n(-d) + ' ' + n(b + c) + ' ' + n(-d) + ' ' + n(a + b + c) + ' ' + n(-d) + ' ' +
      'Z")';
  }
  var sqEls = Array.prototype.slice.call(document.querySelectorAll('[data-squircle]'));
  function applySquircle(el) {
    var w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    var r = parseFloat(el.getAttribute('data-sq-radius')) || 32;
    el.style.clipPath = squirclePath(w, h, r, 0.6);
  }
  function applySquircles() { sqEls.forEach(applySquircle); }
  if (sqEls.length && 'ResizeObserver' in window) {
    var sqRO = new ResizeObserver(function (entries) {
      entries.forEach(function (e) { applySquircle(e.target); });
    });
    sqEls.forEach(function (el) { sqRO.observe(el); });
  }

  /* ── Появление при скролле со stagger (цепочка, шаги, платформы) */
  var revealEls = [].slice.call(document.querySelectorAll('[data-chain], [data-reveal]'));
  if (revealEls.length) {
    if (reduce.matches || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('is-in'); });
    } else {
      var revealIO = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); obs.unobserve(e.target); }
        });
      }, { threshold: 0.3 });
      revealEls.forEach(function (el) { revealIO.observe(el); });
    }
  }

  /* ── Init ───────────────────────────────────────────────────── */
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('load', applySquircles);

  var prevBtn = rail && rail.querySelector('[data-rail-prev]');
  var nextBtn = rail && rail.querySelector('[data-rail-next]');
  if (prevBtn) prevBtn.addEventListener('click', function () { railScrollTo(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { railScrollTo(1); });

  // наведение на карточку → её слово в шапке; уход с ленты → дефолтное (первое)
  cards.forEach(function (c) {
    c.addEventListener('mouseenter', function () { setWordHTML(c.getAttribute('data-word')); });
  });
  if (rail) rail.addEventListener('mouseleave', function () { setWordHTML(words[0]); });

  if (wordEl && words.length) { wordEl.innerHTML = words[0]; curWord = words[0]; }

  // картинки/шрифты могут менять размеры — меряем после загрузки
  window.addEventListener('load', onResize);
  measureRail();
  if (isMobile.matches || reduce.matches) { initActStatic(); }
  else { measureAct(); }
  onScroll();
})();

/* ── Бургер-меню (мобайл): выезд сверху + морфинг палок в крестик ── */
(function () {
  var burger = document.querySelector('[data-burger]');
  var menu = document.querySelector('[data-menu]');
  if (!burger || !menu) return;

  function setOpen(open) {
    burger.classList.toggle('is-open', open);
    menu.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    menu.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('menu-open', open);
  }

  burger.addEventListener('click', function () {
    setOpen(!menu.classList.contains('is-open'));
  });
  // клик по пункту меню — закрыть
  menu.querySelectorAll('[data-menu-link]').forEach(function (a) {
    a.addEventListener('click', function () { setOpen(false); });
  });
  // Esc и переход на десктоп — закрыть
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });
  window.matchMedia('(max-width: 860px)').addEventListener('change', function (e) {
    if (!e.matches) setOpen(false);
  });
})();

/* ── Маскот в финальном CTA: «просыпается» и поднимает глаза при скролле ── */
(function () {
  var mascot = document.querySelector('[data-cta-mascot]');
  if (!mascot) return;
  var block = document.querySelector('.final');
  var le = mascot.querySelector('[data-eye-l]');
  var re = mascot.querySelector('[data-eye-r]');
  if (!block || !le || !re) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // p=0 — сонные глаза (низко, узкие); p=1 — открыты и подняты
  function setEyes(p) {
    var y = 34 - 11 * p;        // 34 → 23 (поднимаются)
    var h = 4 + 13 * p;         // 4  → 17 (открываются)
    le.setAttribute('y', y); le.setAttribute('height', h);
    re.setAttribute('y', y); re.setAttribute('height', h);
  }

  if (reduce.matches) { setEyes(1); return; }

  var ticking = false;
  function update() {
    ticking = false;
    var r = block.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    // глаза поднимаются, пока блок проходит от низа экрана к ~45% высоты
    var p = (vh - r.top) / (vh - vh * 0.45);
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    setEyes(p);
  }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  setEyes(0);
  update();
})();
