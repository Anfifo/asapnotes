# asapnotes plugin for Claude Code

Optional. Once installed, a Claude Code session is reminded that asapnotes keeps notes for
the code it is working on, so it can read them for context and earlier decisions.

## Install

```text
/plugin install asapnotes --marketplace Anfifo/asapnotes
```

On older Claude Code versions, add the marketplace first:

```text
/plugin marketplace add Anfifo/asapnotes
/plugin install asapnotes@asapnotes
```

Needs Node on `PATH` and asapnotes run at least once on this machine, so the helper's path is
published. `ASAPNOTES_MCP_HELPER` points the plugin at a helper somewhere else.

## Set it up

In asapnotes, Settings → Project folders → a project → Code folders → Add folder…, and pick
the folder the work happens in, such as the repository. An AI with settings access can set
the same list over MCP: `projects.<name>.codeFolders` in `write_settings`.

## When it reminds

Once per project per session, the first time any of these names one of that project's code
folders:

- the folder the session starts in, or a folder inside it;
- a file or folder a tool reads, edits, writes or searches;
- a shell command;
- a prompt that contains the folder's path.

A cleared or compacted session gets the reminder again on its next match.

## What it reads and runs

On a match it adds one line to the session: the project's name, where its notes are stored,
whether AI tools may write to them, and which asapnotes MCP tools to use. Nothing is shown in
the chat.

The hook runs `asapnotes-mcp code_folders`, which reads `settings.json` and lists only
projects whose MCP access is read or write. A project set to off never prompts a reminder.
The answer is cached for the session in the plugin's data folder and asked again when
`settings.json` changes. Nothing leaves the machine.
