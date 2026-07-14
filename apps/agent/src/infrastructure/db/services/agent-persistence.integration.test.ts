import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, dbPool } from '@/infrastructure/db/client';
import {
  agentNutritionMeals,
  agentScheduledTaskRuns,
  agentScheduledTasks,
} from '@/infrastructure/db/schema';
import { AgentNutritionDbService } from '@/infrastructure/db/services/agent-nutrition';
import { AgentScheduleDbService } from '@/infrastructure/db/services/agent-schedule';

const describeIntegration =
  process.env.AGENT_DB_INTEGRATION_TESTS === '1' ? describe : describe.skip;

describeIntegration('agent persistence integration', () => {
  const identityId = `test-persistence-${randomUUID()}`;

  afterEach(async () => {
    await Promise.all([
      db.delete(agentNutritionMeals).where(eq(agentNutritionMeals.identityId, identityId)),
      db.delete(agentScheduledTasks).where(eq(agentScheduledTasks.identityId, identityId)),
    ]);
  });

  afterAll(async () => {
    await dbPool.end();
  });

  it('finalizes a delivered schedule run without overwriting a task edited after execution started', async () => {
    const scheduledFor = new Date('2099-06-01T09:00:00.000Z');
    const claimToken = randomUUID();
    const task = await AgentScheduleDbService.createTask({
      identityId,
      threadId: 'schedule-thread',
      title: 'Morning briefing',
      prompt: 'Summarize the morning agenda.',
      scheduleKind: 'one_time',
      timeZone: 'UTC',
      nextRunAt: scheduledFor,
      metadata: { qstashTriggerVersion: 'old-trigger' },
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    expect(task).not.toBeNull();

    if (!task) {
      throw new Error('Expected a scheduled task to be created.');
    }

    const run = await AgentScheduleDbService.createTaskRun({
      taskId: task.id,
      scheduledFor,
      triggerVersion: 'old-trigger',
      claimToken,
    });

    expect(run).not.toBeNull();

    if (!run) {
      throw new Error('Expected a scheduled task run to be created.');
    }

    const editedTask = await AgentScheduleDbService.updateTask({
      identityId,
      threadId: task.threadId,
      taskId: task.id,
      prompt: 'Summarize the agenda and unread email.',
      metadata: { qstashTriggerVersion: 'replacement-trigger' },
    });

    await expect(
      AgentScheduleDbService.renewTaskRunLease({
        runId: run.id,
        taskId: task.id,
        claimToken,
        taskRevision: task.revision,
        scheduledFor,
      }),
    ).resolves.toBe(false);

    const outcome = await AgentScheduleDbService.finishSuccessfulTaskRun({
      task,
      runId: run.id,
      claimToken,
      output: 'Your briefing is ready.',
      ranAt: new Date('2099-06-01T09:00:01.000Z'),
    });

    expect(outcome).toEqual({ taskUpdated: false });

    await expect(
      AgentScheduleDbService.getTaskRunByScheduledFor({
        taskId: task.id,
        scheduledFor,
        triggerVersion: 'old-trigger',
      }),
    ).resolves.toMatchObject({
      id: run.id,
      status: 'sent',
      output: 'Your briefing is ready.',
    });

    await expect(AgentScheduleDbService.getTaskById({ taskId: task.id })).resolves.toMatchObject({
      id: task.id,
      status: 'active',
      prompt: editedTask.prompt,
      nextRunAt: scheduledFor,
      updatedAt: editedTask.updatedAt,
    });

    await expect(
      AgentScheduleDbService.createTaskRun({
        taskId: task.id,
        scheduledFor,
        triggerVersion: 'replacement-trigger',
        claimToken: randomUUID(),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        taskId: task.id,
        scheduledFor,
        triggerVersion: 'replacement-trigger',
        status: 'running',
      }),
    );
  });

  it('records a delivered run and completes its current one-time task atomically', async () => {
    const scheduledFor = new Date('2099-06-02T09:00:00.000Z');
    const claimToken = randomUUID();
    const task = await AgentScheduleDbService.createTask({
      identityId,
      threadId: 'schedule-thread',
      title: 'Submit report',
      prompt: 'Remind me to submit the report.',
      scheduleKind: 'one_time',
      timeZone: 'UTC',
      nextRunAt: scheduledFor,
    });

    expect(task).not.toBeNull();

    if (!task) {
      throw new Error('Expected a scheduled task to be created.');
    }

    const run = await AgentScheduleDbService.createTaskRun({
      taskId: task.id,
      scheduledFor,
      triggerVersion: 'legacy',
      claimToken,
    });

    expect(run).not.toBeNull();

    if (!run) {
      throw new Error('Expected a scheduled task run to be created.');
    }

    const ranAt = new Date('2099-06-02T09:00:01.000Z');
    const outcome = await AgentScheduleDbService.finishSuccessfulTaskRun({
      task,
      runId: run.id,
      claimToken,
      output: 'Remember to submit the report.',
      ranAt,
    });

    expect(outcome).toEqual({ taskUpdated: true });
    await expect(
      AgentScheduleDbService.getTaskRunByScheduledFor({
        taskId: task.id,
        scheduledFor,
        triggerVersion: 'legacy',
      }),
    ).resolves.toMatchObject({
      status: 'sent',
      output: 'Remember to submit the report.',
    });
    await expect(AgentScheduleDbService.getTaskById({ taskId: task.id })).resolves.toMatchObject({
      status: 'completed',
      lastRunAt: ranAt,
      completedAt: ranAt,
    });
  });

  it('fences a stale owner after its schedule run claim is reclaimed', async () => {
    const scheduledFor = new Date('2099-06-03T09:00:00.000Z');
    const staleClaimToken = randomUUID();
    const currentClaimToken = randomUUID();
    const task = await AgentScheduleDbService.createTask({
      identityId,
      threadId: 'schedule-thread',
      title: 'Fenced reminder',
      prompt: 'Send the fenced reminder.',
      scheduleKind: 'one_time',
      timeZone: 'UTC',
      nextRunAt: scheduledFor,
    });

    expect(task).not.toBeNull();

    if (!task) {
      throw new Error('Expected a scheduled task to be created.');
    }

    const staleRun = await AgentScheduleDbService.createTaskRun({
      taskId: task.id,
      scheduledFor,
      triggerVersion: 'legacy',
      claimToken: staleClaimToken,
    });

    expect(staleRun).not.toBeNull();

    if (!staleRun) {
      throw new Error('Expected a scheduled task run to be created.');
    }

    await db
      .update(agentScheduledTaskRuns)
      .set({ startedAt: new Date('2000-01-01T00:00:00.000Z') })
      .where(eq(agentScheduledTaskRuns.id, staleRun.id));

    const reclaimedRun = await AgentScheduleDbService.createTaskRun({
      taskId: task.id,
      scheduledFor,
      triggerVersion: 'legacy',
      claimToken: currentClaimToken,
    });

    expect(reclaimedRun).toMatchObject({
      id: staleRun.id,
      status: 'running',
      claimToken: currentClaimToken,
    });
    await expect(
      AgentScheduleDbService.renewTaskRunLease({
        runId: staleRun.id,
        taskId: task.id,
        claimToken: staleClaimToken,
        taskRevision: task.revision,
        scheduledFor,
      }),
    ).resolves.toBe(false);
    await expect(
      AgentScheduleDbService.finishSuccessfulTaskRun({
        task,
        runId: staleRun.id,
        claimToken: staleClaimToken,
        output: 'Stale output.',
        ranAt: new Date('2099-06-03T09:00:01.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_TASK_RUN_NOT_FOUND' });

    await expect(
      AgentScheduleDbService.finishSuccessfulTaskRun({
        task,
        runId: staleRun.id,
        claimToken: currentClaimToken,
        output: 'Current output.',
        ranAt: new Date('2099-06-03T09:00:02.000Z'),
      }),
    ).resolves.toEqual({ taskUpdated: true });
  });

  it('persists nutrition corrections without moving the meal to another date or time', async () => {
    const eatenAt = new Date('2026-02-14T18:30:00.000Z');
    const draft = await AgentNutritionDbService.createDraft({
      identityId,
      threadId: 'nutrition-thread',
      name: 'Salmon bowl',
      items: [
        {
          name: 'Salmon bowl',
          estimatedGrams: 420,
          preparationMethod: 'Baked and assembled',
          calories: 540,
          proteinGrams: 38,
          carbsGrams: 55,
          fatGrams: 18,
          fiberGrams: 7,
          confidence: 'medium',
        },
      ],
      source: 'text',
      calories: 540,
      caloriesMin: 500,
      caloriesMax: 580,
      proteinGrams: 38,
      carbsGrams: 55,
      fatGrams: 18,
      fiberGrams: 7,
      confidence: 'medium',
      localDate: '2026-02-14',
      eatenAt,
      idempotencyKey: `meal-${randomUUID()}`,
    });

    expect(draft.meal).not.toBeNull();

    if (!draft.meal) {
      throw new Error('Expected a nutrition draft to be created.');
    }

    const confirmedAt = new Date('2026-02-14T18:31:00.000Z');
    const confirmedMeal = await AgentNutritionDbService.confirmPendingDraft({
      identityId,
      threadId: draft.meal.threadId,
      confirmedAt,
    });

    expect(confirmedMeal).not.toBeNull();

    const correctedMeal = await AgentNutritionDbService.updateMeal({
      identityId,
      mealId: draft.meal.id,
      update: {
        name: 'Large salmon bowl',
        calories: 620,
        caloriesMin: 580,
        caloriesMax: 660,
      },
    });

    expect(correctedMeal).toMatchObject({
      id: draft.meal.id,
      status: 'confirmed',
      name: 'Large salmon bowl',
      calories: 620,
      localDate: '2026-02-14',
      eatenAt,
      confirmedAt,
    });
  });

  it('distinguishes pending, confirmed, and superseded nutrition draft replays', async () => {
    const baseDraft = {
      identityId,
      threadId: 'nutrition-replay-thread',
      name: 'Yogurt bowl',
      items: [
        {
          name: 'Yogurt bowl',
          estimatedGrams: 300,
          preparationMethod: 'Assembled',
          calories: 360,
          proteinGrams: 24,
          carbsGrams: 42,
          fatGrams: 10,
          fiberGrams: 5,
          confidence: 'medium' as const,
        },
      ],
      source: 'text' as const,
      calories: 360,
      caloriesMin: 320,
      caloriesMax: 400,
      proteinGrams: 24,
      carbsGrams: 42,
      fatGrams: 10,
      fiberGrams: 5,
      confidence: 'medium' as const,
      localDate: '2026-07-11',
      eatenAt: new Date('2026-07-11T08:00:00.000Z'),
    };
    const confirmedKey = `confirmed-${randomUUID()}`;
    const created = await AgentNutritionDbService.createDraft({
      ...baseDraft,
      idempotencyKey: confirmedKey,
    });

    expect(created).toMatchObject({ outcome: 'created', meal: { status: 'draft' } });
    await expect(
      AgentNutritionDbService.createDraft({ ...baseDraft, idempotencyKey: confirmedKey }),
    ).resolves.toMatchObject({ outcome: 'existing_draft', meal: { status: 'draft' } });
    await AgentNutritionDbService.confirmPendingDraft({
      identityId,
      threadId: baseDraft.threadId,
      confirmedAt: new Date('2026-07-11T08:01:00.000Z'),
    });
    await expect(
      AgentNutritionDbService.createDraft({ ...baseDraft, idempotencyKey: confirmedKey }),
    ).resolves.toMatchObject({ outcome: 'already_confirmed', meal: { status: 'confirmed' } });

    const supersededKey = `superseded-${randomUUID()}`;

    await AgentNutritionDbService.createDraft({ ...baseDraft, idempotencyKey: supersededKey });
    await AgentNutritionDbService.createDraft({
      ...baseDraft,
      idempotencyKey: `replacement-${randomUUID()}`,
    });
    await expect(
      AgentNutritionDbService.createDraft({ ...baseDraft, idempotencyKey: supersededKey }),
    ).resolves.toMatchObject({ outcome: 'stale_replay', meal: { status: 'deleted' } });
  });
});
