import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod/v4";
import * as docTools from "./docTools.ts";
import { activeSelection, listProjects, loadProject, setActiveProject, withProject } from "./projects.ts";
import { broadcast } from "./realtime.ts";

/**
 * MCP server for agents (Claude Code, Cursor, Codex, Gemini CLI…), served over Streamable HTTP at /mcp.
 * Callers authenticate with a personal access token (server/auth.ts); every tool
 * acts only on that user's projects — by default the one they had open last.
 */
const INSTRUCTIONS = `This server edits designs in Project Ars, a vector design editor.
Edits are saved and appear live in the user's open editor, where Ctrl+Z undoes them.
Tools act on the project the user has open (or opened last); pass project_id to target another one
(list_projects shows them). Call get_document first to see the canvas, the selection and free space.

${docTools.CANVAS_GUIDE}`;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const projectId = { project_id: z.string().uuid().optional().describe("Defaults to the project the user has open") };

async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

const handler = createMcpHandler(async ({ authInfo }) => {
  const userId = (authInfo?.extra as { userId?: string } | undefined)?.userId;
  if (!userId) throw new Error("unauthenticated");
  const server = new McpServer({ name: "project-ars", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  /** Registers a document tool: same schema plus an optional project_id. */
  const docTool = <S extends z.ZodObject>(
    name: string,
    title: string,
    description: string,
    schema: S,
    fn: (doc: docTools.DocTarget, input: z.infer<S>) => string | Promise<string>,
    annotations: Record<string, boolean> = {},
  ) =>
    server.registerTool(
      name,
      // The SDK's overloads can't follow a generic schema; the input is validated against it either way.
      { title, description, inputSchema: schema.extend(projectId) as unknown as z.ZodObject<typeof projectId>, annotations },
      async (input: { project_id?: string }) =>
        run(() => withProject(userId, input.project_id, (doc) => fn(doc, input as z.infer<S>))),
    );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "The user's projects (newest first); `active` marks the one tools use by default.",
      annotations: { readOnlyHint: true },
    },
    async () => run(async () => JSON.stringify(await listProjects(userId))),
  );

  server.registerTool(
    "open_project",
    {
      title: "Open project",
      description: "Make a project the default target of the other tools.",
      inputSchema: z.object({ project_id: z.string().uuid() }),
    },
    async ({ project_id }) => run(async () => (await setActiveProject(userId, project_id), "Opened.")),
  );

  server.registerTool(
    "get_document",
    {
      title: "Get document",
      description: "Return the project name, the selected node ids and every node (z-order, bottom to top).",
      inputSchema: z.object(projectId),
      annotations: { readOnlyHint: true },
    },
    async ({ project_id }) =>
      run(() =>
        withProject(userId, project_id, async (doc, project) => {
          const selection = await activeSelection(userId);
          return JSON.stringify({ project_id: project.id, name: project.name, selection, nodes: doc.nodes() });
        }),
      ),
  );

  docTool("create_nodes", "Create nodes", docTools.descriptions.createNodes, docTools.schemas.createNodes, docTools.createNodes);
  docTool("update_nodes", "Update nodes", docTools.descriptions.updateNodes, docTools.schemas.updateNodes, docTools.updateNodes, {
    idempotentHint: true,
  });
  docTool("delete_nodes", "Delete nodes", docTools.descriptions.deleteNodes, docTools.schemas.deleteNodes, docTools.deleteNodes, {
    destructiveHint: true,
    idempotentHint: true,
  });
  docTool("reorder_node", "Reorder node", docTools.descriptions.reorderNode, docTools.schemas.reorderNode, docTools.reorderNode);
  docTool("group_nodes", "Group nodes", docTools.descriptions.groupNodes, docTools.schemas.groupNodes, docTools.groupNodesTool);
  docTool("ungroup_nodes", "Ungroup nodes", docTools.descriptions.ungroupNodes, docTools.schemas.ungroupNodes, docTools.ungroupNodesTool);
  docTool("organize_layers", "Organize layers", docTools.descriptions.organizeLayers, docTools.schemas.organizeLayers, (doc) =>
    docTools.organizeLayers(doc),
  );
  docTool("import_image", "Import image", docTools.descriptions.importImage, docTools.schemas.importImage, (doc, input) =>
    docTools.importImage(doc, userId, input),
  );

  server.registerTool(
    "select_nodes",
    {
      title: "Select nodes",
      description: "Set the selection in the user's open editor (an empty list clears it). Useful to point at what you changed.",
      inputSchema: z.object({ ids: z.array(z.string()), ...projectId }),
      annotations: { idempotentHint: true },
    },
    async ({ ids, project_id }) =>
      run(async () => {
        const project = await loadProject(userId, (await listProjects(userId)).find((p) => p.id === project_id || (!project_id && p.active))?.id ?? project_id ?? "");
        const known = new Set(project.document.nodes.map((n) => n.id));
        await broadcast(project.id, { type: "select", ids: ids.filter((id) => known.has(id)) });
        return "Selected.";
      }),
  );

  return server;
});

export const mcpNodeHandler = toNodeHandler(handler);
