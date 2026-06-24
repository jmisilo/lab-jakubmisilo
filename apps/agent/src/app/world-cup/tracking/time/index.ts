import type { WorldCupGameSnapshot } from '@/app/world-cup/types';

type WorldCupStadiumTimeZone = {
  name: string;
  city: string;
  timeZone: string;
};

export class WorldCupTimeService {
  private static defaultUserTimeZone = 'Europe/Warsaw';

  /**
   * @note `stadium_id` comes from the World Cup API `/get/stadiums` endpoint.
   * The API's `local_date` is venue-local wall-clock time, but stadium data does not expose IANA zones.
   */
  private static stadiums: Record<string, WorldCupStadiumTimeZone> = {
    '1': {
      name: 'Estadio Azteca',
      city: 'Mexico City',
      timeZone: 'America/Mexico_City',
    },
    '2': {
      name: 'Estadio Akron',
      city: 'Guadalajara',
      timeZone: 'America/Mexico_City',
    },
    '3': {
      name: 'Estadio BBVA',
      city: 'Monterrey',
      timeZone: 'America/Monterrey',
    },
    '4': {
      name: 'AT&T Stadium',
      city: 'Dallas',
      timeZone: 'America/Chicago',
    },
    '5': {
      name: 'NRG Stadium',
      city: 'Houston',
      timeZone: 'America/Chicago',
    },
    '6': {
      name: 'GEHA Field at Arrowhead Stadium',
      city: 'Kansas City',
      timeZone: 'America/Chicago',
    },
    '7': {
      name: 'Mercedes-Benz Stadium',
      city: 'Atlanta',
      timeZone: 'America/New_York',
    },
    '8': {
      name: 'Hard Rock Stadium',
      city: 'Miami',
      timeZone: 'America/New_York',
    },
    '9': {
      name: 'Gillette Stadium',
      city: 'Boston',
      timeZone: 'America/New_York',
    },
    '10': {
      name: 'Lincoln Financial Field',
      city: 'Philadelphia',
      timeZone: 'America/New_York',
    },
    '11': {
      name: 'MetLife Stadium',
      city: 'New York/New Jersey',
      timeZone: 'America/New_York',
    },
    '12': {
      name: 'BMO Field',
      city: 'Toronto',
      timeZone: 'America/Toronto',
    },
    '13': {
      name: 'BC Place',
      city: 'Vancouver',
      timeZone: 'America/Vancouver',
    },
    '14': {
      name: 'Lumen Field',
      city: 'Seattle',
      timeZone: 'America/Los_Angeles',
    },
    '15': {
      name: "Levi's Stadium",
      city: 'San Francisco Bay Area',
      timeZone: 'America/Los_Angeles',
    },
    '16': {
      name: 'SoFi Stadium',
      city: 'Los Angeles',
      timeZone: 'America/Los_Angeles',
    },
  };

  static getKickoffAt(game: Pick<WorldCupGameSnapshot, 'localDate' | 'raw'>) {
    const timeZone = this.getStadiumTimeZone(game.raw.stadium_id);

    if (!timeZone) {
      return null;
    }

    return this.parseApiLocalDate({
      value: game.localDate,
      timeZone,
    });
  }

  static formatDateTime(date: Date, timeZone: string) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  static formatDateKey(date: Date, timeZone: string) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  static resolveTimeZone(timeZone: string) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      return timeZone;
    } catch {
      return this.defaultUserTimeZone;
    }
  }

  private static getStadiumTimeZone(stadiumId: string) {
    return this.stadiums[stadiumId]?.timeZone ?? null;
  }

  private static parseApiLocalDate({ value, timeZone }: { value: string; timeZone: string }) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(value.trim());

    if (!match) {
      return null;
    }

    const [, month, day, year, hour, minute] = match;

    if (!month || !day || !year || !hour || !minute) {
      return null;
    }

    return this.zonedTimeToDate({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      timeZone,
    });
  }

  private static zonedTimeToDate({
    year,
    month,
    day,
    hour,
    minute,
    timeZone,
  }: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    timeZone: string;
  }) {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    const firstOffset = this.getTimeZoneOffsetMs(timeZone, utcGuess);
    const firstPass = new Date(utcGuess.getTime() - firstOffset);
    const correctedOffset = this.getTimeZoneOffsetMs(timeZone, firstPass);

    return new Date(utcGuess.getTime() - correctedOffset);
  }

  private static getTimeZoneOffsetMs(timeZone: string, date: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return (
      Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second),
      ) - date.getTime()
    );
  }
}
