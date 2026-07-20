'use client';

import type { FC } from 'react';

import { motion } from 'motion/react';

import type { AIWidgetMessage } from './types';

type AIWidgetUserMessageProps = {
  message: AIWidgetMessage;
};

export const AIWidgetUserMessage: FC<AIWidgetUserMessageProps> = ({ message }) => {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="ml-10 self-end rounded-3xl border border-[#f2f2f2] bg-white px-4 py-2.5 text-black [box-shadow:0px_8px_8px_rgba(0,0,0,0.02)]"
      initial={{ opacity: 0, y: 8 }}
      transition={{
        duration: 0.2,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      {message.parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={`${message.id}-${index}`}>{part.text}</span>;
        }

        return null;
      })}
    </motion.div>
  );
};
