"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { FC } from "react";
import { LuArrowUp, LuLoaderCircle } from "react-icons/lu";

type AIWidgetSubmitButtonProps = {
  disabled: boolean;
};

export const AIWidgetSubmitButton: FC<AIWidgetSubmitButtonProps> = ({
  disabled,
}) => {
  return (
    <motion.div
      layout="position"
      layoutId="submit-button"
      className="inline-flex shrink-0"
      transition={{
        ease: [0.25, 0.5, 0.8, 0.4],
        duration: 0.13,
      }}
    >
      <button
        type="submit"
        className="flex items-center justify-between rounded-full bg-black p-2 [box-shadow:0px_5px_3px_rgba(0,0,0,0.02),0px_2px_2px_rgba(0,0,0,0.03),0px_1px_1px_rgba(0,0,0,0.03),inset_-3px_0px_4px_rgba(255,255,255,0.15),inset_1px_2px_2px_rgba(255,255,255,0.15)] transition-all duration-100 hover:bg-[#030303] active:scale-97 disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:bg-black"
        disabled={disabled}
      >
        <span className="relative inline-flex items-center justify-center">
          <MotionConfig
            transition={{
              duration: 0.22,
              type: "spring",
              bounce: 0,
            }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {disabled ? (
                <motion.span
                  key="loading"
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  className="inline-flex"
                  exit={{ opacity: 0, scale: 0.35, filter: "blur(6px)" }}
                  initial={{ opacity: 0.3, scale: 0.35, filter: "blur(6px)" }}
                >
                  <LuLoaderCircle className="size-4 animate-spin text-white" />
                </motion.span>
              ) : (
                <motion.span
                  key="submit"
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  className="inline-flex"
                  exit={{ opacity: 0, scale: 0.35, filter: "blur(6px)" }}
                  initial={{ opacity: 0.3, scale: 0.35, filter: "blur(6px)" }}
                >
                  <LuArrowUp className="size-4 text-white" />
                </motion.span>
              )}
            </AnimatePresence>
          </MotionConfig>
        </span>
      </button>
    </motion.div>
  );
};
