const DEFAULT_RESOURCE_ID = 'owner';
const LOCAL_API_TOKEN = 'agent-local-dev-token';

export class IdentityService {
  static get studioResourceId() {
    return process.env.AGENT_RESOURCE_ID?.trim() || DEFAULT_RESOURCE_ID;
  }

  static get apiToken() {
    const token = process.env.AGENT_API_TOKEN?.trim();

    if (token) {
      return token;
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error('AGENT_API_TOKEN is required to protect Studio and agent API routes.');
    }

    return LOCAL_API_TOKEN;
  }
}
