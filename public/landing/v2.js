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
    if (gMascot) gMascot.style.opacity = String(easeInOut(range(p, 0.44, 0.6)));

    /* ── Part 2: плитки → день. Строго последовательно, без перелётов:
       сначала плитки чисто уходят, затем день собирается НА МЕСТЕ.
       На любом шаге колеса — цельный кадр, ничего не наслаивается. */
    // 1) Плитки/иконки/маскот уходят целиком (часть «в следующие дни»)
    if (aGrid) aGrid.style.opacity = String(1 - easeInOut(range(p, 0.62, 0.72)));
    // 2) Память проявляется сверху
    if (sMemory) sMemory.style.opacity = String(easeInOut(range(p, 0.72, 0.82)));
    // 3) Таймлайн въезжает снизу
    if (sTimeline) {
      var tl = easeInOut(range(p, 0.73, 0.84));
      sTimeline.style.opacity = String(tl);
      sTimeline.style.transform = 'translateY(' + lerp(16, 0, tl) + 'px)';
    }
    // 4) События проявляются на своих местах (лёгкий подъём + укрупнение), каскадом
    sEvents.forEach(function (e, i) {
      var w0 = 0.74 + i * 0.035;
      var te = easeInOut(range(p, w0, w0 + 0.12));
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

  function setWord(p) {
    if (!words.length) return;
    var idx = clamp(Math.round(p * (words.length - 1)), 0, words.length - 1);
    if (words[idx] !== curWord) {
      curWord = words[idx];
      wordEl.style.opacity = '0';
      wordEl.style.transform = 'translateY(-6px)';
      setTimeout(function () {
        wordEl.textContent = curWord;
        wordEl.style.opacity = '1';
        wordEl.style.transform = 'none';
      }, 150);
    }
  }

  function updateRail() {
    if (!rail || isMobile.matches) return;
    var rect = rail.getBoundingClientRect();
    var total = rail.offsetHeight - window.innerHeight;
    var p = clamp(-rect.top / total, 0, 1);
    track.style.transform = 'translateX(' + (-p * maxShift) + 'px)';
    setWord(p);
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

  /* ── Init ───────────────────────────────────────────────────── */
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  var prevBtn = rail && rail.querySelector('[data-rail-prev]');
  var nextBtn = rail && rail.querySelector('[data-rail-next]');
  if (prevBtn) prevBtn.addEventListener('click', function () { railScrollTo(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { railScrollTo(1); });

  if (wordEl && words.length) { wordEl.textContent = words[0]; curWord = words[0]; }

  // картинки/шрифты могут менять размеры — меряем после загрузки
  window.addEventListener('load', onResize);
  measureRail();
  if (isMobile.matches || reduce.matches) { initActStatic(); }
  else { measureAct(); }
  onScroll();
})();
