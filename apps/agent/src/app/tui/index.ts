import { runAgentTUI } from '@ai-sdk/tui';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const { AgentService } = await import('@/app/agent');

await runAgentTUI({
  title: 'Lab JM Agent',
  agent: AgentService.agent,
  reasoning: 'auto-collapsed',
  tools: 'auto-collapsed',
});
