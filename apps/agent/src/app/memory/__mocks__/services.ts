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
  model: 'gpt-5.4-mini',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
  embed: jest.fn(),
  generate: jest.fn(),
};
