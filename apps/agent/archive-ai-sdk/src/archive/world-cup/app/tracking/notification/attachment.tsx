import type { WorldCupDetectedEvent, WorldCupEventPayload } from '@/archive/world-cup/app/types';
import type { Attachment as ChatAttachment } from 'chat';
import type { CSSProperties, FC } from 'react';

import { Attachment, Column, Heading, Row, Section, Spacer, Text } from '@message-ui/components';

import {
  loadEmojiImageDataUrl,
  renderWorldCupAttachmentToPng,
} from '@/archive/world-cup/app/tracking/notification/renderer';

const ATTACHMENT_WIDTH = 720;
const KICKOFF_ATTACHMENT_HEIGHT = 312;
const GAME_END_ATTACHMENT_BASE_HEIGHT = 312;
const SCORER_ROW_HEIGHT = 24;
const ATTACHMENT_SCALE = 2;

type SupportedAttachmentEvent = Extract<WorldCupDetectedEvent['eventType'], 'kickoff' | 'game-end'>;

type AttachmentPayload = WorldCupEventPayload & {
  eventType: SupportedAttachmentEvent;
};

type ScorerEntry = {
  minute?: string;
  name: string;
};

type WorldCupNotificationAttachmentProps = {
  payload: AttachmentPayload;
};

type TeamColumnProps = {
  align: 'left' | 'right';
  scorers: ScorerEntry[];
  team: AttachmentPayload['homeTeam'];
};

type ScoreboardProps = {
  payload: AttachmentPayload;
};

type ScorerListProps = {
  align: 'left' | 'right';
  scorers: ScorerEntry[];
};

const palette = {
  background: '#ffffff',
  shell: '#f8f8f8',
  card: '#ffffff',
  border: '#f2f2f2',
  primary: '#18181b',
  secondary: '#333333',
  muted: '#959595',
  black: '#000000',
};

export class WorldCupNotificationAttachmentService {
  static async createAttachment(event: WorldCupDetectedEvent): Promise<ChatAttachment | null> {
    if (!this.#isSupportedEvent(event)) {
      return null;
    }

    const height = getAttachmentHeight(event.payload);
    const graphemeImages = await getGraphemeImages(event.payload);
    const data = await renderWorldCupAttachmentToPng(
      <WorldCupNotificationAttachment payload={event.payload} />,
      {
        graphemeImages,
        width: ATTACHMENT_WIDTH,
        height,
        scale: ATTACHMENT_SCALE,
      },
    );

    return {
      data,
      height: height * ATTACHMENT_SCALE,
      mimeType: 'image/png',
      name: `world-cup-2026-${event.payload.eventType}-${event.gameId}.png`,
      size: data.byteLength,
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
  const homeScorers = isFinal ? parseScorerEntries(payload.homeTeam.scorers) : [];
  const awayScorers = isFinal ? parseScorerEntries(payload.awayTeam.scorers) : [];

  return (
    <Attachment style={styles.root}>
      <Section style={styles.shell}>
        <Section style={styles.card}>
          <Heading level={1} style={styles.title}>
            {isFinal ? 'Final score' : 'Kickoff'}
          </Heading>

          <Spacer height={28} />

          <Row style={styles.scoreRow}>
            <TeamColumn team={payload.homeTeam} scorers={homeScorers} align="left" />
            <Scoreboard payload={payload} />
            <TeamColumn team={payload.awayTeam} scorers={awayScorers} align="right" />
          </Row>
        </Section>
      </Section>
    </Attachment>
  );
};

const TeamColumn: FC<TeamColumnProps> = ({ align, scorers, team }) => {
  const alignedRight = align === 'right';

  return (
    <Column style={{ ...styles.teamColumn, alignItems: alignedRight ? 'flex-end' : 'flex-start' }}>
      <Text style={styles.flag}>{team.flagEmoji ?? team.fifaCode ?? 'TBD'}</Text>
      <Spacer height={10} />
      <Text style={{ ...styles.teamName, textAlign: alignedRight ? 'right' : 'left' }}>
        {formatTeamName(team.name)}
      </Text>
      {scorers.length > 0 && <ScorerList scorers={scorers} align={align} />}
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

const ScorerList: FC<ScorerListProps> = ({ align, scorers }) => {
  const alignedRight = align === 'right';

  return (
    <div
      style={{
        ...styles.scorerLane,
        ...(alignedRight ? styles.awayScorerLane : styles.homeScorerLane),
        alignItems: alignedRight ? 'flex-end' : 'flex-start',
      }}
    >
      {scorers.map((scorer, index) => (
        <div
          key={`${scorer.name}-${scorer.minute ?? index}`}
          style={{
            ...styles.scorerRow,
            ...(alignedRight ? styles.awayScorerRow : styles.homeScorerRow),
          }}
        >
          {align === 'left' ? (
            <>
              <div style={styles.homeScorerBall}>⚽️</div>
              <div style={styles.homeScorerText}>{formatHomeScorerText(scorer)}</div>
            </>
          ) : (
            <>
              <div style={styles.awayScorerText}>{formatAwayScorerText(scorer)}</div>
              <div style={styles.awayScorerBall}>⚽️</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

const getAttachmentHeight = (payload: AttachmentPayload) => {
  if (payload.eventType === 'kickoff') {
    return KICKOFF_ATTACHMENT_HEIGHT;
  }

  const scorerCount = Math.max(
    parseScorerEntries(payload.homeTeam.scorers).length,
    parseScorerEntries(payload.awayTeam.scorers).length,
  );

  if (scorerCount === 0) {
    return GAME_END_ATTACHMENT_BASE_HEIGHT;
  }

  return GAME_END_ATTACHMENT_BASE_HEIGHT + 24 + scorerCount * SCORER_ROW_HEIGHT;
};

const getGraphemeImages = async (payload: AttachmentPayload) => {
  const emojis = new Set(
    [payload.homeTeam.flagEmoji, payload.awayTeam.flagEmoji, '⚽️'].filter(
      (emoji): emoji is string => Boolean(emoji),
    ),
  );
  const entries = await Promise.all(
    [...emojis].map(async (emoji) => [emoji, await loadEmojiImageDataUrl(emoji)] as const),
  );

  return Object.fromEntries(entries);
};

const formatTeamName = (name: string) => {
  const replacements: Record<string, string> = {
    'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
    'Democratic Republic of the Congo': 'DR Congo',
  };

  return replacements[name] ?? name;
};

const parseScorerEntries = (value: string): ScorerEntry[] => {
  const trimmed = value.trim();

  if (!trimmed || trimmed.toLowerCase() === 'null') {
    return [];
  }

  const quotedEntries = [...trimmed.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]?.trim())
    .filter((entry): entry is string => Boolean(entry));
  const entries =
    quotedEntries.length > 0
      ? quotedEntries
      : trimmed
          .replace(/^[{[]/, '')
          .replace(/[}\]]$/, '')
          .split(/[;,]/)
          .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);

  return entries.map(parseScorerEntry);
};

const parseScorerEntry = (entry: string): ScorerEntry => {
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

const formatHomeScorerText = (scorer: ScorerEntry) => {
  const minute = scorer.minute ? `${scorer.minute}'` : null;

  return [minute, scorer.name].filter(Boolean).join(' ');
};

const formatAwayScorerText = (scorer: ScorerEntry) => {
  const minute = scorer.minute ? `${scorer.minute}'` : null;

  return [scorer.name, minute].filter(Boolean).join(' ');
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
  title: {
    color: palette.primary,
    fontFamily: 'Inter',
    fontSize: 34,
    fontWeight: 500,
    letterSpacing: -1,
    lineHeight: 1.06,
  },
  scoreRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  teamColumn: {
    position: 'relative',
    width: 190,
  },
  flag: {
    color: palette.black,
    fontSize: 40,
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
  scorerLane: {
    alignItems: 'flex-start',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    position: 'absolute',
    top: 94,
    width: 190,
  },
  homeScorerLane: {
    left: 0,
  },
  awayScorerLane: {
    right: 0,
  },
  scorerRow: {
    alignItems: 'center',
    color: palette.secondary,
    display: 'flex',
    flexDirection: 'row',
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: 500,
    height: SCORER_ROW_HEIGHT,
    lineHeight: 1,
    width: '100%',
  },
  homeScorerRow: {
    textAlign: 'left',
  },
  awayScorerRow: {
    justifyContent: 'flex-end',
    textAlign: 'right',
  },
  homeScorerBall: {
    color: palette.black,
    display: 'flex',
    fontFamily: 'Inter',
    fontSize: 14,
    lineHeight: 1,
    marginRight: 6,
    width: 18,
  },
  awayScorerBall: {
    color: palette.black,
    display: 'flex',
    fontFamily: 'Inter',
    fontSize: 14,
    justifyContent: 'flex-end',
    lineHeight: 1,
    marginLeft: 6,
    width: 18,
  },
  homeScorerText: {
    color: palette.secondary,
    display: 'flex',
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1,
    textAlign: 'left',
    width: 166,
  },
  awayScorerText: {
    color: palette.secondary,
    display: 'flex',
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: 500,
    justifyContent: 'flex-end',
    lineHeight: 1,
    textAlign: 'right',
    width: 166,
  },
} satisfies Record<string, CSSProperties>;
