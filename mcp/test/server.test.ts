/**
 * The corpus, as seen through a real MCP client.
 *
 * A real client, linked to a real server, over the real Rust helper binary,
 * against a real corpus in a temp directory — see [harness.ts](harness.ts) for
 * how one is built. The one requirement is that `cargo build --bin
 * asapnotes-mcp` has run; the tests say so if it hasn't.
 *
 * This file is about corpus behavior. The protocol surface is in
 * protocol.test.ts, the convention layer in convention.test.ts, and the seam to
 * the helper process in helper.test.ts.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { corpus, type Corpus, type Hits, type Listing, type NoteRow } from "./harness.js";
import type { Outlined, ProjectRow, Read, Workspaces } from "./harness.js";

let c: Corpus;

before(async () => {
  c = await corpus({
    projects: { work: "write", reading: "read", private: "off" },
    // A workspace naming a project that is off, and it is the current one.
    workspaces: { focus: ["work", "private"] },
    currentWorkspace: "focus",
    files: {
      "work/plan.md":
        "Intro paragraph.\n\n# Design\n\ndesign body\n\n## Decisions\n\nwe picked A\n\n## Notes\n\nnotes body\n",
      "work/TODO.md": "# TODO\n\n## 2026-08-01\n\n- [ ] **An older item** — context\n",
      "reading/ref.md": "reference material\n",
      // A project the user has not granted: it must not exist to this server.
      "private/secret.md": "the passphrase is hunter2\n",
    },
  });
});

after(async () => {
  await c?.close();
});

describe("finding things", () => {
  it("finds notes by name without opening them", async () => {
    const found = await c.call<Listing<NoteRow>>("find_notes", { pattern: "plan" });
    assert.equal(found.notes[0].note, "work/plan.md");
    assert.equal(found.truncated, false);
  });

  it("says so when a limit clipped the answer", async () => {
    const clipped = await c.call<Listing<NoteRow>>("find_notes", { pattern: "work", limit: 1 });
    assert.equal(clipped.notes.length, 1);
    assert.equal(clipped.truncated, true);

    const whole = await c.call<Listing<NoteRow>>("find_notes", { pattern: "work" });
    assert.equal(whole.notes.length, 2);
    assert.equal(whole.truncated, false);
  });

  it("searches contents and says which section each hit is in", async () => {
    const { hits } = await c.call<Hits>("search_notes", { query: "picked" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].note, "work/plan.md");
    assert.equal(hits[0].section, "Design/Decisions");
  });

  it("lists heading trees without ever carrying content", async () => {
    const { notes } = await c.call<Listing<Outlined>>("list_notes", {
      project: "work",
      outline: true,
    });
    const plan = notes.find((n) => n.note === "work/plan.md");
    assert.deepEqual(
      plan?.headings.map((h) => h.section),
      ["Design", "Design/Decisions", "Design/Notes"],
    );
    assert.ok(!JSON.stringify(notes).includes("we picked A"));
  });

  it("reads one section rather than the whole note", async () => {
    const part = await c.call<Read>("read_note", { note: "work/plan.md", section: "Decisions" });
    assert.match(part.text, /we picked A/);
    assert.ok(!part.text.includes("Intro paragraph"));
    assert.ok(part.mtimeMs > 0);
  });

  it("lists the real sections when a section name misses", async () => {
    const message = await c.refusal("read_note", { note: "work/plan.md", section: "Choices" });
    assert.match(message, /Design\/Decisions/);
  });
});

describe("the access boundary", () => {
  it("does not list, search or read a project that is off", async () => {
    const projects = await c.call<ProjectRow[]>("list_projects");
    assert.deepEqual(projects.map((p) => p.project).sort(), ["reading", "work"]);

    const { hits } = await c.call<Hits>("search_notes", { query: "hunter2" });
    assert.equal(hits.length, 0);

    // And the refusal is word-for-word what a nonexistent note gets, so it
    // can't be used to probe for the project.
    const real = await c.refusal("read_note", { note: "private/secret.md" });
    const fake = await c.refusal("read_note", { note: "private/nothing.md" });
    assert.equal(real, "no such note: private/secret.md");
    assert.equal(fake, "no such note: private/nothing.md");
  });

  it("scopes by workspace without ever naming a hidden member", async () => {
    const ws = await c.call<Workspaces>("list_workspaces");
    assert.equal(ws.current, "focus");
    assert.deepEqual(ws.workspaces, [{ workspace: "focus", projects: ["work"] }]);

    const projects = await c.call<ProjectRow[]>("list_projects", { workspace: "focus" });
    assert.deepEqual(
      projects.map((p) => p.project),
      ["work"],
    );
    const listed = await c.call<Listing<NoteRow>>("list_notes", { workspace: "focus" });
    assert.ok(listed.notes.length > 0);
    assert.ok(listed.notes.every((n) => n.note.startsWith("work/")));
    const { hits } = await c.call<Hits>("search_notes", { query: "hunter2", workspace: "focus" });
    assert.equal(hits.length, 0);

    // Default is everything visible; an unknown name says what does exist.
    const all = await c.call<Listing<NoteRow>>("list_notes", { workspace: "Default" });
    assert.ok(all.notes.some((n) => n.note === "reading/ref.md"));
    const message = await c.refusal("list_notes", { workspace: "nope" });
    assert.match(message, /focus/);
  });

  it("keeps a hidden project out of every listing shape", async () => {
    const byName = await c.call<Listing<NoteRow>>("find_notes", { pattern: "secret" });
    assert.deepEqual(byName.notes, []);
    const listed = await c.call<Listing<NoteRow>>("list_notes");
    assert.ok(!listed.notes.some((n) => n.note.startsWith("private/")));
    const outline = await c.refusal("outline_note", { note: "private/secret.md" });
    assert.equal(outline, "no such note: private/secret.md");

    // Naming the project in a filter is not a way in either — and it answers
    // exactly as a project that was never there does, so the difference
    // between hidden and nonexistent stays invisible.
    const hidden = await c.call<Listing<NoteRow>>("list_notes", { project: "private" });
    const absent = await c.call<Listing<NoteRow>>("list_notes", { project: "no-such-project" });
    assert.deepEqual(hidden, { notes: [], truncated: false });
    assert.deepEqual(hidden, absent);
  });

  it("refuses a write to a read-only project and says which key to change", async () => {
    const message = await c.refusal("append_to_note", {
      note: "reading/ref.md",
      content: "mine now",
    });
    assert.match(message, /read-only/);
    assert.match(message, /projects\.reading\.mcp/);
    const after = await c.call<Read>("read_note", { note: "reading/ref.md" });
    assert.equal(after.text, "reference material\n");
  });

  it("keeps settings shut until the user opens them", async () => {
    const message = await c.refusal("read_settings");
    assert.match(message, /mcp\.settings/);
  });
});

describe("writing", () => {
  it("replaces a section body and leaves the rest of the note alone", async () => {
    const before = await c.call<Read>("read_note", { note: "work/plan.md", section: "Decisions" });
    await c.call("write_section", {
      note: "work/plan.md",
      section: "Decisions",
      content: "we picked B after all",
      expectUnchanged: before.mtimeMs,
    });
    const whole = await c.call<Read>("read_note", { note: "work/plan.md" });
    assert.match(whole.text, /we picked B after all/);
    assert.ok(!whole.text.includes("we picked A"));
    assert.match(whole.text, /^Intro paragraph\./);
    assert.match(whole.text, /## Notes\n\nnotes body/);
  });

  it("refuses a write whose expectUnchanged is stale", async () => {
    const message = await c.refusal("write_section", {
      note: "work/plan.md",
      section: "Decisions",
      content: "sneaky",
      expectUnchanged: 1,
    });
    assert.match(message, /changed since you read it/);
  });

  it("refuses a write over a file a human edited in between", async () => {
    const before = await c.call<Read>("read_note", { note: "work/plan.md", section: "Notes" });
    // The user typing in the same file, outside this server entirely.
    c.write("work/plan.md", `${c.onDisk("work/plan.md")}\n<!-- typed by hand -->\n`);
    const message = await c.refusal("write_section", {
      note: "work/plan.md",
      section: "Notes",
      content: "overwritten",
      expectUnchanged: before.mtimeMs,
    });
    assert.match(message, /changed since you read it/);
    assert.match(c.onDisk("work/plan.md"), /typed by hand/);
  });

  it("carries arbitrary markdown through unmangled", async () => {
    // Content goes over stdin rather than argv precisely so this survives.
    const content = 'Quotes "x", a backslash \\, $HOME, `code`, and a\nsecond line.';
    await c.call("append_to_note", { note: "work/odd.md", content });
    const read = await c.call<Read>("read_note", { note: "work/odd.md" });
    assert.equal(read.text, `${content}\n`);
  });

  it("creates a note in one call, and it is findable afterwards", async () => {
    const note = "work/2026-08-19-standup.md";
    const result = await c.call<{ created: boolean }>("append_to_note", {
      note,
      content: "# Standup\n\n- shipped the sidecar",
    });
    assert.equal(result.created, true);
    const read = await c.call<Read>("read_note", { note });
    assert.equal(read.text, "# Standup\n\n- shipped the sidecar\n");
    // Creating a note it cannot then find would leave an agent writing into a
    // corpus it can't navigate, so this half is the test.
    const found = await c.call<Listing<NoteRow>>("find_notes", { pattern: "standup" });
    assert.deepEqual(
      found.notes.map((n) => n.note),
      [note],
    );
    const { hits } = await c.call<Hits>("search_notes", { query: "shipped the sidecar" });
    assert.equal(hits[0].note, note);
  });

  it("creates a note in a subfolder and can still find it", async () => {
    // A note in a project's own subfolder used to be written, read back, and
    // then be invisible to every list, search and count — the walk stopped one
    // folder in. Creating something an agent can never find again is the one
    // outcome worse than refusing.
    const nested = "work/meetings/2026-08-19-standup.md";
    const created = await c.call<{ created: boolean }>("append_to_note", {
      note: nested,
      content: "# Standup\n\n- the walk goes all the way down now",
    });
    assert.equal(created.created, true);

    const found = await c.call<Listing<NoteRow>>("find_notes", { pattern: "meetings" });
    assert.ok(
      found.notes.some((n) => n.note === nested),
      "find_notes should see it",
    );
    const { hits } = await c.call<Hits>("search_notes", { query: "all the way down" });
    assert.equal(hits[0]?.note, nested);
    const listed = await c.call<Listing<NoteRow>>("list_notes", { project: "work" });
    assert.ok(
      listed.notes.some((n) => n.note === nested),
      "list_notes should see it",
    );
  });

  it("refuses an id the corpus does not admit", async () => {
    for (const note of ["../escape.md", "work/thing.exe"]) {
      const message = await c.refusal("append_to_note", { note, content: "x" });
      assert.match(message, /invalid note name/);
    }
  });
});

describe("diagnosis", () => {
  it("reports the roots it resolved and the grant on each project", async () => {
    const out = await c.call<{
      notesRoot: string;
      grants: Record<string, string>;
      notesRootSource: string;
    }>("doctor");
    assert.equal(out.notesRoot, path.join(c.home, "notes"));
    assert.equal(out.grants.work, "write");
    assert.equal(out.grants.private, "off");
    assert.equal(out.notesRootSource, "given on the command line");
  });
});
