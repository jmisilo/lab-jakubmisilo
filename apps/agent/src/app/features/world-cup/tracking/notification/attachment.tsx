import type { WorldCupDetectedEvent, WorldCupEventPayload } from '@/app/features/world-cup/types';
import type { Attachment as ChatAttachment } from 'chat';
import type { CSSProperties, FC } from 'react';

import { Attachment, Column, Heading, Row, Section, Spacer, Text } from '@message-ui/components';

import {
  loadEmojiImageDataUrl,
  renderWorldCupAttachmentToPng,
} from '@/app/features/world-cup/tracking/notification/renderer';

const ATTACHMENT_WIDTH = 720;
const KICKOFF_ATTACHMENT_HEIGHT = 312;
const GAME_END_ATTACHMENT_BASE_HEIGHT = 312;
const SCORER_ROW_HEIGHT = 24;
const ATTACHMENT_SCALE = 2;

type SupportedAttachmentEvent = Extract<WorldCupDetectedEvent['eventType'], 'kickoff' | 'game-end'>;

type AttachmentPayload = WorldCupEventPayload & {
  eventType: SupportedAttachmentEvent;
};

type WorldCupNotificationAttachmentProps = {
  payload: AttachmentPayload;
};

type TeamColumnProps = {
  align: 'left' | 'right';
  team: AttachmentPayload['homeTeam'];
};

type ScoreboardProps = {
  payload: AttachmentPayload;
};

type ScorerListsProps = {
  awayScorers: ScorerDisplay[];
  homeScorers: ScorerDisplay[];
};

const palette = {
  background: '#ffffff',
  shell: '#f8f8f8',
  card: '#ffffff',
  border: '#f2f2f2',
  borderStrong: '#e4e4e7',
  primary: '#18181b',
  secondary: '#333333',
  muted: '#959595',
  subtle: '#a1a1aa',
  black: '#000000',
  success: '#52B371',
};

export class WorldCupNotificationAttachmentService {
  static async createAttachment(event: WorldCupDetectedEvent): Promise<ChatAttachment | null> {
    if (!this.#isSupportedEvent(event)) {
      return null;
    }

    const attachmentHeight = getAttachmentHeight(event.payload);
    const graphemeImages = await getAttachmentGraphemeImages(event.payload);

    const data = await renderWorldCupAttachmentToPng(
      <WorldCupNotificationAttachment payload={event.payload} />,
      {
        graphemeImages,
        width: ATTACHMENT_WIDTH,
        height: attachmentHeight,
        scale: ATTACHMENT_SCALE,
      },
    );

    return {
      data,
      height: attachmentHeight * ATTACHMENT_SCALE,
      mimeType: 'image/png',
      name: `world-cup-2026-${event.payload.eventType}-${event.gameId}.png`,
      type: 'image',
      width: ATTACHMENT_WIDTH * ATTACHMENT_SCALE,
    };
  }

  static #isSupportedEvent(
    event: WorldCupDetectedEvent,
  ): event is WorldCupDetectedEvent & { payload: AttachmentPayload } {
    return event.eventType === 'kickoff' || event.eventType === 'game-end';
  }
}

const WorldCupNotificationAttachment: FC<WorldCupNotificationAttachmentProps> = ({ payload }) => {
  const isFinal = payload.eventType === 'game-end';
  const homeScorers = parseScorers(payload.homeTeam.scorers);
  const awayScorers = parseScorers(payload.awayTeam.scorers);
  const hasScorers = isFinal && (homeScorers.length > 0 || awayScorers.length > 0);

  return (
    <Attachment style={styles.root}>
      <Section style={styles.shell}>
        <Section style={styles.card}>
          <Spacer height={26} />

          <Heading level={1} style={styles.title}>
            {isFinal ? 'Final score' : 'Kickoff'}
          </Heading>

          <Spacer height={32} />

          <Row style={styles.scoreRow}>
            <TeamColumn team={payload.homeTeam} align="left" />

            <Scoreboard payload={payload} />

            <TeamColumn team={payload.awayTeam} align="right" />
          </Row>

          {hasScorers ? <ScorerLists homeScorers={homeScorers} awayScorers={awayScorers} /> : null}
        </Section>
      </Section>
    </Attachment>
  );
};

const TeamColumn: FC<TeamColumnProps> = ({ align, team }) => {
  const alignedRight = align === 'right';

  return (
    <Column style={{ ...styles.teamColumn, alignItems: alignedRight ? 'flex-end' : 'flex-start' }}>
      <Text style={team.flagEmoji ? styles.teamFlag : styles.teamFlagCode}>
        {team.flagEmoji ?? team.fifaCode ?? 'TBD'}
      </Text>
      <Spacer height={12} />
      <Text style={{ ...styles.teamName, textAlign: alignedRight ? 'right' : 'left' }}>
        {formatTeamName(team.name)}
      </Text>
    </Column>
  );
};

const Scoreboard: FC<ScoreboardProps> = ({ payload }) => {
  return (
    <Row style={styles.scoreBox}>
      <Text style={styles.score}>{payload.homeTeam.score}</Text>
      <Text style={styles.scoreSeparator}>-</Text>
      <Text style={styles.score}>{payload.awayTeam.score}</Text>
    </Row>
  );
};

const ScorerLists: FC<ScorerListsProps> = ({ awayScorers, homeScorers }) => {
  return (
    <div style={styles.scorersGrid}>
      <div style={styles.homeScorersColumn}>
        {homeScorers.map((scorer) => (
          <div key={`${scorer.minute}-${scorer.name}`} style={styles.homeScorerLine}>
            <Text style={styles.goalIcon}>⚽️</Text>
            <Text style={styles.scorerMinute}>{formatScorerMinute(scorer)}</Text>
            <Text style={styles.scorerName}>{scorer.name}</Text>
          </div>
        ))}
      </div>

      <div style={styles.awayScorersColumn}>
        {awayScorers.map((scorer) => (
          <div key={`${scorer.minute}-${scorer.name}`} style={styles.awayScorerLine}>
            <Text style={styles.scorerName}>{scorer.name}</Text>
            <Text style={styles.scorerMinute}>{formatScorerMinute(scorer)}</Text>
            <Text style={styles.goalIcon}>⚽️</Text>
          </div>
        ))}
      </div>
    </div>
  );
};

const getAttachmentHeight = (payload: AttachmentPayload) => {
  if (payload.eventType !== 'game-end') {
    return KICKOFF_ATTACHMENT_HEIGHT;
  }

  const scorerRowCount = Math.max(
    parseScorers(payload.homeTeam.scorers).length,
    parseScorers(payload.awayTeam.scorers).length,
  );

  if (scorerRowCount === 0) {
    return KICKOFF_ATTACHMENT_HEIGHT;
  }

  return GAME_END_ATTACHMENT_BASE_HEIGHT + scorerRowCount * SCORER_ROW_HEIGHT;
};

const formatTeamName = (name: string) => {
  const replacements: Record<string, string> = {
    'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
    'Democratic Republic of the Congo': 'DR Congo',
    'United States': 'United States',
  };

  return replacements[name] ?? name;
};

const formatScorerMinute = (scorer: ScorerDisplay) => {
  return scorer.minute ? `${scorer.minute}'` : '';
};

const parseScorers = (value: string): ScorerDisplay[] => {
  return parseScorerEntries(value).map(parseScorerEntry);
};

const parseScorerEntries = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed || trimmed.toLowerCase() === 'null') {
    return [];
  }

  const quotedEntries = [...trimmed.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]?.trim())
    .filter((entry): entry is string => Boolean(entry));

  if (quotedEntries.length > 0) {
    return quotedEntries;
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseScorerEntry = (entry: string): ScorerDisplay => {
  const trailingMinuteMatch = /^(?<name>.+?)\s+(?<minute>\d{1,3}(?:\+\d{1,2})?)['’]?$/.exec(entry);

  if (trailingMinuteMatch?.groups?.name && trailingMinuteMatch.groups.minute) {
    return {
      name: trailingMinuteMatch.groups.name.trim(),
      minute: trailingMinuteMatch.groups.minute,
    };
  }

  const leadingMinuteMatch = /^(?<minute>\d{1,3}(?:\+\d{1,2})?)['’]?\s+(?<name>.+)$/.exec(entry);

  if (leadingMinuteMatch?.groups?.name && leadingMinuteMatch.groups.minute) {
    return {
      name: leadingMinuteMatch.groups.name.trim(),
      minute: leadingMinuteMatch.groups.minute,
    };
  }

  return { name: entry };
};

const getAttachmentGraphemeImages = async (payload: AttachmentPayload) => {
  const emojis = new Set(
    [payload.homeTeam.flagEmoji, payload.awayTeam.flagEmoji, '⚽', '⚽️'].filter(
      (emoji): emoji is string => Boolean(emoji),
    ),
  );

  const entries = await Promise.all(
    [...emojis].map(async (emoji) => [emoji, await loadEmojiImageDataUrl(emoji)] as const),
  );

  return Object.fromEntries(entries);
};

const styles = {
  root: {
    backgroundColor: palette.background,
    fontFamily: 'Inter',
    height: '100%',
    padding: 22,
    width: '100%',
  },
  shell: {
    backgroundColor: palette.shell,
    borderColor: palette.border,
    borderRadius: 26,
    borderStyle: 'solid',
    borderWidth: 1,
    height: '100%',
    padding: 4,
    width: '100%',
  },
  card: {
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderRadius: 24,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0px 8px 8px rgba(0,0,0,0.02)',
    height: '100%',
    padding: '30px 32px 42px',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  eventPill: {
    alignItems: 'center',
    backgroundColor: palette.card,
    borderColor: '#f1f1f1',
    borderRadius: 999,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow:
      '0px 5px 3px rgba(0,0,0,0.02),0px 2px 2px rgba(0,0,0,0.03),0px 1px 1px rgba(0,0,0,0.03)',
    gap: 8,
    padding: '8px 12px',
  },
  statusDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  eventText: {
    color: palette.black,
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1,
  },
  kicker: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: 500,
  },
  title: {
    color: palette.primary,
    fontFamily: 'Inter',
    fontSize: 34,
    fontWeight: 500,
    letterSpacing: -1,
    lineHeight: 1.06,
  },
  subtitle: {
    color: palette.muted,
    fontSize: 16,
    fontWeight: 400,
  },
  scoreRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  teamColumn: {
    flex: '0 0 190px',
    width: 190,
  },
  teamFlag: {
    color: palette.primary,
    fontSize: 48,
    fontWeight: 500,
    lineHeight: 1,
  },
  teamFlagCode: {
    color: palette.primary,
    fontSize: 20,
    fontWeight: 500,
    lineHeight: 1,
  },
  teamName: {
    color: palette.secondary,
    fontSize: 24,
    fontWeight: 500,
    lineHeight: 1.08,
  },
  scoreBox: {
    alignItems: 'center',
    backgroundColor: palette.shell,
    borderColor: palette.border,
    borderRadius: 24,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.7)',
    justifyContent: 'center',
    padding: '16px 28px',
  },
  score: {
    color: palette.black,
    fontSize: 58,
    fontWeight: 500,
    lineHeight: 1,
  },
  scoreSeparator: {
    color: palette.muted,
    fontSize: 36,
    fontWeight: 400,
    lineHeight: 1,
    marginLeft: 14,
    marginRight: 14,
  },
  scorersGrid: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    width: '100%',
  },
  homeScorersColumn: {
    display: 'flex',
    flexDirection: 'column',
    width: 260,
  },
  awayScorersColumn: {
    alignItems: 'flex-end',
    display: 'flex',
    flexDirection: 'column',
    width: 260,
  },
  homeScorerLine: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'row',
    gap: 6,
    height: SCORER_ROW_HEIGHT,
    justifyContent: 'flex-start',
    width: '100%',
  },
  awayScorerLine: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'row',
    gap: 6,
    height: SCORER_ROW_HEIGHT,
    justifyContent: 'flex-end',
    width: '100%',
  },
  goalIcon: {
    color: palette.secondary,
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1,
  },
  scorerMinute: {
    color: palette.secondary,
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1,
  },
  scorerName: {
    color: palette.secondary,
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1,
  },
  metaPanel: {
    backgroundColor: palette.shell,
    borderColor: palette.border,
    borderRadius: 20,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: '14px 16px',
    width: '100%',
  },
  metaRow: {
    justifyContent: 'space-between',
    width: '100%',
  },
  metaDivider: {
    backgroundColor: palette.border,
    height: 1,
    marginBottom: 10,
    marginTop: 10,
    width: '100%',
  },
  metaLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: 400,
  },
  metaValue: {
    color: palette.secondary,
    fontSize: 14,
    fontWeight: 500,
  },
} satisfies Record<string, CSSProperties>;

type ScorerDisplay = {
  name: string;
  minute?: string;
};
