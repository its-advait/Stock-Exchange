import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive, DropdownMenu as MenuPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlay = 'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_150ms_ease-out]';
const content =
  'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-24px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-panel focus:outline-none';

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: ReactNode; description?: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <DialogPrimitive.Content className={cn(content, className)} {...props}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-fg-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">Dialog</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Confirmation dialog for irreversible or consequential actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  busy,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'sell' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className={overlay} />
        <AlertPrimitive.Content className={content}>
          <AlertPrimitive.Title className="text-base font-semibold tracking-tight">{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description className={cn('mt-1 text-sm text-fg-muted', !description && 'sr-only')}>
            {description ?? 'Confirm action'}
          </AlertPrimitive.Description>
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <AlertPrimitive.Cancel asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </AlertPrimitive.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : tone}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {busy ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}

/* ------------------------------ Dropdown menu ------------------------------ */
export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export function MenuContent({ className, ...props }: ComponentPropsWithoutRef<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        sideOffset={6}
        align="end"
        className={cn('z-50 min-w-48 rounded-xl border border-border bg-surface-2 p-1 shadow-panel', className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}
export function MenuItem({ className, ...props }: ComponentPropsWithoutRef<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg-muted outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
export const MenuSeparator = () => <MenuPrimitive.Separator className="my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <MenuPrimitive.Label className="px-2.5 py-1.5 text-xs text-fg-subtle">{children}</MenuPrimitive.Label>
);
