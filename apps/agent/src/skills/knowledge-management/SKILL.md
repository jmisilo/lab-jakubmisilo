---
name: knowledge-management
description: How to save, update, supersede, and use the user's durable knowledge tree without creating duplicate or noisy notes.
---

# Knowledge Management

Use this skill when the conversation is about remembering facts, correcting memories, managing notes, journaling, ideas, projects, or any durable user context.

## Core Model

Durable knowledge is a user-owned markdown tree. Paths behave like Obsidian-style note paths:

- `profile/location`
- `preferences/communication`
- `work/current-role`
- `work/history/company-x`
- `projects/lab-agent/knowledge-system`
- `journal/2026/07/06`

Each node can be a concise memory, a group description, a project note, an idea note, or a longer journal-style note. A note can naturally become a group when child notes are created under it.

The same database table stores both short memories and longer notes. Long notes are allowed, but one note is capped at 20,000 characters. If the user provides more than that, split it into multiple focused notes or ask how they want it split.

## Tool Split

Use `read-knowledge` for inspection only:

- `list`
- `explore`
- `read`

Use `manage-knowledge` for changes only:

- `create`
- `update`
- `deactivate`
- `move`
- `supersede`

If you need to edit an existing note but do not know the exact path or current content, use `read-knowledge` first, then call `manage-knowledge` only after the target is clear.

## Save Rules

Save information when it is durable and useful later:

- Personal facts such as age, nationality, gender, language, default location, timezone, family, relationships, work, education, and stable preferences.
- Project facts, decisions, constraints, architecture choices, and user-specific product direction.
- Explicit notes, ideas, journal entries, or instructions the user asks to preserve.
- Corrections or changes that supersede older facts while preserving useful history.

Do not save:

- One-off task details.
- Jokes or throwaway comments.
- Raw transcripts.
- Unsupported assistant guesses.
- Generic summaries of normal conversation.

## Inspect And Correct

Use `read-knowledge` `list` when the user asks what is remembered/saved under a topic, or when you need to locate a note before editing it. Omit `parentPath` to list root notes.

Use `read-knowledge` `explore` when a broad topic may map to multiple related notes or deeper child notes. Start from a known path when available, or provide a query when the path is not obvious. Explore returns bounded previews and tree relationships; use `read` afterward for the full content of selected notes.

Use `read-knowledge` `read` when the user asks what a note contains, asks to show saved information, or when you need the complete current content before rewriting a note.

Use `manage-knowledge` `deactivate` for forget/archive/no-longer-active requests when no replacement note is needed. Do not hard-delete knowledge through chat. Deactivated notes preserve history and stop being active context.

Use `manage-knowledge` `move` when the user asks to rename a note path, move a note under another parent, retitle a note, or reorganize a subtree. Moving a note should preserve its child notes.

When answering "what do you remember?", do not expose database IDs, operation IDs, retrieval scores, source message IDs, or raw tool payloads. Summarize the note content naturally.

## Create, Update, Supersede

Use `manage-knowledge` `create` when no active note already covers the fact.

Use `manage-knowledge` `update` when the same active note should be edited in place. The updated content must be complete standalone markdown, not a diff.

Use `manage-knowledge` `supersede` when a new fact replaces an older useful fact and the old fact should remain as inactive history. Example: if the user says they now work at Company Y and Company X was known as current work, create Company Y and supersede the Company X current-work fact.

For explicit longer notes, preserve the user's wording and structure unless they ask you to rewrite, summarize, or clean it up. Use headings and bullets only when they clarify the note.

For implicit/background memories, stay concise. Do not create long journal/project notes implicitly from ordinary conversation unless the user clearly asked to preserve that note.

## Path Choice

Prefer specific paths over broad group nodes. Good paths:

- `profile/demographics`
- `profile/location`
- `preferences/communication`
- `work/current-role`
- `work/history/<company-slug>`
- `projects/<project-slug>/<topic>`
- `journal/<yyyy>/<mm>/<dd>`

Avoid stuffing unrelated facts into one broad note just because it exists.

For implicit memories, prefer existing relevant parent paths when available. Example: if `projects/lab-agent` exists and the user mentions a durable decision about scheduling, save it under `projects/lab-agent/scheduling` rather than creating a generic root `scheduling` note.

## User Experience

If a save succeeds, acknowledge it briefly and naturally.

If a save fails, do not mention operation IDs, debug IDs, database IDs, tool names, or error codes. Say only that you could not save it yet and continue helping.

Never expose retrieval scores, embeddings, metadata, or source message IDs to the user.

## Examples

User: "remember that I prefer casual short answers"

Action: create or update `preferences/communication`.

Content:

```md
The user prefers casual, short, natural answers. Avoid overexplaining unless they ask for depth.
```

User: "actually I moved to Lisbon"

Action: update or supersede the active default/current location note depending on whether the older location remains useful history.

User: "note this idea: build a Telegram agent that can schedule recurring research"

Action: create a project or idea note, likely under `projects/lab-agent/scheduling` or `ideas/telegram-agent-scheduling`.
