import * as React from 'react';
import { clsx } from 'clsx';
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={clsx(
        'h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
