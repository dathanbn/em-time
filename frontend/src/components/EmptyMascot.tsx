// The small decorative mascot beside empty-state captions (design.md 9): the confused shrug, "no
// tasks yet?". It never wears the headlamp, so it stays a calm doodle at night too.
import { data } from '../app/coreBridge';
import { Mascot } from './Mascot';

export function EmptyMascot({ size }: { size: number }) {
  if (!data.value.settings.mascot) return null;
  return <Mascot state="shrug" dark={false} size={size} class="mascot--still" testid="mascot-empty" />;
}
