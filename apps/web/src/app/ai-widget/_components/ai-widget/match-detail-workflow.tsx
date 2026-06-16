"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { FC } from "react";
import { LuCheck, LuLoaderCircle } from "react-icons/lu";

import { LoadingText } from "../loading-text";
import type { AIWidgetMessage } from "./types";

type MatchDetailWorkflowProps = {
  part: Extract<
    AIWidgetMessage["parts"][number],
    { type: "tool-retrieve-match-detail" }
  >;
};

const MATCH_DETAIL_WORKFLOW_STEP_LABELS: Record<
  NonNullable<
    MatchDetailWorkflowProps["part"]["output"]
  >["steps"][number]["step"],
  string
> = {
  "analyze-query": "Analyzing the query",
  "locate-event": "Locating the event",
  "retrieve-action-chain": "Retrieving action chain",
};

export const MatchDetailWorkflow: FC<MatchDetailWorkflowProps> = ({ part }) => {
  if (part.state !== "output-available") {
    return <LoadingText>Loading</LoadingText>;
  }

  return (
    <div className="flex flex-col gap-y-1.5">
      {part.output.steps.map(({ step, status }, index) => {
        return (
          <motion.div
            key={step}
            animate={{ opacity: 1 }}
            className="flex items-center gap-x-1.5 text-[#959595]"
            initial={{ opacity: 0 }}
            transition={{
              delay: index * 0.1,
              duration: 0.2,
              ease: [0.23, 1, 0.32, 1],
            }}
          >
            <span className="relative inline-flex size-4 items-center justify-center">
              <MotionConfig
                transition={{
                  duration: 0.22,
                  type: "spring",
                  bounce: 0,
                }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {status === "done" ? (
                    <motion.span
                      key="done"
                      className="inline-flex"
                      initial={{
                        opacity: 0.3,
                        scale: 0.35,
                        filter: "blur(6px)",
                      }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.35, filter: "blur(6px)" }}
                    >
                      <LuCheck className="size-4 text-[#52B371]" />
                    </motion.span>
                  ) : (
                    <motion.span
                      key="pending"
                      className="inline-flex"
                      initial={{
                        opacity: 0.3,
                        scale: 0.35,
                        filter: "blur(6px)",
                      }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.35, filter: "blur(6px)" }}
                    >
                      <LuLoaderCircle className="size-4 animate-spin" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </MotionConfig>
            </span>

            <span>{MATCH_DETAIL_WORKFLOW_STEP_LABELS[step]}</span>
          </motion.div>
        );
      })}
    </div>
  );
};
