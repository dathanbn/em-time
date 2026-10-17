import { useEffect, useState } from 'preact/hooks';
import { reducedMotion } from '../platform/env';

const COLORS = ['var(--em-heat-1)', 'var(--em-heat-2)', 'var(--em-heat-3)', 'var(--em-accent)'];
const COUNT = 36;

/** Quiet milestone confetti: 36 particles, 1.2 s, then removed from the DOM. */
export function Confetti({ trigger }: { trigger: number }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!trigger || reducedMotion()) return;
    setActive(trigger);
    const t = setTimeout(() => setActive(0), 1400);
    return () => clearTimeout(t);
  }, [trigger]);
  if (!active) return null;
  return (
    <div class="confetti" aria-hidden="true" key={active}>
      {Array.from({ length: COUNT }, (_, i) => {
        const size = 4 + (i % 4);
        const spread = ((i * 53) % 100) - 50;
        return (
          <span
            key={i}
            class="confetti__p"
            style={{
              left: `${50 + spread * 0.9}%`,
              width: `${size}px`,
              height: `${size}px`,
              background: COLORS[i % COLORS.length],
              animationDelay: `${(i % 6) * 40}ms`,
              '--dx': `${((i * 37) % 80) - 40}px`,
              '--dy': `${160 + ((i * 29) % 120)}px`,
            }}
          />
        );
      })}
    </div>
  );
}
