/**
 * The seam between this server and the helper process.
 *
 * Everything here is about what happens when the other side does not behave:
 * the binary is missing, it dies without answering, it answers in pieces, it
 * never answers at all. Those are the failures a user actually hits — a fresh
 * checkout with no `cargo build`, a stale binary, a corpus on a disconnected
 * drive — and each one has to say what to do about it, because the symptom
 * ("no notes") looks the same for all of them.
 *
 * The fake helpers are node scripts, run by the same node: `Helper` puts the
 * command first on the argv, so pointing `binary` at `process.execPath` makes
 * the command a script path. That gives full control of the envelope without
 * touching the Rust side.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Helper, HelperError, resolveBinary } from "../src/helper.js";
import { requireHelper } from "./harness.js";

let scripts: string;

/** A fake helper: `node <file>`, so `command` is the script and the body
 * decides what comes back. Returns the command to pass to `call`. */
function fake(name: string, body: string): string {
  const file = path.join(scripts, `${name}.js`);
  writeFileSync(file, body, "utf8");
  return file;
}

const node = (options: { timeoutMs?: number } = {}) =>
  new Helper({ binary: process.execPath, ...options });

before(() => {
  scripts = mkdtempSync(path.join(tmpdir(), "asapnotes-mcp-fake-"));
});

after(() => {
  if (scripts) rmSync(scripts, { recursive: true, force: true });
});

describe("finding the binary", () => {
  const saved = process.env.ASAPNOTES_MCP_HELPER;
  after(() => {
    if (saved === undefined) delete process.env.ASAPNOTES_MCP_HELPER;
    else process.env.ASAPNOTES_MCP_HELPER = saved;
  });

  it("prefers an explicit path over the environment", () => {
    process.env.ASAPNOTES_MCP_HELPER = requireHelper();
    assert.equal(resolveBinary(process.execPath), process.execPath);
  });

  it("uses the environment when nothing was passed", () => {
    process.env.ASAPNOTES_MCP_HELPER = process.execPath;
    assert.equal(resolveBinary(), process.execPath);
  });

  it("skips a path that isn't there rather than trying to run it", () => {
    delete process.env.ASAPNOTES_MCP_HELPER;
    const missing = path.join(scripts, "not-built-yet.exe");
    const resolved = resolveBinary(missing);
    assert.notEqual(resolved, missing);
    // Falls through to the development build, which is what makes an
    // uninstalled checkout work at all.
    assert.equal(resolved, requireHelper());
  });

  it("skips an environment variable pointing at nothing", () => {
    process.env.ASAPNOTES_MCP_HELPER = path.join(scripts, "also-missing.exe");
    assert.equal(resolveBinary(), requireHelper());
  });
});

describe("when the helper cannot be run", () => {
  it("says how to build it instead of just failing", async () => {
    // A directory exists, so it survives the search, and spawning it fails —
    // which is the same shape as a corrupt or wrong-architecture binary.
    const helper = new Helper({ binary: scripts });
    await assert.rejects(
      () => helper.call("doctor"),
      (e: Error) => {
        assert.ok(e instanceof HelperError);
        assert.match(e.message, /couldn't run the corpus helper/);
        assert.match(e.message, /cargo build --bin asapnotes-mcp/);
        assert.match(e.message, /ASAPNOTES_MCP_HELPER/);
        return true;
      },
    );
  });
});

describe("the envelope", () => {
  it("hands back the result of a call that worked", async () => {
    const script = fake(
      "ok",
      `process.stdout.write(JSON.stringify({ok: true, result: {notes: 3}}))`,
    );
    assert.deepEqual(await node().call(script), { notes: 3 });
  });

  it("turns a refusal into an error carrying the helper's own words", async () => {
    const message = "reading is read-only over MCP; set projects.reading.mcp to write";
    const script = fake(
      "refusal",
      `process.stdout.write(JSON.stringify({ok: false, error: ${JSON.stringify(message)}}))`,
    );
    await assert.rejects(
      () => node().call(script),
      (e: Error) => {
        // Verbatim: these messages are written to be acted on, and a wrapper
        // around them would bury the settings key the user has to change.
        assert.equal(e.message, message);
        assert.equal(e.name, "HelperError");
        return true;
      },
    );
  });

  it("tells a helper that died apart from one that refused", async () => {
    const crashed = fake(
      "crash",
      `process.stderr.write("thread 'main' panicked at corpus/walk.rs:12"); process.exit(101)`,
    );
    await assert.rejects(() => node().call(crashed), /failed without answering.*panicked/s);

    const garbage = fake("garbage", `process.stdout.write("Usage: asapnotes-mcp <command>")`);
    await assert.rejects(() => node().call(garbage), /failed without answering.*Usage/s);

    const silent = fake("silent", `process.exit(0)`);
    await assert.rejects(() => node().call(silent), /failed without answering: no output/);
  });

  it("reads an answer that arrives in pieces", async () => {
    // Outlining a large corpus is hundreds of kilobytes on stdout, which never
    // arrives as one chunk.
    const script = fake(
      "chunked",
      [
        `const body = "x".repeat(400000);`,
        `const envelope = JSON.stringify({ok: true, result: {body}});`,
        `let at = 0;`,
        `const push = () => {`,
        `  if (at >= envelope.length) return process.stdout.end();`,
        `  process.stdout.write(envelope.slice(at, at + 8192));`,
        `  at += 8192;`,
        `  setTimeout(push, 1);`,
        `};`,
        `push();`,
      ].join("\n"),
    );
    const result = (await node().call(script)) as { body: string };
    assert.equal(result.body.length, 400000);
  });

  it("gives up on a helper that never answers, naming the wait", async () => {
    const script = fake("hang", `setTimeout(() => {}, 30000)`);
    await assert.rejects(() => node({ timeoutMs: 200 }).call(script), /took longer than 200ms/);
  });
});

describe("how arguments travel", () => {
  const echo = () =>
    fake(
      "echo",
      [
        `let data = "";`,
        `process.stdin.setEncoding("utf8");`,
        `process.stdin.on("data", (c) => (data += c));`,
        `process.stdin.on("end", () => {`,
        `  const result = {stdin: data, argv: process.argv.slice(2)};`,
        `  process.stdout.write(JSON.stringify({ok: true, result}));`,
        `});`,
      ].join("\n"),
    );

  it("puts them on stdin, not on the command line", async () => {
    // Note content is arbitrary text; on argv every shell on the way would get
    // a vote about what survived.
    const content = 'a "quoted" word, a \\ backslash, $HOME, `code`\nand a second line';
    const result = (await node().call(echo(), { note: "work/plan.md", content })) as {
      stdin: string;
      argv: string[];
    };
    assert.deepEqual(JSON.parse(result.stdin), { note: "work/plan.md", content });
    assert.deepEqual(result.argv, []);
    assert.ok(!JSON.stringify(result.argv).includes("backslash"));
  });

  it("passes the roots on the command line, where they belong", async () => {
    const helper = new Helper({
      binary: process.execPath,
      notesRoot: "C:\\notes",
      appData: "C:\\data",
    });
    const result = (await helper.call(echo())) as { argv: string[]; stdin: string };
    assert.deepEqual(result.argv, ["--notes-root", "C:\\notes", "--app-data", "C:\\data"]);
    assert.equal(result.stdin, "{}");
  });
});

describe("doctor, against the real binary", () => {
  it("answers even with no corpus behind it", async () => {
    // No --notes-root: the helper resolves its own, which is the path that
    // matters most and the one a test cannot fake.
    const out = await new Helper().doctor();
    assert.equal(typeof out.notesRoot, "string");
    assert.ok(String(out.notesRootSource).length > 0);
  });
});
