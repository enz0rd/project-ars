import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod/v4";
import * as docTools from "./docTools.ts";
import { liveDoc, liveSnapshot, setLiveSelection } from "./live.ts";

/**
 * MCP server exposing the editor open in the browser, so Claude Code / Claude
 * Desktop can read and edit the canvas. Served over Streamable HTTP at /mcp.
 */
const INSTRUCTIONS = `This server controls a Figma-like vector editor that the user has open in their browser.
Every edit is applied live to their screen and can be undone there with Ctrl+Z.
Call get_document first to see the canvas, the current selection and free space.

${docTools.CANVAS_GUIDE}`;

const NO_EDITOR =
  "No editor is open. Ask the user to open the app in their browser (http://localhost:5173 in development) and try again.";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs a tool against the live document, or reports that no editor is open. */
function withEditor(fn: () => string): ToolResult {
  if (!liveSnapshot()) return { content: [{ type: "text", text: NO_EDITOR }], isError: true };
  return { content: [{ type: "text", text: fn() }] };
}

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "figma-claude", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description: "Return the document name, the selected node ids and every node on the canvas (z-order, bottom to top).",
      annotations: { readOnlyHint: true },
    },
    async () =>
      withEditor(() => {
        const { name, selection, nodes } = liveSnapshot()!;
        return JSON.stringify({ name, selection, nodes });
      }),
  );

  server.registerTool(
    "create_nodes",
    { title: "Create nodes", description: docTools.descriptions.createNodes, inputSchema: docTools.schemas.createNodes },
    async (input) => withEditor(() => docTools.createNodes(liveDoc, input)),
  );

  server.registerTool(
    "update_nodes",
    {
      title: "Update nodes",
      description: docTools.descriptions.updateNodes,
      inputSchema: docTools.schemas.updateNodes,
      annotations: { idempotentHint: true },
    },
    async (input) => withEditor(() => docTools.updateNodes(liveDoc, input)),
  );

  server.registerTool(
    "delete_nodes",
    {
      title: "Delete nodes",
      description: docTools.descriptions.deleteNodes,
      inputSchema: docTools.schemas.deleteNodes,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async (input) => withEditor(() => docTools.deleteNodes(liveDoc, input)),
  );

  server.registerTool(
    "reorder_node",
    { title: "Reorder node", description: docTools.descriptions.reorderNode, inputSchema: docTools.schemas.reorderNode },
    async (input) => withEditor(() => docTools.reorderNode(liveDoc, input)),
  );

  server.registerTool(
    "select_nodes",
    {
      title: "Select nodes",
      description: "Set the selection in the editor (an empty list clears it). Useful to point the user at what you changed.",
      inputSchema: z.object({ ids: z.array(z.string()) }),
      annotations: { idempotentHint: true },
    },
    async ({ ids }) =>
      withEditor(() => {
        const known = new Set(liveDoc.nodes().map((n) => n.id));
        setLiveSelection(ids.filter((id) => known.has(id)));
        return "Selected.";
      }),
  );

  return server;
});

export const mcpNodeHandler = toNodeHandler(handler);
