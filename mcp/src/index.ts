#!/usr/bin/env node
/**
 * asapnotes over MCP — a stdio server an agent's client spawns.
 *
 * This file is protocol plumbing and nothing else. Every corpus question goes
 * to the `asapnotes-mcp` helper binary, which is where grants, the write pin
 * and id validation are enforced — deliberately, because this process is the
 * untrusted half: it is started by the agent's own client, so anything it
 * checked would be a check the agent could skip.
 *
 * Configuration, all optional:
 *
 * - `ASAPNOTES_MCP_HELPER` — path to the helper binary, when it is not beside
 *   this server or on PATH.
 * - `ASAPNOTES_NOTES_ROOT`, `ASAPNOTES_APP_DATA` — override the directories the
 *   helper would resolve itself. Normally unnecessary; the app publishes its own
 *   notes root, and the helper reads that.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { CONVENTION, CONVENTION_URI, PROMPTS, PROMPTS_BY_NAME } from "./convention.js";
import { Helper } from "./helper.js";
import { TOOLS, TOOLS_BY_NAME } from "./tools.js";

const VERSION = "0.1.0";

export function createServer(helper: Helper): Server {
  const server = new Server(
    { name: "asapnotes", version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: tool.readOnly },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS_BY_NAME.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    try {
      const args = request.params.arguments ?? {};
      // The schemas say additionalProperties: false and nothing downstream
      // enforces it — the helper reads arguments by name, so a misspelled
      // `limmit` would be dropped in silence and the caller would believe the
      // limit it passed was honored. Names only: types and required arguments
      // are the helper's business, and re-checking those here would be a second
      // implementation of the rules that matter.
      const declared = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      const unknown = Object.keys(args).filter((key) => !Object.hasOwn(declared, key));
      if (unknown.length) {
        throw new Error(
          `${tool.name} has no argument "${unknown[0]}". It takes: ${Object.keys(declared).join(", ") || "no arguments"}.`,
        );
      }
      const result = await tool.run(helper, args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      // A refusal is a result, not a transport failure: the helper's messages
      // are written to be acted on — they name the settings key to change, or
      // list the sections that do exist — so they go back verbatim.
      return {
        content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: CONVENTION_URI,
        name: "The asapnotes working convention",
        description:
          "Where a piece of writing belongs: the live TODO file, dated decision " +
          "entries, and how to read and write these notes without wasting either " +
          "your context or the user's work.",
        mimeType: "text/markdown",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== CONVENTION_URI) {
      throw new Error(`unknown resource: ${request.params.uri}`);
    }
    return {
      contents: [{ uri: CONVENTION_URI, mimeType: "text/markdown", text: CONVENTION }],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = PROMPTS_BY_NAME.get(request.params.name);
    if (!prompt) throw new Error(`unknown prompt: ${request.params.name}`);
    const missing = prompt.arguments
      .filter((a) => a.required && !request.params.arguments?.[a.name])
      .map((a) => a.name);
    if (missing.length) throw new Error(`missing required argument(s): ${missing.join(", ")}`);
    return {
      description: prompt.description,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: prompt.render((request.params.arguments ?? {}) as Record<string, string>),
          },
        },
      ],
    };
  });

  return server;
}

async function main(): Promise<void> {
  const helper = new Helper({
    notesRoot: process.env.ASAPNOTES_NOTES_ROOT,
    appData: process.env.ASAPNOTES_APP_DATA,
  });

  // Fail loudly here rather than serving an empty corpus. A helper that
  // resolved the wrong roots answers every question politely and wrongly, and
  // that is the one failure in this design that looks like success.
  let doctor: Record<string, unknown>;
  try {
    doctor = await helper.doctor();
  } catch (e) {
    console.error(
      `asapnotes-mcp: couldn't reach the corpus.\n${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  }
  // stderr, so it can't corrupt the protocol stream on stdout.
  console.error(
    `asapnotes-mcp ${VERSION} — notes root ${doctor.notesRoot} ` +
      `(${doctor.notesRootSource}), ${doctor.visibleProjects} project(s) visible, ` +
      `writes ${doctor.writeScope === "current" ? `pinned to ${doctor.currentProject ?? "(none open)"}` : "unpinned"}`,
  );

  await createServer(helper).connect(new StdioServerTransport());
}

// Only run when this file is the process entry point, so the tests can import
// createServer without starting a server on their own stdio.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`asapnotes-mcp: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
