"use client";

import type { FC } from "react";
import { LuBrain } from "react-icons/lu";

import { LoadingText } from "../loading-text";

type AIWidgetReasoningProps = {
  isStreaming: boolean;
};

export const AIWidgetReasoning: FC<AIWidgetReasoningProps> = ({
  isStreaming,
}) => {
  return (
    <div className="flex items-center gap-x-1.5 text-[#959595]">
      <LuBrain />

      <div>
        {isStreaming ? (
          <LoadingText color="#959595">Thinking</LoadingText>
        ) : (
          "Thought for few seconds"
        )}
      </div>
    </div>
  );
};
