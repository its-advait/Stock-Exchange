import { cva, type VariantProps } from 'class-variance-authority';
import { Label as LabelPrimitive, Separator as SeparatorPrimitive, Tabs as TabsPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ---------------------------------- Input --------------------------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded-lg border border-border bg-bg-subtle px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors',
      'hover:border-border-strong focus:border-up/60 focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50',
      'aria-[invalid=true]:border-down/60 aria-[invalid=true]:focus:ring-down/30',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-24 w-full rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm text-fg placeholder:text-fg-subtle',
      'hover:border-border-strong focus:border-up/60 focus:outline-none focus:ring-2 focus:ring-ring/40',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const NativeSelect = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-10 w-full rounded-lg border border-border bg-bg-subtle px-3 text-sm text-fg hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/40',
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = 'NativeSelect';

export function Label({ className, ...props }: ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-xs font-medium text-fg-muted', className)} {...props} />;
}

/* ---------------------------------- Badge --------------------------------- */
export const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-surface-3 text-fg-muted',
      up: 'bg-up-soft text-up',
      down: 'bg-down-soft text-down',
      warn: 'bg-warn-soft text-warn',
      info: 'bg-info-soft text-info',
      outline: 'border border-border text-fg-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* -------------------------------- Skeleton -------------------------------- */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden rounded-md bg-surface-3/70',
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/[0.04] after:to-transparent',
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className, ...props }: ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return <SeparatorPrimitive.Root className={cn('shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:w-px', className)} {...props} />;
}

/* ---------------------------------- Tabs ---------------------------------- */
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex items-center gap-1 rounded-lg bg-surface-2 p-1', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg',
        'data-[state=active]:bg-surface-3 data-[state=active]:text-fg data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/** Underline-style tabs for page sections. */
export function LineTabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex items-center gap-5 border-b border-border overflow-x-auto scrollbar-thin', className)} {...props} />;
}
export function LineTabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px whitespace-nowrap border-b-2 border-transparent pb-2.5 pt-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg',
        'data-[state=active]:border-up data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------- Tooltip -------------------------------- */
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-xs text-fg shadow-panel"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ---------------------------------- Panel --------------------------------- */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn('panel', className)} {...props} />;
}
export function PanelHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5', className)}>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1.5 py-px font-mono text-[10px] text-fg-subtle">{children}</kbd>;
}
