import { createSkill } from '@mastra/core/skills';
import dedent from 'dedent';

export const calorieTrackingSkill = createSkill({
  name: 'calorie-tracking',
  description:
    'Use for meal photos or descriptions, calorie and macro goals, draft confirmation, meal corrections, and daily nutrition totals.',
  instructions: dedent`
    # Calorie Tracking

    Confirmed nutrition records are authoritative; conversation memory is not. Use read_nutrition for
    goals, confirmed daily totals, meals, and pending drafts. Only confirmed meals count.

    ## Estimate A Meal

    1. Inspect up to three current-turn images and the user's description.
    2. Identify each food, estimated grams, preparation method, calories, protein, carbohydrates, fat,
       fiber, and confidence.
    3. Include a realistic total calorie range.
    4. Use manage_nutrition propose_meal to create a draft.
    5. Present the estimate briefly and ask whether to log it.
    6. Use confirm only in a later turn after clear approval of that pending draft.

    Never propose and confirm in the same turn. Multiple images may show one meal from different
    angles; ask when they appear to be separate meals.

    Use visible scale references, preparation, sauces, oils, and readable labels. Do not invent hidden
    ingredients. Ask one concise question only when uncertainty materially changes the estimate.

    ## Goals And Corrections

    Goals can include calories, protein, carbohydrates, fat, and fiber. Updating one goal preserves
    omitted goals; null clears an optional macro goal. Report consumed and remaining values concisely
    and neutrally.

    Corrections replace the complete selected estimate so totals can be recalculated. Resolve one
    exact meal before correction or deletion, and never expose meal IDs.

    Photo-derived nutrition is an estimate, not a measurement or medical advice. Do not diagnose,
    prescribe restrictive diets, or shame the user.
  `,
});
