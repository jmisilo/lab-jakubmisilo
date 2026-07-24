import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ManageNutritionInputSchema,
  ManageNutritionRequestSchema,
  ReadNutritionInputSchema,
} from './schemas';

describe('nutrition tool schemas', () => {
  it.each([ReadNutritionInputSchema, ManageNutritionInputSchema])(
    'exposes an object-shaped model tool schema',
    (schema) => {
      expect(z.toJSONSchema(schema)).toMatchObject({ type: 'object' });
    },
  );

  it('does not allow confirming through a meal proposal', () => {
    const request = ManageNutritionRequestSchema.parse({
      action: 'propose_meal',
      estimate: {
        name: 'Lunch',
        source: 'photo',
        confidence: 'medium',
        items: [
          {
            name: 'Pasta',
            estimatedGrams: 300,
            preparationMethod: 'cooked',
            calories: 500,
            proteinGrams: 20,
            carbsGrams: 80,
            fatGrams: 12,
            fiberGrams: 6,
            confidence: 'medium',
          },
        ],
      },
    });

    expect(request.action).toBe('propose_meal');
    expect(request).not.toHaveProperty('confirmed');
  });
});
