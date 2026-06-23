process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.LOG_LEVEL ??= "silent";

jest.mock("@/infrastructure/logger");
