// Doodle Cloud, the app's mascot: a marker-sketch cloud with a thick wobbly outline, dot eyes, a
// line mouth, stick arms and legs. Inline SVG; every pose (face, limbs, props) is a group that CSS
// shows or hides from `data-state` and `data-accessory`, so there is no JS animation. The outline
// is near-black on light skies and ice blue on dark ones (--mascot-line). Decorative only:
// aria-hidden, never focusable, never interactive.
import { useUid } from './uid';

/** idle: little wave; focusing: nose in a book; break: coffee; celebrate: arms up and confetti;
 * wave: hugging a heart (streak, first open of the day); shrug: empty states; thumbs: goal met. */
export type MascotState = 'idle' | 'focusing' | 'break' | 'celebrate' | 'wave' | 'shrug' | 'thumbs';

/** Cloud silhouette shapes for the sky's drifting clouds (the mascot has its own doodled body). */
export function CloudShapes() {
  return (
    <>
      <circle cx="34" cy="52" r="20" />
      <circle cx="58" cy="38" r="26" />
      <circle cx="84" cy="48" r="20" />
      <rect x="14" y="48" width="92" height="30" rx="15" />
    </>
  );
}

const STAR5 = 'M0-6l1.76 3.6 3.97.58-2.87 2.8.68 3.95L0 5.1l-3.54 1.83.68-3.95-2.87-2.8 3.97-.58z';
const CLOUD =
  'M42 118C22 120 14 102 26 90C12 78 24 56 44 62C46 36 82 32 92 56C112 44 140 58 132 82C150 90 146 116 124 118Z';
const HEART_EYE = 'M0 0c-4-8 8-10 6-2c2-8 10-6 6 2c-2 4-6 6-6 8c0-2-4-4-6-8z';
const QMARK = 'M0 0Q0-7 6-7Q12-7 12-1.5Q12 3 6 5.5V9';

const line = 'var(--mascot-line)';
const ink = 'var(--mascot-ink)';

export function Mascot({
  state,
  dark,
  mirror,
  size,
  class: cls,
  testid = 'mascot',
}: {
  state: MascotState;
  /** True while the polarity is dark: headlamp, wide eyes, star companion on breaks. */
  dark: boolean;
  /** Mirrored horizontally so it faces left (used when it sits on the right). */
  mirror?: boolean;
  size: number;
  class?: string;
  testid?: string;
}) {
  // Small copies get a heavier marker so the outline still reads.
  const lw = Math.min(8, Math.max(4.5, 300 / size));
  const beam = `mb-${useUid().replace(/[^a-zA-Z0-9]/g, '')}`;
  const limb = lw * 0.9;
  const fine = lw * 0.7;
  return (
    <svg
      class={`mascot${cls ? ` ${cls}` : ''}${mirror ? ' mascot--mirror' : ''}`}
      viewBox="0 0 160 140"
      width={size}
      height={(size * 140) / 160}
      aria-hidden="true"
      focusable="false"
      data-testid={testid}
      data-state={state}
      data-accessory={dark ? 'headlamp' : 'none'}
    >
      <defs>
        <linearGradient id={beam} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ffd36b" stop-opacity="0.4" />
          <stop offset="1" stop-color="#ffd36b" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g class="m-drift">
        <g class="m-motion">
          {/* legs */}
          <path
            d="M66 118v18M100 118v18"
            fill="none"
            stroke={line}
            stroke-width={limb}
            stroke-linecap="round"
          />

          {/* headlamp beam, behind the body */}
          <g class="m-lamp">
            <path d="M89 50L150 30L150 70Z" fill={`url(#${beam})`} />
          </g>

          {/* body */}
          <path d={CLOUD} fill="var(--mascot-fill)" stroke={line} stroke-width={lw} stroke-linejoin="round" />

          {/* blush */}
          <g class="m-blush" fill="var(--mascot-blush)">
            <ellipse cx="58" cy="92" rx="6" ry="3.5" />
            <ellipse cx="106" cy="92" rx="6" ry="3.5" />
          </g>

          {/* eyes */}
          <g class="m-eyes m-eyes--open m-blink" fill={ink}>
            <circle cx="68" cy="78" r="3.4" />
            <circle cx="96" cy="78" r="3.4" />
          </g>
          <g
            class="m-eyes m-eyes--focus m-blink m-blink--slow"
            fill="none"
            stroke={ink}
            stroke-width="3.4"
            stroke-linecap="round"
          >
            <path d="M62 78h10M92 78h10" />
          </g>
          <g class="m-eyes m-eyes--wide m-blink" fill={ink}>
            <circle cx="68" cy="78" r="4.4" />
            <circle cx="96" cy="78" r="4.4" />
            <circle cx="69.6" cy="76.4" r="1.4" fill="#fff" />
            <circle cx="97.6" cy="76.4" r="1.4" fill="#fff" />
          </g>
          <g class="m-eyes m-eyes--happy" fill="none" stroke={ink} stroke-width="3.4" stroke-linecap="round">
            <path d="M62 80Q68 72 74 80M90 80Q96 72 102 80" />
          </g>
          <g class="m-eyes m-eyes--wave" fill="#e8557a">
            <path d={HEART_EYE} transform="translate(62 80)" />
            <path d={HEART_EYE} transform="translate(90 80)" />
          </g>
          <g class="m-eyes m-eyes--confused" fill={ink}>
            <circle cx="68" cy="80" r="3.4" />
            <circle cx="96" cy="76" r="3.4" />
          </g>

          {/* mouths */}
          <g class="m-mouth m-mouth--idle" fill="none" stroke={ink} stroke-width="3.2" stroke-linecap="round">
            <path d="M72 94Q82 102 94 94" />
          </g>
          <g
            class="m-mouth m-mouth--focus"
            fill="none"
            stroke={ink}
            stroke-width="3.2"
            stroke-linecap="round"
          >
            <path d="M78 96h10" />
          </g>
          <g class="m-mouth m-mouth--wide" fill="none" stroke={ink} stroke-width="3.2" stroke-linecap="round">
            <path d="M76 96Q82 99 88 96" />
          </g>
          <g class="m-mouth m-mouth--open">
            <path d="M70 92Q82 108 94 92Z" fill={ink} stroke={ink} stroke-width="2" stroke-linejoin="round" />
          </g>
          <g class="m-mouth m-mouth--wave" fill="none" stroke={ink} stroke-width="3.2" stroke-linecap="round">
            <path d="M74 96Q82 102 90 96" />
          </g>
          <g
            class="m-mouth m-mouth--confused"
            fill="none"
            stroke={ink}
            stroke-width="3.2"
            stroke-linecap="round"
          >
            <path d="M72 98Q80 92 88 98Q94 102 100 96" />
          </g>

          {/* limbs and props, one set per pose */}
          <g
            class="m-limbs m-limbs--idle"
            fill="none"
            stroke={line}
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M40 104Q24 112 20 126" stroke-width={limb} />
            <g class="m-armwave">
              <path d="M128 100Q142 92 146 76" stroke-width={limb} />
              <path d="M146 76l-5-2M146 76l1-6M146 76l5-1" stroke-width={fine} />
            </g>
          </g>
          <g class="m-limbs m-limbs--alert" fill="none" stroke={line} stroke-linecap="round">
            <path d="M40 104Q24 108 24 124M128 104Q142 110 142 124" stroke-width={limb} />
          </g>
          <g class="m-limbs m-limbs--focus" fill="none" stroke={line} stroke-linecap="round">
            <rect
              x="52"
              y="104"
              width="56"
              height="30"
              rx="4"
              fill="var(--mascot-fill)"
              stroke-width={fine}
            />
            <path d="M80 104v30M58 112h16M58 120h16M86 112h16M86 120h16" stroke-width="2.4" />
            <path d="M40 104Q40 118 52 118M128 104Q128 118 112 118" stroke-width={limb} />
          </g>
          <g class="m-limbs m-limbs--break" fill="none" stroke={line} stroke-linecap="round">
            <path d="M40 104Q26 116 32 130M128 104Q134 118 122 124" stroke-width={limb} />
            <path d="M108 118h22v16q0 8-8 8h-6q-8 0-8-8z" fill="#fff" stroke-width={fine} />
            <path d="M130 124q10 0 10 6q0 6-10 6" stroke-width={fine} />
            <path d="M114 108q2-6 0-10M121 110q2-6 0-10" stroke="#9aa6b2" stroke-width="2.5" />
          </g>
          <g class="m-limbs m-limbs--celebrate" fill="none" stroke={line} stroke-linecap="round">
            <path d="M38 100Q18 84 22 58M130 100Q150 84 146 58" stroke-width={limb} />
            <path
              d="M22 58l-5 2M22 58l-1-6M22 58l5-2M146 58l5 2M146 58l1-6M146 58l-5-2"
              stroke-width={fine}
            />
          </g>
          <g class="m-limbs m-limbs--love" fill="none" stroke={line} stroke-linecap="round">
            <path d="M40 104Q28 118 46 124M128 104Q140 118 122 124" stroke-width={limb} />
            <path
              d="M84 134c-8-14 14-18 10-4c4-14 24-8 12 6c-6 8-14 10-22 16c-6-6-14-10-16-18z"
              fill="#e8557a"
              stroke-width={fine}
              stroke-linejoin="round"
              transform="translate(-6 -14) scale(.9)"
            />
          </g>
          <g class="m-limbs m-limbs--shrug" fill="none" stroke={line} stroke-linecap="round">
            <path d="M38 100Q18 96 16 78M130 100Q150 96 152 78" stroke-width={limb} />
            <g stroke="var(--em-ink)" stroke-width="3" fill="none">
              <path d={QMARK} transform="translate(104 24)" />
              <circle cx="110" cy="38" r="1.6" fill="var(--em-ink)" stroke="none" />
              <path d={QMARK} transform="translate(122 18) rotate(8)" />
              <circle cx="128.5" cy="32" r="1.6" fill="var(--em-ink)" stroke="none" />
              <path d={QMARK} transform="translate(140 26) rotate(-6)" />
              <circle cx="146" cy="40" r="1.6" fill="var(--em-ink)" stroke="none" />
            </g>
          </g>
          <g
            class="m-limbs m-limbs--thumbs"
            fill="none"
            stroke={line}
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M40 104Q24 112 22 128M128 104Q146 96 146 74" stroke-width={limb} />
            <path d="M141 74q2-14 6-4q1-6 5 1" fill="var(--mascot-fill)" stroke-width={fine} />
          </g>

          {/* night alert: headlamp */}
          <g class="m-lamp">
            <path
              d="M62 54q20-10 40 0"
              fill="none"
              stroke={line}
              stroke-width={limb}
              stroke-linecap="round"
            />
            <circle
              class="m-lamp__bulb"
              cx="82"
              cy="50"
              r="7"
              fill="#ffd36b"
              stroke={line}
              stroke-width="3"
            />
          </g>
        </g>
      </g>

      {/* star companion (night, break and celebrate) */}
      <g class="m-orbit">
        <g class="m-orbit__spin">
          <path
            d={STAR5}
            transform="translate(148 24) scale(1.5)"
            fill="#ffd36b"
            stroke="#e0b840"
            stroke-width="0.6"
          />
        </g>
      </g>

      {/* confetti strokes (celebrate) */}
      <g class="m-sparkles" fill="none" stroke-width="3.5" stroke-linecap="round">
        <path class="m-sp m-sp--1" d="M30 30l4 8" stroke="#f7a8b8" />
        <path class="m-sp m-sp--2" d="M60 22l-3 8" stroke="#8ec5f0" />
        <path class="m-sp m-sp--3" d="M100 18l2 9" stroke="#ffd36b" />
        <path class="m-sp m-sp--1" d="M130 28l-4 7" stroke="#b9f0e3" />
        <path class="m-sp m-sp--2" d="M14 56l6 5" stroke="#ffd36b" />
        <path class="m-sp m-sp--3" d="M146 40l6-4" stroke="#f7a8b8" />
        <path class="m-sp m-sp--1" d="M80 12l5 4" stroke="#b39ddb" />
      </g>
    </svg>
  );
}
