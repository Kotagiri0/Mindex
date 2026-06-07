import { useEffect, useRef, useState } from 'react';
import { getSvgPath } from 'figma-squircle';

interface SquircleOptions {
  cornerRadius?: number;
  cornerSmoothing?: number;
}

export function useSquircle({ cornerRadius = 32, cornerSmoothing = 0.6 }: SquircleOptions = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipPath, setClipPath] = useState<string>('');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h) return;
      const path = getSvgPath({
        width: w,
        height: h,
        cornerSmoothing,
        topLeftCornerRadius: cornerRadius,
        topRightCornerRadius: cornerRadius,
        bottomLeftCornerRadius: 0,
        bottomRightCornerRadius: 0,
      });
      setClipPath(`path('${path}')`);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cornerRadius, cornerSmoothing]);

  return { ref, clipPath };
}
