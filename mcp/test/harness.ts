/**
 * Building a corpus for a test to run against.
 *
 * A test that wants different access rules needs a different `settings.json`,
 * and a test about the write pin needs a different `mcp-state.json` — so the
 * corpus is a per-test thing rather than one shared fixture. `corpus()` writes
 * the files, spawns nothing until a call is made, and hands back a real MCP
 * client wired to a real server over the real helper binary.
 *
 * Nothing here mocks the helper. The parts most likely to break are the seams
 * between the two halves, and a mock of the helper would test the mock.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Helper, resolveBinary } from "../src/helper.js";
import { createServer } from "../src/index.js";

/** Fails the test with the command to run, rather than 23 confusing failures. */
export function requireHelper(): string {
  const binary = resolveBinary();
  assert.ok(
    existsSync(binary),
    `the corpus helper isn't built — run \`cargo build --bin asapnotes-mcp\` in src-tauri (looked at ${binary})`,
  );
  return binary;
}

export interface CorpusOptions {
  /** Note files, keyed by path under the notes root. */
  files?: Record<string, string>;
  /** Per-project access: "read", "write" or "off". */
  projects?: Record<string, string>;
  /** The `mcp` block of settings — settings access, the write pin, defaults. */
  mcp?: Record<string, unknown>;
  /** What the app publishes about itself: the current project, mainly. */
  state?: Record<string, unknown>;
}

/** What a tool call comes back as, before the JSON inside it is parsed. */
type ToolResult = { content: { text: string }[]; isError?: boolean };

export interface Corpus {
  /** The temp directory holding `notes/` and `data/`. */
  home: string;
  notesRoot: string;
  client: Client;
  helper: Helper;
  /** The tool result as the parsed JSON the tool returned. The type argument is
   * the shape being asserted on, which keeps these tests documenting it. */
  call<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** The error message a refused tool call carries. */
  refusal(name: string, args?: Record<string, unknown>): Promise<string>;
  /** A note's bytes, straight off disk — no tool in the way. */
  onDisk(rel: string): string;
  write(rel: string, content: string): void;
  settingsOnDisk(): Record<string, unknown>;
  close(): Promise<void>;
}

export async function corpus(options: CorpusOptions = {}): Promise<Corpus> {
  requireHelper();

  const home = mkdtempSync(path.join(tmpdir(), "asapnotes-mcp-test-"));
  const notesRoot = path.join(home, "notes");
  const appData = path.join(home, "data");
  mkdirSync(notesRoot, { recursive: true });
  mkdirSync(appData, { recursive: true });

  const write = (rel: string, content: string): void => {
    const file = path.join(notesRoot, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  };
  for (const [rel, content] of Object.entries(options.files ?? {})) write(rel, content);

  const projects: Record<string, unknown> = {};
  for (const [name, grant] of Object.entries(options.projects ?? {})) {
    projects[name] = { mcp: grant };
  }
  writeFileSync(
    path.join(appData, "settings.json"),
    JSON.stringify({ version: 1, projects, ...(options.mcp ? { mcp: options.mcp } : {}) }, null, 2),
    "utf8",
  );
  if (options.state) {
    writeFileSync(
      path.join(appData, "mcp-state.json"),
      JSON.stringify({ notesRoot, updatedMs: 0, ...options.state }, null, 2),
      "utf8",
    );
  }

  const helper = new Helper({ notesRoot, appData });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([
    createServer(helper).connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    home,
    notesRoot,
    client,
    helper,
    write,
    async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const result = (await client.callTool({ name, arguments: args })) as ToolResult;
      const text = result.content[0].text;
      if (result.isError) throw new Error(text);
      return JSON.parse(text) as T;
    },
    async refusal(name: string, args: Record<string, unknown> = {}): Promise<string> {
      const result = (await client.callTool({ name, arguments: args })) as ToolResult;
      assert.equal(result.isError, true, `${name} should have been refused`);
      return result.content[0].text;
    },
    onDisk(rel: string): string {
      return readFileSync(path.join(notesRoot, rel), "utf8");
    },
    settingsOnDisk(): Record<string, unknown> {
      return JSON.parse(readFileSync(path.join(appData, "settings.json"), "utf8")) as Record<
        string,
        unknown
      >;
    },
    async close(): Promise<void> {
      await client.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

// The shapes these tests assert on, named once so a change to a tool's answer
// breaks compilation here rather than passing quietly somewhere.
export type NoteRow = { note: string; mtimeMs: number };
export type Outlined = NoteRow & { headings: { section: string; depth: number }[] };
export type Read = { note: string; text: string; mtimeMs: number; section?: string };
export type Hit = { note: string; line: number; section: string; text: string };
export type ProjectRow = { project: string; grant: string; notes: number };
export type Listing<T> = { notes: T[]; truncated: boolean };
export type Hits = { hits: Hit[]; truncated: boolean };
