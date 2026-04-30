'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/hooks/use-plexchat';
import { ChatMessageBubble } from './chat-message';
import { TypingIndicator } from './typing-indicator';

interface ChatPanelCharacter {
  canonicalName: string;
  portraitUri: string;
  birthYear: number | null;
  deathYear: number | null;
  genesisTicker: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  isAgentTyping: boolean;
  isConnected: boolean;
  isWalletConnected: boolean;
  /** Character context — when present, the panel is themed for character chat. */
  character?: ChatPanelCharacter;
  /** When true, the input is disabled (e.g. access denied). */
  inputDisabled?: boolean;
  inputDisabledReason?: string;
  onSendMessage: (content: string) => void;
}

/**
 * Time Machine character-chat openers. Generic enough to fit any
 * historical figure — the agent's persona makes them feel personal.
 */
const CHARACTER_OPENERS = [
  'What was your world like?',
  'What did most people misunderstand about you?',
  'Tell me about your greatest work.',
  'What would you make of our century?',
  'Who were your fiercest rivals?',
  'What still keeps you up at night?',
];

export function ChatPanel({
  messages,
  isAgentTyping,
  isConnected,
  isWalletConnected,
  character,
  inputDisabled,
  inputDisabledReason,
  onSendMessage,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const lastSendRef = useRef(0);

  const canSend =
    isConnected && isWalletConnected && !inputDisabled;

  const placeholderText = !isConnected
    ? 'Establishing connection…'
    : !isWalletConnected
      ? 'Connect your wallet to begin…'
      : inputDisabled
        ? inputDisabledReason ?? 'Chat is unavailable.'
        : character
          ? `Speak to ${character.canonicalName}…`
          : 'Type a message…';

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isAgentTyping]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleScroll() {
      if (!el) return;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      setShowScrollBtn(!isNearBottom);
    }
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || !canSend) return;
    onSendMessage(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  function handleSuggestionClick(suggestion: string) {
    if (!canSend) return;
    const now = Date.now();
    if (now - lastSendRef.current < 500) return;
    lastSendRef.current = now;
    onSendMessage(suggestion);
  }

  const showOpeners = messages.length === 0 && !!character;

  return (
    <div className="relative flex h-full min-h-[60vh] flex-1 flex-col overflow-hidden">
      {/* Message list */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-3 px-2 py-6 sm:px-4">
          {messages.length === 0 ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center gap-7 px-4 text-center">
              {character ? (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 -m-2 rounded-full bg-gradient-to-br from-tm-gold-400/40 via-transparent to-transparent blur-2xl" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={character.portraitUri}
                      alt={character.canonicalName}
                      className="relative h-32 w-32 rounded-full object-cover ring-1 ring-tm-gold-400/40"
                    />
                  </div>
                  <div>
                    <h2 className="tm-headline text-2xl font-semibold text-tm-gold-50">
                      {character.canonicalName} is listening.
                    </h2>
                    <p className="mt-1 text-xs uppercase tracking-[0.3em] text-tm-gold-400/80">
                      {character.birthYear ?? '?'} – {character.deathYear ?? '?'}
                    </p>
                    <p className="mt-3 text-sm text-zinc-400">
                      Open with anything — they'll meet you in their own century.
                    </p>
                  </div>
                </>
              ) : (
                <h2 className="tm-headline text-2xl font-semibold text-tm-gold-50">
                  How can I help?
                </h2>
              )}
              {showOpeners && (
                <div className="flex flex-wrap justify-center gap-2">
                  {CHARACTER_OPENERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSuggestionClick(s)}
                      disabled={!canSend}
                      className="rounded-full border border-tm-gold-600/40 bg-tm-ink-800/50 px-3.5 py-1.5 text-xs text-tm-gold-200 transition-colors hover:border-tm-gold-400 hover:bg-tm-gold-200/5 hover:text-tm-gold-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <ChatMessageBubble key={msg.id} message={msg} />
              ))}
              {isAgentTyping && <TypingIndicator />}
            </>
          )}
        </div>
      </div>

      {showScrollBtn && messages.length > 0 && (
        <div className="pointer-events-none absolute bottom-28 left-0 right-0 flex justify-center">
          <button
            onClick={scrollToBottom}
            className="pointer-events-auto rounded-full border border-tm-gold-600/40 bg-tm-ink-900/90 p-2 text-tm-gold-200 shadow-lg backdrop-blur-sm transition-all hover:border-tm-gold-400 hover:text-tm-gold-50"
            title="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="px-2 pb-3 pt-2 sm:px-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-tm-gold-600/30 bg-tm-ink-900/70 p-2 shadow-lg shadow-black/20 transition-colors focus-within:border-tm-gold-400 focus-within:shadow-tm-gold-400/10">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              disabled={!canSend}
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-tm-gold-50 placeholder-zinc-500 outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || !canSend}
              className="tm-button-primary flex-shrink-0 rounded-lg p-2 disabled:opacity-40"
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8H14M9 3L14 8L9 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-600">
            <span>Press Enter to send · Shift+Enter for a new line</span>
          </p>
        </div>
      </div>
    </div>
  );
}
