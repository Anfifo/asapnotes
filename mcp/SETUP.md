# Setting up the asapnotes MCP sidecar

Step-by-step. [README.md](README.md) is the reference for what the tools do and why
the design is shaped this way; this file is just how to get it running.

Two pieces have to exist before a client can use it:

| Piece                    | What it is                                    | Built with |
| ------------------------ | --------------------------------------------- | ---------- |
| `asapnotes-mcp` (binary) | Talks to your notes. Where access is enforced | `cargo`    |
| `mcp/dist/src/index.js`  | The stdio MCP server your client spawns       | `npm`      |

## 1. Get both

**If you installed asapnotes**, the helper came with it — no toolchain, nothing to
build. Settings → MCP prints its path; that is what `ASAPNOTES_MCP_HELPER` wants in
step 4. You still need the server itself, which is the `mcp/` folder of this repo:

```bash
cd mcp && npm install && npm run build
```

**If you are working in this repo**, build the helper too:

```bash
cargo build --manifest-path src-tauri/Cargo.toml --release --bin asapnotes-mcp
cd mcp && npm install && npm run build
```

The cargo build took about 35 seconds here on a warm cache — it links the app's
crate, so expect minutes on a cold one. The binary lands at
`src-tauri/target/release/asapnotes-mcp.exe` (drop the `.exe` off Windows).

> Skip `--release` if you are only running it from the tree. The server looks in
> `src-tauri/target/debug` on its own, so a `cargo build --bin asapnotes-mcp` and no
> `ASAPNOTES_MCP_HELPER` at all is enough.

`npm run tauri build` produces an installer that carries the helper, with no extra
step and no bundle configuration for it: the helper is a second `[[bin]]` of the
app's own crate, so the release build compiles it and the bundler ships every
binary the crate builds. The generated NSIS script installs `asapnotes-mcp.exe`
beside `asapnotes.exe`.

## 2. Check it can see your notes

```bash
echo '{}' | ./src-tauri/target/release/asapnotes-mcp doctor
```

You want something like this — the paths will be yours:

```json
{
  "ok": true,
  "result": {
    "notesRoot": "C:\\Users\\you\\Documents\\asapnotes",
    "notesRootSource": "published by the app",
    "settingsFile": "C:\\Users\\you\\AppData\\Roaming\\com.anfifo.asapnotes\\settings.json",
    "settingsFileExists": true,
    "grants": { "work": "read", "client-repo": "off" },
    "writeScope": "any",
    "visibleProjects": 1
  }
}
```

**Read `notesRoot` and `settingsFileExists` before going further.** This is the one
thing that can be wrong without looking wrong: a helper pointed at the wrong corpus
answers every question politely and incorrectly. `notesRootSource: "published by the
app"` means it used the root the app itself resolved, which is what you want — if it
says `"resolved from this platform's Documents"`, the app has not run since this was
installed, and it is guessing.

If the paths are wrong, override them:

```bash
./asapnotes-mcp doctor --notes-root "D:/notes" --app-data "D:/notes/.appdata"
```

## 3. Grant access

**Nothing is writable yet, and linked projects are invisible.** That is deliberate,
not a missing step — but it does mean an agent will report an empty-looking corpus if
all your projects are linked from outside the notes folder.

Edit `settings.json` (the path `doctor` printed). Add or extend the `mcp` block and
the per-project grants:

<!-- prettier-ignore -->
```jsonc
{
  "projects": {
    "work":        { "mcp": "write" },   // agent can read and edit
    "reading":     { "mcp": "read" },    // agent can read only
    "client-repo": { "mcp": "off" }      // does not exist to the agent
  },
  "mcp": {
    "notesRoot": "read",   // default for projects inside the notes folder
    "linked": "off",       // default for projects linked from elsewhere
    "writeScope": "any",   // see step 5
    "settings": "off"      // whether the agent may read/write settings.json itself
  }
}
```

Defaults if you write nothing: projects in your notes folder are **`read`**, projects
linked from elsewhere are **`off`**, and `settings` is **`off`**. A per-project `mcp`
always beats the default. An unrecognized value reads as `off`, so a typo fails closed
rather than silently granting something.

Re-run `doctor` and check the `grants` map says what you meant. Grants are re-read on
every call, so you never have to restart anything after changing them.

## 4. Point your client at it

For a client using the usual `mcpServers` JSON:

```json
{
  "mcpServers": {
    "asapnotes": {
      "command": "node",
      "args": ["C:/path/to/asapnotes/mcp/dist/src/index.js"],
      "env": {
        "ASAPNOTES_MCP_HELPER": "C:/path/to/asapnotes/src-tauri/target/release/asapnotes-mcp.exe"
      }
    }
  }
}
```

Absolute paths, forward slashes are fine on Windows. With an installed app, copy the
path out of Settings → MCP — it points inside the install, next to the app itself.
`ASAPNOTES_MCP_HELPER` can be omitted if the binary is on `PATH`, sits next to
`index.js`, or you are running from this repo with a debug build.

Two more environment variables exist and are normally unnecessary:
`ASAPNOTES_NOTES_ROOT` and `ASAPNOTES_APP_DATA` override what the helper resolves —
useful for a second corpus, or for trying it against scratch notes.

The server prints one line to **stderr** on startup naming the notes root, how many
projects are visible and whether writes are pinned. If your client shows server logs,
that line is the fastest confirmation it is wired to the right corpus.

## 5. Optional: pin writes to what you are working on

Set `mcp.writeScope` to `"current"` in `settings.json`. Reads are unaffected; writes
only land in the project the app currently has a note open in, and an edit aimed
anywhere else is refused by name.

Two behaviours to know, because neither is guessable:

- **Nothing open means no writes.** The app publishes "no current project" at launch,
  so until you open a note in a project, every write is refused. That is the safe
  direction, but it will look like a broken sidecar if you do not expect it.
- **Closing the app leaves the last pin in place.** The current project lives in a
  file, so it survives the app quitting; the next launch clears it again.

An agent cannot turn this off. `write_settings` refuses the whole `mcp` block rather
than checking it key by key.

## Troubleshooting

**"couldn't run the corpus helper at …"** — the binary is not where the server looked.
Set `ASAPNOTES_MCP_HELPER` to its absolute path.

**The agent says a note does not exist, but it does.** Either the project's grant is
`off` (an `off` project answers exactly what a missing note answers, on purpose — a
refusal naming the project would confirm the project exists), or the helper is on a
different corpus. `doctor` answers both: check `grants`, then `notesRoot`.

**The agent can read but every write is refused.** Expected until you grant `write`.
The refusal names the exact settings key to change. If the grant is already `write`,
check `writeScope` — see step 5.

**Search finds nothing across a linked repo.** A project's `files` rules in
`.asapnotes.json` are an access boundary, not a display filter: what they exclude, the
sidecar genuinely cannot see.

**Nothing at all is visible.** `visibleProjects: 0` in `doctor` with projects on disk
means they are all linked from outside the notes folder and `mcp.linked` is `off`.

## Verifying a change to the sidecar itself

```bash
cargo test --manifest-path src-tauri/Cargo.toml     # the corpus core
cd mcp && npm test                                  # end-to-end, needs the debug binary built
```

The `mcp` suite drives a real MCP client over a real server over the real binary
against a temp corpus. It builds first, but it does **not** build the Rust helper — run
`cargo build --manifest-path src-tauri/Cargo.toml --bin asapnotes-mcp` after changing
Rust, or the tests will exercise a stale binary.
