import { MastraPlatformExporter, MastraStorageExporter } from '@mastra/observability';
import { describe, expect, it } from 'vitest';

import { createAgentObservabilityExporters } from './observability';

describe('createAgentObservabilityExporters', () => {
  it('uses only Mastra Platform in production', () => {
    const exporters = createAgentObservabilityExporters({
      NODE_ENV: 'production',
    });

    expect(exporters).toHaveLength(1);
    expect(exporters[0]).toBeInstanceOf(MastraPlatformExporter);
  });

  it('uses Mastra Platform outside production when both credentials are configured', () => {
    const exporters = createAgentObservabilityExporters({
      NODE_ENV: 'development',
      MASTRA_PLATFORM_ACCESS_TOKEN: 'test-token',
      MASTRA_PROJECT_ID: 'test-project',
    });

    expect(exporters).toHaveLength(1);
    expect(exporters[0]).toBeInstanceOf(MastraPlatformExporter);
  });

  it.each([
    {
      MASTRA_PLATFORM_ACCESS_TOKEN: undefined,
      MASTRA_PROJECT_ID: undefined,
    },
    {
      MASTRA_PLATFORM_ACCESS_TOKEN: 'test-token',
      MASTRA_PROJECT_ID: undefined,
    },
    {
      MASTRA_PLATFORM_ACCESS_TOKEN: undefined,
      MASTRA_PROJECT_ID: 'test-project',
    },
    {
      MASTRA_PLATFORM_ACCESS_TOKEN: ' ',
      MASTRA_PROJECT_ID: 'test-project',
    },
  ])('falls back to storage outside production without both credentials', (credentials) => {
    const exporters = createAgentObservabilityExporters({
      NODE_ENV: 'development',
      ...credentials,
    });

    expect(exporters).toHaveLength(1);
    expect(exporters[0]).toBeInstanceOf(MastraStorageExporter);
  });
});
