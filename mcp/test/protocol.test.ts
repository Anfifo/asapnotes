/**
 * The surface a client sees, and what it does with a request it cannot serve.
 *
 * These assert on what comes back *through* a client rather than on the
 * definitions in `tools.ts`, because a schema that never reaches the client is
 * not a schema. A typo here doesn't fail loudly: the client sends the wrong
 * arguments, the tool refuses, and it reads like the agent's mistake.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PROMPTS } from "../src/convention.js";
import { corpus, type Corpus } from "./harness.js";

let c: Corpus;

/** The bit of a tool's schema these tests care about. */
type Schema = {
  type: string;
  properties: Record<string, { type?: string; description?: string }>;
  required?: string[];
  additionalProperties?: boolean;
};

before(async () => {
  c = await corpus({ projects: { work: "write" }, files: { "work/note.md": "hello\n" } });
});

after(async () => {
  await c?.close();
});

describe("what the server advertises", () => {
  it("advertises tools, a convention resource and prompts", async () => {
    const { tools } = await c.client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.ok(names.includes("search_notes"));
    assert.ok(names.includes("write_section"));
    assert.ok(names.includes("append_todo"));
    assert.equal(new Set(names).size, names.length, "tool names must be unique");

    const { resources } = await c.client.listResources();
    assert.equal(resources[0].uri, "asapnotes://convention");
    const { prompts } = await c.client.listPrompts();
    assert.ok(prompts.map((p) => p.name).includes("draft_decision"));
  });

  it("marks the read-only tools as read-only and the writing ones as not", async () => {
    const { tools } = await c.client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    assert.equal(byName.get("read_note")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("search_notes")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("write_section")?.annotations?.readOnlyHint, false);
    assert.equal(byName.get("append_todo")?.annotations?.readOnlyHint, false);
  });

  it("gives every tool a description and a schema an agent can act on", async () => {
    const { tools } = await c.client.listTools();
    for (const tool of tools) {
      assert.ok(
        tool.description && tool.description.length > 40,
        `${tool.name} needs a description`,
      );
      const schema = tool.inputSchema as unknown as Schema;
      assert.equal(schema.type, "object", `${tool.name} schema must be an object`);
      // Closed schemas, so a misspelled argument is refused rather than dropped.
      assert.equal(
        schema.additionalProperties,
        false,
        `${tool.name} should not accept unknown arguments`,
      );
      for (const [name, property] of Object.entries(schema.properties)) {
        assert.ok(property.description, `${tool.name}.${name} needs a description`);
      }
      // A required argument that isn't in properties is unfillable: a closed
      // schema rejects it, and the tool refuses every call.
      for (const name of schema.required ?? []) {
        assert.ok(
          Object.hasOwn(schema.properties, name),
          `${tool.name} requires "${name}" but never declares it`,
        );
      }
    }
  });

  it("offers expectUnchanged on every tool that writes into a note", async () => {
    const { tools } = await c.client.listTools();
    for (const tool of tools) {
      const schema = tool.inputSchema as unknown as Schema;
      if (tool.annotations?.readOnlyHint !== false) continue;
      if (!Object.hasOwn(schema.properties, "note")) continue;
      assert.ok(
        Object.hasOwn(schema.properties, "expectUnchanged"),
        `${tool.name} writes into a named note, so it has to offer expectUnchanged`,
      );
    }
  });
});

describe("the convention resource and prompts", () => {
  it("serves the convention as readable markdown", async () => {
    const result = await c.client.readResource({ uri: "asapnotes://convention" });
    const text = (result.contents[0] as { text: string }).text;
    assert.match(text, /why is it like this/);
    assert.match(text, /expectUnchanged/);
  });

  it("renders every prompt with its arguments filled in", async () => {
    for (const definition of PROMPTS) {
      const args = Object.fromEntries(definition.arguments.map((a) => [a.name, `given-${a.name}`]));
      const prompt = await c.client.getPrompt({ name: definition.name, arguments: args });
      const text = (prompt.messages[0].content as { text: string }).text;
      for (const argument of definition.arguments) {
        assert.match(
          text,
          new RegExp(`given-${argument.name}`),
          `${definition.name} never uses its ${argument.name} argument`,
        );
      }
      // A prompt that ends in a write points at the convention first, since
      // shape is the whole reason these tools exist. A read-only prompt has
      // nothing to get wrong.
      if (/append_todo|new_decision/.test(text)) {
        assert.match(
          text,
          /asapnotes:\/\/convention/,
          `${definition.name} writes without pointing at the convention`,
        );
      }
    }
  });

  it("refuses a prompt missing its arguments, naming them", async () => {
    await assert.rejects(
      () => c.client.getPrompt({ name: "add_todo_item", arguments: {} }),
      /project/,
    );
    await assert.rejects(
      () => c.client.getPrompt({ name: "add_todo_item", arguments: { project: "work" } }),
      /what/,
    );
  });
});

describe("requests the server cannot serve", () => {
  it("reports an unknown tool without pretending it worked", async () => {
    const message = await c.refusal("delete_everything");
    assert.match(message, /unknown tool/);
  });

  it("rejects an unknown resource and an unknown prompt", async () => {
    await assert.rejects(
      () => c.client.readResource({ uri: "asapnotes://not-a-thing" }),
      /unknown resource/,
    );
    await assert.rejects(
      () => c.client.getPrompt({ name: "not_a_prompt", arguments: {} }),
      /unknown prompt/,
    );
  });

  it("refuses an unknown argument rather than dropping it", async () => {
    // The schemas are closed, and a dropped argument is worse than a refusal:
    // the caller believes the limit it passed was honored.
    const message = await c.refusal("find_notes", { pattern: "note", limmit: 1 });
    assert.match(message, /no argument "limmit"/);
    assert.match(message, /pattern, limit/);
    // A tool that takes nothing still says so rather than accepting anything.
    assert.match(await c.refusal("doctor", { verbose: true }), /no argument "verbose"/);
  });
});
