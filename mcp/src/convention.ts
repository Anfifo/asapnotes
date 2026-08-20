/**
 * The working convention, as something an agent can read.
 *
 * The docs pattern — a live TODO file, dated decision entries answering "why is
 * it like this?" — is the thing an agent most needs taught, and the thing that
 * makes one useful in any project that adopts it. It ships as a resource plus
 * two prompts so a client can offer the workflow, instead of every agent
 * inventing a shape and every human tidying up after it.
 */

export const CONVENTION_URI = "asapnotes://convention";

export const CONVENTION = `# The asapnotes working convention

Notes are plain markdown files the user owns. Everything below is about *where
a piece of writing belongs*, not about formatting.

## The two documents

**TODO.md — the live working file.** It describes what is happening now.

- Add an item when work starts or is agreed, with a date and one line of
  context — enough that it still makes sense weeks later.
- Update it as the work moves: check off sub-steps, note blockers, record what
  was decided along the way.
- Newest date first. Items live under a dated heading.
- On completion the item either becomes a decision entry (below) or is deleted.
  Task noise is deleted, not archived — this file is a working surface, not a
  record.

**decisions/ — dated entries.** One file per decision,
\`decisions/YYYY-MM-DD-slug.md\`.

The bar is a single question: **does it answer "why is it like this?"** A
routine fix does not. A choice someone will otherwise re-litigate in six
months does. Entries are not rewritten when they age — a superseded one gets a
link to what replaced it, because the point of an entry is being read later.

The fields new entries carry: Status, Context, Decision, and Consequences when
there are any worth naming. Older entries in a project may be prose instead;
both shapes are fine, and existing entries are left alone.

## What to do with this

- Adding a task, a blocker, or a note about work in flight → \`append_todo\`.
- Recording why something is the way it is → \`new_decision\`.
- Anything else → the ordinary note tools.

Both convention tools are conveniences. They compose the same calls you could
make yourself and give you no access you did not already have; they exist so
the common case is one call with the right shape.

## Reading efficiently

Notes can be long. The surface is built so you rarely need a whole one:

1. \`find_notes\` to locate by name, or \`search_notes\` to locate by content —
   every search hit names the heading path it fell under.
2. \`list_notes\` with \`outline: true\`, or \`outline_note\`, for heading trees.
3. \`read_note\` with a \`section\` for just that part.

Whole-note reads are the fallback, not the first move.

## Writing safely

Reads hand back \`mtimeMs\`. Pass it as \`expectUnchanged\` on the write and the
call is refused if the file moved in between, rather than overwriting an edit
you never saw. The user may well be typing in the same file right now.

There is no whole-file write for notes, deliberately: \`write_section\` replaces
one heading's body, \`append_to_note\` adds to the end of a note or a section,
and a note that does not exist yet is created by appending to it.
`;

export interface PromptDef {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  render(args: Record<string, string>): string;
}

export const PROMPTS: PromptDef[] = [
  {
    name: "add_todo_item",
    description: "Add a well-shaped item to a project's TODO file.",
    arguments: [
      { name: "project", description: "Project to add to.", required: true },
      { name: "what", description: "What the work is.", required: true },
    ],
    render: (args) =>
      `Add a TODO item to the "${args.project}" project for: ${args.what}\n\n` +
      `First read ${CONVENTION_URI} if you have not. Then check whether the ` +
      `project's TODO already has an item covering this — search before adding, ` +
      `since a duplicate is worse than a missing line. Write the item as a bold ` +
      `title plus one line of context that will still make sense in a month, and ` +
      `add it with append_todo.`,
  },
  {
    name: "draft_decision",
    description: "Draft a dated decision entry for a choice that has been made.",
    arguments: [
      { name: "project", description: "Project the decision belongs to.", required: true },
      { name: "about", description: "What was decided.", required: true },
    ],
    render: (args) =>
      `Draft a decision entry for the "${args.project}" project about: ${args.about}\n\n` +
      `Read ${CONVENTION_URI} first. Check the entry is worth one — it has to ` +
      `answer "why is it like this?", not just record that something was done. ` +
      `Look at the existing entries in the project's decisions/ folder for the ` +
      `voice, and search the notes for the context and the alternatives that ` +
      `were actually weighed, so Context says what really forced the choice. ` +
      `Name what the decision costs in Consequences — an entry that only lists ` +
      `upsides is not describing a decision. Then write it with new_decision.`,
  },
  {
    name: "catch_up",
    description: "Summarize where a project's work stands right now.",
    arguments: [{ name: "project", description: "Project to summarize.", required: true }],
    render: (args) =>
      `Summarize where the "${args.project}" project stands.\n\n` +
      `Use list_notes with outline: true to see its shape, then read the ` +
      `handoff and TODO sections that matter — section reads, not whole files. ` +
      `Report: what is in flight, what is finished but unverified, and what is ` +
      `blocked. Say which notes you read, and say plainly when something is ` +
      `unclear rather than smoothing it over.`,
  },
];

export const PROMPTS_BY_NAME = new Map(PROMPTS.map((p) => [p.name, p]));
