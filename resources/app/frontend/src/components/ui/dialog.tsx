import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({ className, children, placement = 'center', ...props }: ComponentProps<typeof DialogPrimitive.Content> & { placement?: 'center' | 'left' | 'bottom' }) {
  const position = placement === 'center' ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2' : placement === 'bottom' ? 'ui-sheet-bottom left-0 bottom-0' : 'left-0 top-0';
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="ui-dialog-overlay fixed inset-0 z-[1500] bg-slate-950/30 backdrop-blur-sm" /><DialogPrimitive.Content className={cn('ui-dialog fixed z-[1501] w-[calc(100%-32px)] max-w-md rounded-3xl border border-border bg-white p-7 shadow-xl', position, className)} {...props}>{children}<DialogPrimitive.Close className="ui-dialog-close absolute right-5 top-5 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="关闭"><X size={18} /></DialogPrimitive.Close></DialogPrimitive.Content></DialogPrimitive.Portal>;
}
