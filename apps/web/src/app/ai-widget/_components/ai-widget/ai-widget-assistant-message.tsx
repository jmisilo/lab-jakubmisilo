"use client";

import type { FC } from "react";
import { Streamdown } from "streamdown";

import { LoadingText } from "../loading-text";
import { MatchDetailWorkflow } from "./match-detail-workflow";
import { AIWidgetReasoning } from "./ai-widget-reasoning";
import type { AIWidgetMessage } from "./types";

type AIWidgetAssistantMessageProps = {
  message: AIWidgetMessage;
  showLoader: boolean;
};

export const AIWidgetAssistantMessage: FC<AIWidgetAssistantMessageProps> = ({
  message,
  showLoader,
}) => {
  return (
    <div className="mr-10 flex flex-col gap-y-2.5 text-[#333333]">
      {showLoader ? (
        <LoadingText>Loading</LoadingText>
      ) : (
        <>
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return (
                <Streamdown key={`${message.id}-${index}`}>
                  {part.text}
                </Streamdown>
              );
            }

            if (part.type === "reasoning") {
              return (
                <AIWidgetReasoning
                  key={`${message.id}-${index}`}
                  isStreaming={part.state === "streaming"}
                />
              );
            }

            if (part.type === "tool-retrieve-match-detail") {
              return (
                <MatchDetailWorkflow
                  key={`${message.id}-${index}`}
                  part={part}
                />
              );
            }

            return null;
          })}
        </>
      )}
    </div>
  );
};
