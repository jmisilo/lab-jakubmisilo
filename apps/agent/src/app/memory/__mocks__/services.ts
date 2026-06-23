export const agentMemoryDbServiceMock = {
  createMessage: jest.fn(),
  getUncompressedMessages: jest.fn(),
  markMessagesCompressed: jest.fn(),
  createMemoryChunk: jest.fn(),
  getRecentMemoryChunks: jest.fn(),
  createNotedMemory: jest.fn(),
  getNotedMemories: jest.fn(),
  searchNotedMemories: jest.fn(),
};

export const aiServiceMock = {
  model: "gpt-5.4-nano",
  timeout: 30_000,
  embeddingModel: "text-embedding-3-small",
  embeddingDimensions: 1536,
  embeddingTimeout: 10_000,
  embed: jest.fn(),
  generate: jest.fn(),
};
