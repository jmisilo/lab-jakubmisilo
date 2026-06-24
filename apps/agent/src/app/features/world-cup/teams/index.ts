export type WorldCupTeam = {
  id: string;
  name: string;
  fifaCode: string;
  iso2: string;
  group: string;
  aliases?: string[];
};

export const WORLD_CUP_TEAMS = [
  { id: '1', name: 'Mexico', fifaCode: 'MEX', iso2: 'MX', group: 'A' },
  { id: '2', name: 'South Africa', fifaCode: 'RSA', iso2: 'ZA', group: 'A' },
  { id: '3', name: 'South Korea', fifaCode: 'KOR', iso2: 'KR', group: 'A', aliases: ['Korea'] },
  {
    id: '4',
    name: 'Czech Republic',
    fifaCode: 'CZE',
    iso2: 'CZ',
    group: 'A',
    aliases: ['Czechia'],
  },
  { id: '5', name: 'Canada', fifaCode: 'CAN', iso2: 'CA', group: 'B' },
  {
    id: '6',
    name: 'Bosnia and Herzegovina',
    fifaCode: 'BIH',
    iso2: 'BA',
    group: 'B',
    aliases: ['Bosnia'],
  },
  { id: '7', name: 'Qatar', fifaCode: 'QAT', iso2: 'QA', group: 'B' },
  { id: '8', name: 'Switzerland', fifaCode: 'SUI', iso2: 'CH', group: 'B' },
  { id: '9', name: 'Brazil', fifaCode: 'BRA', iso2: 'BR', group: 'C' },
  { id: '10', name: 'Morocco', fifaCode: 'MAR', iso2: 'MA', group: 'C' },
  { id: '11', name: 'Haiti', fifaCode: 'HAI', iso2: 'HT', group: 'C' },
  { id: '12', name: 'Scotland', fifaCode: 'SCO', iso2: 'SCO', group: 'C' },
  {
    id: '13',
    name: 'United States',
    fifaCode: 'USA',
    iso2: 'US',
    group: 'D',
    aliases: ['USA', 'US', 'United States of America'],
  },
  { id: '14', name: 'Paraguay', fifaCode: 'PAR', iso2: 'PY', group: 'D' },
  { id: '15', name: 'Australia', fifaCode: 'AUS', iso2: 'AU', group: 'D' },
  { id: '16', name: 'Turkey', fifaCode: 'TUR', iso2: 'TR', group: 'D' },
  { id: '17', name: 'Germany', fifaCode: 'GER', iso2: 'DE', group: 'E' },
  { id: '18', name: 'Curaçao', fifaCode: 'CUW', iso2: 'CW', group: 'E', aliases: ['Curacao'] },
  {
    id: '19',
    name: 'Ivory Coast',
    fifaCode: 'CIV',
    iso2: 'CI',
    group: 'E',
    aliases: ["Cote d'Ivoire", 'Côte d’Ivoire', 'Côte dIvoire'],
  },
  { id: '20', name: 'Ecuador', fifaCode: 'ECU', iso2: 'EC', group: 'E' },
  {
    id: '21',
    name: 'Netherlands',
    fifaCode: 'NED',
    iso2: 'NL',
    group: 'F',
    aliases: ['Holland'],
  },
  { id: '22', name: 'Japan', fifaCode: 'JPN', iso2: 'JP', group: 'F' },
  { id: '23', name: 'Sweden', fifaCode: 'SWE', iso2: 'SE', group: 'F' },
  { id: '24', name: 'Tunisia', fifaCode: 'TUN', iso2: 'TN', group: 'F' },
  { id: '25', name: 'Belgium', fifaCode: 'BEL', iso2: 'BE', group: 'G' },
  { id: '26', name: 'Egypt', fifaCode: 'EGY', iso2: 'EG', group: 'G' },
  { id: '27', name: 'Iran', fifaCode: 'IRN', iso2: 'IR', group: 'G' },
  { id: '28', name: 'New Zealand', fifaCode: 'NZL', iso2: 'NZ', group: 'G' },
  { id: '29', name: 'Spain', fifaCode: 'ESP', iso2: 'ES', group: 'H' },
  { id: '30', name: 'Cape Verde', fifaCode: 'CPV', iso2: 'CV', group: 'H' },
  { id: '31', name: 'Saudi Arabia', fifaCode: 'KSA', iso2: 'SA', group: 'H', aliases: ['Saudi'] },
  { id: '32', name: 'Uruguay', fifaCode: 'URU', iso2: 'UY', group: 'H' },
  { id: '33', name: 'France', fifaCode: 'FRA', iso2: 'FR', group: 'I' },
  { id: '34', name: 'Senegal', fifaCode: 'SEN', iso2: 'SN', group: 'I' },
  { id: '35', name: 'Iraq', fifaCode: 'IRQ', iso2: 'IQ', group: 'I' },
  { id: '36', name: 'Norway', fifaCode: 'NOR', iso2: 'NO', group: 'I' },
  { id: '37', name: 'Argentina', fifaCode: 'ARG', iso2: 'AR', group: 'J' },
  { id: '38', name: 'Algeria', fifaCode: 'ALG', iso2: 'DZ', group: 'J' },
  { id: '39', name: 'Austria', fifaCode: 'AUT', iso2: 'AT', group: 'J' },
  { id: '40', name: 'Jordan', fifaCode: 'JOR', iso2: 'JO', group: 'J' },
  { id: '41', name: 'Portugal', fifaCode: 'POR', iso2: 'PT', group: 'K' },
  {
    id: '42',
    name: 'Democratic Republic of the Congo',
    fifaCode: 'COD',
    iso2: 'CD',
    group: 'K',
    aliases: ['DR Congo', 'DRC', 'Congo DR', 'Democratic Republic Congo'],
  },
  { id: '43', name: 'Uzbekistan', fifaCode: 'UZB', iso2: 'UZ', group: 'K' },
  { id: '44', name: 'Colombia', fifaCode: 'COL', iso2: 'CO', group: 'K' },
  { id: '45', name: 'England', fifaCode: 'ENG', iso2: 'ENG', group: 'L' },
  { id: '46', name: 'Croatia', fifaCode: 'CRO', iso2: 'HR', group: 'L' },
  { id: '47', name: 'Ghana', fifaCode: 'GHA', iso2: 'GH', group: 'L' },
  { id: '48', name: 'Panama', fifaCode: 'PAN', iso2: 'PA', group: 'L' },
] as const satisfies readonly WorldCupTeam[];

export const WORLD_CUP_TEAM_FIFA_CODES = WORLD_CUP_TEAMS.map((team) => team.fifaCode) as [
  (typeof WORLD_CUP_TEAMS)[number]['fifaCode'],
  ...(typeof WORLD_CUP_TEAMS)[number]['fifaCode'][],
];

export type WorldCupTeamFifaCode = (typeof WORLD_CUP_TEAM_FIFA_CODES)[number];

export class WorldCupTeamRegistry {
  static resolve(query: string) {
    const normalizedQuery = this.normalizeQuery(query);

    const exactMatches = WORLD_CUP_TEAMS.filter((team) =>
      this.getSearchValues(team).some((value) => this.normalizeQuery(value) === normalizedQuery),
    );
    const [exactMatch] = exactMatches;

    if (exactMatches.length === 1 && exactMatch) {
      return { ok: true as const, team: exactMatch };
    }

    if (exactMatches.length > 1) {
      return { ok: false as const, reason: 'ambiguous_team' as const, matches: exactMatches };
    }

    const fuzzyMatches = WORLD_CUP_TEAMS.filter((team) =>
      this.getSearchValues(team).some((value) =>
        this.normalizeQuery(value).includes(normalizedQuery),
      ),
    );
    const [fuzzyMatch] = fuzzyMatches;

    if (fuzzyMatches.length === 1 && fuzzyMatch) {
      return { ok: true as const, team: fuzzyMatch };
    }

    if (fuzzyMatches.length > 1) {
      return { ok: false as const, reason: 'ambiguous_team' as const, matches: fuzzyMatches };
    }

    return { ok: false as const, reason: 'unknown_team' as const, matches: [] };
  }

  static getById(id: string) {
    return WORLD_CUP_TEAMS.find((team) => team.id === id);
  }

  static getByFifaCode(fifaCode: string) {
    return WORLD_CUP_TEAMS.find((team) => team.fifaCode === fifaCode.trim().toUpperCase());
  }

  static getFlagEmojiById(id: string) {
    const team = this.getById(id);

    if (!team || team.iso2.length !== 2) {
      return undefined;
    }

    return [...team.iso2.toUpperCase()]
      .map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127_397))
      .join('');
  }

  private static normalizeQuery(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/s$/, '');
  }

  private static getSearchValues(team: WorldCupTeam) {
    return [team.id, team.name, team.fifaCode, team.iso2, ...(team.aliases ?? [])];
  }
}
