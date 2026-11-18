import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({ className, children, placement = 'center', ...props }: ComponentProps<typeof DialogPrimitive.Content> & { placement?: 'center' | 'left' | 'bottom' }) {
  const centered = placement === 'center';
  const position = centered ? 'ui-dialog-center' : placement === 'bottom' ? 'ui-sheet-bottom fixed left-0 bottom-0' : 'fixed left-0 top-0';
  const content = <DialogPrimitive.Content className={cn('ui-dialog z-[1501] w-[calc(100%-32px)] max-w-md rounded-3xl border border-border bg-white p-7 shadow-xl', position, className)} {...props}>{children}<DialogPrimitive.Close className="ui-dialog-close absolute right-5 top-5 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="关闭"><X size={18} /></DialogPrimitive.Close></DialogPrimitive.Content>;
  // Flow layout keeps the whole dialog visible in wallet WebViews that ignore
  // independent translate properties or override transforms during animations.
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className={cn('ui-dialog-overlay fixed inset-0 z-[1500] bg-slate-950/30 backdrop-blur-sm', centered && 'ui-dialog-frame')}>{centered ? content : null}</DialogPrimitive.Overlay>{centered ? null : content}</DialogPrimitive.Portal>;
}
