import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export function ChatImage({ id, group, available }: { id: number; group: string; available?: boolean }) {
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0), [open, setOpen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const src = `/api/community/message-image/${id}?group=${encodeURIComponent(group)}${attempt ? `&retry=${attempt}` : ''}`;
  const retry = () => { setAttempt(n => n + 1); setFailed(false); setPreviewFailed(false); };
  if (available === false) return <div className="sx-image-unavailable" role="status">原图片未保存<br /><small>请发送者重新发送</small></div>;
  return <>
    {failed ? <div className="sx-image-unavailable" role="status">图片暂时无法显示<button type="button" onClick={retry}>重新加载图片</button></div>
      : <button className="sx-image-open" type="button" aria-label="查看图片" onClick={() => { setPreviewFailed(false); setOpen(true); }}>
        <img key={src} className="sx-message-image" src={src} alt="图片消息" loading="lazy" onError={() => setFailed(true)} />
      </button>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sx-chat-image-preview">
      <DialogTitle>图片预览</DialogTitle><DialogDescription className="sr-only">查看当前群聊中的图片</DialogDescription>
      {previewFailed ? <div className="sx-image-unavailable" role="status">图片暂时无法显示<button type="button" onClick={retry}>重新加载图片</button></div>
        : <img key={src} src={src} alt="群聊图片预览" onError={() => setPreviewFailed(true)} />}
    </DialogContent></Dialog>
  </>;
}
