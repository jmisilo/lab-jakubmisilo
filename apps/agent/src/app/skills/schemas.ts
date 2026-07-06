import { z } from 'zod';

export const LoadSkillToolInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe('Exact skill name from the # Skills section of the system instructions.'),
  section: z
    .string()
    .min(1)
    .optional()
    .describe('Optional markdown heading to load only one section from the skill.'),
});

const SkillSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const LoadSkillToolOutputSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  skill: SkillSummarySchema.extend({
    content: z.string(),
    characterCount: z.number(),
    truncated: z.boolean(),
  }).optional(),
  availableSkills: z.array(SkillSummarySchema).optional(),
});
