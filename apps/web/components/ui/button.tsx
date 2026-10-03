'use client';
import * as React from 'react';
import { Terminal, FileCode } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
const styles = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50 disabled:pointer-events-none h-9 px-4',
  {
    variants: {
      variant: {
        default: 'bg-blue-600 text-white hover:bg-blue-700',
        outline: 'border bg-background hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
export function Button({
  className,
  variant,
  asChild = false,
  hint,
  operation,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof styles> & {
    asChild?: boolean;
    hint?: string;
    operation?: 'command' | 'script';
  }) {
  const Comp = asChild ? Slot.Root : 'button';
  const content = (
    <Comp
      className={twMerge(
        clsx(styles({ variant }), operation && `operation-${operation}`, className),
      )}
      {...props}
    >
      {!asChild && operation && (
        <>
          <span className="operation-kind">
            {operation === 'command' ? (
              <Terminal size={13} aria-hidden="true" />
            ) : (
              <FileCode size={13} aria-hidden="true" />
            )}
            {operation}
          </span>
        </>
      )}
      {children}
    </Comp>
  );
  if (!hint) return content;
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{content}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="help-tooltip" sideOffset={8}>
            {hint}
            <Tooltip.Arrow className="help-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
