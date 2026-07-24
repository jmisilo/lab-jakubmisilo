import { registerApiRoute } from '@mastra/core/server';

import { GoogleService } from '.';

export const googleRoutes = [
  registerApiRoute('/links/google/connect/:requestId', {
    method: 'GET',
    requiresAuth: false,
    handler: async (context) => {
      try {
        return context.redirect(
          await GoogleService.createAuthorizationUrl(context.req.param('requestId')),
        );
      } catch (error) {
        return context.html(
          renderGooglePage(
            'Google was not connected',
            error instanceof Error ? error.message : 'The connection link is invalid.',
          ),
          400,
        );
      }
    },
  }),
  registerApiRoute('/links/google/callback', {
    method: 'GET',
    requiresAuth: false,
    handler: async (context) => {
      const code = context.req.query('code');
      const state = context.req.query('state');
      const denied = context.req.query('error');

      if (denied || !code || !state) {
        return context.html(
          renderGooglePage(
            'Google was not connected',
            'Access was not granted. Ask the agent for a new connection link to try again.',
          ),
          400,
        );
      }

      try {
        const connection = await GoogleService.completeConnection({ code, state });

        const delivery = context
          .get('mastra')
          .getAgent('agent')
          .sendSignal(
            {
              type: 'notification',
              contents:
                'Google connection completed successfully. Calendar and read-only Gmail access are now available.',
              attributes: { source: 'google-oauth' },
            },
            {
              resourceId: connection.resourceId,
              threadId: connection.threadId,
              ifIdle: { behavior: 'wake' },
              ifActive: { behavior: 'deliver' },
            },
          );
        const accepted = await delivery.accepted;

        if (accepted.action === 'wake') {
          await accepted.output.consumeStream();
        }

        return context.html(
          renderGooglePage(
            'Google connected',
            'Calendar and read-only Gmail access are ready. You can close this page.',
          ),
        );
      } catch (error) {
        console.error('[GOOGLE]: OAuth callback failed', error);
        return context.html(
          renderGooglePage(
            'Google was not connected',
            'The connection could not be completed. Ask the agent for a fresh link.',
          ),
          500,
        );
      }
    },
  }),
];

function renderGooglePage(title: string, message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 sans-serif; background: #f7f7f5; color: #242421; }
      main { width: min(560px, calc(100% - 40px)); padding: 32px; border: 1px solid #deded8; border-radius: 20px; background: white; }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0; color: #62625d; }
    </style>
  </head>
  <body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
