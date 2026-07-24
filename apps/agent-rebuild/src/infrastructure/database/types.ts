import type { database } from './index';

export type DatabaseTransaction = Parameters<Parameters<(typeof database)['transaction']>[0]>[0];
