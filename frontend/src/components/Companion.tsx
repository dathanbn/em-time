// The mascot in its reserved slot. Renders nothing when "Cloud friend" is off, so the slot
// collapses and the layout has no gap.
import { currentMascotState } from '../app/mascotState';
import { data } from '../app/coreBridge';
import { skyPolarity } from '../app/skySignals';
import { Mascot } from './Mascot';

export function Companion({
  size,
  mirror,
  idleOnly,
  class: cls,
  testid,
}: {
  size: number;
  mirror?: boolean;
  idleOnly?: boolean;
  class?: string;
  testid?: string;
}) {
  if (!data.value.settings.mascot) return null;
  return (
    <Mascot
      state={currentMascotState(idleOnly)}
      dark={skyPolarity.value === 'dark'}
      mirror={mirror}
      size={size}
      class={cls}
      testid={testid}
    />
  );
}
