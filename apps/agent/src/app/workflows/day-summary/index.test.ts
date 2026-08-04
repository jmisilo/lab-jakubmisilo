import { Mastra } from '@mastra/core/mastra';
import { MASTRA_RESOURCE_ID_KEY, RequestContext } from '@mastra/core/request-context';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { daySummaryWorkflow } from '.';
import { GoogleService } from '../../features/google';
import { SchedulingService } from '../../schedules';
import { daySummaryAgent } from './summary-agent';

vi.mock('../../../infrastructure/database', () => ({
  database: {},
  databasePool: {},
}));
vi.mock('./summary-agent', () => ({
  daySummaryAgent: {
    generate: vi.fn().mockResolvedValue({
      object: {
        summary: 'Today is centered around the project review at noon.',
      },
    }),
  },
}));

describe('daySummaryWorkflow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('gathers day context and returns a generated briefing', async () => {
    vi.spyOn(GoogleService, 'listCalendars').mockResolvedValue([
      { id: 'primary', summary: 'Personal' },
    ]);
    vi.spyOn(GoogleService, 'listCalendarEvents').mockResolvedValue([
      {
        id: 'event-1',
        summary: 'Project review',
        start: { dateTime: '2026-07-26T12:00:00+02:00' },
        end: { dateTime: '2026-07-26T13:00:00+02:00' },
      },
    ]);
    vi.spyOn(SchedulingService, 'list').mockResolvedValue({
      recurring: [],
      oneTime: [],
    });
    const mastra = new Mastra({
      workflows: {
        daySummary: daySummaryWorkflow,
      },
    });
    const workflow = mastra.getWorkflow('daySummary');
    const run = await workflow.createRun({ resourceId: 'user-1' });
    const requestContext = new RequestContext();
    requestContext.set(MASTRA_RESOURCE_ID_KEY, 'user-1');
    requestContext.set('timeZone', 'Europe/Warsaw');

    const result = await run.start({
      inputData: {
        date: '2026-07-26',
        relevantContext: 'The project review is the main priority.',
      },
      requestContext,
    });

    expect(result.status).toBe('success');

    if (result.status !== 'success') {
      throw new Error(`Pre-day summary workflow finished with status ${result.status}.`);
    }

    expect(result.stepExecutionPath).toEqual([
      'resolve-day',
      'gather-day-context',
      'summarize-day',
    ]);
    expect(result.result).toEqual({
      date: '2026-07-26',
      timeZone: 'Europe/Warsaw',
      summary: 'Today is centered around the project review at noon.',
      calendarAvailable: true,
      schedulesAvailable: true,
      eventCount: 1,
      scheduledTaskCount: 0,
    });
    expect(daySummaryAgent.generate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        memory: {
          resource: 'user-1',
          thread: 'day-summary:user-1:2026-07-26',
        },
        requestContext,
      }),
    );
  });

  it('defaults to the current local day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T22:30:00.000Z'));
    vi.spyOn(GoogleService, 'listCalendars').mockResolvedValue([]);
    vi.spyOn(SchedulingService, 'list').mockResolvedValue({
      recurring: [],
      oneTime: [],
    });
    const mastra = new Mastra({
      workflows: {
        daySummary: daySummaryWorkflow,
      },
    });
    const workflow = mastra.getWorkflow('daySummary');
    const run = await workflow.createRun({ resourceId: 'user-1' });
    const requestContext = new RequestContext();
    requestContext.set(MASTRA_RESOURCE_ID_KEY, 'user-1');
    requestContext.set('timeZone', 'Europe/Warsaw');

    const result = await run.start({
      inputData: {},
      requestContext,
    });

    expect(result.status).toBe('success');

    if (result.status !== 'success') {
      throw new Error(`Day summary workflow finished with status ${result.status}.`);
    }

    expect(result.result.date).toBe('2026-07-27');
  });
});
