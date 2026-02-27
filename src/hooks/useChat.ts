import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../lib/firebase';
import { ref, push, query, limitToLast, onChildAdded, off, onValue } from 'firebase/database';

export interface ChatMessage {
  id: string;
  address: string;
  displayName: string;
  text: string;
  timestamp: number;
  color: string;
}

const MAX_MESSAGES = 100;
const CHAT_REF = 'chat/messages';

export function useChat(walletAddress: string | null, displayName: string, color: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!db) return;

    const chatRef = query(ref(db, CHAT_REF), limitToLast(MAX_MESSAGES));

    initialLoadDone.current = false;

    onValue(chatRef, (snapshot) => {
      if (initialLoadDone.current) return;
      initialLoadDone.current = true;
      const data = snapshot.val();
      if (data) {
        const loaded: ChatMessage[] = [];
        for (const [key, val] of Object.entries(data)) {
          const msg = val as any;
          loaded.push({
            id: key,
            address: msg.address || '',
            displayName: msg.displayName || '',
            text: msg.text || '',
            timestamp: msg.timestamp || 0,
            color: msg.color || '#8b5cf6',
          });
        }
        loaded.sort((a, b) => a.timestamp - b.timestamp);
        setMessages(loaded);
      }
      setConnected(true);
    }, { onlyOnce: true });

    onChildAdded(chatRef, (snapshot) => {
      if (!initialLoadDone.current) return;
      const msg = snapshot.val();
      if (!msg) return;
      const newMsg: ChatMessage = {
        id: snapshot.key!,
        address: msg.address || '',
        displayName: msg.displayName || '',
        text: msg.text || '',
        timestamp: msg.timestamp || Date.now(),
        color: msg.color || '#8b5cf6',
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        const next = [...prev, newMsg];
        return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      });
    });

    return () => {
      off(chatRef);
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!db || !walletAddress || !text.trim()) return;
      const chatRef = ref(db, CHAT_REF);
      await push(chatRef, {
        address: walletAddress,
        displayName,
        text: text.trim().slice(0, 200),
        timestamp: Date.now(),
        color,
      });
    },
    [walletAddress, displayName, color],
  );

  return { messages, sendMessage, connected };
}
