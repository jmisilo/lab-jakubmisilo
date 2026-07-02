'use client';

import type { ChatStatus } from 'ai';
import type { FC, PointerEvent as ReactPointerEvent, RefObject } from 'react';

import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import useMeasure from 'react-use-measure';

import type { AIWidgetMessage } from './types';
import { LoadingText } from '../loading-text';
import { AIWidgetAssistantMessage } from './ai-widget-assistant-message';
import { AIWidgetUserMessage } from './ai-widget-user-message';

type AIWidgetMessageListProps = {
  messages: AIWidgetMessage[];
  status: ChatStatus;
};

const RESIZE_HANDLE_MIN_HEIGHT = 160;
const RESIZE_HANDLE_MAX_HEIGHT = 720;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

const MESSAGE_LIST_TRANSITION = {
  duration: 0.28,
  ease: EASE_IN_OUT,
};

type AIWidgetResizeHandleProps = {
  listRef: RefObject<HTMLDivElement | null>;
  onDraggingChange: (isDragging: boolean) => void;
  onHeightChange: (height: number) => void;
};

const clampMessageListHeight = (height: number) => {
  const viewportMax =
    typeof window === 'undefined' ? RESIZE_HANDLE_MAX_HEIGHT : window.innerHeight * 0.45;
  const maxHeight = Math.min(RESIZE_HANDLE_MAX_HEIGHT, viewportMax);
  const minHeight = Math.min(RESIZE_HANDLE_MIN_HEIGHT, maxHeight);

  return Math.min(Math.max(height, minHeight), maxHeight);
};

const AIWidgetResizeHandle: FC<AIWidgetResizeHandleProps> = ({
  listRef,
  onDraggingChange,
  onHeightChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{ pointerId: number; startHeight: number; startY: number } | null>(
    null,
  );

  const setDragging = useCallback(
    (nextIsDragging: boolean) => {
      setIsDragging(nextIsDragging);
      onDraggingChange(nextIsDragging);
    },
    [onDraggingChange],
  );

  const stopDragging = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = dragStateRef.current;

      if (dragState && event.currentTarget.hasPointerCapture(dragState.pointerId)) {
        event.currentTarget.releasePointerCapture(dragState.pointerId);
      }

      dragStateRef.current = null;
      setDragging(false);
    },
    [setDragging],
  );

  return (
    <button
      type="button"
      aria-label="Resize AI response panel"
      aria-pressed={isDragging}
      className="group flex h-5 w-full cursor-ns-resize touch-none items-start justify-center pt-1 outline-none select-none"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }

        if (!listRef.current) {
          return;
        }

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStateRef.current = {
          pointerId: event.pointerId,
          startHeight: listRef.current.getBoundingClientRect().height,
          startY: event.clientY,
        };
        setDragging(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
          return;
        }

        if (!listRef.current) {
          return;
        }

        event.preventDefault();

        const step = event.shiftKey ? 48 : 24;
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        onHeightChange(
          clampMessageListHeight(listRef.current.getBoundingClientRect().height + step * direction),
        );
      }}
      onPointerMove={(event) => {
        const dragState = dragStateRef.current;

        if (!dragState || event.pointerId !== dragState.pointerId) {
          return;
        }

        const nextHeight = dragState.startHeight + dragState.startY - event.clientY;
        onHeightChange(clampMessageListHeight(nextHeight));
      }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={() => {
        dragStateRef.current = null;
        setDragging(false);
      }}
    >
      <motion.span
        animate={{
          opacity: isDragging ? 1 : 0.82,
          scaleX: isDragging ? 1.08 : 1,
        }}
        className="block h-1.25 w-33.5 rounded-full bg-black shadow-[0_1px_0_rgba(255,255,255,0.45)] transition-colors duration-200 ease-in-out group-hover:bg-[#202020] group-focus-visible:bg-[#202020]"
        transition={MESSAGE_LIST_TRANSITION}
      />
    </button>
  );
};

export const AIWidgetMessageList: FC<AIWidgetMessageListProps> = ({ messages, status }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [chatContentRef, chatContentBounds] = useMeasure();
  const [height, setHeight] = useState<number>();
  const [isResizing, setIsResizing] = useState(false);

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
  const shouldShowResizeHandle = messages.some((message) => {
    return message.role === 'assistant' && hasRenderableMessageParts(message);
  });

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

  useEffect(() => {
    const syncHeightWithViewport = () => {
      setHeight((currentHeight) => {
        if (currentHeight === undefined) {
          return currentHeight;
        }

        return clampMessageListHeight(currentHeight);
      });
    };

    window.addEventListener('resize', syncHeightWithViewport);
    window.addEventListener('orientationchange', syncHeightWithViewport);

    return () => {
      window.removeEventListener('resize', syncHeightWithViewport);
      window.removeEventListener('orientationchange', syncHeightWithViewport);
    };
  }, []);

  if (messages.length === 0) {
    return null;
  }

  return (
    <motion.div
      animate={{ height: height === undefined ? chatContentBounds.height : height + 36 }}
      className="overflow-hidden"
      initial={{ height: 0 }}
      transition={isResizing ? { duration: 0 } : MESSAGE_LIST_TRANSITION}
    >
      <div ref={chatContentRef} className="flex flex-col px-1">
        <div className="h-4 shrink-0" />

        <div className="relative">
          <AnimatePresence initial={false}>
            {shouldShowResizeHandle && (
              <motion.div
                key="resize-handle"
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                className="absolute inset-x-0 -top-3 z-10"
                exit={{
                  opacity: 0,
                  y: 4,
                  filter: 'blur(4px)',
                  transition: {
                    duration: 0.18,
                    ease: EASE_IN_OUT,
                  },
                }}
                initial={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
                transition={{
                  delay: 2,
                  duration: 0.34,
                  ease: EASE_IN_OUT,
                }}
              >
                <AIWidgetResizeHandle
                  listRef={listRef}
                  onDraggingChange={setIsResizing}
                  onHeightChange={setHeight}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div
            ref={listRef}
            className="flex max-h-[min(37.5rem,45vh)] scrollbar-thin flex-col gap-y-3 overflow-x-hidden overflow-y-auto px-3 text-sm"
            style={height === undefined ? undefined : { height }}
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
        </div>

        <div className="h-5 shrink-0" />
      </div>
    </motion.div>
  );
};
