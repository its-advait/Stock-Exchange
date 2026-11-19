import { STOCK_UNIVERSE } from '@aez/shared';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { money } from '@/lib/format';
import { useSecurities } from '@/lib/queries';
import { ChangePill, TickerMark } from './common';
import { Kbd } from './ui/primitives';

/** ⌘K / Ctrl-K security search with autocomplete by ticker or brother name. */
export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const nav = useNavigate();
  const secs = useSecurities();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  const rows = secs.data ?? STOCK_UNIVERSE.map((s) => ({ ticker: s.ticker, name: s.name, displayPriceCents: null, changeFromReferenceBps: null }));

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-panel">
          <DialogPrimitive.Title className="sr-only">Search securities</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search by ticker or brother name</DialogPrimitive.Description>
          <Command
            label="Search securities"
            filter={(value, search) => {
              const s = search.trim().toLowerCase();
              if (!s) return 1;
              const [t, ...n] = value.toLowerCase().split(' ');
              if (t!.startsWith(s)) return 1;
              return n.join(' ').includes(s) ? 0.6 : 0;
            }}
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-fg-subtle" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                autoFocus
                placeholder="Search 45 brothers by ticker or name…"
                className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
              />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[52vh] overflow-y-auto p-1.5 scrollbar-thin">
              <Command.Empty className="px-4 py-8 text-center text-sm text-fg-muted">No brother matches “{q}”.</Command.Empty>
              {rows.map((s) => (
                <Command.Item
                  key={s.ticker}
                  value={`${s.ticker} ${s.name}`}
                  onSelect={() => {
                    onOpenChange(false);
                    nav(`/stocks/${s.ticker}`);
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 data-[selected=true]:bg-surface-3"
                >
                  <TickerMark ticker={s.ticker} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[13px] font-semibold">{s.ticker}</div>
                    <div className="truncate text-xs text-fg-muted">{s.name}</div>
                  </div>
                  <span className="num text-sm text-fg">{money(s.displayPriceCents)}</span>
                  <ChangePill bps={s.changeFromReferenceBps} />
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
