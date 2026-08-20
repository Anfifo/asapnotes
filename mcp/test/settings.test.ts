/**
 * The two things a corpus with default settings cannot show: settings access
 * turned on, and writes pinned to the project the app is currently on.
 *
 * Both are off by default, so every test above this one exercises the refusal
 * and none of them exercise what happens when a user says yes. That is the
 * wrong way round: a permission nobody has ever seen granted is a permission
 * nobody has tested.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { corpus, type CorpusOptions, type Read } from "./harness.js";

const FILES = {
  "work/plan.md": "# Design\n\ndesign body\n",
  "reading/ref.md": "reference material\n",
};

async function withCorpus(
  options: CorpusOptions,
  body: (c: Awaited<ReturnType<typeof corpus>>) => Promise<void>,
): Promise<void> {
  const c = await corpus({ files: FILES, ...options });
  try {
    await body(c);
  } finally {
    await c.close();
  }
}

describe("settings, once the user turns them on", () => {
  it("reads the file when the grant says read", async () => {
    await withCorpus({ projects: { work: "write" }, mcp: { settings: "read" } }, async (c) => {
      const settings = await c.call<{ version: number; projects: Record<string, unknown> }>(
        "read_settings",
      );
      assert.equal(settings.version, 1);
      assert.ok(Object.hasOwn(settings.projects, "work"));
      // Reading is not writing, even now.
      const message = await c.refusal("write_settings", { patch: { theme: "dark" } });
      assert.match(message, /mcp\.settings/);
    });
  });

  it("applies a merge patch and leaves everything it did not name alone", async () => {
    await withCorpus(
      { projects: { work: "write", reading: "read" }, mcp: { settings: "write" } },
      async (c) => {
        await c.call("write_settings", {
          patch: { files: ["*.tmp"], summonHotkey: "Alt+Space" },
        });
        const onDisk = c.settingsOnDisk();
        assert.deepEqual(onDisk.files, ["*.tmp"]);
        assert.equal(onDisk.summonHotkey, "Alt+Space");
        // The grants that were already there survived the patch.
        assert.deepEqual(onDisk.projects, {
          work: { mcp: "write" },
          reading: { mcp: "read" },
        });

        // Objects merge rather than replace: one keybind added, the other kept.
        await c.call("write_settings", { patch: { keybinds: { "note.new": "Ctrl+N" } } });
        await c.call("write_settings", { patch: { keybinds: { "note.save": "Ctrl+S" } } });
        assert.deepEqual(c.settingsOnDisk().keybinds, {
          "note.new": "Ctrl+N",
          "note.save": "Ctrl+S",
        });

        // null removes a key.
        await c.call("write_settings", { patch: { summonHotkey: null } });
        assert.ok(!Object.hasOwn(c.settingsOnDisk(), "summonHotkey"));
      },
    );
  });

  it("KNOWN GAP: a settings key the app does not model is dropped on write", async () => {
    // The patch is applied to the file's JSON but what gets written is the
    // parsed Settings struct, which has no catch-all — so a key nobody models
    // does not survive. This is how the app writes settings too, not something
    // the sidecar introduced, and it matters because settings.json is a file
    // the user hand-edits. Pinned here so it is found on purpose rather than
    // by a user losing a line.
    await withCorpus({ projects: { work: "write" }, mcp: { settings: "write" } }, async (c) => {
      await c.call("write_settings", { patch: { fromANewerBuild: "keep me" } });
      assert.ok(!Object.hasOwn(c.settingsOnDisk(), "fromANewerBuild"));
    });
  });

  it("never lets the mcp block be written, even at write access", async () => {
    await withCorpus({ projects: { reading: "read" }, mcp: { settings: "write" } }, async (c) => {
      // The whole block, not field by field: a tool that can widen its own
      // grant has no grant.
      for (const patch of [
        { mcp: { settings: "off" } },
        { mcp: { writeScope: "any" } },
        { mcp: { linked: "write" } },
        { mcp: {} },
      ]) {
        const message = await c.refusal("write_settings", { patch });
        assert.match(message, /mcp/);
      }
      assert.deepEqual(c.settingsOnDisk().mcp, { settings: "write" });

      // Nor by the back door of a project's own grant... which is a plain
      // settings key, so this one goes through. Worth pinning: the block is
      // what is protected, and per-project grants are not in it.
      await c.call("write_settings", { patch: { projects: { reading: { mcp: "write" } } } });
      assert.deepEqual((c.settingsOnDisk().projects as Record<string, unknown>).reading, {
        mcp: "write",
      });
    });
  });

  it("refuses a patch that would not parse, before writing anything", async () => {
    await withCorpus({ projects: { work: "write" }, mcp: { settings: "write" } }, async (c) => {
      const before = JSON.stringify(c.settingsOnDisk());
      const message = await c.refusal("write_settings", { patch: { version: "not a number" } });
      assert.ok(message.length > 0);
      assert.equal(JSON.stringify(c.settingsOnDisk()), before);
    });
  });
});

describe("writes pinned to the project the app is on", () => {
  const pinned = { projects: { work: "write", reading: "write" }, mcp: { writeScope: "current" } };

  it("allows the current project and refuses the others by name", async () => {
    await withCorpus({ ...pinned, state: { currentProject: "work" } }, async (c) => {
      await c.call("append_to_note", { note: "work/plan.md", content: "added under the pin" });
      assert.match(c.onDisk("work/plan.md"), /added under the pin/);

      const message = await c.refusal("append_to_note", {
        note: "reading/ref.md",
        content: "not allowed",
      });
      assert.match(message, /pinned to the current project "work"/);
      assert.match(message, /mcp\.writeScope/);
      assert.equal(c.onDisk("reading/ref.md"), "reference material\n");
    });
  });

  it("refuses every write when the app has not named a project", async () => {
    await withCorpus(pinned, async (c) => {
      const message = await c.refusal("append_to_note", { note: "work/plan.md", content: "x" });
      assert.match(message, /hasn't named one/);
      assert.match(message, /mcp\.writeScope/);
    });
  });

  it("leaves reading alone — the pin is about writes", async () => {
    await withCorpus({ ...pinned, state: { currentProject: "work" } }, async (c) => {
      const read = await c.call<Read>("read_note", { note: "reading/ref.md" });
      assert.equal(read.text, "reference material\n");
    });
  });

  it("never widens a grant", async () => {
    // Being the current project is not permission; the grant still decides.
    await withCorpus(
      {
        projects: { reading: "read", private: "off" },
        mcp: { writeScope: "current" },
        state: { currentProject: "reading" },
        files: { ...FILES, "private/secret.md": "hunter2\n" },
      },
      async (c) => {
        assert.match(
          await c.refusal("append_to_note", { note: "reading/ref.md", content: "x" }),
          /read-only/,
        );
        // And an off project still answers as if it were not there, rather
        // than admitting it exists but is out of scope.
        assert.equal(
          await c.refusal("append_to_note", { note: "private/secret.md", content: "x" }),
          "no such note: private/secret.md",
        );
      },
    );
  });

  it("says which way it is set", async () => {
    await withCorpus({ ...pinned, state: { currentProject: "work" } }, async (c) => {
      const out = await c.call<{ writeScope: string; currentProject: string }>("doctor");
      assert.equal(out.writeScope, "current");
      assert.equal(out.currentProject, "work");
    });
  });
});

describe("when the app and the helper disagree about the corpus", () => {
  it("reports which notes root it actually used", async () => {
    // The one failure this design cannot make obvious by itself: a helper on a
    // different corpus answers every question politely and wrongly. doctor is
    // the only way to tell, so it has to name the source.
    await withCorpus({ projects: { work: "write" } }, async (c) => {
      const out = await c.call<{
        notesRoot: string;
        notesRootSource: string;
        settingsFileExists: boolean;
      }>("doctor");
      assert.equal(out.notesRoot, c.notesRoot);
      assert.equal(out.notesRootSource, "given on the command line");
      assert.equal(out.settingsFileExists, true);
    });
  });
});
