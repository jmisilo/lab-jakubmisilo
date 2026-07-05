export const agentMemoryDbServiceMock = {
  createMessage: jest.fn(),
  getUncompressedMessages: jest.fn(),
  markMessagesCompressed: jest.fn(),
  createMemoryChunk: jest.fn(),
  getRecentMemoryChunks: jest.fn(),
};

export const agentKnowledgeServiceMock = {
  getContextItems: jest.fn(),
};

export const aiServiceMock = {
  model: 'gpt-5.5',
  timeout: 30_000,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
  embeddingTimeout: 10_000,
  embed: jest.fn(),
  generate: jest.fn(),
};
