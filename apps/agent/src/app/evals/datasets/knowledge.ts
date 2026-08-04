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
    path: 'projects/agent/database',
    title: 'Agent database',
    content:
      'The agent uses Neon PostgreSQL for relational knowledge-tree storage and pgvector while remaining inexpensive.',
  },
  {
    path: 'preferences/food/breakfast',
    title: 'Breakfast preference',
    content: 'The user usually prefers a savory breakfast.',
  },
] as const;
