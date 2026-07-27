import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SkillService } from '@/app/skills';

describe('SkillService', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('lists skills from directories and keeps the first matching name', () => {
    const projectSkills = createSkillDirectory();
    const globalSkills = createSkillDirectory();

    writeSkill(projectSkills, 'knowledge-management', {
      frontmatterName: 'knowledge-management',
      description: 'Project-local skill.',
      content: '# Project Skill',
    });
    writeSkill(globalSkills, 'knowledge-management', {
      frontmatterName: 'knowledge-management',
      description: 'Global duplicate.',
      content: '# Global Skill',
    });
    writeSkill(globalSkills, 'weather', {
      description: 'Weather skill.',
      content: '# Weather Skill',
    });

    expect(
      SkillService.listSkills({
        directories: [projectSkills, globalSkills],
      }),
    ).toEqual([
      {
        name: 'knowledge-management',
        description: 'Project-local skill.',
      },
      {
        name: 'weather',
        description: 'Weather skill.',
      },
    ]);
  });

  it('loads full skill content by exact name', () => {
    const directory = createSkillDirectory();

    writeSkill(directory, 'knowledge-management', {
      frontmatterName: 'knowledge-management',
      description: 'Knowledge skill.',
      content: '# Knowledge Management\n\nUse durable notes carefully.',
    });

    expect(
      SkillService.loadSkill({
        name: 'knowledge-management',
        directories: [directory],
      }),
    ).toEqual({
      ok: true,
      message: 'Loaded skill "knowledge-management".',
      skill: {
        name: 'knowledge-management',
        description: 'Knowledge skill.',
        content: expect.stringContaining('Use durable notes carefully.'),
        characterCount: expect.any(Number),
        truncated: false,
      },
    });
  });

  it('loads a markdown section when requested', () => {
    const directory = createSkillDirectory();

    writeSkill(directory, 'knowledge-management', {
      description: 'Knowledge skill.',
      content: [
        '# Knowledge Management',
        '',
        'Overview.',
        '',
        '## Save Rules',
        '',
        'Save durable facts.',
        '',
        '## Path Choice',
        '',
        'Choose specific paths.',
      ].join('\n'),
    });

    const result = SkillService.loadSkill({
      name: 'knowledge-management',
      section: 'Save Rules',
      directories: [directory],
    });

    expect(result).toMatchObject({
      ok: true,
      message: 'Loaded section "Save Rules" from skill "knowledge-management".',
      skill: {
        content: '## Save Rules\n\nSave durable facts.',
      },
    });
  });

  it('caps loaded skill content', () => {
    const directory = createSkillDirectory();

    writeSkill(directory, 'long-skill', {
      description: 'Long skill.',
      content: `# Long Skill\n\n${'a'.repeat(50)}`,
    });

    const result = SkillService.loadSkill({
      name: 'long-skill',
      directories: [directory],
      maxCharacters: 20,
    });

    expect(result).toMatchObject({
      ok: true,
      skill: {
        truncated: true,
        characterCount: 64,
      },
    });

    if (result.ok) {
      expect(result.skill.content).toContain('[Skill content truncated.');
    }
  });

  it('discovers the built-in calendar management skill', () => {
    expect(SkillService.listSkills()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'calendar-management',
          description: expect.stringContaining('implicit event creation'),
        }),
      ]),
    );

    expect(SkillService.loadSkill({ name: 'calendar-management' })).toMatchObject({
      ok: true,
      skill: {
        content: expect.stringContaining('The user does not need to say "add this to Calendar"'),
      },
    });
  });

  function createSkillDirectory() {
    const directory = mkdtempSync(join(tmpdir(), 'agent-skills-'));

    tempDirectories.push(directory);

    return directory;
  }

  function writeSkill(
    directory: string,
    name: string,
    {
      frontmatterName,
      description,
      content,
    }: {
      frontmatterName?: string;
      description: string;
      content: string;
    },
  ) {
    const skillDirectory = join(directory, name);

    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(
      join(skillDirectory, 'SKILL.md'),
      [
        '---',
        frontmatterName ? `name: ${frontmatterName}` : undefined,
        `description: ${description}`,
        '---',
        '',
        content,
      ]
        .filter((line): line is string => line !== undefined)
        .join('\n'),
    );
  }
});
