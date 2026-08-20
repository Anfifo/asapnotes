/**
 * Talking to the `asapnotes-mcp` helper binary.
 *
 * The helper is the only thing in this stack that touches the corpus, and this
 * module is the only thing that talks to the helper. That split is the point:
 * the project model — notes root, per-project locations, mounts, and each
 * project's `files` rules — decides what a caller may *see*, so re-implementing
 * it here in TypeScript would not be a display bug, it would be an
 * access-boundary bug. This file spawns a process and parses JSON.
 *
 * Nothing here enforces anything. Grants, the write pin and id validation all
 * live in the helper, below anything a client controls — this server is a
 * process the agent's own client starts, so it is the untrusted half.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** How long a single helper call may take before it is abandoned. Generous:
 * a first search over a large linked repository reads a lot of files. */
const TIMEOUT_MS = 60_000;

export interface HelperOptions {
  /** Explicit path to the binary. Falls back to the search below. */
  binary?: string;
  /** Passed through as `--notes-root` / `--app-data`. Absent means the helper
   * resolves them itself, which is the normal case. */
  notesRoot?: string;
  appData?: string;
  /** How long one call may take. Defaults to [`TIMEOUT_MS`]. */
  timeoutMs?: number;
}

export class HelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelperError";
  }
}

const exeName = process.platform === "win32" ? "asapnotes-mcp.exe" : "asapnotes-mcp";

/**
 * Where the binary is. In order: an explicit option, the `ASAPNOTES_MCP_HELPER`
 * environment variable, beside this server, the repository's debug build, and
 * finally the bare name so `PATH` gets a say.
 *
 * The dev-build entry is there because during development the helper lives in
 * `src-tauri/target/debug`, and a server that couldn't find it there would make
 * every change a packaging exercise.
 */
export function resolveBinary(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.ASAPNOTES_MCP_HELPER,
    path.join(path.dirname(fileURLToPath(import.meta.url)), exeName),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "src-tauri",
      "target",
      "debug",
      exeName,
    ),
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(c)) ?? exeName;
}

/** The envelope the helper always emits, refusals included. */
type Envelope = { ok: true; result: unknown } | { ok: false; error: string };

export class Helper {
  private readonly binary: string;
  private readonly roots: string[];
  private readonly timeoutMs: number;

  constructor(options: HelperOptions = {}) {
    this.binary = resolveBinary(options.binary);
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.roots = [
      ...(options.notesRoot ? ["--notes-root", options.notesRoot] : []),
      ...(options.appData ? ["--app-data", options.appData] : []),
    ];
  }

  get binaryPath(): string {
    return this.binary;
  }

  /**
   * Run one command. Arguments go in over stdin as JSON rather than as argv,
   * because note content is arbitrary text — newlines, quotes, whole markdown
   * documents — and every shell on the way would otherwise get a vote on what
   * survived.
   *
   * A refusal comes back as a thrown `HelperError` carrying the helper's own
   * message, which is written to be read by whoever called the tool: it names
   * the settings key to change, or lists the sections that do exist.
   */
  call(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, [command, ...this.roots], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new HelperError(`${command} took longer than ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(
          new HelperError(
            `couldn't run the corpus helper at ${this.binary}: ${e.message}. ` +
              `Build it with \`cargo build --bin asapnotes-mcp\`, or set ASAPNOTES_MCP_HELPER ` +
              `to where it lives.`,
          ),
        );
      });
      child.on("close", () => {
        clearTimeout(timer);
        let envelope: Envelope;
        try {
          envelope = JSON.parse(stdout) as Envelope;
        } catch {
          // No envelope means the helper died rather than refused — which is a
          // different thing from a tool saying no, and worth saying so.
          reject(
            new HelperError(
              `the corpus helper failed without answering: ${stderr.trim() || stdout.trim() || "no output"}`,
            ),
          );
          return;
        }
        if (envelope.ok) resolve(envelope.result);
        else reject(new HelperError(envelope.error));
      });

      child.stdin.end(JSON.stringify(args));
    });
  }

  /**
   * The startup check. A helper resolving a different `settings.json` than the
   * app serves a *different corpus* and nothing looks wrong — no error, no
   * empty result, just quietly the wrong notes. So this runs once before the
   * server accepts anything, and failing here is loud.
   */
  async doctor(): Promise<Record<string, unknown>> {
    return (await this.call("doctor")) as Record<string, unknown>;
  }
}
