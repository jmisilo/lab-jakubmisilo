import { Hono } from 'hono';

import { bot } from '@/app/bot';
import { GoogleCalendarConnectionService } from '@/app/features/google-calendar/connection';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

export const GoogleCalendarRouter = new Hono()
  .get('/links/google-calendar/connect/:requestId', async (c) => {
    const requestId = c.req.param('requestId');

    try {
      const authorizationUrl = await GoogleCalendarConnectionService.createAuthorizationUrl({
        requestId,
      });

      return c.redirect(authorizationUrl);
    } catch (error) {
      logger.warn(
        {
          requestId,
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[GOOGLE_CALENDAR]: connection link failed',
      );

      const recovery = await sendExpiredConnectionRecovery({ requestId, error });

      return c.html(
        renderCalendarPage({
          title: 'Calendar connection expired',
          body: recovery.sent
            ? 'That Calendar connection link expired. A fresh link was sent in the conversation.'
            : 'That Calendar connection link expired or is invalid. Ask for a new Calendar connection link.',
        }),
        400,
      );
    }
  })
  .get('/links/google-calendar/callback', async (c) => {
    const errorCode = c.req.query('error');
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (errorCode) {
      logger.warn({ errorCode }, '[GOOGLE_CALENDAR]: OAuth callback denied');

      return c.html(
        renderCalendarPage({
          title: 'Calendar was not connected',
          body: 'Google Calendar access was not granted. You can request a new connection link if you want to try again.',
        }),
        400,
      );
    }

    if (!code || !state) {
      logger.warn('[GOOGLE_CALENDAR]: OAuth callback missing code or state');

      return c.html(
        renderCalendarPage({
          title: 'Calendar was not connected',
          body: 'The Google callback was missing required information. Ask for a new Calendar connection link.',
        }),
        400,
      );
    }

    try {
      const result = await GoogleCalendarConnectionService.completeConnection({ code, state });

      await bot.initialize();
      await bot.thread(result.threadId).post({
        markdown: 'Google Calendar is connected. I can now help with calendar events.',
      });

      logger.info(
        {
          identityId: result.identityId,
          threadId: result.threadId,
          connectionId: result.connection.id,
        },
        '[GOOGLE_CALENDAR]: connection completed',
      );

      return c.redirect('/links/google-calendar/done');
    } catch (error) {
      logger.error(
        {
          error,
          safeError: ErrorService.toSafeLog(error),
        },
        '[GOOGLE_CALENDAR]: OAuth callback failed',
      );

      return c.html(renderConnectionFailurePage(error), 500);
    }
  })
  .get('/links/google-calendar/done', (c) =>
    c.html(
      renderCalendarPage({
        title: 'Calendar connected',
        body: 'Google Calendar is connected.',
      }),
    ),
  )
  .get('/links/google-calendar/error', (c) =>
    c.html(
      renderCalendarPage({
        title: 'Calendar was not connected',
        body: 'Google Calendar connection failed. Ask for a new Calendar connection link.',
      }),
      400,
    ),
  );

function renderCalendarPage({ title, body }: { title: string; body: string }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      ::selection {
        background: rgba(212, 212, 216, 0.7);
        color: #52525b;
      }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #ffffff;
        color: #71717a;
        -webkit-font-smoothing: antialiased;
        text-rendering: geometricPrecision;
      }
      .page {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 64px 20px 20px;
      }
      main {
        width: 100%;
        max-width: 608px;
        margin: 0 auto;
      }
      .card {
        overflow: hidden;
        border: 1px solid #f2f2f2;
        border-radius: 26px;
        background: #f8f8f8;
        padding: 2px;
      }
      .panel {
        border: 1px solid #f2f2f2;
        border-radius: 24px;
        background: #ffffff;
        padding: 24px;
      }
      h1 {
        margin: 0;
        color: #09090b;
        font-size: 20px;
        font-weight: 500;
        line-height: 1.25;
        letter-spacing: -0.01em;
      }
      p {
        margin: 10px 0 0;
        font-size: 15px;
        line-height: 1.6;
      }
      a {
        color: #3f3f46;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-decoration-thickness: 8.5%;
        text-underline-offset: 3.5px;
        transition: color 125ms ease-in-out;
      }
      a:hover {
        color: #18181b;
      }
      @media (max-width: 640px) {
        .page {
          padding-top: 32px;
        }
        .panel {
          padding: 20px;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <main>
        <div class="card">
          <section class="panel" aria-labelledby="calendar-status-title">
            <h1 id="calendar-status-title">${escapeHtml(title)}</h1>
            <p>${escapeHtml(body)}</p>
          </section>
        </div>
      </main>
    </div>
  </body>
</html>`;
}

function renderConnectionFailurePage(error: unknown) {
  if (AppError.is(error) && error.code === AppErrorCode.GOOGLE_CALENDAR_CONFIGURATION_INVALID) {
    return renderCalendarPage({
      title: 'Calendar is not configured',
      body: 'Google Calendar is not configured correctly on the server. Try again after the configuration is fixed.',
    });
  }

  return renderCalendarPage({
    title: 'Calendar was not connected',
    body: 'Google Calendar connection failed. Ask for a new Calendar connection link.',
  });
}

async function sendExpiredConnectionRecovery({
  requestId,
  error,
}: {
  requestId: string;
  error: unknown;
}) {
  if (!AppError.is(error) || error.code !== AppErrorCode.GOOGLE_CALENDAR_OAUTH_EXPIRED) {
    return { sent: false };
  }

  try {
    const replacement =
      await GoogleCalendarConnectionService.createReplacementConnectionRequestForExpiredRequest({
        requestId,
      });

    if (!replacement) {
      return { sent: false };
    }

    await bot.initialize();
    await bot.thread(replacement.threadId).post({
      markdown: [
        'That Google Calendar connection link expired.',
        `Here is a fresh one: ${replacement.connectionUrl}`,
        `It expires at ${replacement.expiresAt.toISOString()}.`,
      ].join('\n\n'),
    });

    logger.info(
      {
        identityId: replacement.identityId,
        threadId: replacement.threadId,
        expiresAt: replacement.expiresAt,
      },
      '[GOOGLE_CALENDAR]: replacement connection link sent after expiry',
    );

    return { sent: true };
  } catch (recoveryError) {
    logger.error(
      {
        error: recoveryError,
        safeError: ErrorService.toSafeLog(recoveryError),
      },
      '[GOOGLE_CALENDAR]: failed to send replacement connection link after expiry',
    );

    return { sent: false };
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
