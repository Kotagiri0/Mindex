import { TaskCategory } from '../types';

/**
 * Категории задач существуют ТОЛЬКО в календарном виде.
 * В списке (Dashboard list / TodayMobile) цвета не применяются.
 *
 * Палитра — мягкие пастельные тона из мокапа дашборда, НЕ ядовитые
 * Google-Calendar-цвета. Граница блока чуть темнее фона того же тона.
 * `text` — приглушённый тёмный оттенок того же семейства для заголовка задачи.
 */
export interface CategoryColors {
  /** Заливка блока в таймлайне */
  bg: string;
  /** Граница блока (чуть темнее фона) */
  border: string;
  /** Цвет текста названия задачи внутри блока */
  text: string;
  /** Цвет вторичного текста (время) внутри блока */
  textMuted: string;
}

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  work: 'Работа',
  personal: 'Личное',
  event: 'Мероприятие',
  study: 'Учёба',
  none: 'Без категории',
};

export const CATEGORY_COLORS: Record<TaskCategory, CategoryColors> = {
  // Личное — мягкий зелёный (мокап: «Завтрак и утренние процедуры»)
  personal: {
    bg: '#DDF3E4',
    border: '#C2E6CE',
    text: '#2F6B45',
    textMuted: 'rgba(47,107,69,0.55)',
  },
  // Мероприятие / встреча — мягкий сине-лавандовый (мокап: «Созвон с Партнёром»)
  event: {
    bg: '#DDE3F7',
    border: '#C6D0EE',
    text: '#3A4A86',
    textMuted: 'rgba(58,74,134,0.55)',
  },
  // Учёба — тёплый амбер (мокап: «Сделать уроки и посмотреть вебинар»)
  study: {
    bg: '#FBE7CF',
    border: '#F3D6AE',
    text: '#8A5A22',
    textMuted: 'rgba(138,90,34,0.55)',
  },
  // Работа — спокойный розово-персиковый (отличается от учёбы, не кричит)
  work: {
    bg: '#F4DEDE',
    border: '#E9C6C6',
    text: '#8A3A3A',
    textMuted: 'rgba(138,58,58,0.55)',
  },
  // Без категории — нейтральный серый (задачи без времени / нераспределённые)
  none: {
    bg: '#ECECEC',
    border: '#E0E0E0',
    text: '#4A4A4C',
    textMuted: 'rgba(74,74,76,0.5)',
  },
};

export const ORDERED_CATEGORIES: TaskCategory[] = ['work', 'personal', 'event', 'study', 'none'];

export const categoryColors = (category?: TaskCategory): CategoryColors =>
  CATEGORY_COLORS[category ?? 'none'];
