import { pgSequence } from 'drizzle-orm/pg-core';

/**
 * Chat SDK creates and owns these sequences through its PostgreSQL state
 * adapter. Drizzle Kit currently introspects all public sequences even when
 * tablesFilter excludes chat_state_* tables, so these declarations prevent a
 * custom-schema push from proposing to drop the adapter's sequences.
 */
export const chatStateListsSequence = pgSequence('chat_state_lists_seq_seq');
export const chatStateQueuesSequence = pgSequence('chat_state_queues_seq_seq');
