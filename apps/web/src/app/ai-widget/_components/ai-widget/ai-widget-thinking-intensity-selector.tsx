"use client";

import { cn } from "@labjm/utilities/cn";
import type { FC } from "react";

import { THINKING_INTENSITIES } from "./constants";
import type { ThinkingIntensity } from "./types";

type AIWidgetThinkingIntensitySelectorProps = {
  onSelectNextThinkingIntensity: () => void;
  thinkingIntensity: ThinkingIntensity;
};

export const AIWidgetThinkingIntensitySelector: FC<
  AIWidgetThinkingIntensitySelectorProps
> = ({ onSelectNextThinkingIntensity, thinkingIntensity }) => {
  const activeBars = THINKING_INTENSITIES.indexOf(thinkingIntensity) + 1;
  const barHeights = ["h-1", "h-2", "h-3"] as const;

  return (
    <button
      type="button"
      aria-label={`Thinking intensity: ${thinkingIntensity}. Click to change thinking intensity.`}
      onClick={onSelectNextThinkingIntensity}
      className="rounded-full border border-[#f1f1f1] bg-white p-2 [box-shadow:0px_5px_3px_rgba(0,0,0,0.02),0px_2px_2px_rgba(0,0,0,0.03),0px_1px_1px_rgba(0,0,0,0.03)] transition-all duration-100 hover:bg-[#fcfcfc] active:scale-97"
    >
      <span className="flex size-4 items-end justify-center gap-0.5">
        {[1, 2, 3].map((bar) => {
          const isActive = bar <= activeBars;

          return (
            <span
              key={bar}
              className={cn(
                "w-1 rounded-full transition-colors duration-150 ease-out",
                barHeights[bar - 1],
                isActive
                  ? "bg-[#111111] opacity-100"
                  : "bg-[#d8d8d8] opacity-55",
              )}
            />
          );
        })}
      </span>
    </button>
  );
};
