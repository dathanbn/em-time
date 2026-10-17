// The sky scene (design.md 2): gradient, stars, sun, moon, three clouds, two hills and the sticker
// layer. Fixed, behind everything, aria-hidden. All motion is CSS; the sky custom properties on
// <html> (written by platform/sky.ts once a minute) drive every color and position.
import { clockTick } from '../app/coreBridge';
import { useNarrow } from '../app/useNarrow';
import { moonPhase } from '../platform/sky';
import { mulberry32 } from '../platform/stickers';
import { CloudShapes } from './Mascot';

interface Star {
  x: number;
  y: number;
  r: number;
  sparkle: boolean;
  dur: number;
  delay: number;
}

/** 28 stars from seeded PRNG (mulberry32, seed 7): x 2% to 98%, y 3% to 60%. */
const STARS: Star[] = (() => {
  const r = mulberry32(7);
  return Array.from({ length: 28 }, () => ({
    x: 2 + r() * 96,
    y: 3 + r() * 57,
    r: 1 + r() * 0.8,
    sparkle: r() < 0.25,
    dur: 3 + r() * 2,
    delay: -r() * 5,
  }));
})();

const SPARK = 'M0-3.4Q.5-.5 3.4 0Q.5.5 0 3.4Q-.5.5-3.4 0Q-.5-.5 0-3.4z';

function Moon({ illumination, waxing }: { illumination: number; waxing: boolean }) {
  // Terminator ellipse: the lit part is a half disc plus or minus a half ellipse.
  const k = 1 - 2 * illumination; // 1 new .. -1 full
  const rx = Math.abs(k) * 30;
  const outer = waxing ? 1 : 0;
  const term = waxing ? (k > 0 ? 0 : 1) : k > 0 ? 1 : 0;
  const lit = `M32 2A30 30 0 0 ${outer} 32 62A${rx.toFixed(2)} 30 0 0 ${term} 32 2Z`;
  return (
    <svg viewBox="0 0 64 64" class="moon__svg" focusable="false">
      <circle cx="32" cy="32" r="30" fill="#CFD8F0" />
      <path d={lit} fill="#FFFBE8" />
      <circle cx="22" cy="24" r="4.4" fill="#E6E2F2" opacity="0.8" />
      <circle cx="40" cy="42" r="3.2" fill="#E6E2F2" opacity="0.8" />
    </svg>
  );
}

const CLOUDS = [
  { w: 140, wn: 96, top: 14, dur: 160, delay: -40, o: 1, rx: '14vw' },
  { w: 104, wn: 72, top: 26, dur: 210, delay: -120, o: 0.8, rx: '52vw' },
  { w: 80, wn: 56, top: 38, dur: 250, delay: -200, o: 0.6, rx: '78vw' },
];

const RAYS = Array.from({ length: 8 }, (_, i) => i * 45);

export function Scene() {
  void clockTick.value; // the lunar phase changes once a day; re-read it with the clock
  const narrow = useNarrow();
  const moon = moonPhase(new Date());
  const stars = narrow ? STARS.slice(0, 16) : STARS;
  return (
    <div class="scene" data-testid="sky" aria-hidden="true">
      <svg class="scene__stars" data-testid="sky-stars" focusable="false">
        <g>
          {stars.map((s, i) =>
            s.sparkle ? (
              <svg key={i} x={`${s.x}%`} y={`${s.y}%`} width="0" height="0" overflow="visible">
                <path
                  class="star"
                  d={SPARK}
                  transform="scale(1.7)"
                  fill="#fff"
                  style={{ animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }}
                />
              </svg>
            ) : (
              <circle
                key={i}
                class="star"
                cx={`${s.x}%`}
                cy={`${s.y}%`}
                r={s.r}
                fill="#fff"
                style={{ animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }}
              />
            ),
          )}
        </g>
      </svg>

      <div class="sun" data-testid="sky-sun">
        <div class="sun__glow" />
        <svg class="sun__rays" viewBox="-50 -50 100 100" focusable="false">
          {RAYS.map((a) => (
            <rect key={a} x="-1.5" y="-49" width="3" height="9" rx="1.5" transform={`rotate(${a})`} />
          ))}
        </svg>
        <div class="sun__body" />
      </div>

      <div class="moon" data-testid="sky-moon">
        <div class="moon__glow" />
        <Moon illumination={moon.illumination} waxing={moon.waxing} />
      </div>

      {CLOUDS.map((c, i) => (
        <div
          key={i}
          class="cloud"
          data-testid="sky-cloud"
          style={{
            '--cw': `${c.w}px`,
            '--cwn': `${c.wn}px`,
            top: `${c.top}%`,
            animationDuration: `${c.dur}s`,
            animationDelay: `${c.delay}s`,
            '--cm': c.o,
            '--rx': c.rx,
          }}
        >
          <svg viewBox="8 8 104 76" focusable="false">
            <g fill="var(--sky-cloud-fill)">
              <CloudShapes />
            </g>
          </svg>
        </div>
      ))}

      <div class="stickerlayer" data-testid="sticker-layer" />

      <svg
        class="hills"
        data-testid="sky-hills"
        viewBox="0 0 1440 200"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path
          fill="var(--sky-hill-back)"
          d="M0 62C120 18 260 12 380 44C500 76 600 70 720 38C840 6 960 8 1080 40C1200 72 1320 66 1440 30V200H0Z"
        />
        <path
          fill="var(--sky-hill-front)"
          d="M0 142C200 132 420 124 640 112C860 100 1060 72 1240 78C1330 81 1390 92 1440 104V200H0Z"
        />
      </svg>
    </div>
  );
}
