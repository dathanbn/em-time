import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Measures an element's content width with a ResizeObserver. */
export function useSize<T extends HTMLElement = HTMLDivElement>(): [{ current: T | null }, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const nw = Math.round(entries[0]!.contentRect.width);
      setW((prev) => (prev === nw ? prev : nw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
