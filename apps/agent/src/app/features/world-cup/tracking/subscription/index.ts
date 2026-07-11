import type { WorldCupTeam } from '@/app/features/world-cup/teams';
import type {
  WorldCupDetectedEvent,
  WorldCupEventType,
  WorldCupTrackingMode,
} from '@/app/features/world-cup/types';
import type { WorldCupSubscription } from '@/infrastructure/db/services/world-cup';

import { WORLD_CUP_TEAMS, WorldCupTeamRegistry } from '@/app/features/world-cup/teams';
import { WORLD_CUP_EVENT_TYPES } from '@/app/features/world-cup/types';
import { WorldCupDbService } from '@/infrastructure/db/services/world-cup';

export class WorldCupSubscriptionService {
  static async subscribe({
    identityId,
    threadId,
    sourceMessageId,
    trackingMode,
    teamCodes,
    eventTypes,
  }: {
    identityId: string;
    threadId: string;
    sourceMessageId?: string;
    trackingMode: WorldCupTrackingMode;
    teamCodes?: string[];
    eventTypes: WorldCupEventType[];
  }) {
    const normalizedEventTypes = this.#normalizeEventTypes(eventTypes);
    const resolvedTeams = this.#resolveTrackedTeams({
      trackingMode,
      teamCodes,
    });

    if (!resolvedTeams.ok) {
      return resolvedTeams;
    }

    if (trackingMode === 'all_teams') {
      await WorldCupDbService.deactivateMatchingSubscriptions({
        identityId,
        threadId,
        scope: 'team',
      });
    }

    const subscriptions: WorldCupSubscription[] = [];

    for (const team of resolvedTeams.teams) {
      if (trackingMode !== 'all_teams') {
        await WorldCupDbService.deactivateMatchingSubscriptions({
          identityId,
          threadId,
          scope: 'team',
          teamId: team.id,
        });
      }

      const subscription = await WorldCupDbService.createSubscription({
        identityId,
        threadId,
        scope: 'team',
        teamId: team.id,
        teamName: team.name,
        eventTypes: normalizedEventTypes,
        active: true,
        sourceMessageId,
        updatedAt: new Date(),
      });

      if (subscription) {
        subscriptions.push(subscription);
      }
    }

    return {
      ok: true as const,
      subscriptions,
      message: this.#describeSubscription({
        trackingMode,
        teams: resolvedTeams.teams,
        eventTypes: normalizedEventTypes,
      }),
    };
  }

  static async unsubscribe({
    identityId,
    threadId,
    trackingMode,
    teamCodes,
  }: {
    identityId: string;
    threadId: string;
    trackingMode: WorldCupTrackingMode;
    teamCodes?: string[];
  }) {
    const resolvedTeams = this.#resolveTrackedTeams({
      trackingMode,
      teamCodes,
    });

    if (!resolvedTeams.ok) {
      return resolvedTeams;
    }

    if (trackingMode === 'all_teams') {
      const deactivatedCount = await WorldCupDbService.deactivateMatchingSubscriptions({
        identityId,
        threadId,
        scope: 'team',
      });

      return { ok: true as const, deactivatedCount };
    }

    let deactivatedCount = 0;

    for (const team of resolvedTeams.teams) {
      deactivatedCount += await WorldCupDbService.deactivateMatchingSubscriptions({
        identityId,
        threadId,
        scope: 'team',
        teamId: team.id,
      });
    }

    return { ok: true as const, deactivatedCount };
  }

  static async listTrackedSubscriptions({
    identityId,
    threadId,
  }: {
    identityId: string;
    threadId: string;
  }) {
    const subscriptions = await WorldCupDbService.getActiveSubscriptionsForThread({
      identityId,
      threadId,
    });
    const trackedSubscriptions = subscriptions.map((subscription) =>
      this.#toTrackedSubscription(subscription),
    );

    return {
      ok: true as const,
      subscriptions: trackedSubscriptions,
      message: this.#describeTrackedSubscriptions(trackedSubscriptions),
      summaryMarkdown: this.#renderTrackedSubscriptions(trackedSubscriptions),
    };
  }

  static async findNotificationTargets(event: WorldCupDetectedEvent) {
    /**
     * @note Current fanout loads active subscriptions and filters in memory. This is fine for
     * current personal-agent scale (hundreds of subscriptions), but should move matching into SQL
     * and batch delivery if usage grows.
     */
    const subscriptions = await WorldCupDbService.getActiveSubscriptions();
    const matchingSubscriptions = subscriptions.filter((subscription) =>
      WorldCupSubscriptionService.subscriptionMatchesEvent(subscription, event),
    );
    const targets = new Map<string, WorldCupNotificationTarget>();

    for (const subscription of matchingSubscriptions) {
      const targetKey = `${subscription.identityId}:${subscription.threadId}`;

      if (!targets.has(targetKey)) {
        targets.set(targetKey, {
          identityId: subscription.identityId,
          threadId: subscription.threadId,
          subscriptionId: subscription.id,
        });
      }
    }

    return [...targets.values()];
  }

  static subscriptionMatchesEvent(
    subscription: Pick<WorldCupSubscription, 'eventTypes' | 'teamId'>,
    event: WorldCupDetectedEvent,
  ) {
    if (!subscription.eventTypes.includes(this.#toSubscriptionEventType(event.eventType))) {
      return false;
    }

    if (!subscription.teamId) {
      return false;
    }

    return (
      event.payload.homeTeam.id === subscription.teamId ||
      event.payload.awayTeam.id === subscription.teamId
    );
  }

  static #toSubscriptionEventType(eventType: WorldCupDetectedEvent['eventType']) {
    return eventType === 'kickoff-reminder' ? 'kickoff' : eventType;
  }

  static #normalizeEventTypes(eventTypes: readonly string[]) {
    const allowedEventTypes = new Set<string>(WORLD_CUP_EVENT_TYPES);
    const knownEventTypes = eventTypes.filter((eventType): eventType is WorldCupEventType =>
      allowedEventTypes.has(eventType),
    );
    const values = knownEventTypes.length > 0 ? knownEventTypes : [...WORLD_CUP_EVENT_TYPES];

    return [...new Set(values)];
  }

  static #toTrackedSubscription(subscription: WorldCupSubscription) {
    const team = subscription.teamId
      ? WorldCupTeamRegistry.getById(subscription.teamId)
      : undefined;
    const teamName = team?.name ?? subscription.teamName ?? 'Unknown team';

    return {
      subscriptionId: subscription.id,
      teamId: subscription.teamId,
      teamName,
      fifaCode: team?.fifaCode,
      flagEmoji: subscription.teamId
        ? WorldCupTeamRegistry.getFlagEmojiById(subscription.teamId)
        : undefined,
      eventTypes: this.#normalizeEventTypes(subscription.eventTypes),
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
  }

  static #resolveTrackedTeams({
    trackingMode,
    teamCodes,
  }: {
    trackingMode: WorldCupTrackingMode;
    teamCodes?: string[];
  }) {
    if (trackingMode === 'all_teams') {
      return { ok: true as const, teams: [...WORLD_CUP_TEAMS] };
    }

    const requestedTeamCodes = [
      ...new Set((teamCodes ?? []).map((teamCode) => teamCode.trim().toUpperCase())),
    ].filter(Boolean);

    if (requestedTeamCodes.length === 0) {
      return {
        ok: false as const,
        reason: 'missing_team',
        message: 'At least one three-letter FIFA team code is required for team subscriptions.',
      };
    }

    if (trackingMode === 'team' && requestedTeamCodes.length !== 1) {
      return {
        ok: false as const,
        reason: 'too_many_teams',
        message: 'Use trackingMode "teams" when subscribing to multiple World Cup teams.',
      };
    }

    const teams = new Map<string, WorldCupTeam>();

    for (const teamCode of requestedTeamCodes) {
      const team = WorldCupTeamRegistry.getByFifaCode(teamCode);

      if (!team) {
        return {
          ok: false as const,
          reason: 'unknown_team',
          message: `I could not find FIFA code "${teamCode}" in the World Cup team list.`,
        };
      }

      teams.set(team.id, team);
    }

    return { ok: true as const, teams: [...teams.values()] };
  }

  static #describeSubscription({
    trackingMode,
    teams,
    eventTypes,
  }: {
    trackingMode: WorldCupTrackingMode;
    teams: readonly WorldCupTeam[];
    eventTypes: WorldCupEventType[];
  }) {
    const events = eventTypes.map((eventType) => eventType.replace('-', ' ')).join(', ');

    if (trackingMode === 'all_teams') {
      return `Subscribed to ${events} for all ${teams.length} World Cup teams.`;
    }

    const teamLabels = teams.map((team) => team.name).join(', ');

    return `Subscribed to ${events} for ${teamLabels} World Cup matches.`;
  }

  static #describeTrackedSubscriptions(subscriptions: WorldCupTrackedSubscription[]) {
    if (subscriptions.length === 0) {
      return 'No active World Cup tracking subscriptions for this chat.';
    }

    return `Tracking ${subscriptions.length} active World Cup subscription(s) for this chat.`;
  }

  static #renderTrackedSubscriptions(subscriptions: WorldCupTrackedSubscription[]) {
    if (subscriptions.length === 0) {
      return 'No active World Cup tracking subscriptions for this chat.';
    }

    const lines = subscriptions.map((subscription) => {
      const teamLabel = [
        subscription.flagEmoji,
        subscription.teamName,
        subscription.fifaCode ? `(${subscription.fifaCode})` : undefined,
      ]
        .filter(Boolean)
        .join(' ');
      const eventLabels = subscription.eventTypes
        .map((eventType) => eventType.replace('-', ' '))
        .join(', ');

      return `- ${teamLabel}: ${eventLabels}`;
    });

    return ['Active World Cup tracking:', ...lines].join('\n');
  }
}

type WorldCupNotificationTarget = {
  identityId: string;
  threadId: string;
  subscriptionId: string;
};

type WorldCupTrackedSubscription = {
  subscriptionId: string;
  teamId: string | null;
  teamName: string;
  fifaCode?: string;
  flagEmoji?: string;
  eventTypes: WorldCupEventType[];
  createdAt: Date;
  updatedAt: Date;
};
