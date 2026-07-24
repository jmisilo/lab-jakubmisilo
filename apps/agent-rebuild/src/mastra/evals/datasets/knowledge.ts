export const knowledgeRuntimeCases = [
  {
    input: 'Where do I usually train, and what time should I avoid?',
    groundTruth:
      'The user usually trains at Vektor Fitness in Warsaw after work and avoids early-morning sessions.',
  },
  {
    input: 'Which database did I choose for the agent rebuild, and why?',
    groundTruth:
      'The user chose Neon PostgreSQL because the agent needs relational tree storage and pgvector while remaining inexpensive.',
  },
] as const;

export const knowledgeFixtureNotes = [
  {
    path: 'preferences/fitness/default-gym',
    title: 'Default gym',
    content: 'Preferred gym: Vektor Fitness in Warsaw. The user usually trains there after work.',
  },
  {
    path: 'preferences/fitness/training-time',
    title: 'Training time',
    content:
      'The user prefers strength training on weekdays and wants to avoid early-morning sessions.',
  },
  {
    path: 'projects/agent-rebuild/database',
    title: 'Agent rebuild database',
    content:
      'The agent rebuild uses Neon PostgreSQL for relational knowledge-tree storage and pgvector while remaining inexpensive.',
  },
  {
    path: 'preferences/food/breakfast',
    title: 'Breakfast preference',
    content: 'The user usually prefers a savory breakfast.',
  },
] as const;
