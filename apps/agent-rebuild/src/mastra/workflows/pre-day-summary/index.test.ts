import { Mastra } from '@mastra/core/mastra';
import { MASTRA_RESOURCE_ID_KEY, RequestContext } from '@mastra/core/request-context';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { preDaySummaryWorkflow } from '.';
import { GoogleService } from '../../modules/google';
import { SchedulingService } from '../../modules/scheduling';

vi.mock('../../../infrastructure/database', () => ({
  database: {},
}));
vi.mock('./summary-agent', () => ({
  preDaySummaryAgent: {
    generate: vi.fn().mockResolvedValue({
      object: {
        summary: 'Tomorrow is centered around the project review at noon.',
      },
    }),
  },
}));

describe('preDaySummaryWorkflow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gathers upcoming-day context and returns a generated briefing', async () => {
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
        preDaySummary: preDaySummaryWorkflow,
      },
    });
    const workflow = mastra.getWorkflow('preDaySummary');
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
      'resolve-upcoming-day',
      'gather-upcoming-day-context',
      'summarize-upcoming-day',
    ]);
    expect(result.result).toEqual({
      date: '2026-07-26',
      timeZone: 'Europe/Warsaw',
      summary: 'Tomorrow is centered around the project review at noon.',
      calendarAvailable: true,
      schedulesAvailable: true,
      eventCount: 1,
      scheduledTaskCount: 0,
    });
  });
});
