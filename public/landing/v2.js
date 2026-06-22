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

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // Замер дельты «заметка → её плитка». Обе внутри одного sticky —
  // двигаются вместе, поэтому дельта постоянна и меряется единожды.
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
    applyNotes(notesCur);   // вернуть transform после замера (он сбрасывался в none)
  }

  /* ── Полёт заметок: развязан со скроллом ─────────────────────────
     Скролл лишь триггерит цель (0 = дома, 1 = на плитках). Сам полёт
     проигрывается по таймеру с ease-in-out, поэтому он быстрый, ровный
     и его нельзя «заморозить» на середине, остановив колесо. */
  var NOTES_TRIG = 0.18;   // порог прогресса ≈ один «шаг» колеса
  var NOTES_DUR = 700;     // длительность полёта, мс
  var notesCur = 0;        // текущее сглаженное значение 0..1
  var notesTarget = 0;     // куда летим: 0 или 1
  var notesFrom = 0, notesTo = 0, notesStart = 0, notesRAF = 0;

  function applyNotes(v) {
    gNotes.forEach(function (n) {
      var dx = (n._dx || 0) * v;
      var dy = (n._dy || 0) * v;
      var s = lerp(1, 0.86, v);
      n.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ')';
    });
  }

  function tickNotes() {
    var t = clamp((performance.now() - notesStart) / NOTES_DUR, 0, 1);
    notesCur = lerp(notesFrom, notesTo, easeInOut(t));
    applyNotes(notesCur);
    if (t < 1) { notesRAF = requestAnimationFrame(tickNotes); }
    else { notesRAF = 0; }
  }

  function setNotesTarget(target) {
    if (target === notesTarget) return;
    notesTarget = target;
    notesFrom = notesCur;          // стартуем с текущей позиции → плавный реверс
    notesTo = target;
    notesStart = performance.now();
    if (!notesRAF) notesRAF = requestAnimationFrame(tickNotes);
  }

  function updateAct() {
    if (!act || isMobile.matches) return;
    var rect = act.getBoundingClientRect();
    var total = act.offsetHeight - window.innerHeight;
    var p = clamp(-rect.top / total, 0, 1);

    // Тексты: hero гаснет, решения проявляются
    if (aHero) aHero.style.opacity = String(1 - range(p, 0.10, 0.28));
    if (aSol) aSol.style.opacity = String(range(p, 0.34, 0.52));

    // Заметки: скролл лишь триггерит цель; полёт сам доигрывает по таймеру.
    setNotesTarget(p >= NOTES_TRIG ? 1 : 0);
    // Гаснут при передаче эстафеты плиткам (это можно оставить на скролле)
    var nFade = String(1 - range(p, 0.5, 0.6));
    gNotes.forEach(function (n) { n.style.opacity = nFade; });

    // Плитки, иконки, маскот проявляются по мере приземления заметок
    var tileIn = range(p, 0.46, 0.62);
    gTiles.forEach(function (el) { el.style.opacity = String(tileIn); });
    var icoIn = range(p, 0.54, 0.7);
    gIcos.forEach(function (el) { el.style.opacity = String(icoIn); });
    if (gMascot) gMascot.style.opacity = String(range(p, 0.44, 0.6));
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
