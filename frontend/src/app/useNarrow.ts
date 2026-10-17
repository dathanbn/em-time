import { useEffect, useState } from 'preact/hooks';

/** True below the 900px desktop breakpoint. */
export function useNarrow(): boolean {
  const q = '(max-width: 899px)';
  const [n, setN] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setN(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return n;
}
