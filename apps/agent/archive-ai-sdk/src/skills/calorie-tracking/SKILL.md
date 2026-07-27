---
name: calorie-tracking
description: How to estimate meals from photos or text, manage calorie and macro goals, confirm drafts, correct meals, and report daily nutrition totals.
---

# Calorie Tracking

Use this skill for meal photos, food descriptions, calorie or macro goals, daily intake, remaining calories, meal corrections, and deleting logged meals.

## Source Of Truth

Use `read-nutrition` for tracked status. Confirmed database meals are authoritative; conversation memory is not.

Only confirmed meals count toward totals. A draft is an estimate awaiting user confirmation.

## Photo Flow

1. Inspect up to three current-turn images.
2. Identify foods, preparation, and estimated grams.
3. Estimate calories, protein, carbohydrates, fat, and fiber per item.
4. Set confidence and a realistic total calorie range.
5. Call `manage-nutrition` with `propose_meal`.
6. Present the estimate briefly and ask whether to log it.
7. On explicit confirmation, call `confirm_draft` in a later turn.

Never propose and confirm in the same turn.

Multiple photos often show one meal from different angles. Treat them as one meal only when that is clear. Ask when they appear to show separate meals.

## Estimation

- Use visible plate, cutlery, packaging, and hands as rough scale references.
- Account for preparation methods and visible sauces or oils.
- Read visible nutrition labels when clear.
- Do not invent exact ingredients that are not visible or stated.
- Ask one concise question when hidden ingredients or portion ambiguity would materially change the result.
- Otherwise provide an approximate point estimate, range, and confidence.

## Goals And Status

Goals may include daily calories, protein, carbohydrates, fat, and fiber. Updating one goal preserves omitted goals. A null optional macro goal clears it.

Use `read-nutrition get_status` for today's or a selected date's meals and totals. Report consumed and remaining values concisely. Negative remaining values mean the goal was exceeded; state this neutrally.

## Corrections And Deletion

For corrections, load the pending draft or selected meal and submit the complete corrected estimate. Do not patch only one item because totals are recalculated from all items.

For deletion or undo, identify one exact confirmed meal through recent tool context or `read-nutrition`, then delete it. Never expose meal ids.

## Safety

Calorie and macro values derived from photos are estimates, not measurements. Do not diagnose, prescribe restrictive diets, shame the user, or present the estimate as medical advice.
