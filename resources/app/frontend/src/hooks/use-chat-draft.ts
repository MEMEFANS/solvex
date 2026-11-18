import { useSyncExternalStore } from 'react';
import { readChatDraft, subscribeChatLocal, writeChatDraft } from '@/lib/chat-local';

export function useChatDraft(key: string) {
  const draft = useSyncExternalStore(subscribeChatLocal, () => readChatDraft(key));
  return [draft, (value: string) => writeChatDraft(key, value)] as const;
}
