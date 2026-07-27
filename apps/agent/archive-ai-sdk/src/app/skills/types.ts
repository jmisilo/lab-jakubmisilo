export type AgentSkillSummary = {
  name: string;
  description: string;
};

export type AgentSkill = AgentSkillSummary & {
  path: string;
};

export type ListSkillsInput = {
  directories?: string[];
};

export type LoadSkillInput = {
  name: string;
  section?: string;
  directories?: string[];
  maxCharacters?: number;
};

export type LoadSkillResult =
  | {
      ok: true;
      message: string;
      skill: AgentSkillSummary & {
        content: string;
        characterCount: number;
        truncated: boolean;
      };
    }
  | {
      ok: false;
      message: string;
      availableSkills: AgentSkillSummary[];
    };
