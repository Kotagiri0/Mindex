import { useEffect, useState } from 'react';

/**
 * Высота, на которую экранная клавиатура (и autofill-панель над ней) перекрывает
 * нижнюю часть вьюпорта, в px. 0 — клавиатуры нет.
 *
 * Зачем: шторки создания/редактирования задачи прибиты к низу экрана
 * (align-items: flex-end). Когда в Telegram WebView вылезает клавиатура, она
 * перекрывает шторку снизу и ломает вёрстку. visualViewport даёт реальную
 * видимую высоту над клавиатурой — поднимаем шторку ровно на эту величину.
 *
 * Работает в современных iOS/Android WebView. Если API нет — возвращает 0
 * (поведение как раньше, без регресса).
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // Разница между полной высотой окна и видимой частью = высота клавиатуры
      // (+ панель автозаполнения, если она всё же появилась). offsetTop учитывает
      // случаи, когда вьюпорт сдвигается, а не сжимается.
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      // Маленькие колебания (адресная строка и т.п.) игнорируем — порог 80px
      // отделяет реальную клавиатуру от шума.
      setInset(overlap > 80 ? overlap : 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
