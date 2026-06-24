import {
  WORLD_CUP_TEAM_FIFA_CODES,
  WORLD_CUP_TEAMS,
  WorldCupTeamRegistry,
} from '@/app/features/world-cup/teams';

describe('World Cup teams registry', () => {
  it('lists all 48 teams with unique standardized ids', () => {
    expect(WORLD_CUP_TEAMS).toHaveLength(48);
    expect(new Set(WORLD_CUP_TEAMS.map((team) => team.id))).toHaveProperty('size', 48);
  });

  it('derives a unique FIFA code enum from the team registry', () => {
    expect(WORLD_CUP_TEAM_FIFA_CODES).toHaveLength(48);
    expect(new Set(WORLD_CUP_TEAM_FIFA_CODES)).toHaveProperty('size', 48);
    expect(WORLD_CUP_TEAM_FIFA_CODES).toContain('POR');
  });

  it('resolves teams by name, FIFA code, and alias', () => {
    expect(WorldCupTeamRegistry.resolve('Portugal')).toEqual(
      expect.objectContaining({ ok: true, team: expect.objectContaining({ id: '41' }) }),
    );
    expect(WorldCupTeamRegistry.resolve('ENG')).toEqual(
      expect.objectContaining({ ok: true, team: expect.objectContaining({ id: '45' }) }),
    );
    expect(WorldCupTeamRegistry.resolve('DRC')).toEqual(
      expect.objectContaining({ ok: true, team: expect.objectContaining({ id: '42' }) }),
    );
  });

  it('looks up subscription teams by FIFA code only', () => {
    expect(WorldCupTeamRegistry.getByFifaCode('por')).toEqual(
      expect.objectContaining({ id: '41', fifaCode: 'POR' }),
    );
    expect(WorldCupTeamRegistry.getByFifaCode('Portugal')).toBeUndefined();
  });
});
