'use client';

import type { ChatStatus } from 'ai';
import type { FC } from 'react';

import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';
import useMeasure from 'react-use-measure';

import type { AIWidgetMessage } from './types';
import { LoadingText } from '../loading-text';
import { AIWidgetAssistantMessage } from './ai-widget-assistant-message';
import { AIWidgetUserMessage } from './ai-widget-user-message';

type AIWidgetMessageListProps = {
  messages: AIWidgetMessage[];
  status: ChatStatus;
};

export const AIWidgetMessageList: FC<AIWidgetMessageListProps> = ({ messages, status }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [chatContentRef, chatContentBounds] = useMeasure();

  const lastMessage = messages.at(-1);
  const lastMessagePartCount = lastMessage?.parts.length ?? 0;
  const hasRenderableMessageParts = useCallback((message: AIWidgetMessage) => {
    return message.parts.some((part) => {
      if (part.type === 'text') {
        return part.text.trim().length > 0;
      }

      if (part.type === 'tool-retrieve-match-detail') {
        return true;
      }

      return part.type === 'reasoning';
    });
  }, []);

  const shouldShowLoader =
    status === 'submitted' || (status === 'streaming' && lastMessage?.role !== 'assistant');

  useEffect(() => {
    const list = listRef.current;

    if (!list) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      list.scrollTo({
        top: list.scrollHeight,
        behavior: 'smooth',
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [chatContentBounds.height, lastMessage?.id, lastMessagePartCount, messages.length, status]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <motion.div
      animate={{ height: chatContentBounds.height }}
      className="overflow-hidden"
      initial={{ height: 0 }}
      transition={{
        type: 'spring',
        duration: 0.34,
        bounce: 0,
      }}
    >
      <div ref={chatContentRef} className="flex flex-col px-1">
        <div className="h-4 shrink-0" />

        <div
          ref={listRef}
          className="flex max-h-[min(37.5rem,45vh)] scrollbar-thin flex-col gap-y-3 overflow-x-hidden overflow-y-auto px-3 text-sm"
        >
          <AnimatePresence initial={false}>
            {messages.map((message) => {
              if (message.role === 'user') {
                return <AIWidgetUserMessage key={message.id} message={message} />;
              }

              if (message.role === 'system') {
                return null;
              }

              return (
                <AIWidgetAssistantMessage
                  key={message.id}
                  message={message}
                  showLoader={!hasRenderableMessageParts(message) && status === 'streaming'}
                />
              );
            })}

            {shouldShowLoader && <LoadingText>Loading</LoadingText>}
          </AnimatePresence>
        </div>

        <div className="h-5 shrink-0" />
      </div>
    </motion.div>
  );
};
