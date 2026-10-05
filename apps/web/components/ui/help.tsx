import { CircleHelp } from 'lucide-react';
import { Button } from './button';
/** Render keyboard/hover/touch help from caller-provided content.
 * Input: props, from React props and user interaction supplied by the parent.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function Help({ label, children }: { label: string; children: string }) {
  return (
    <Button
      variant="ghost"
      className="h-7 px-1 shrink-0"
      aria-label={'Help: ' + label}
      hint={children}
    >
      <CircleHelp size={16} aria-hidden="true" />
    </Button>
  );
}
