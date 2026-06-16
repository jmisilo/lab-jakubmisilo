"use client";

import type { RefObject } from "react";
import { useEffect } from "react";

export const useAIWidgetFocus = (
  ref: RefObject<HTMLTextAreaElement | null>,
) => {
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (
        event.key === "Tab" ||
        event.key === "Escape" ||
        event.key === "Enter" ||
        event.key.startsWith("Arrow") ||
        event.key.startsWith("F")
      ) {
        return;
      }

      if (event.key.length === 1) {
        ref.current?.focus();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [ref]);
};
