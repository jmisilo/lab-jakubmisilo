import { describe, expect, it } from 'vitest';

import { KnowledgeContextNoteTag } from '../../modules/knowledge/context';
import { getRetrievedKnowledgeContext } from './knowledge-retrieval';

describe('knowledge retrieval scorers', () => {
  it('uses the individual knowledge notes injected into the agent context', () => {
    expect(
      getRetrievedKnowledgeContext(
        {
          inputMessages: [],
          rememberedMessages: [],
          systemMessages: [],
          taggedSystemMessages: {
            [KnowledgeContextNoteTag]: [
              { role: 'system', content: '## preferences/fitness\nVektor Fitness.' },
              { role: 'system', content: '## profile/location\nWarsaw.' },
            ],
          },
        },
        [],
      ),
    ).toEqual(['## preferences/fitness\nVektor Fitness.', '## profile/location\nWarsaw.']);
  });
});
