"use client";

import { cn } from "@labjm/utilities/cn";
import { AnimatePresence, motion } from "motion/react";
import type {
  Dispatch,
  FC,
  RefObject,
  SetStateAction,
  SubmitEventHandler,
} from "react";
import { useEffect, useState } from "react";
import useMeasure from "react-use-measure";

import { FORM_TRANSITION } from "./constants";
import type { ModelChoice, ThinkingIntensity } from "./types";
import { AIWidgetSubmitButton } from "./ai-widget-submit-button";
import { AIWidgetModelSelector } from "./ai-widget-model-selector";
import { AIWidgetThinkingIntensitySelector } from "./ai-widget-thinking-intensity-selector";

type AIWidgetFormProps = {
  disabled: boolean;
  forceExpanded: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  input: string;
  onExpandedChange?: (isExpanded: boolean) => void;
  onInputChange: Dispatch<SetStateAction<string>>;
  onSelectNextModel: () => void;
  onSelectNextThinkingIntensity: () => void;
  onSubmit: SubmitEventHandler<HTMLFormElement>;
  selectedModel: ModelChoice;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  thinkingIntensity: ThinkingIntensity;
};

export const AIWidgetForm: FC<AIWidgetFormProps> = ({
  disabled,
  forceExpanded,
  formRef,
  input,
  onExpandedChange,
  onInputChange,
  onSelectNextModel,
  onSelectNextThinkingIntensity,
  onSubmit,
  selectedModel,
  textareaRef,
  thinkingIntensity,
}) => {
  const [isFocusedWithin, setIsFocusedWithin] = useState(false);
  const [formContentRef, formContentBounds] = useMeasure();

  const isExpanded =
    forceExpanded || isFocusedWithin || input.trim().length > 0;

  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  return (
    <motion.form
      ref={formRef}
      onSubmit={onSubmit}
      onFocus={() => {
        setIsFocusedWithin(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsFocusedWithin(false);
        }
      }}
      animate={{
        height: formContentBounds.height ? formContentBounds.height : "auto",
      }}
      className="relative overflow-hidden rounded-3xl border border-[#f2f2f2] bg-white"
      initial={false}
      transition={FORM_TRANSITION}
    >
      <motion.div
        ref={formContentRef}
        className={cn("flex flex-col px-4", {
          "pr-2": !isExpanded,
        })}
        transition={FORM_TRANSITION}
      >
        <motion.div
          className="flex items-center justify-between gap-x-2 py-2"
          animate={{ y: isExpanded ? 8 : 0 }}
          transition={FORM_TRANSITION}
        >
          <div className="relative flex-1 w-full">
            {/** @note native placeholder might get buggy on smaller devices, as it might occupy more than one line, causing height flickering on input expand */}
            {input.length === 0 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-0 truncate  text-[#959595] h-full"
              >
                Ask about this match - tactics, players, key moments...
              </span>
            )}

            <textarea
              ref={textareaRef}
              rows={1}
              name="input"
              id="input"
              className={cn(
                "relative z-10 w-full min-w-0 flex-1 h-auto resize-none caret-black focus-visible:ring-0 outline-none ring-0 disabled:invisible",
                input.length === 0 ? "text-transparent" : "text-black",
                isExpanded
                  ? "field-sizing-content max-h-[3lh]"
                  : "min-h-5 max-h-5 overflow-hidden leading-5",
              )}
              value={input}
              onChange={(event) => onInputChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !disabled) {
                  event.preventDefault();

                  formRef.current?.requestSubmit();
                  textareaRef.current?.focus();
                }
              }}
            />
          </div>

          {!isExpanded && <div className="size-8" aria-hidden />}
        </motion.div>

        <div className="flex items-center justify-between">
          <AnimatePresence initial={false} mode="popLayout">
            {isExpanded && (
              <motion.div
                key="expanded-selectors"
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                className="flex items-center gap-x-1.5 pt-6 pb-4"
                exit={{
                  y: 6,
                  opacity: 0,
                  filter: "blur(6px)",
                  transition: { duration: 0.21, ease: "easeIn" },
                }}
                initial={{ opacity: 0, y: 6, filter: "blur(6px)" }}
                transition={{
                  duration: 0.36,
                  delay: 0.15,
                  ease: [0.23, 1, 0.32, 1],
                }}
              >
                <AIWidgetModelSelector
                  selectedModel={selectedModel}
                  onSelectNextModel={onSelectNextModel}
                />

                <AIWidgetThinkingIntensitySelector
                  thinkingIntensity={thinkingIntensity}
                  onSelectNextThinkingIntensity={onSelectNextThinkingIntensity}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div
          className={cn(
            "absolute right-2 bottom-1.5 transition-transform ease-in-out duration-350",
            {
              "-translate-y-2.25 -translate-x-2": isExpanded,
            },
          )}
        >
          <AIWidgetSubmitButton disabled={disabled} />
        </div>
      </motion.div>
    </motion.form>
  );
};
