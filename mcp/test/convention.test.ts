/**
 * The convention layer: `append_todo` and `new_decision`.
 *
 * These two are the only tools that are not a pass-through, so they are the
 * only place a bug can live on this side of the seam. They also compose
 * ordinary tool calls and get no privileged path, which is a claim worth
 * testing rather than asserting — the last describe block does that.
 *
 * The insertion cases are the substance. A TODO file in the wild is not the
 * fixture shape: it may not exist, may have no dated headings, may keep them at
 * the top level, and may carry prose above them that a careless rewrite moves.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slugify } from "../src/tools.js";
import { corpus, type Read } from "./harness.js";

const ITEM = "**Wire the sidecar** — first item today";

/** Run one test against a fresh corpus, since each shape of TODO file is a
 * different starting point and they must not see each other's writes. */
async function withTodo(
  todo: string | undefined,
  body: (c: Awaited<ReturnType<typeof corpus>>) => Promise<void>,
): Promise<void> {
  const c = await corpus({
    projects: { work: "write" },
    files: todo === undefined ? {} : { "work/TODO.md": todo },
  });
  try {
    await body(c);
  } finally {
    await c.close();
  }
}

describe("append_todo, when the file already has dated headings", () => {
  const existing = "# TODO\n\n## 2026-08-01\n\n- [ ] **An older item** — context\n";

  it("puts a newer date above the older ones and keeps them", async () => {
    await withTodo(existing, async (c) => {
      const first = await c.call<{ created: boolean }>("append_todo", {
        project: "work",
        text: ITEM,
        date: "2026-08-19",
      });
      assert.equal(first.created, true);
      const todo = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.ok(todo.text.indexOf("## 2026-08-19") < todo.text.indexOf("## 2026-08-01"));
      assert.match(todo.text, /- \[ \] \*\*Wire the sidecar\*\*/);
      assert.match(todo.text, /An older item/);
      // The file's own title stays where the user put it.
      assert.match(todo.text, /^# TODO/);
    });
  });

  it("joins a heading that is already there instead of making a second one", async () => {
    await withTodo(existing, async (c) => {
      const date = "2026-08-01";
      const result = await c.call<{ created: boolean; section: string }>("append_todo", {
        project: "work",
        text: "**A second item** — same day",
        date,
      });
      assert.equal(result.created, false);
      const todo = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.equal(todo.text.split(`## ${date}`).length - 1, 1);
      assert.match(todo.text, /A second item/);
      assert.match(todo.text, /An older item/);
    });
  });

  it("backfills an older date below the newer ones, not on top", async () => {
    await withTodo(
      "# TODO\n\n## 2026-08-10\n\n- [ ] later\n\n## 2026-08-01\n\n- [ ] earlier\n",
      async (c) => {
        await c.call("append_todo", {
          project: "work",
          text: "**Backfilled**",
          date: "2026-08-05",
        });
        const { text } = await c.call<Read>("read_note", { note: "work/TODO.md" });
        const order = ["## 2026-08-10", "## 2026-08-05", "## 2026-08-01"].map((h) =>
          text.indexOf(h),
        );
        assert.ok(
          order.every((at) => at > 0),
          "every heading should still be there",
        );
        assert.deepEqual(
          [...order].sort((a, b) => a - b),
          order,
          "newest first must still hold",
        );
        assert.match(text, /Backfilled/);
        assert.match(text, /later/);
        assert.match(text, /earlier/);
      },
    );
  });

  it("puts a date older than all of them at the bottom", async () => {
    await withTodo("# TODO\n\n## 2026-08-10\n\n- [ ] later\n", async (c) => {
      await c.call("append_todo", { project: "work", text: "**Oldest**", date: "2026-07-01" });
      const { text } = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.ok(text.indexOf("## 2026-08-10") < text.indexOf("## 2026-07-01"));
      assert.match(text, /later/);
    });
  });

  it("leaves prose above the dated headings where it was", async () => {
    // Dated headings at the top level, with a line about the file above them:
    // the insert rewrites the preamble, so this is where prose gets moved.
    await withTodo("What this file is for.\n\n## 2026-08-01\n\n- [ ] old\n", async (c) => {
      await c.call("append_todo", { project: "work", text: "**Today**", date: "2026-08-19" });
      const { text } = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.match(text, /^What this file is for\./);
      assert.ok(text.indexOf("What this file is for.") < text.indexOf("## 2026-08-19"));
      assert.ok(text.indexOf("## 2026-08-19") < text.indexOf("## 2026-08-01"));
      assert.match(text, /Today/);
      assert.match(text, /- \[ \] old/);
    });
  });

  it("leaves prose under the parent heading where it was", async () => {
    await withTodo("# TODO\n\nHow to use this file.\n\n## 2026-08-01\n\n- [ ] old\n", async (c) => {
      await c.call("append_todo", { project: "work", text: "**Today**", date: "2026-08-19" });
      const { text } = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.ok(text.indexOf("How to use this file.") < text.indexOf("## 2026-08-19"));
      assert.ok(text.indexOf("## 2026-08-19") < text.indexOf("## 2026-08-01"));
    });
  });

  it("matches a dated heading that says more than the date", async () => {
    await withTodo("# TODO\n\n## Today (2026-08-19)\n\n- [ ] old\n", async (c) => {
      const result = await c.call<{ created: boolean; section: string }>("append_todo", {
        project: "work",
        text: "**Same day**",
        date: "2026-08-19",
      });
      assert.equal(result.created, false);
      const { text } = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.ok(!text.includes("## 2026-08-19"), "should not have added a bare-date heading");
      assert.match(text, /Same day/);
    });
  });
});

describe("append_todo, when the file is not that shape", () => {
  it("creates the file when the project has no TODO yet", async () => {
    await withTodo(undefined, async (c) => {
      const result = await c.call<{ note: string; created: boolean }>("append_todo", {
        project: "work",
        text: ITEM,
        date: "2026-08-19",
      });
      assert.equal(result.note, "work/TODO.md");
      assert.equal(result.created, true);
      const { text } = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.match(text, /^# TODO/);
      assert.match(text, /## 2026-08-19/);
      assert.match(text, /- \[ \] \*\*Wire the sidecar\*\*/);
    });
  });

  it("adds a dated heading to a file that has headings but no dates", async () => {
    await withTodo("# TODO\n\n## Someday\n\n- [ ] eventually\n", async (c) => {
      await c.call("append_todo", { project: "work", text: ITEM, date: "2026-08-19" });
      const { text } = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.match(text, /## 2026-08-19/);
      assert.match(text, /eventually/);
      assert.match(text, /- \[ \] \*\*Wire the sidecar\*\*/);
    });
  });

  it("finds the file in a subfolder of the project", async () => {
    const c = await corpus({
      projects: { work: "write" },
      files: { "work/notes/TODO.md": "# TODO\n\n## 2026-08-01\n\n- [ ] old\n" },
    });
    try {
      const result = await c.call<{ note: string }>("append_todo", {
        project: "work",
        text: ITEM,
        date: "2026-08-19",
      });
      // The one that exists, not a second TODO.md at the project root.
      assert.equal(result.note, "work/notes/TODO.md");
      assert.match(c.onDisk("work/notes/TODO.md"), /Wire the sidecar/);
    } finally {
      await c.close();
    }
  });

  it("finds the file whatever case it is written in", async () => {
    const c = await corpus({
      projects: { work: "write" },
      files: { "work/todo.md": "# Todo\n\n## 2026-08-01\n\n- [ ] old\n" },
    });
    try {
      const result = await c.call<{ note: string }>("append_todo", {
        project: "work",
        text: ITEM,
        date: "2026-08-19",
      });
      // The existing file, not a second TODO.md beside it.
      assert.equal(result.note, "work/todo.md");
      assert.match(c.onDisk("work/todo.md"), /Wire the sidecar/);
    } finally {
      await c.close();
    }
  });

  it("does not double up a checkbox the caller already wrote", async () => {
    await withTodo(undefined, async (c) => {
      await c.call("append_todo", { project: "work", text: "- [x] **Done already**" });
      const { text } = await c.call<Read>("read_note", { note: "work/TODO.md" });
      assert.match(text, /- \[x\] \*\*Done already\*\*/);
      assert.ok(!text.includes("- [ ] - ["));
    });
  });

  it("defaults the date to today", async () => {
    await withTodo(undefined, async (c) => {
      const result = await c.call<{ section: string }>("append_todo", {
        project: "work",
        text: ITEM,
      });
      assert.match(result.section, /^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe("new_decision", () => {
  const args = {
    project: "work",
    title: "Helper binary over direct filesystem access",
    context: "The project model decides what a caller may see.",
    decision: "The sidecar shells out to a Rust helper from the same crate.",
    date: "2026-08-19",
  };

  it("writes a dated entry and refuses to overwrite one", async () => {
    await withTodo(undefined, async (c) => {
      const result = await c.call<{ note: string; status: string }>("new_decision", {
        ...args,
        consequences: "A second binary to build and ship.",
      });
      assert.equal(
        result.note,
        "work/decisions/2026-08-19-helper-binary-over-direct-filesystem-access.md",
      );
      const entry = await c.call<Read>("read_note", { note: result.note });
      assert.match(entry.text, /^# Helper binary over direct filesystem access/);
      assert.match(entry.text, /\*\*Status:\*\* Accepted/);
      assert.match(entry.text, /## Consequences\n\nA second binary/);

      const message = await c.refusal("new_decision", args);
      assert.match(message, /already exists/);
      // And the refusal left the entry alone rather than appending to it.
      const again = await c.call<Read>("read_note", { note: result.note });
      assert.equal(again.text, entry.text);
    });
  });

  it("leaves out a Consequences heading it has nothing to put under", async () => {
    await withTodo(undefined, async (c) => {
      const result = await c.call<{ note: string }>("new_decision", args);
      const entry = await c.call<Read>("read_note", { note: result.note });
      assert.ok(!entry.text.includes("## Consequences"));
      assert.match(entry.text, /## Decision/);
    });
  });

  it("carries a status other than Accepted", async () => {
    await withTodo(undefined, async (c) => {
      const result = await c.call<{ status: string }>("new_decision", {
        ...args,
        status: "Superseded",
      });
      assert.equal(result.status, "Superseded");
      const entry = await c.call<Read>("read_note", {
        note: "work/decisions/2026-08-19-helper-binary-over-direct-filesystem-access.md",
      });
      assert.match(entry.text, /\*\*Status:\*\* Superseded/);
    });
  });

  it("slugifies titles into something a file name can hold", () => {
    assert.equal(slugify("Canvas files are JSONCanvas"), "canvas-files-are-jsoncanvas");
    assert.equal(slugify("  Why?! Spaces & symbols  "), "why-spaces-symbols");
    assert.equal(slugify("///"), "entry");
    // Long titles are cut so the file name stays a file name, and never left
    // ending on the hyphen the cut made.
    assert.equal(slugify("a".repeat(80)), "a".repeat(60));
    assert.ok(!slugify(`${"word ".repeat(20)}`).endsWith("-"));
  });
});

describe("the convention tools get no access of their own", () => {
  it("refuses both of them on a read-only project", async () => {
    const c = await corpus({
      projects: { reading: "read" },
      files: { "reading/TODO.md": "# TODO\n\n## 2026-08-01\n\n- [ ] old\n" },
    });
    try {
      const todo = await c.refusal("append_todo", { project: "reading", text: ITEM });
      assert.match(todo, /read-only/);
      assert.match(todo, /projects\.reading\.mcp/);
      assert.ok(!c.onDisk("reading/TODO.md").includes("Wire the sidecar"));

      const decision = await c.refusal("new_decision", {
        project: "reading",
        title: "Something",
        context: "x",
        decision: "y",
      });
      assert.match(decision, /read-only/);
    } finally {
      await c.close();
    }
  });

  it("refuses both of them on a project that is off, without admitting it exists", async () => {
    const c = await corpus({
      projects: { private: "off" },
      files: { "private/TODO.md": "# TODO\n\n## 2026-08-01\n\n- [ ] secret work\n" },
    });
    try {
      const todo = await c.refusal("append_todo", { project: "private", text: ITEM });
      assert.match(todo, /no such note/);
      assert.ok(!todo.includes("read-only"), "an off project must not read as merely read-only");
      assert.match(c.onDisk("private/TODO.md"), /secret work/);
      assert.ok(!c.onDisk("private/TODO.md").includes("Wire the sidecar"));

      const decision = await c.refusal("new_decision", {
        project: "private",
        title: "Something",
        context: "x",
        decision: "y",
      });
      assert.match(decision, /no such note/);
    } finally {
      await c.close();
    }
  });
});
