/**
 * The tool surface, as an agent sees it.
 *
 * Most of these forward one-for-one to the helper; the shape and the wording
 * are the work. Two things the descriptions are trying hard to teach, because
 * an agent that misses them burns a context window:
 *
 * 1. **The cheap path.** `find_notes` and `search_notes` answer "where is it"
 *    without reading anything whole; `list_notes` with `outline` gives heading
 *    trees, and `read_note` with `section` reads one of them. Reading a whole
 *    note is the fallback, not the first move.
 * 2. **The write discipline.** Reads hand back an `mtimeMs`; passing it as
 *    `expectUnchanged` on the write is what makes an edit survive a human
 *    editing the same file at the same time.
 *
 * The last two tools are the convention layer — `append_todo` and
 * `new_decision` — which add no access at all. They compose the same helper
 * calls an agent could make itself, and exist so the common case is one call
 * with the right shape rather than a free-form section write that gets it
 * subtly wrong.
 */

import type { Helper } from "./helper.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Advertised to clients that show it, and true only for tools that open no
   * file for writing. */
  readOnly: boolean;
  run(helper: Helper, args: Record<string, unknown>): Promise<unknown>;
}

const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });

const NOTE_ARG = str(
  'Note id — its path inside the corpus, like "work/plan.md" or ' +
    '"work/meetings/2026-08-19.md". Never an absolute path.',
);

const SECTION_ARG = str(
  'Heading path. The heading\'s own text ("Decisions"), or a "/"-joined tail ' +
    'when that is ambiguous ("Design/Decisions"). "" means the preamble, ' +
    "before the first heading. If it matches nothing or matches twice, the " +
    "error lists the sections that do exist — read it and try again rather " +
    "than falling back to a whole-note read.",
);

const WORKSPACE_ARG = str(
  "Restrict to one workspace — a named set of projects the user keeps; " +
    "list_workspaces names them. Top-level notes are in every workspace. " +
    '"Default" means every project. Leave it out to see everything you can.',
);

const EXPECT_ARG = int(
  "The mtimeMs you got from reading this note. When given, the write is " +
    "refused if the file changed in between, instead of overwriting an edit " +
    "you never saw. Pass it whenever you read before writing.",
);

/** Straight pass-through: the helper command and the tool share a name. */
function forward(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  readOnly: boolean,
): ToolDef {
  return {
    name,
    description,
    inputSchema,
    readOnly,
    run: (helper, args) => helper.call(name, args),
  };
}

export const TOOLS: ToolDef[] = [
  forward(
    "list_projects",
    "The projects this server can see, each with its access grant (read or " +
      "write), note count, and destinations: the folders, relative to the " +
      "project, where the user files new notes by kind. Projects the user " +
      "has not granted access to do not appear here at all.",
    object({ workspace: WORKSPACE_ARG }),
    true,
  ),

  forward(
    "list_workspaces",
    "The user's workspaces — named sets of projects — with the projects in " +
      "each, and which one the app is on (current; null means Default, every " +
      "project). Pass a name as workspace to list_projects, list_notes, " +
      "find_notes or search_notes to scope to it. A workspace never widens " +
      "what you can see: a project without a grant is left out of it here too.",
    object({}),
    true,
  ),

  forward(
    "find_notes",
    "Find notes by name. Matches the note id, opens no files, and is the " +
      "cheapest way to answer 'where is the note about X' when X is in the " +
      "title. Ranked: exact file name first, then partial, then a match in a " +
      "folder along the path. Returns { notes, truncated }; truncated means " +
      "more matched than came back, so narrow the pattern or raise limit.",
    object(
      {
        pattern: str("Substring to match against note ids, case-insensitive."),
        limit: int("Maximum notes to return. Default 30."),
        workspace: WORKSPACE_ARG,
      },
      ["pattern"],
    ),
    true,
  ),

  forward(
    "search_notes",
    "Search note contents, case-insensitively. Returns { hits, truncated }; " +
      "each hit names the note, the line, and the heading path the line falls " +
      "under — so the usual next call is read_note with that section, not a " +
      "whole-note read. truncated means more matched than came back: scope it " +
      "with project or raise limit rather than assuming that is all there is.",
    object(
      {
        query: str("Literal text to look for."),
        project: str("Restrict to one project. Much faster than searching everything."),
        workspace: WORKSPACE_ARG,
        limit: int("Maximum hits overall. Default 50."),
        perNote: int(
          "Maximum hits from any one note, so a long file can't fill the result. Default 10.",
        ),
      },
      ["query"],
    ),
    true,
  ),

  forward(
    "list_notes",
    "List notes. Returns { notes, truncated }. With outline: true each note " +
      "also carries its heading tree, which is how you find the section you " +
      "want without reading any file — but a tree per note over a whole " +
      "corpus is a very large answer, so scope it with project. Never returns " +
      "note content.",
    object({
      project: str("Restrict to one project."),
      workspace: WORKSPACE_ARG,
      outline: bool(
        "Include each note's heading tree. Costs a read per note, and lowers " +
          "the default limit to 200 because the answer grows so much faster.",
      ),
      limit: int("Maximum notes to return. Default 2000, or 200 with outline."),
    }),
    true,
  ),

  forward(
    "outline_note",
    "One note's heading tree, with the line each heading sits on. Use it to " +
      "pick a section before reading, and to check the heading path a write " +
      "should target.",
    object({ note: NOTE_ARG }, ["note"]),
    true,
  ),

  forward(
    "read_note",
    "Read a note, or just one section of it. Pass section whenever you can — " +
      "a section read brings back that heading and everything under it, " +
      "including its subsections, and nothing else. Returns mtimeMs, which is " +
      "what you pass back as expectUnchanged if you then write.",
    object({ note: NOTE_ARG, section: SECTION_ARG }, ["note"]),
    true,
  ),

  forward(
    "write_section",
    "Replace what is under one heading. The heading line itself is kept — " +
      "content is the body that goes below it — and the extent replaced runs " +
      "through that section's subsections. There is deliberately no " +
      "whole-file write for notes; this plus append_to_note is the whole " +
      "editing surface.",
    object(
      {
        note: NOTE_ARG,
        section: SECTION_ARG,
        content: str("Markdown to put under that heading. Surrounding blank lines are normalized."),
        expectUnchanged: EXPECT_ARG,
      },
      ["note", "section", "content"],
    ),
    false,
  ),

  forward(
    "append_to_note",
    "Add to the end of a note, or to the end of one of its sections. This is " +
      "also how a note is created: give an id whose file does not exist yet " +
      "and it is written, so adding a note is one call. The id still has to " +
      "be one the corpus admits — inside a project you have write access to.",
    object(
      {
        note: NOTE_ARG,
        content: str("Markdown to add. It lands on its own line, after a blank one."),
        section: str("Heading path to append inside. Omit to append at the end of the note."),
        expectUnchanged: EXPECT_ARG,
      },
      ["note", "content"],
    ),
    false,
  ),

  forward(
    "create_note",
    "Create a note in the folder the user set for its kind, so it lands where " +
      "they would file it. Give the file name; the folder comes from the " +
      "user's destinations (list_projects shows each project's, doctor the " +
      "ones outside projects). Refuses rather than overwriting a note that " +
      "exists. Returns the note id it wrote.",
    object(
      {
        name: str(
          "File name, extension optional (the note type's is added). May " +
            "carry subfolders below the destination.",
        ),
        project: str("Project to create it in. Omit for a note outside projects."),
        kind: str(
          '"note" (the default), "capture" (a quick jotting) or "meeting". ' +
            "Captures and meetings are markdown.",
        ),
        type: str(
          "Note-type id for kind note, such as markdown. Defaults to the " + "user's default type.",
        ),
        content: str("Initial markdown. Omit for an empty note."),
      },
      ["name"],
    ),
    false,
  ),

  forward(
    "move_note",
    "Move or rename a note to another id, within a project or between " +
      "projects. Both ends need write access. Links in other notes are not " +
      "rewritten. Refused while the app holds unsaved edits for the note.",
    object(
      {
        from: NOTE_ARG,
        to: str("The note id to move it to, e.g. work/archive/plan.md."),
      },
      ["from", "to"],
    ),
    false,
  ),

  forward(
    "start_meeting",
    "Start recording a meeting in the running asapnotes app, into a meeting " +
      "note filed in the user's meetings folder (of the project, if given); a " +
      "note of that name already there is recorded into again. Records the " +
      "microphone and system audio unless told otherwise; the app window " +
      "comes up and shows the recording. Needs meeting control on in the app " +
      "(Settings > MCP > Meetings) and write access to the project. Tell the " +
      "user it is recording; telling the other participants is theirs to do. " +
      "Only the user can change access: if this is refused, pass on what the " +
      "refusal says to switch on.",
    object(
      {
        name: str("Meeting note name, such as 2026-10-29 standup. Becomes name.md."),
        project: str("Project whose meetings folder it goes in. Omit for none."),
        mic: bool("Record the microphone. Default true."),
        system: bool("Record system audio (what the computer plays). Default true."),
      },
      ["name"],
    ),
    false,
  ),

  forward(
    "stop_meeting",
    "Stop the running recording. The app writes the recording's links into " +
      "the meeting note. With transcribe true it also starts a local " +
      "transcription; the transcript becomes a note beside the meeting note, " +
      "linked under the recording line, and meeting_status shows progress.",
    object({
      transcribe: bool("Start a transcription once stopped. Default false."),
      language: str(
        'Language spoken, as a code such as en or pt, or "auto". Defaults to ' +
          "the user's last pick.",
      ),
      model: str(
        'Speech model id: "base", "small" or "large-v3-turbo-q5_0". Defaults to the last pick.',
      ),
    }),
    false,
  ),

  forward(
    "meeting_status",
    "Whether a recording is running (its note and length so far) and whether " +
      "a transcription is in progress (its note and percent).",
    object({}),
    true,
  ),

  forward(
    "read_settings",
    "The user's settings.json. Off unless the user turns it on, because this " +
      "file names every project location on the machine; the refusal says " +
      "which key to set.",
    object({}),
    true,
  ),

  forward(
    "write_settings",
    "Change settings with a JSON merge patch: objects merge recursively, null " +
      "removes a key. The result has to remain valid settings or the write is " +
      "refused before anything is written. The mcp block — the grants, and the " +
      "write pin — is never writable here. Where new notes go is " +
      "destinations ({capture, meeting, types: {typeId: folder}}, folders as " +
      "note-id prefixes) and projects.<name>.destinations (same shape, " +
      "folders relative to the project); projects.<name>.codeFolders lists " +
      "the absolute folders a project's notes are about.",
    object({ patch: { type: "object", description: "JSON merge patch to apply." } }, ["patch"]),
    false,
  ),

  forward(
    "doctor",
    "What this server resolved: the notes root and settings file it is " +
      "reading, the grant on each project, and whether writes are pinned to " +
      "the current project. Run it when results look wrong — the usual cause " +
      "is a different corpus than you expected, which otherwise looks fine.",
    object({}),
    true,
  ),

  {
    name: "append_todo",
    description:
      "Add an item to a project's TODO.md in the shape this convention uses: " +
      "a checkbox item under a dated heading, newest date first. Creates the " +
      "dated heading if today has none. Read the asapnotes://convention " +
      "resource for what belongs here versus in a decision entry.",
    inputSchema: object(
      {
        project: str("Project whose TODO.md to add to."),
        text: str(
          "The item, without the leading checkbox — a bold title then a line " +
            "of context is the shape the file uses.",
        ),
        date: str("ISO date (YYYY-MM-DD). Defaults to today."),
      },
      ["project", "text"],
    ),
    readOnly: false,
    run: appendTodo,
  },

  {
    name: "new_decision",
    description:
      "Write a dated decision entry in a project's decisions/ folder. The bar " +
      "for one is that it answers 'why is it like this?' — a routine fix is " +
      "not a decision. Refuses rather than overwriting when the slug is taken.",
    inputSchema: object(
      {
        project: str("Project to write the entry in."),
        title: str("Short title. Becomes the heading and the file's slug."),
        context: str("What made this decision necessary."),
        decision: str("What was decided."),
        consequences: str("What follows from it, including what it costs."),
        status: str('Accepted, Superseded, and so on. Defaults to "Accepted".'),
        date: str("ISO date (YYYY-MM-DD). Defaults to today."),
      },
      ["project", "title", "context", "decision"],
    ),
    readOnly: false,
    run: newDecision,
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// --------------------------------------------------------------- convention

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "entry"
  );
}

type Heading = { section: string; depth: number; line: number };

/** A heading that carries an ISO date is a dated heading, whatever else it says
 * around it — this file writes them as "Today (2026-08-19)". */
const DATED = /\d{4}-\d{2}-\d{2}/;

async function findNote(
  helper: Helper,
  project: string,
  name: string,
): Promise<string | undefined> {
  const { notes: found } = (await helper.call("find_notes", {
    pattern: name,
    limit: 50,
  })) as { notes: { note: string }[] };
  return found.find(
    (f) => f.note.startsWith(`${project}/`) && f.note.toLowerCase().endsWith(`/${name}`),
  )?.note;
}

/**
 * Newest date first is the convention, so a new dated heading goes at the top
 * of whatever section already holds the dated ones — which means reading that
 * parent section and writing it back with the new heading in front. Both halves
 * are ordinary tool calls; there is no privileged path here.
 */
async function appendTodo(helper: Helper, args: Record<string, unknown>): Promise<unknown> {
  const project = String(args.project);
  const text = String(args.text).trim();
  const date = String(args.date ?? today());
  const item = text.startsWith("- ") ? text : `- [ ] ${text}`;

  const note = (await findNote(helper, project, "todo.md")) ?? `${project}/TODO.md`;
  let headings: Heading[] = [];
  try {
    const outline = (await helper.call("outline_note", { note })) as { headings: Heading[] };
    headings = outline.headings;
  } catch {
    // No TODO file yet: the append below creates it.
    await helper.call("append_to_note", {
      note,
      content: `# TODO\n\n## ${date}\n\n${item}`,
    });
    return { note, section: date, created: true };
  }

  const dateOf = (h: Heading) => h.section.split("/").pop()?.match(DATED)?.[0] ?? "";
  const dated = headings.filter((h) => DATED.test(h.section.split("/").pop() ?? ""));

  const existing = dated.find((h) => dateOf(h) === date);
  if (existing) {
    await helper.call("append_to_note", { note, content: item, section: existing.section });
    return { note, section: existing.section, created: false };
  }

  if (!dated.length) {
    await helper.call("append_to_note", { note, content: `## ${date}\n\n${item}` });
    return { note, section: date, created: true };
  }

  const heading = `${"#".repeat(dated[0].depth)} ${date}`;

  // A date older than one already there is a backfill, and newest-first still
  // has to hold: it goes at the end of the oldest section that is still newer
  // than it, which is the slot immediately above the next date down.
  const newer = dated.filter((h) => dateOf(h) > date);
  if (newer.length) {
    await helper.call("append_to_note", {
      note,
      content: `${heading}\n\n${item}`,
      section: newer[newer.length - 1].section,
    });
    return { note, section: date, created: true };
  }

  // It is the newest, so it goes above them all — which means rewriting the
  // section that contains the dated ones.
  const parent = dated[0].section.split("/").slice(0, -1).join("/");
  const read = (await helper.call("read_note", { note, section: parent })) as {
    text: string;
    mtimeMs: number;
  };
  const body = parent === "" ? read.text : read.text.split("\n").slice(1).join("\n");
  // Prose can sit above the dated headings — a file title, a line about what
  // the file is for. The new heading goes below that, not on top of it, or the
  // rewrite quietly moves the user's writing into today's items.
  const lines = body.split("\n");
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && DATED.test(l));
  const above = (at < 0 ? lines : lines.slice(0, at)).join("\n").trim();
  const rest = at < 0 ? "" : lines.slice(at).join("\n").trim();
  await helper.call("write_section", {
    note,
    section: parent,
    content: [above, `${heading}\n\n${item}`, rest].filter(Boolean).join("\n\n"),
    expectUnchanged: read.mtimeMs,
  });
  return { note, section: date, created: true };
}

async function newDecision(helper: Helper, args: Record<string, unknown>): Promise<unknown> {
  const project = String(args.project);
  const title = String(args.title).trim();
  const date = String(args.date ?? today());
  const note = `${project}/decisions/${date}-${slugify(title)}.md`;

  // Refuse rather than overwrite: append_to_note would quietly add to the end
  // of an entry that is already there.
  let exists = true;
  try {
    await helper.call("read_note", { note });
  } catch {
    exists = false;
  }
  if (exists) {
    throw new Error(
      `${note} already exists — pick a different title, or edit that entry with write_section.`,
    );
  }

  const status = String(args.status ?? "Accepted");
  const consequences = args.consequences ? String(args.consequences).trim() : "";
  const body = [
    `# ${title}`,
    "",
    `**Status:** ${status} · **Date:** ${date}`,
    "",
    "## Context",
    "",
    String(args.context).trim(),
    "",
    "## Decision",
    "",
    String(args.decision).trim(),
    ...(consequences ? ["", "## Consequences", "", consequences] : []),
  ].join("\n");

  await helper.call("append_to_note", { note, content: body });
  return { note, date, status };
}
