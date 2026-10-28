// Tells an agent session that asapnotes keeps notes for the code it is
// working on. Runs as a hook at session start, on each prompt and after file
// and shell tools: whenever the session's folder, a path a tool touched, a
// shell command or the prompt names one of a project's code folders, the
// session gets one short reminder for that project. Each project is named
// once per session, so repeat touches cost a file read and nothing else.
//
// The helper binary decides what is visible: a project whose access is off
// is never listed, so it never prompts a reminder. Anything unexpected exits
// quietly, because a hook that fails must not get in the way of a session.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_ID = "com.anfifo.asapnotes";

/** Where the app keeps settings.json and mcp-state.json, as the helper finds it. */
function appData() {
  if (process.env.ASAPNOTES_APP_DATA) return process.env.ASAPNOTES_APP_DATA;
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), APP_ID);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_ID);
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), APP_ID);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function mtimeMs(file) {
  try {
    return Math.floor(statSync(file).mtimeMs);
  } catch {
    return null;
  }
}

/** The helper's answer to `code_folders`, or null when it can't be asked. The
 * running app publishes the helper's path; the variable overrides it. */
function askHelper(data) {
  const helper =
    process.env.ASAPNOTES_MCP_HELPER ?? readJson(path.join(data, "mcp-state.json"))?.helper;
  if (!helper) return null;
  const args = ["code_folders"];
  if (process.env.ASAPNOTES_APP_DATA) args.push("--app-data", data);
  const run = spawnSync(helper, args, { input: "{}", encoding: "utf8", timeout: 5000 });
  const envelope = run.stdout ? JSON.parse(run.stdout) : null;
  return envelope?.ok ? envelope.result : null;
}

const windows = process.platform === "win32";
const caseless = windows || process.platform === "darwin";

/** A Git Bash or WSL drive path (`/c/...`, `/mnt/c/...`) as a Windows one,
 * before it is resolved: resolving it as is would land under the current drive. */
function native(p) {
  return windows ? p.replace(/^\/(?:mnt\/)?([a-z])\//i, "$1:/") : p;
}

/** One spelling per path: forward slashes, no trailing slash, and no case
 * where the file system has none. */
function norm(p) {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return caseless ? s.toLowerCase() : s;
}

/** The ways a shell command may write a folder: as stored, and on Windows
 * the Git Bash and WSL forms of its drive. */
function spellings(folder) {
  const drive = windows && /^([a-z]):\/(.*)$/.exec(folder);
  return drive ? [folder, `/${drive[1]}/${drive[2]}`, `/mnt/${drive[1]}/${drive[2]}`] : [folder];
}

/** Whether `text` mentions `folder` as a whole path, not as the start of a
 * longer name. */
function mentions(text, folder) {
  for (let at = text.indexOf(folder); at >= 0; at = text.indexOf(folder, at + 1)) {
    const next = text[at + folder.length];
    if (next === undefined || !/[\w.-]/.test(next)) return true;
  }
  return false;
}

function reminder(project) {
  const access =
    project.grant === "write" ? "AI tools may read and add to them" : "AI tools may read them";
  return (
    `asapnotes keeps notes for this code in the project "${project.project}", stored as ` +
    `markdown at ${path.normalize(project.location)}; ${access}. Check them for context and earlier ` +
    `decisions: with the asapnotes MCP tools connected, use find_notes, search_notes or ` +
    `list_notes with project "${project.project}", otherwise read the files there.`
  );
}

/** Session files older than a week belong to sessions long over. */
function prune(dir) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    if (name.endsWith(".json") && (mtimeMs(file) ?? cutoff) < cutoff) rmSync(file, { force: true });
  }
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const data = appData();
  const dir = process.env.CLAUDE_PLUGIN_DATA ?? path.join(os.tmpdir(), "asapnotes-claude");
  const sessionFile = path.join(
    dir,
    `${String(input.session_id ?? "unknown").replace(/[^\w-]/g, "")}.json`,
  );

  if (input.hook_event_name === "SessionStart") prune(dir);
  // A cleared or compacted session no longer holds earlier reminders.
  const fresh =
    input.hook_event_name === "SessionStart" && ["clear", "compact"].includes(input.source);
  const session = (!fresh && readJson(sessionFile)) || { seen: [] };
  let changed = fresh;

  // The folder list is cached per session and re-asked when settings change.
  const settingsMtime = mtimeMs(path.join(data, "settings.json"));
  if (!session.folders || session.settingsMtimeMs !== settingsMtime) {
    const answer = askHelper(data);
    if (!answer) return;
    session.folders = answer.projects;
    session.settingsMtimeMs = settingsMtime;
    changed = true;
  }

  const cwd = native(input.cwd ?? process.cwd());
  const tool = input.tool_input ?? {};
  const paths = [cwd, tool.file_path, tool.notebook_path, tool.path]
    .filter((p) => typeof p === "string" && p)
    .map((p) => norm(path.resolve(cwd, native(p))));
  const texts = [tool.command, tool.pattern, input.prompt]
    .filter((t) => typeof t === "string" && t)
    .map((t) => {
      const s = t.replace(/\\/g, "/");
      return caseless ? s.toLowerCase() : s;
    });

  const hits = session.folders.filter(
    (project) =>
      !session.seen.includes(project.project) &&
      project.codeFolders
        .map(norm)
        .some(
          (folder) =>
            paths.some((p) => p === folder || p.startsWith(`${folder}/`)) ||
            spellings(folder).some((s) => texts.some((t) => mentions(t, s))),
        ),
  );
  session.seen.push(...hits.map((p) => p.project));
  if (changed || hits.length > 0) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(sessionFile, JSON.stringify(session));
  }
  if (hits.length === 0) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        additionalContext: hits.map(reminder).join("\n"),
      },
    }),
  );
}

try {
  main();
} catch {
  // Quiet by design: see the top of this file.
}
