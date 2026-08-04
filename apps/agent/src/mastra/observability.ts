import {
  MastraPlatformExporter,
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';

interface ObservabilityEnvironment {
  NODE_ENV?: string;
  MASTRA_PLATFORM_ACCESS_TOKEN?: string;
  MASTRA_PROJECT_ID?: string;
}

export function createAgentObservabilityExporters(
  environment: ObservabilityEnvironment = process.env,
) {
  const hasPlatformCredentials =
    Boolean(environment.MASTRA_PLATFORM_ACCESS_TOKEN?.trim()) &&
    Boolean(environment.MASTRA_PROJECT_ID?.trim());
  const useMastraPlatform = environment.NODE_ENV === 'production' || hasPlatformCredentials;

  return useMastraPlatform ? [new MastraPlatformExporter()] : [new MastraStorageExporter()];
}

export const agentObservability = new Observability({
  configs: {
    default: {
      serviceName: 'agent',
      exporters: createAgentObservabilityExporters(),
      spanOutputProcessors: [new SensitiveDataFilter()],
      logging: {
        enabled: true,
        level: 'info',
      },
    },
  },
});
