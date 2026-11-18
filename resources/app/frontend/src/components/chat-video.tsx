import { useState } from 'react';

export function ChatVideo({ id, group, available }: { id: number; group: string; available?: boolean }) {
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const src = `/api/community/message-video/${id}?group=${encodeURIComponent(group)}${attempt ? `&retry=${attempt}` : ''}`;
  const retry = () => { setAttempt(value => value + 1); setFailed(false); };
  if (available === false) return <div className="sx-video-unavailable" role="status">视频已自动清理<br /><small>视频仅保留 24 小时</small></div>;
  if (failed) return <div className="sx-video-unavailable" role="status">视频暂时无法播放<button type="button" onClick={retry}>重新加载视频</button></div>;
  return <video className="sx-message-video" src={src} controls preload="metadata" playsInline onError={() => setFailed(true)} />;
}
