// Unique DOM ids across the whole page. Dialogs render into their own roots on document.body, so
// preact's useId (numbered per root) repeats between them; this counter never does.
import { useRef } from 'preact/hooks';

let seq = 0;

export const nextUid = (prefix = 'em'): string => `${prefix}-${++seq}`;

export function useUid(prefix = 'em'): string {
  const ref = useRef('');
  if (!ref.current) ref.current = nextUid(prefix);
  return ref.current;
}
