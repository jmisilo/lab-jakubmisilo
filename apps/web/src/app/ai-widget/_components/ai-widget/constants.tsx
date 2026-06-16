"use client";

import type { FC } from "react";
import { RiOpenaiFill } from "react-icons/ri";
import { SiClaude } from "react-icons/si";

import type { AIWidgetModel } from "@labjm/types/ai-widget";

import { GeminiIcon } from "../gemini-icon";

export const WIDGET_TRANSITION = {
  type: "spring" as const,
  stiffness: 380,
  damping: 34,
};

export const FORM_TRANSITION = {
  type: "spring" as const,
  stiffness: 380,
  damping: 34,
};

export const MODEL_CHOICES = [
  {
    id: "openai-gpt-5.5",
    provider: "OpenAI",
    label: "GPT 5.5",
    Icon: () => <RiOpenaiFill className="size-3.5 text-black" />,
  },
  {
    id: "claude-opus-4.8",
    provider: "Claude",
    label: "Opus 4.8",
    Icon: () => <SiClaude className="size-3.5 text-[#D97757]" />,
  },
  {
    id: "google-gemini-3.1-pro",
    provider: "Google",
    label: "Gemini 3.1 Pro",
    Icon: () => <GeminiIcon className="size-3.5" />,
  },
] as const satisfies ReadonlyArray<{
  id: AIWidgetModel;
  provider: string;
  label: string;
  Icon: FC;
}>;

export const THINKING_INTENSITIES = ["low", "medium", "high"] as const;
