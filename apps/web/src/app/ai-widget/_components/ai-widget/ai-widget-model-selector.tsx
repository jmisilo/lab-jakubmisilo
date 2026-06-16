"use client";

import { motion, AnimatePresence, MotionConfig } from "motion/react";
import type { FC } from "react";
import useMeasure from "react-use-measure";

import type { ModelChoice } from "./types";

type AIWidgetModelSelectorProps = {
  onSelectNextModel: () => void;
  selectedModel: ModelChoice;
};

export const AIWidgetModelSelector: FC<AIWidgetModelSelectorProps> = ({
  onSelectNextModel,
  selectedModel,
}) => {
  const [modelIndicatorContentRef, modelIndicatorContentBounds] = useMeasure();

  return (
    <motion.button
      type="button"
      aria-label={`Selected model: ${selectedModel.provider} ${selectedModel.label}. Click to change model.`}
      onClick={onSelectNextModel}
      className="overflow-hidden rounded-full border border-[#f1f1f1] bg-white p-2 pr-2.25 [box-shadow:0px_5px_3px_rgba(0,0,0,0.02),0px_2px_2px_rgba(0,0,0,0.03),0px_1px_1px_rgba(0,0,0,0.03)] transition-[background-color,scale] duration-100 hover:bg-[#fcfcfc] active:scale-97"
    >
      <motion.div
        animate={
          modelIndicatorContentBounds.width
            ? { width: modelIndicatorContentBounds.width + 2 }
            : undefined
        }
        className="overflow-hidden"
        transition={{ duration: 0.25, ease: "easeInOut" }}
      >
        <div
          ref={modelIndicatorContentRef}
          className="flex w-max items-center gap-x-1.5"
        >
          <MotionConfig
            transition={{ duration: 0.15, type: "spring", bounce: 0 }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={`${selectedModel.id}-icon`}
                className="inline-flex shrink-0"
                exit={{ opacity: 0, scale: 0.35, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                initial={{ opacity: 0.3, scale: 0.35, filter: "blur(6px)" }}
              >
                <selectedModel.Icon />
              </motion.span>
            </AnimatePresence>

            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={`${selectedModel.id}-label`}
                className="text-xs leading-4 whitespace-nowrap text-black"
                exit={{ opacity: 0, scale: 0.95, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                initial={{ opacity: 0.3, scale: 0.95, filter: "blur(6px)" }}
              >
                {selectedModel.label}
              </motion.span>
            </AnimatePresence>
          </MotionConfig>
        </div>
      </motion.div>
    </motion.button>
  );
};
