import { runAgentTUI } from "@ai-sdk/tui";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const { AIAgentService } = await import("@/app/agent");

await runAgentTUI({
  title: "Lab JM Agent",
  agent: AIAgentService.agent,
  reasoning: "auto-collapsed",
  tools: "auto-collapsed",
});
