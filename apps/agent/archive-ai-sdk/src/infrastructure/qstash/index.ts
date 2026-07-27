import { Client, Receiver, SignatureError } from '@upstash/qstash';

import { UrlComposer } from '@labjm/utilities/url-composer';

import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const QSTASH_EXECUTION_RETRIES = 3;
const QSTASH_EXECUTION_TIMEOUT_SECONDS = 60;
const QSTASH_SIGNATURE_CLOCK_TOLERANCE_SECONDS = 30;

const DAY_OF_WEEK_CRON_VALUE: Record<QStashScheduleDayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export class QStashService {
  static async verifySignedRequest(request: Request): Promise<QStashVerificationResult> {
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;

    if (!currentSigningKey || !nextSigningKey) {
      return { ok: false, reason: 'missing_configuration' };
    }

    const signature = request.headers.get('upstash-signature');

    if (!signature) {
      return { ok: false, reason: 'unauthorized' };
    }

    const body = await request.text();
    const receiver = new Receiver({
      currentSigningKey,
      nextSigningKey,
      devMode: false,
    });

    try {
      const verified = await receiver.verify({
        signature,
        body,
        url: request.url,
        clockTolerance: QSTASH_SIGNATURE_CLOCK_TOLERANCE_SECONDS,
        upstashRegion: request.headers.get('upstash-region') ?? undefined,
      });

      return verified ? { ok: true, body } : { ok: false, reason: 'unauthorized' };
    } catch (error) {
      const safeError = ErrorService.toSafeLog(error);

      if (error instanceof SignatureError) {
        logger.warn({ safeError }, '[QSTASH]: signed request authentication failed');
      } else {
        logger.error({ safeError }, '[QSTASH]: signed request verification errored');
      }

      return { ok: false, reason: 'unauthorized' };
    }
  }

  static async scheduleOneTimeTask({
    taskId,
    runAt,
    triggerVersion,
    previewSlug,
  }: ScheduleOneTimeTaskInput) {
    const response = await this.#client.publishJSON<ScheduleTaskPayload>({
      url: this.#executionUrl,
      body: {
        taskId,
        scheduleKind: 'one_time',
        scheduledFor: runAt.toISOString(),
        triggerVersion,
        previewSlug,
      },
      notBefore: Math.floor(runAt.getTime() / 1000),
      retries: QSTASH_EXECUTION_RETRIES,
      timeout: QSTASH_EXECUTION_TIMEOUT_SECONDS,
      failureCallback: this.#failureUrl,
      deduplicationId: this.#oneTimeDeduplicationId({ taskId, runAt, triggerVersion }),
      label: [
        'agent-schedule',
        'agent-schedule-one-time',
        this.#previewLabel({ scheduleKind: 'one_time', previewSlug }),
        `task-${taskId}`,
      ],
    });

    if (Array.isArray(response) || !('messageId' in response)) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_PROVIDER_ERROR,
        message: 'QStash one-time schedule response did not include a message id.',
        context: { taskId },
        retryable: true,
        userMessage: 'I could not schedule that right now.',
      });
    }

    if ('deduplicated' in response && response.deduplicated) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_PROVIDER_ERROR,
        message: 'QStash one-time schedule was deduplicated and not enqueued.',
        context: { taskId, runAt: runAt.toISOString(), triggerVersion },
        retryable: true,
        userMessage: 'I could not schedule that right now.',
      });
    }

    return response.messageId;
  }

  static async scheduleRecurringTask({
    taskId,
    recurrence,
    timeZone,
    triggerVersion,
    previewSlug,
  }: ScheduleRecurringTaskInput) {
    const scheduleId = this.getRecurringScheduleId(taskId);
    const response = await this.#client.schedules.create({
      destination: this.#executionUrl,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        taskId,
        scheduleKind: 'recurring',
        triggerVersion,
        previewSlug,
      } satisfies ScheduleTaskPayload),
      cron: this.#toCronExpression({ recurrence, timeZone }),
      retries: QSTASH_EXECUTION_RETRIES,
      timeout: QSTASH_EXECUTION_TIMEOUT_SECONDS,
      failureCallback: this.#failureUrl,
      scheduleId,
      label: this.#previewLabel({ scheduleKind: 'recurring', previewSlug }),
    });

    return response.scheduleId;
  }

  static async cancelScheduledTask({
    qstashMessageId,
    qstashScheduleId,
  }: CancelScheduledTaskInput) {
    if (qstashMessageId) {
      await this.#client.messages.cancel(qstashMessageId);
    }

    if (qstashScheduleId) {
      await this.#client.schedules.delete(qstashScheduleId);
    }
  }

  static getRecurringScheduleId(taskId: string) {
    return `agent-task-${taskId}`;
  }

  static #oneTimeDeduplicationId({
    taskId,
    runAt,
    triggerVersion,
  }: {
    taskId: string;
    runAt: Date;
    triggerVersion: string;
  }) {
    return `agent-schedule-${taskId}-${runAt.getTime()}-${triggerVersion}`;
  }

  static #previewLabel({
    scheduleKind,
    previewSlug,
  }: {
    scheduleKind: ScheduleTaskPayload['scheduleKind'];
    previewSlug: string;
  }) {
    return `agent-schedule-${scheduleKind.replace('_', '-')}-${previewSlug}`;
  }

  static get #client() {
    const token = process.env.QSTASH_TOKEN;

    if (!token) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_PROVIDER_UNAVAILABLE,
        message: 'QStash token is not configured.',
        retryable: false,
        userMessage: 'Scheduling is not configured yet.',
      });
    }

    return new Client({ token });
  }

  static get #executionUrl() {
    return this.#url('/jobs/schedules/execute');
  }

  static get #failureUrl() {
    return this.#url('/jobs/schedules/failure');
  }

  static #url(path: string) {
    return this.#urlComposer.compose({ pathSegments: [path] });
  }

  static get #urlComposer() {
    const baseUrl =
      process.env.AGENT_PUBLIC_URL ??
      process.env.VERCEL_PROJECT_PRODUCTION_URL ??
      process.env.VERCEL_URL;

    if (!baseUrl) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_PROVIDER_UNAVAILABLE,
        message: 'Agent public URL could not be resolved for QStash schedules.',
        retryable: false,
        userMessage: 'Scheduling is not configured yet.',
      });
    }

    const parsedBaseUrl = new URL(/^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`);
    const protocol = parsedBaseUrl.protocol === 'http:' ? 'http' : 'https';

    return new UrlComposer(parsedBaseUrl.host, protocol);
  }

  static #toCronExpression({
    recurrence,
    timeZone,
  }: {
    recurrence: QStashScheduleRecurrence;
    timeZone: string;
  }) {
    const [hour, minute] = recurrence.timeOfDay.split(':');

    if (!hour || !minute) {
      throw new AppError({
        code: AppErrorCode.SCHEDULE_TASK_INVALID,
        message: 'Recurring schedule has invalid time of day.',
        context: { recurrence },
        retryable: false,
      });
    }

    if (recurrence.frequency === 'daily') {
      return `CRON_TZ=${timeZone} ${Number(minute)} ${Number(hour)} * * *`;
    }

    if (recurrence.frequency === 'weekdays') {
      return `CRON_TZ=${timeZone} ${Number(minute)} ${Number(hour)} * * 1-5`;
    }

    const daysOfWeek = recurrence.daysOfWeek
      .map((day) => DAY_OF_WEEK_CRON_VALUE[day])
      .sort((left, right) => left - right)
      .join(',');

    return `CRON_TZ=${timeZone} ${Number(minute)} ${Number(hour)} * * ${daysOfWeek}`;
  }
}

type ScheduleTaskPayload = {
  taskId: string;
  scheduleKind: 'one_time' | 'recurring';
  scheduledFor?: string;
  triggerVersion: string;
  previewSlug: string;
};

type QStashScheduleDayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

type QStashScheduleRecurrence = {
  frequency: 'daily' | 'weekdays' | 'weekly';
  daysOfWeek: QStashScheduleDayOfWeek[];
  timeOfDay: string;
};

type ScheduleOneTimeTaskInput = {
  taskId: string;
  runAt: Date;
  triggerVersion: string;
  previewSlug: string;
};

type ScheduleRecurringTaskInput = {
  taskId: string;
  recurrence: QStashScheduleRecurrence;
  timeZone: string;
  triggerVersion: string;
  previewSlug: string;
};

type CancelScheduledTaskInput = {
  qstashMessageId?: string | null;
  qstashScheduleId?: string | null;
};

type QStashVerificationResult =
  | { ok: true; body: string }
  | { ok: false; reason: 'missing_configuration' | 'unauthorized' };
