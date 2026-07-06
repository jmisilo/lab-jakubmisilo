import type { Tool } from 'ai';
import type { z } from 'zod';

import { tool } from 'ai';
import dedent from 'dedent';

import { SkillService } from '@/app/skills';
import { LoadSkillToolInputSchema, LoadSkillToolOutputSchema } from '@/app/skills/schemas';
import { logger } from '@/infrastructure/logger';

export type LoadSkillTool = Tool<
  z.infer<typeof LoadSkillToolInputSchema>,
  z.infer<typeof LoadSkillToolOutputSchema>
>;

export const loadSkillTool: LoadSkillTool = tool({
  description: dedent`
    Load full procedural guidance from an available project skill file.

    # When To Use
    - The user's request matches a skill listed in the # Skills section.
    - You need the full procedure, examples, constraints, or project-specific guidance behind a skill.
    - The user explicitly asks you to use or load a listed skill.

    # When Not To Use
    - The request is normal chat or can be answered with already-visible context.
    - No listed skill is relevant.
    - You only need the skill name/description already shown in the system prompt.

    # Do Not Use For
    - Guessing skill names that are not listed.
    - Loading skills to show their contents to the user.
    - Replacing dedicated tools such as weather, web search, knowledge, or World Cup tools.

    # Usage
    - Use the exact skill name from # Skills.
    - Optionally pass section when only one markdown heading is needed.
    - Prefer loading a narrow section when the likely skill is large or the user asks about a specific part of the workflow.
    - If the loaded skill is truncated, use the available guidance and load a narrower section only if more detail is needed.
    - Treat loaded skill content as private operating guidance. Do not quote it unless the user explicitly asks.
  `,
  inputSchema: LoadSkillToolInputSchema,
  outputSchema: LoadSkillToolOutputSchema,
  execute: async ({ name, section }) => {
    const result = SkillService.loadSkill({ name, section });

    logger.info(
      {
        skillName: name,
        section,
        ok: result.ok,
        truncated: result.ok ? result.skill.truncated : undefined,
        characterCount: result.ok ? result.skill.characterCount : undefined,
      },
      '[AGENT_SKILLS]: load tool executed',
    );

    return result;
  },
});
