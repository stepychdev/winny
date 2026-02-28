import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { MessageCircle, Send, ChevronDown, ChevronUp, Wifi, WifiOff } from 'lucide-react';
import { useChat, ChatMessage } from '../hooks/useChat';
import { shortenAddress } from '../mocks';
import { useNavigation } from '../contexts/NavigationContext';

const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#22c55e', '#ec4899', '#3b82f6', '#f97316'];

function getWalletColor(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i++) hash = (hash * 31 + address.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function Chat() {
  const { publicKey, connected: walletConnected } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;
  const displayName = walletAddress ? shortenAddress(walletAddress) : 'Anon';
  const color = walletAddress ? getWalletColor(walletAddress) : '#8b5cf6';

  const { messages, sendMessage, connected: chatConnected } = useChat(walletAddress, displayName, color);

  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(true);
  const [unread, setUnread] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const prevMessagesCount = useRef(0);

  // Автоскролл к новым сообщениям (только внутри контейнера чата)
  useEffect(() => {
    if (!isOpen) {
      if (messages.length > prevMessagesCount.current) {
        setUnread((u) => u + (messages.length - prevMessagesCount.current));
      }
    } else {
      setUnread(0);
      const container = chatBodyRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
    prevMessagesCount.current = messages.length;
  }, [messages.length, isOpen]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !walletAddress) return;
    const text = input;
    setInput('');
    await sendMessage(text);
  }, [input, walletAddress, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center justify-between p-4 pb-3 w-full text-left group"
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">Chat</h3>
          {unread > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-primary text-white text-[10px] font-bold rounded-full">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {chatConnected ? (
            <Wifi className="w-3 h-3 text-green-500" />
          ) : (
            <WifiOff className="w-3 h-3 text-red-400" />
          )}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
          ) : (
            <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
          )}
        </div>
      </button>

      {isOpen && (
        <>
          {/* Messages */}
          <div
            ref={chatBodyRef}
            className="flex-1 overflow-y-auto px-4 space-y-2 max-h-[300px] min-h-[200px] hide-scrollbar"
          >
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-500 text-sm py-8">
                No messages yet...
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isOwn={msg.address === walletAddress}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 pt-2 border-t border-slate-100 dark:border-slate-700">
            {walletConnected ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  maxLength={200}
                  className="flex-1 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex-shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-1">
                Connect wallet to chat
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MessageBubble({ msg, isOwn }: { msg: ChatMessage; isOwn: boolean }) {
  const { navigateToPlayer } = useNavigation();
  return (
    <div
      className="animate-[fadeSlideIn_0.2s_ease-out]"
    >
      <div className="flex items-baseline gap-1.5 mb-0.5">
        <button
          onClick={() => navigateToPlayer(msg.address)}
          className="text-xs font-bold truncate max-w-[120px] cursor-pointer hover:underline"
          style={{ color: msg.color }}
        >
          {msg.displayName}
        </button>
        {isOwn && (
          <span className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded-full font-bold leading-none">
            you
          </span>
        )}
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono ml-auto flex-shrink-0">
          {formatTime(msg.timestamp)}
        </span>
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-300 break-words leading-relaxed">
        {msg.text}
      </p>
    </div>
  );
}
