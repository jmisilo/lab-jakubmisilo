import type { ScheduledTaskSideEffect } from '@/app/schedules/types';
import type { AgentScheduledTask } from '@/types';
import type { Tool } from 'ai';
import type { z } from 'zod';

import { tool } from 'ai';
import dedent from 'dedent';

import { AgentScheduleService } from '@/app/schedules';
import {
  ManageScheduleToolContextSchema,
  ManageScheduleToolInputSchema,
  ManageScheduleToolOutputSchema,
} from '@/app/schedules/schemas';
import { ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

const PROMPT_PREVIEW_CHARACTER_LIMIT = 500;

export const manageScheduleTool: ManageScheduleTool = tool({
  description: dedent`
    Create, list, update, complete a pending occurrence, pause, resume, or cancel scheduled AI tasks for the current user and chat thread.

    # Core Behavior
    - A scheduled task stores a durable prompt.
    - When due, QStash calls the schedule execution endpoint; the agent executes the prompt and sends the result to this thread.
    - Use this for reminders, recurring nudges, recurring reports, background web-search reports, and periodic assistant tasks.
    - Current limits: 10 active one-time schedules and 10 active recurring schedules per user.
    - Current QStash plan: free. One-time schedules can be created at most 7 days ahead.
    - Recurring schedules must not run more often than once per hour. The current recurrence schema supports daily, weekdays, and weekly schedules.
    - An action is confirmed only when this tool returns ok=true. If ok=false, do not imply it succeeded.

    # When To Use
    - The user asks to remind, notify, ping, send a future message, run a background task, or create a recurring report.
    - The user asks to do something at a future time or on a repeating cadence.
    - Reminder-only wording such as "remind me about tennis at 19:00" or "ping me to leave for the dentist"; do not create a Calendar event unless the user also asks to block time or save an event.
    - Requests that combine an event and reminder, such as "I have tennis at 19:00, remind me 30 minutes before"; use this tool for the reminder and Calendar tools for the event when event details are clear.
    - The user asks what tasks/reminders are scheduled.
    - The user asks to cancel, edit, move, reschedule, pause, or resume one.
    - The user clearly reports that the exact pending reminder outcome is already done, so that occurrence is no longer useful.
    - If the user identifies a task naturally ("the 9am one", "the shopping reminder"), call list first when the task id is not already visible in context.

    # When Not To Use
    - The user wants a time block or event represented on Google Calendar; use Calendar tools.
    - The user wants an immediate answer or immediate web search.
    - The requested time is ambiguous enough that the wrong schedule would be harmful; ask a brief clarification.

    # Occurrence Completion Safety
    - Use complete_occurrence only for explicit completion language such as "done", "I took them", "already handled", or "I bought it".
    - Do not use it for intentions, future plans, questions, negated completion, habits, or historical completion unrelated to the pending occurrence.
    - Resolve the exact active task first. If more than one task plausibly matches, ask which one instead of calling complete_occurrence.
    - For recurring tasks, complete_occurrence suppresses only today's pending occurrence and keeps future recurrence active.
    - Never use cancel when the user completed only the current occurrence of a recurring task.

    # Time Rules
    - Use the user's timezone from runtime context unless durable knowledge clearly says another timezone should be used.
    - Resolve relative dates/times before calling this tool. Prefer a future ISO datetime with an explicit offset, for example "2026-07-06T19:00:00+02:00".
    - If runAt has no offset, it is interpreted as local wall-clock time in schedule.timeZone. Always set schedule.timeZone from runtime context or durable knowledge.
    - If a time has already passed today, ask whether the user meant tomorrow unless the intent is clear.
    - For recurring tasks without a time, choose a sensible time based on task context and user preferences. Use 09:00 as the neutral fallback.
    - For "work day" or "business day", use weekday recurrence.
    - For "every Monday and Friday", use weekly recurrence with monday/friday.
    - After ok=true, acknowledge the schedule using task.scheduleSummary and a short natural sentence.

    # Prompt Rules
    - The prompt must be the exact durable instruction for the future subagent, not just the user's raw words.
    - For reminders, write a prompt that asks the subagent to send a short natural reminder.
    - For reports, include what to research, what tools to use when useful, desired format, and concise output expectations.
    - Scheduled executions can read Calendar context by default, but Calendar writes require explicit allowedSideEffects.
    - Set allowedSideEffects to ["calendar.create"] only when the user clearly asks the future scheduled task to create Calendar events. Do not set it for reminders, reports, or normal calendar reads.
    - Do not include hidden metadata, operation IDs, database IDs, or raw tool payloads in the prompt.

    # Examples
    - "Remind me about tennis at 7pm" -> one_time, prompt "Send the user a short reminder about their tennis game."
    - "Each morning at 9 send me a todo prep message" -> recurring daily at 09:00.
    - "Every Monday and Friday remind me about shopping" -> recurring weekly monday/friday, choose a convenient time such as 08:30 if no user preference says otherwise.
    - "Each work day perform news search about latest AI things and send a report around 11am" -> recurring weekdays at 11:00, prompt instructs the subagent to search the web and send a concise AI-news report.
  `,
  inputSchema: ManageScheduleToolInputSchema,
  outputSchema: ManageScheduleToolOutputSchema,
  contextSchema: ManageScheduleToolContextSchema,
  execute: async (input, { context }) => {
    logger.info(
      {
        identityId: context.identityId,
        threadId: context.threadId,
        sourceMessageId: context.sourceMessageId,
        action: input.action,
      },
      '[AGENT_SCHEDULE]: manage tool started',
    );

    try {
      if (input.action === 'create') {
        const task = await AgentScheduleService.createTask({
          identityId: context.identityId,
          threadId: context.threadId,
          title: input.title,
          prompt: input.prompt,
          schedule: input.schedule,
          sourceMessageId: context.sourceMessageId,
          userFacingSchedule: input.userFacingSchedule,
          allowedSideEffects: input.allowedSideEffects,
        });

        if (!task) {
          return {
            ok: false,
            message: 'Scheduled task could not be created.',
          };
        }

        logger.info(
          {
            identityId: context.identityId,
            threadId: context.threadId,
            taskId: task.id,
            scheduleKind: task.scheduleKind,
            nextRunAt: task.nextRunAt,
          },
          '[AGENT_SCHEDULE]: task created',
        );

        return {
          ok: true,
          message: `Schedule confirmed: "${task.title}" is set for ${AgentScheduleService.formatTaskSchedule(task)}`,
          task: toToolTask(task),
        };
      }

      if (input.action === 'list') {
        const tasks = await AgentScheduleService.listTasks({
          identityId: context.identityId,
          threadId: context.threadId,
          includeInactive: input.includeInactive,
          limit: input.limit,
        });

        logger.info(
          {
            identityId: context.identityId,
            threadId: context.threadId,
            taskCount: tasks.length,
          },
          '[AGENT_SCHEDULE]: tasks listed',
        );

        return {
          ok: true,
          message:
            tasks.length > 0
              ? `Loaded ${tasks.length} scheduled task${tasks.length === 1 ? '' : 's'}.`
              : 'No scheduled tasks found.',
          tasks: tasks.map((task) => toToolTask(task)),
        };
      }

      if (input.action === 'update') {
        const task = await AgentScheduleService.updateTask({
          identityId: context.identityId,
          threadId: context.threadId,
          taskId: input.taskId,
          title: input.title,
          prompt: input.prompt,
          schedule: input.schedule,
          userFacingSchedule: input.userFacingSchedule,
          allowedSideEffects: input.allowedSideEffects,
        });

        logger.info(
          {
            identityId: context.identityId,
            threadId: context.threadId,
            taskId: task.id,
          },
          '[AGENT_SCHEDULE]: task updated',
        );

        return {
          ok: true,
          message: `Update confirmed: "${task.title}" is set for ${AgentScheduleService.formatTaskSchedule(task)}`,
          task: toToolTask(task),
        };
      }

      if (input.action === 'complete_occurrence') {
        const result = await AgentScheduleService.completeOccurrence({
          identityId: context.identityId,
          threadId: context.threadId,
          taskId: input.taskId,
          sourceMessageId: context.sourceMessageId,
        });
        const message =
          result.task.scheduleKind === 'recurring'
            ? `Occurrence completion confirmed: "${result.task.title}" will stay active, but its pending occurrence will not send.`
            : `Completion confirmed: "${result.task.title}" will not send.`;

        logger.info(
          {
            identityId: context.identityId,
            threadId: context.threadId,
            taskId: result.task.id,
            scheduleKind: result.task.scheduleKind,
            alreadySatisfied: result.alreadySatisfied,
          },
          '[AGENT_SCHEDULE]: occurrence completed before delivery',
        );

        return {
          ok: true,
          message,
          task: toToolTask(result.task),
        };
      }

      if (input.action === 'pause') {
        const task = await AgentScheduleService.pauseTask({
          identityId: context.identityId,
          threadId: context.threadId,
          taskId: input.taskId,
          reason: input.reason,
        });

        logger.info(
          {
            identityId: context.identityId,
            threadId: context.threadId,
            taskId: task.id,
          },
          '[AGENT_SCHEDULE]: task paused',
        );

        return {
          ok: true,
          message: `Pause confirmed: "${task.title}" is paused.`,
          task: toToolTask(task),
        };
      }

      if (input.action === 'resume') {
        const task = await AgentScheduleService.resumeTask({
          identityId: context.identityId,
          threadId: context.threadId,
          taskId: input.taskId,
        });

        logger.info(
          {
            identityId: context.identityId,
            threadId: context.threadId,
            taskId: task.id,
          },
          '[AGENT_SCHEDULE]: task resumed',
        );

        return {
          ok: true,
          message: `Resume confirmed: "${task.title}" is active again for ${AgentScheduleService.formatTaskSchedule(task)}`,
          task: toToolTask(task),
        };
      }

      const task = await AgentScheduleService.cancelTask({
        identityId: context.identityId,
        threadId: context.threadId,
        taskId: input.taskId,
        reason: input.reason,
      });

      logger.info(
        {
          identityId: context.identityId,
          threadId: context.threadId,
          taskId: task.id,
        },
        '[AGENT_SCHEDULE]: task cancelled',
      );

      return {
        ok: true,
        message: `Cancellation confirmed: "${task.title}" is cancelled.`,
        task: toToolTask(task),
      };
    } catch (error) {
      logger.error(
        {
          identityId: context.identityId,
          threadId: context.threadId,
          sourceMessageId: context.sourceMessageId,
          action: input.action,
          safeError: ErrorService.toSafeLog(error),
        },
        '[AGENT_SCHEDULE]: manage tool failed',
      );
      const failure = ErrorService.toUserFacingFailure(error, {
        fallbackCode: 'SCHEDULE_PROVIDER_ERROR',
        fallbackMessage: 'Schedule request could not be completed.',
      });

      return {
        ok: false,
        message: failure.message,
      };
    }
  },
});

function toToolTask(task: AgentScheduledTask) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    scheduleKind: task.scheduleKind,
    timeZone: task.timeZone,
    nextRunAt: task.status === 'active' ? task.nextRunAt.toISOString() : null,
    scheduleSummary: AgentScheduleService.formatTaskSchedule(task),
    promptPreview: truncateText(task.prompt, PROMPT_PREVIEW_CHARACTER_LIMIT),
    allowedSideEffects: getAllowedSideEffects(task),
  };
}

function getAllowedSideEffects(task: AgentScheduledTask): ScheduledTaskSideEffect[] | undefined {
  if (!task.metadata || typeof task.metadata !== 'object' || Array.isArray(task.metadata)) {
    return undefined;
  }

  const allowedSideEffects = (task.metadata as Record<string, unknown>).allowedSideEffects;

  if (!Array.isArray(allowedSideEffects)) {
    return undefined;
  }

  return allowedSideEffects.filter(
    (sideEffect): sideEffect is ScheduledTaskSideEffect => sideEffect === 'calendar.create',
  );
}

function truncateText(value: string, characterLimit: number) {
  if (value.length <= characterLimit) {
    return value;
  }

  return `${value.slice(0, characterLimit)}[truncated]`;
}

export type ManageScheduleTool = Tool<
  z.infer<typeof ManageScheduleToolInputSchema>,
  z.infer<typeof ManageScheduleToolOutputSchema>,
  z.infer<typeof ManageScheduleToolContextSchema>
>;
