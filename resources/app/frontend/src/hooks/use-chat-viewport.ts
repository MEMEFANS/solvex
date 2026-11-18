import { useLayoutEffect, useRef } from 'react';

// Match the chat CSS, including phones rotated into landscape.
const mobileChat = '(max-width: 900px), (max-width: 1100px) and (pointer: coarse) and (max-height: 600px)';

export function useChatViewport(open: boolean) {
  const pageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!open || !page) return;
    const media = window.matchMedia(mobileChat);
    const viewport = window.visualViewport;
    const topbar = document.querySelector<HTMLElement>('.rx-topbar');
    let frame = 0;
    const clear = () => {
      document.documentElement.classList.remove('sx-chat-viewport-locked');
      page.style.removeProperty('--chat-viewport-top');
      page.style.removeProperty('--chat-viewport-height');
      delete page.dataset.chatCompact;
    };
    const update = () => {
      frame = 0;
      if (!media.matches) { clear(); return; }
      // iOS moves the visual viewport when the keyboard opens; Android can
      // resize the layout viewport instead. Use the visible rectangle for both.
      const offset = viewport?.offsetTop || 0;
      const height = viewport?.height || window.innerHeight;
      const top = Math.max(offset, topbar?.getBoundingClientRect().bottom || 0);
      const available = Math.max(0, offset + height - top);
      page.style.setProperty('--chat-viewport-top', `${top}px`);
      page.style.setProperty('--chat-viewport-height', `${available}px`);
      page.dataset.chatCompact = String(available < 300);
      document.documentElement.classList.add('sx-chat-viewport-locked');
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    media.addEventListener('change', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('pageshow', schedule);
    const observer = new ResizeObserver(schedule);
    if (topbar) observer.observe(topbar);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener('change', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('pageshow', schedule);
      observer.disconnect();
      clear();
    };
  }, [open]);

  return pageRef;
}
