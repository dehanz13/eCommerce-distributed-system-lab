'use client';

import { Dialog } from 'radix-ui';
import { Button } from './ui/button';

/** Explain an unconfirmed checkout using state supplied by Shop, never a guessed order outcome.
 * Inputs: open/busy and parent callbacks from the retained browser submission and checkout response.
 * Communicates with Shop callbacks only; the explicit recover callback sends the original submission to ordering.
 */
export function CheckoutRecoveryDialog({
  open,
  busy,
  onOpenChange,
  onRecover,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onRecover: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="panel fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">
            We couldn’t confirm your checkout
          </Dialog.Title>
          <Dialog.Description className="mt-3 leading-relaxed">
            The connection was interrupted before we received confirmation. Your order may already
            have been accepted. We’ve kept your original submission so you can check its outcome
            safely. Please recover it before placing another order.
          </Dialog.Description>
          <p className="hint mt-3">
            Recovery sends the same saved submission and checkout key. Closing this message keeps it
            saved; reconnecting alone does not submit it again.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Dialog.Close asChild>
              <Button variant="outline">Keep for later</Button>
            </Dialog.Close>
            <Button disabled={busy} onClick={onRecover}>
              {busy ? 'Checking saved checkout…' : 'Recover saved checkout'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
