import type {
  AgentSkill,
  AgentSkillSummary,
  ListSkillsInput,
  LoadSkillInput,
  LoadSkillResult,
} from '@/app/skills/types';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_MAX_SKILL_CHARACTERS = 6_000;
const SKILL_FILE_NAME = 'SKILL.md';

export class SkillService {
  static readonly maxSkillContentCharacters = DEFAULT_MAX_SKILL_CHARACTERS;

  static #uniqueDirectories(directories: string[]) {
    return [...new Set(directories.map((directory) => resolve(directory)))];
  }

  static #normalizeHeading(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  static #parseMarkdownHeading(line: string) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);

    if (!match?.[1] || !match[2]) {
      return null;
    }

    return {
      level: match[1].length,
      title: match[2].trim(),
    };
  }

  static #parseFrontmatter(content: string) {
    if (!content.startsWith('---')) {
      return {};
    }

    const end = content.indexOf('\n---', 3);

    if (end < 0) {
      return {};
    }

    const frontmatter = content.slice(3, end);
    const fields = new Map<string, string>();

    for (const line of frontmatter.split('\n')) {
      const separatorIndex = line.indexOf(':');

      if (separatorIndex < 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');

      if (key && value) {
        fields.set(key, value);
      }
    }

    return {
      name: fields.get('name'),
      description: fields.get('description'),
    };
  }

  static #stripFrontmatter(content: string) {
    if (!content.startsWith('---')) {
      return content;
    }

    const end = content.indexOf('\n---', 3);

    if (end < 0) {
      return content;
    }

    return content.slice(end + '\n---'.length);
  }

  static #extractMarkdownSection({ content, section }: { content: string; section: string }) {
    const normalizedSection = this.#normalizeHeading(section);
    const lines = content.split('\n');
    const startIndex = lines.findIndex((line) => {
      const heading = this.#parseMarkdownHeading(line);

      return heading && this.#normalizeHeading(heading.title) === normalizedSection;
    });

    if (startIndex < 0) {
      return null;
    }

    const startLine = lines[startIndex];

    if (!startLine) {
      return null;
    }

    const startHeading = this.#parseMarkdownHeading(startLine);

    if (!startHeading) {
      return null;
    }

    const endIndex = lines.findIndex((line, index) => {
      if (index <= startIndex) {
        return false;
      }

      const heading = this.#parseMarkdownHeading(line);

      return Boolean(heading && heading.level <= startHeading.level);
    });

    return lines.slice(startIndex, endIndex < 0 ? undefined : endIndex).join('\n');
  }

  static #toSummary(skill: AgentSkill): AgentSkillSummary {
    return {
      name: skill.name,
      description: skill.description,
    };
  }

  static #getDefaultSkillDirectories() {
    const configuredDirectory = process.env.AGENT_SKILLS_DIR;

    return [
      configuredDirectory,
      resolve(process.cwd(), 'src/skills'),
      resolve(process.cwd(), 'dist/skills'),
      resolve(process.cwd(), 'skills'),
    ].filter((directory): directory is string => Boolean(directory));
  }

  static #discoverSkills(directories: string[]): AgentSkill[] {
    const skills: AgentSkill[] = [];
    const seenNames = new Set<string>();

    for (const directory of this.#uniqueDirectories(directories)) {
      if (!existsSync(directory)) {
        continue;
      }

      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const path = resolve(directory, entry.name, SKILL_FILE_NAME);

        if (!existsSync(path)) {
          continue;
        }

        const content = readFileSync(path, 'utf8');
        const frontmatter = this.#parseFrontmatter(content);
        const name = frontmatter.name ?? entry.name;

        if (seenNames.has(name)) {
          continue;
        }

        seenNames.add(name);
        skills.push({
          name,
          description: frontmatter.description ?? '(no description)',
          path,
        });
      }
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  static listSkills(input: ListSkillsInput = {}) {
    const directories = input.directories ?? this.#getDefaultSkillDirectories();

    return this.#discoverSkills(directories).map((skill) => this.#toSummary(skill));
  }

  static loadSkill(input: LoadSkillInput): LoadSkillResult {
    const directories = input.directories ?? this.#getDefaultSkillDirectories();
    const maxCharacters = input.maxCharacters ?? this.maxSkillContentCharacters;
    const skills = this.#discoverSkills(directories);
    const skill = skills.find((candidate) => candidate.name === input.name);

    if (!skill) {
      return {
        ok: false,
        message: `Skill "${input.name}" is not available.`,
        availableSkills: skills.map((candidate) => this.#toSummary(candidate)),
      };
    }

    const fullContent = this.#stripFrontmatter(readFileSync(skill.path, 'utf8'));
    const selectedContent = input.section
      ? this.#extractMarkdownSection({ content: fullContent, section: input.section })
      : fullContent;

    if (!selectedContent) {
      return {
        ok: false,
        message: `Section "${input.section}" was not found in skill "${input.name}".`,
        availableSkills: skills.map((candidate) => this.#toSummary(candidate)),
      };
    }

    const trimmedContent = selectedContent.trim();
    const truncated = trimmedContent.length > maxCharacters;
    const content = truncated
      ? `${trimmedContent.slice(0, maxCharacters)}\n\n[Skill content truncated. Load a narrower section if needed.]`
      : trimmedContent;

    return {
      ok: true,
      message: input.section
        ? `Loaded section "${input.section}" from skill "${input.name}".`
        : `Loaded skill "${input.name}".`,
      skill: {
        ...this.#toSummary(skill),
        content,
        characterCount: trimmedContent.length,
        truncated,
      },
    };
  }
}
