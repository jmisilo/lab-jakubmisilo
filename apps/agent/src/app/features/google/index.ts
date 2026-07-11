import type { Context } from 'hono';

import { Hono } from 'hono';

import { bot } from '@/app/bot';
import { GoogleConnectionService } from '@/app/features/google/connection';
import { AppError, AppErrorCode, ErrorService } from '@/infrastructure/errors';
import { logger } from '@/infrastructure/logger';

export const GoogleRouter = new Hono()
  .get('/links/google/connect/:requestId', handleGoogleConnect)
  .get('/links/google-calendar/connect/:requestId', handleGoogleConnect)
  .get('/links/google/callback', handleGoogleCallback)
  .get('/links/google-calendar/callback', handleGoogleCallback)
  .get('/links/google/done', renderGoogleConnected)
  .get('/links/google-calendar/done', renderGoogleConnected)
  .get('/links/google/error', renderGoogleConnectionError)
  .get('/links/google-calendar/error', renderGoogleConnectionError);

async function handleGoogleConnect(c: Context) {
  const requestId = c.req.param('requestId');

  if (!requestId) {
    return c.html(
      renderGooglePage({
        title: 'Google was not connected',
        body: 'The Google connection link is invalid. Ask for a new connection link.',
      }),
      400,
    );
  }

  try {
    const authorizationUrl = await GoogleConnectionService.createAuthorizationUrl({ requestId });

    return c.redirect(authorizationUrl);
  } catch (error) {
    logger.warn(
      { requestId, safeError: ErrorService.toSafeLog(error) },
      '[GOOGLE]: connection link failed',
    );
    const recovery = await sendExpiredConnectionRecovery({ requestId, error });

    return c.html(
      renderGooglePage({
        title: 'Google connection expired',
        body: recovery.sent
          ? 'That Google connection link expired. A fresh link was sent in the conversation.'
          : 'That Google connection link expired or is invalid. Ask for a new connection link.',
      }),
      400,
    );
  }
}

async function handleGoogleCallback(c: Context) {
  const errorCode = c.req.query('error');
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (errorCode || !code || !state) {
    logger.warn(
      {
        authorizationDenied: Boolean(errorCode),
        hasAuthorizationCode: Boolean(code),
        hasState: Boolean(state),
      },
      '[GOOGLE]: OAuth callback denied or incomplete',
    );

    return c.html(
      renderGooglePage({
        title: 'Google was not connected',
        body: 'Google access was not granted. You can request a new connection link to try again.',
      }),
      400,
    );
  }

  let result: Awaited<ReturnType<typeof GoogleConnectionService.completeConnection>>;

  try {
    result = await GoogleConnectionService.completeConnection({ code, state });
  } catch (error) {
    logger.error({ safeError: ErrorService.toSafeLog(error) }, '[GOOGLE]: OAuth callback failed');

    return c.html(renderConnectionFailurePage(error), 500);
  }

  try {
    await bot.initialize();
    await bot.thread(result.threadId).post({
      markdown: 'Google is connected. Calendar and Gmail access are available when granted.',
    });
  } catch (notificationError) {
    logger.warn(
      {
        identityId: result.identityId,
        threadId: result.threadId,
        connectionId: result.connection.id,
        safeError: ErrorService.toSafeLog(notificationError),
      },
      '[GOOGLE]: connection completion notification failed',
    );
  }

  logger.info(
    {
      identityId: result.identityId,
      threadId: result.threadId,
      connectionId: result.connection.id,
      grantedScopes: result.connection.grantedScopes,
    },
    '[GOOGLE]: connection completed',
  );

  return c.redirect('/links/google/done');
}

function renderGoogleConnected(c: Context) {
  return c.html(renderGooglePage({ title: 'Google connected', body: 'Google is connected.' }));
}

function renderGoogleConnectionError(c: Context) {
  return c.html(
    renderGooglePage({
      title: 'Google was not connected',
      body: 'Google connection failed. Ask for a new connection link.',
    }),
    400,
  );
}

function renderGooglePage({ title, body }: { title: string; body: string }) {
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
          <section class="panel" aria-labelledby="google-status-title">
            <h1 id="google-status-title">${escapeHtml(title)}</h1>
            <p>${escapeHtml(body)}</p>
          </section>
        </div>
      </main>
    </div>
  </body>
</html>`;
}

function renderConnectionFailurePage(error: unknown) {
  if (AppError.is(error) && error.code === AppErrorCode.GOOGLE_CONFIGURATION_INVALID) {
    return renderGooglePage({
      title: 'Google is not configured',
      body: 'Google is not configured correctly on the server. Try again after the configuration is fixed.',
    });
  }

  return renderGooglePage({
    title: 'Google was not connected',
    body: 'Google connection failed. Ask for a new connection link.',
  });
}

async function sendExpiredConnectionRecovery({
  requestId,
  error,
}: {
  requestId: string;
  error: unknown;
}) {
  if (!AppError.is(error) || error.code !== AppErrorCode.GOOGLE_OAUTH_EXPIRED) {
    return { sent: false };
  }

  try {
    const replacement =
      await GoogleConnectionService.createReplacementConnectionRequestForExpiredRequest({
        requestId,
      });

    if (!replacement) {
      return { sent: false };
    }

    await bot.initialize();
    await bot.thread(replacement.threadId).post({
      markdown: [
        'That Google connection link expired.',
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
      '[GOOGLE]: replacement connection link sent after expiry',
    );

    return { sent: true };
  } catch (recoveryError) {
    logger.error(
      {
        safeError: ErrorService.toSafeLog(recoveryError),
      },
      '[GOOGLE]: failed to send replacement connection link after expiry',
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
