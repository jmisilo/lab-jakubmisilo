import {
  MatchDetailToolInputSchema,
  MatchDetailToolOutputSchema,
} from "@labjm/schemas/ai-widget";
import { defineTool } from "eve/tools";

import { DATA_WORKFLOW_RESULT } from "#data/data-workflow-result";

export default defineTool({
  description: "Retrieves match detail based on the query and game ID.",
  inputSchema: MatchDetailToolInputSchema,
  outputSchema: MatchDetailToolOutputSchema,
  async execute() {
    return {
      steps: [
        { step: "analyze-query", status: "done" } as const,
        { step: "locate-event", status: "done" } as const,
        { step: "retrieve-action-chain", status: "done" } as const,
      ],
      details: DATA_WORKFLOW_RESULT,
    };
  },
});
