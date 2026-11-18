import { useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export interface ChatWindowControl { scrollToBottom: () => void; preserveBeforePrepend: () => void }
interface Message { id: number; kind?: string; body?: string }
export function ChatMessageWindow({ messages, scrollRef, controlRef, header, renderMessage }: {
  messages: Message[];
  scrollRef: RefObject<HTMLDivElement | null>;
  controlRef: RefObject<ChatWindowControl | null>;
  header: ReactNode;
  renderMessage: (index: number) => ReactNode;
}) {
  const enabled = messages.length > 120;
  const [padding, setPadding] = useState(0);
  const previousEnabled = useRef(enabled);
  const anchor = useRef<{ id: number; offset: number; bottom: boolean } | null>(null);
  const prependAnchor = useRef<{ id: number; offset: number } | null>(null);
  const virtualizer = useVirtualizer({
    count: messages.length + 1,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => index ? messages[index - 1].id : 'history',
    estimateSize: index => !index ? header ? 40 : 0 : messages[index - 1].kind === 'image' || messages[index - 1].kind === 'video' ? 280 : messages[index - 1].kind === 'red_packet' ? 190 : 75,
    overscan: 10,
    scrollMargin: padding,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 90,
    initialOffset: () => scrollRef.current?.scrollTop || 0,
    enabled,
  });
  useImperativeHandle(controlRef, () => ({ scrollToBottom() {
    if (enabled) virtualizer.scrollToEnd();
    else if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, preserveBeforePrepend() {
    const box = scrollRef.current;
    if (!box) return;
    const top = box.getBoundingClientRect().top;
    const first = [...box.querySelectorAll<HTMLElement>('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > top);
    if (first) prependAnchor.current = { id: Number(first.dataset.messageId), offset: first.getBoundingClientRect().top - top };
  } }), [enabled, virtualizer, scrollRef]);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const resize = () => setPadding(Number.parseFloat(getComputedStyle(box).paddingTop) || 0);
    resize();
    const observer = new ResizeObserver(resize); observer.observe(box);
    return () => observer.disconnect();
  }, [scrollRef]);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box || enabled) return;
    const capture = () => {
      const top = box.getBoundingClientRect().top;
      const first = [...box.querySelectorAll<HTMLElement>('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > top);
      if (first) anchor.current = { id: Number(first.dataset.messageId), offset: first.getBoundingClientRect().top - top, bottom: box.scrollHeight - box.scrollTop - box.clientHeight < 90 };
    };
    capture(); box.addEventListener('scroll', capture, { passive: true });
    return () => box.removeEventListener('scroll', capture);
  }, [enabled, messages, scrollRef]);
  useLayoutEffect(() => {
    if (enabled && !previousEnabled.current && anchor.current && !prependAnchor.current) {
      const saved = anchor.current;
      if (saved.bottom) virtualizer.scrollToEnd();
      else {
        const index = messages.findIndex(message => message.id === saved.id);
        const offset = index >= 0 ? virtualizer.getOffsetForIndex(index + 1, 'start')?.[0] : undefined;
        if (offset !== undefined) virtualizer.scrollToOffset(Math.max(0, offset - saved.offset));
      }
    }
    previousEnabled.current = enabled;
  }, [enabled, messages, virtualizer]);
  useLayoutEffect(() => {
    const saved = prependAnchor.current, box = scrollRef.current;
    if (!saved || !box) return;
    prependAnchor.current = null;
    const index = messages.findIndex(message => message.id === saved.id);
    if (enabled && index >= 0) {
      const offset = virtualizer.getOffsetForIndex(index + 1, 'start')?.[0];
      if (offset !== undefined) virtualizer.scrollToOffset(Math.max(0, offset - saved.offset));
    }
    let frame = 0;
    const correct = () => {
      const row = box.querySelector<HTMLElement>(`[data-message-id="${saved.id}"]`);
      if (!row) return;
      const delta = row.getBoundingClientRect().top - box.getBoundingClientRect().top - saved.offset;
      if (Math.abs(delta) > 1) {
        if (enabled) virtualizer.scrollToOffset(box.scrollTop + delta);
        else box.scrollTop += delta;
      }
    };
    correct(); frame = requestAnimationFrame(correct);
    return () => cancelAnimationFrame(frame);
  }, [messages, enabled, scrollRef, virtualizer]);
  const row = (index: number) => index ? renderMessage(index - 1) : header;
  const className = (index: number) => index ? 'sx-chat-message-item' : 'sx-chat-history-control';
  return <div className="sx-chat-message-window" data-message-count={messages.length} data-virtualized={enabled || undefined} style={enabled ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined}>
    {enabled ? virtualizer.getVirtualItems().map(item => <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} data-message-id={item.index ? messages[item.index - 1].id : undefined} className={className(item.index)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - padding}px)` }}>{row(item.index)}</div>)
      : <><div className="sx-chat-history-control">{header}</div>{messages.map((message, index) => <div key={message.id} className="sx-chat-message-item" data-message-id={message.id}>{row(index + 1)}</div>)}</>}
  </div>;
}
