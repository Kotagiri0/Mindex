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

  /* ── Блок 2: scroll-scrubbed (сетка → день) ─────────────────── */
  var scrub = document.querySelector('[data-scrub]');
  var gNotes = scrub ? Array.prototype.slice.call(scrub.querySelectorAll('.g-note')) : [];
  var gTiles = scrub ? Array.prototype.slice.call(scrub.querySelectorAll('.g-tile')) : [];
  var gIcos = scrub ? Array.prototype.slice.call(scrub.querySelectorAll('.g-ico')) : [];
  var gMascot = scrub && scrub.querySelector('.g-mascot');

  function lerp(a, b, t) { return a + (b - a) * t; }

  function updateScrub() {
    if (!scrub || isMobile.matches) return;
    var rect = scrub.getBoundingClientRect();
    var total = scrub.offsetHeight - window.innerHeight;
    var p = clamp(-rect.top / total, 0, 1);

    var vw = window.innerWidth, vh = window.innerHeight;

    // Маскот «дышит» (CSS), здесь только проявляем
    if (gMascot) gMascot.style.opacity = String(range(p, 0.12, 0.4));

    // Заметки летят из стартового смещения в центр своей плитки (t: 0→1),
    // затем гаснут, передавая место плитке.
    gNotes.forEach(function (n) {
      var t = range(p, 0.06, 0.5);
      var sx = parseFloat(n.getAttribute('data-sx')) || 0;
      var sy = parseFloat(n.getAttribute('data-sy')) || 0;
      var dx = sx / 100 * vw * (1 - t);
      var dy = sy / 100 * vh * (1 - t);
      var s = lerp(0.85, 1, t);
      n.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(' + s + ')';
      n.style.opacity = String(1 - range(p, 0.42, 0.6));
    });

    // Плитки и иконки проявляются по мере «приземления» заметок
    var tileIn = range(p, 0.4, 0.62);
    gTiles.forEach(function (el) {
      el.style.opacity = String(tileIn);
      el.style.transform = 'scale(' + lerp(0.9, 1, tileIn) + ')';
    });
    var icoIn = range(p, 0.5, 0.7);
    gIcos.forEach(function (el) { el.style.opacity = String(icoIn); });
  }

  function initScrubStatic() {
    // мобайл/reduced-motion: финальное состояние — плитки/иконки/маскот видны, заметки скрыты
    if (!scrub) return;
    gNotes.forEach(function (n) { n.style.opacity = '0'; });
    gTiles.forEach(function (el) { el.style.opacity = '1'; el.style.transform = 'none'; });
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
      updateScrub();
      updateRail();
      ticking = false;
    });
  }

  function onResize() {
    measureRail();
    if (isMobile.matches || reduce.matches) initScrubStatic();
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

  // картинки/шрифты могут менять scrollWidth — меряем после загрузки
  window.addEventListener('load', onResize);
  measureRail();
  if (isMobile.matches || reduce.matches) initScrubStatic();
  onScroll();
})();
