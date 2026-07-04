I'd like to create my personal Telegram AI Agent, that's built with chat sdk and ai sdk (both from Vercel). I'd like to be able to preserve context, via both short term, long term memory and knowledge items/notes - noted information, derived from the conversation, either via explict request, or based on conversation. Additionally agent should have access to tools (web search, weather, date & time, and other custom tools, that will be developed progresively). Agent will be able to schedule certain task (either one-time, or cron job based) e.g. to remind user about something, to perform certain background tasks repeatetly, and return results etc.

the core of the agent will be durable context, split as above:

- short term - 35% of the context is alocated to it, but it can use another 0-35% of the context, if it's not alocated to the long term memory
- long term - "compressed" short messages, after exceeding alocated memory set. it should compress half of the short messages currently stored (e.g. if there are 30 short messages, 15 should be compressed). compression is done by ai call. 35%, but it can borrow it to short term, if not used
- knowledge - noted memories/information, that were either explicitly requested to be save, or are considered important information about user & in terms of the context of the conversation. around 20% of the context window is assigned to them.
- 10% of the contest window acts as a buffer.

while short term memory should be preserved by chat sdk state adapters, long term memory has to be stored as separated entities. unline short term memory (which is being compressed upon exceeding assigned limit), compressed items are just being dropped (oldest items) - space for them is not assigned. they are being picked from the newest.

knowledge items are more complicated:

1. they should be stored like an obsidian notes (skip concept of tags etc, just directories + .md notes) - they should use directory tree like structure, yet they should be stored fully in db.
2. in order to achieve that, they can be stored in tree-like structure - where each leaf will be a single note, and each internal node can be consider a "directory" (group). only root might not be defined, as the user is the root
3. leaves might evolve into groups, upon creating notes under them, yet note that content of the internal group should be a "description" of the group, and leaves should carry the most important knowledge, however it all should happen naturally, upon conversation (not strictly defined)
4. retrieval should happen via cosine similarity (each node content has to have embeddings [pg vector] generated on each content change) - based on last X messages, certain most relevant nodes should be retrieved. the question is whether we are only after leaves, or also internal nodes? (perhaps all notes)
5. then we should be able to dive deeper into the group - e.g. consider "project-xxx" parent node, with two leaves - "prd" and "design-system". question about design of the project should 100% touch the "design-system" note, perhaps the "prd" and "project-xxx" nodes should be available as well? but then, why not to proceed and give access e.g. to general "projects" node or eveb "project-yyy" node.

yet memory is the most important module and concept of the agent
