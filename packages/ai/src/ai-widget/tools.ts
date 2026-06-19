import {
  MatchDetailToolInputSchema,
  MatchDetailToolOutputSchema,
} from "@labjm/schemas";
import type {
  MatchDetailWorkflowStep,
  MatchDetailWorkflowStepStatus,
} from "@labjm/types/ai-widget";
import { Tool, tool, zodSchema } from "ai";

import { DATA_WORKFLOW_RESULT } from "./data-workflow-result";
import z from "zod";

/** @todo type annotation is workaround for AI SDK v7 type inference issue, to be tracked & remove */
/** @note the tool is just a mock implementation that returns a static response, for showcase purposes only (at least for now) */
export const tools: {
  "retrieve-match-detail": Tool<
    z.infer<typeof MatchDetailToolInputSchema>,
    z.infer<typeof MatchDetailToolOutputSchema>
  >;
} = {
  "retrieve-match-detail": tool({
    description: "Retrieves match detail based on the query and game ID",
    inputSchema: zodSchema(MatchDetailToolInputSchema),
    outputSchema: zodSchema(MatchDetailToolOutputSchema),
    async *execute() {
      const result = new Map<
        MatchDetailWorkflowStep,
        MatchDetailWorkflowStepStatus
      >();

      result.set("analyze-query", "pending");

      yield {
        steps: Array.from(result.entries()).map(([step, status]) => ({
          step,
          status,
        })),
      };

      await sleep(1000);

      result.set("analyze-query", "done");
      result.set("locate-event", "pending");

      yield {
        steps: Array.from(result.entries()).map(([step, status]) => ({
          step,
          status,
        })),
      };

      await sleep(1000);

      result.set("locate-event", "done");
      result.set("retrieve-action-chain", "pending");

      yield {
        steps: Array.from(result.entries()).map(([step, status]) => ({
          step,
          status,
        })),
      };

      await sleep(1000);

      result.set("retrieve-action-chain", "done");

      yield {
        steps: Array.from(result.entries()).map(([step, status]) => ({
          step,
          status,
        })),
        details: DATA_WORKFLOW_RESULT,
      };

      return {
        steps: Array.from(result.entries()).map(([step, status]) => ({
          step,
          status,
        })),
        details: DATA_WORKFLOW_RESULT,
      };
    },
  }),
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
