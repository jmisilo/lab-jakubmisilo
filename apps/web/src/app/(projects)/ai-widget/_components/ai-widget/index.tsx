'use client';

import type { SubmitEvent } from 'react';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { motion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';

import { apiUrl } from '@labjm/utilities/url-composer';

import type { AIWidgetMessage } from './types';
import { AIWidgetForm } from './ai-widget-form';
import { AIWidgetMessageList } from './ai-widget-message-list';
import { MODEL_CHOICES, THINKING_INTENSITIES, WIDGET_TRANSITION } from './constants';
import { useAIWidgetFocus } from './use-ai-widget-focus';

export const AIWidget = () => {
  const [input, setInput] = useState('');
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [thinkingIntensityIndex, setThinkingIntensityIndex] = useState(1);

  const selectedModel = MODEL_CHOICES[selectedModelIndex] ?? MODEL_CHOICES[0];
  const thinkingIntensity = THINKING_INTENSITIES[thinkingIntensityIndex] ?? THINKING_INTENSITIES[1];

  const { messages, sendMessage, status } = useChat<AIWidgetMessage>({
    transport: new DefaultChatTransport({
      api: apiUrl.compose({ pathSegments: ['/ai-widget'] }),
    }),
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useAIWidgetFocus(textareaRef);

  const disabled = status === 'streaming' || status === 'submitted';
  const shouldExpandForm = messages.length > 0 || status === 'submitted' || status === 'streaming';

  const onSelectNextModel = useCallback(() => {
    setSelectedModelIndex((index) => (index + 1) % MODEL_CHOICES.length);
  }, []);

  const onSelectNextThinkingIntensity = useCallback(() => {
    setThinkingIntensityIndex((index) => (index + 1) % THINKING_INTENSITIES.length);
  }, []);

  const onSubmit = useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!input.trim().length) {
        return;
      }

      sendMessage(
        { text: input },
        {
          body: {
            model: selectedModel.id,
            thinkingIntensity,
          },
        },
      );
      setInput('');

      textareaRef.current?.focus();
    },
    [input, selectedModel.id, sendMessage, thinkingIntensity],
  );

  return (
    <motion.div
      animate={{ maxWidth: isFormExpanded ? 600 : 480 }}
      className="w-full rounded-[1.625rem] border border-[#f2f2f2] bg-[#f8f8f8] p-0.5"
      initial={false}
      transition={WIDGET_TRANSITION}
    >
      <AIWidgetMessageList messages={messages} status={status} />

      <AIWidgetForm
        disabled={disabled}
        forceExpanded={shouldExpandForm}
        formRef={formRef}
        input={input}
        onExpandedChange={setIsFormExpanded}
        onInputChange={setInput}
        onSelectNextModel={onSelectNextModel}
        onSelectNextThinkingIntensity={onSelectNextThinkingIntensity}
        onSubmit={onSubmit}
        selectedModel={selectedModel}
        textareaRef={textareaRef}
        thinkingIntensity={thinkingIntensity}
      />
    </motion.div>
  );
};
