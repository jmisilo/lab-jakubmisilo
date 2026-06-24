import type { WorldCupTeam } from '@/app/world-cup/teams';

import { z } from 'zod';

import { WorldCupTeamRegistry } from '@/app/world-cup/teams';

export const WORLD_CUP_EVENT_TYPES = ['kickoff', 'goal', 'game-end'] as const;
export const WORLD_CUP_DETECTED_EVENT_TYPES = [
  'kickoff',
  'goal',
  'game-end',
  'kickoff-reminder',
] as const;
export const WORLD_CUP_TRACKING_MODES = ['all_teams', 'teams', 'team'] as const;

export const WorldCupEventTypeSchema = z.enum(WORLD_CUP_EVENT_TYPES);
export const WorldCupDetectedEventTypeSchema = z.enum(WORLD_CUP_DETECTED_EVENT_TYPES);
export const WorldCupTrackingModeSchema = z.enum(WORLD_CUP_TRACKING_MODES);

const ApiBooleanSchema = z.string().transform((value) => value.trim().toLowerCase() === 'true');

const ApiScoreSchema = z.string().transform((value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
});

export const WorldCupGameStatusSchema = z.string().transform((value) => value.trim().toLowerCase());

const WorldCupApiTeamResponseItemSchema = z
  .object({
    _id: z.string(),
    id: z.string(),
    name_en: z.string(),
    name_fa: z.string().optional(),
    fifa_code: z.string().optional(),
    iso2: z.string().optional(),
    groups: z.string().optional(),
    flag: z.string().optional(),
  })
  .passthrough()
  .transform((team): WorldCupTeam => {
    const registeredTeam = WorldCupTeamRegistry.getById(team.id);

    return (
      registeredTeam ?? {
        id: team.id,
        name: team.name_en,
        fifaCode: team.fifa_code ?? team.id,
        iso2: team.iso2 ?? team.id,
        group: team.groups ?? '',
      }
    );
  });

export const WorldCupApiGameSchema = z.looseObject({
  _id: z.string(),
  id: z.string(),
  home_team_id: z.string(),
  away_team_id: z.string(),
  home_score: z.string(),
  away_score: z.string(),
  home_scorers: z.string(),
  away_scorers: z.string(),
  group: z.string(),
  matchday: z.string(),
  local_date: z.string(),
  persian_date: z.string().optional(),
  stadium_id: z.string(),
  finished: z.string(),
  time_elapsed: z.string(),
  type: z.string(),
  home_team_name_en: z.string().optional(),
  away_team_name_en: z.string().optional(),
  home_team_label: z.string().optional(),
  away_team_label: z.string().optional(),
});

export const WorldCupGameSnapshotSchema = WorldCupApiGameSchema.transform((game) => {
  const homeTeam = WorldCupTeamRegistry.getById(game.home_team_id);
  const awayTeam = WorldCupTeamRegistry.getById(game.away_team_id);
  const finished = ApiBooleanSchema.parse(game.finished);

  return {
    gameId: game.id,
    homeTeamId: game.home_team_id,
    awayTeamId: game.away_team_id,
    homeTeamName: game.home_team_name_en ?? game.home_team_label ?? homeTeam?.name ?? 'TBD',
    awayTeamName: game.away_team_name_en ?? game.away_team_label ?? awayTeam?.name ?? 'TBD',
    homeScore: ApiScoreSchema.parse(game.home_score),
    awayScore: ApiScoreSchema.parse(game.away_score),
    homeScorers: game.home_scorers,
    awayScorers: game.away_scorers,
    finished: finished || WorldCupGameStatusSchema.parse(game.time_elapsed) === 'finished',
    timeElapsed: game.time_elapsed,
    localDate: game.local_date,
    raw: game,
  };
});

const WorldCupEventTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  fifaCode: z.string().optional(),
  flagEmoji: z.string().optional(),
  score: z.number(),
  scorers: z.string(),
});

const WorldCupScoringTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  fifaCode: z.string().optional(),
  flagEmoji: z.string().optional(),
  scoreAfterGoal: z.number(),
  goalsDetected: z.number(),
  scorers: z.string(),
  scorerName: z.string().optional(),
  goalMinute: z.string().optional(),
});

export const WorldCupEventPayloadSchema = z.object({
  eventType: WorldCupDetectedEventTypeSchema,
  gameId: z.string(),
  matchLabel: z.string(),
  homeTeam: WorldCupEventTeamSchema,
  awayTeam: WorldCupEventTeamSchema,
  localDate: z.string(),
  timeElapsed: z.string(),
  minutesUntilKickoff: z.number().optional(),
  scoringTeam: WorldCupScoringTeamSchema.optional(),
});

export const WorldCupDetectedEventSchema = z.object({
  eventKey: z.string(),
  eventType: WorldCupDetectedEventTypeSchema,
  gameId: z.string(),
  teamIds: z.array(z.string()),
  payload: WorldCupEventPayloadSchema,
});

export const WorldCupTeamsResponseSchema = z.object({
  teams: z.array(WorldCupApiTeamResponseItemSchema),
});

export const WorldCupGamesResponseSchema = z.object({
  games: z.array(WorldCupGameSnapshotSchema),
});
