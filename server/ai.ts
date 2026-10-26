import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import {
  NODE_DEFAULTS,
  applyOp,
  uid,
  type AiEvent,
  type AiRequest,
  type DesignNode,
  type DocOp,
} from "../shared/types.ts";
import { getSettings, resolveApiKey } from "./settings.ts";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";

const SYSTEM_PROMPT = `You are a design assistant embedded in a Figma-like vector editor.
You edit the user's canvas only through the provided tools; every tool call is applied live to their screen.

Canvas model:
- Coordinates are in pixels, origin at the top-left, y grows downward.
- Nodes are flat (no nesting). Array order is z-order: later nodes render on top.
  A "frame" is a background container (e.g. a screen or card); put its contents after it so they render above.
- Colors are hex strings like "#1E1E1E". Use "transparent" for no fill.
- Text nodes use "fill" as the text color; width/height define the text box.

Guidelines:
- Produce clean, well-aligned layouts on an 8px grid with consistent spacing, sensible type scale and good contrast.
- Prefer create_nodes with many nodes in one call over many single calls.
- Give every node a meaningful name (it appears in the layers panel).
- When the user refers to "this" or "selected", use the selected node ids.
- You may also have tools from connected MCP servers (data, icons, design systems…). Use them when they help.
- Place new work in empty space unless asked to modify existing nodes; call get_document if you need fresh coordinates.
- After editing, reply with one or two short sentences describing what you changed. Reply in the user's language.`;

const colorSchema = z.string().describe('Hex color like "#3B82F6", or "transparent"');

const nodeFields = {
  name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional().describe("Degrees, clockwise"),
  fill: colorSchema.optional(),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().optional(),
  cornerRadius: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  text: z.string().optional().describe("Text content (text nodes only)"),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional().describe("100-900"),
  fontFamily: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
};

const newNodeSchema = z.object({
  type: z.enum(["frame", "rect", "ellipse", "text"]),
  ...nodeFields,
});

function createNode(input: z.infer<typeof newNodeSchema>): DesignNode {
  const { type, ...rest } = input;
  const base: DesignNode = {
    ...NODE_DEFAULTS,
    id: uid(),
    type,
    name: type === "text" ? (input.text ?? "Text").slice(0, 32) : type[0].toUpperCase() + type.slice(1),
  };
  if (type === "text") {
    Object.assign(base, { fill: "#000000", fontSize: 16, fontWeight: 400, fontFamily: "Inter", textAlign: "left", text: "Text", height: 24 });
  }
  if (type === "frame") base.fill = "#FFFFFF";
  return { ...base, ...stripUndefined(rest) };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export class MissingApiKeyError extends Error {}

export async function createClient(apiKey?: string) {
  const key = apiKey ?? (await resolveApiKey());
  if (!key) throw new MissingApiKeyError("Nenhuma chave da API configurada. Abra as configurações (⚙) para adicionar.");
  return new Anthropic({ apiKey: key });
}

export async function runDesignAgent(req: AiRequest, emit: (e: AiEvent) => void, signal: AbortSignal) {
  const client = await createClient();
  const mcpServers = (await getSettings()).mcpServers.filter((m) => m.enabled);

  // Working copy the tools mutate, so later tool calls see earlier results.
  let nodes = structuredClone(req.document.nodes);
  const apply = (op: DocOp) => {
    nodes = applyOp(nodes, op);
    emit({ type: "op", op });
  };
  const exists = (id: string) => nodes.some((n) => n.id === id);

  const tools = [
    betaZodTool({
      name: "get_document",
      description: "Return the current list of nodes on the canvas (in z-order) as JSON.",
      inputSchema: z.object({}),
      eager_input_streaming: true,
      run: async () => JSON.stringify(nodes),
    }),
    betaZodTool({
      name: "create_nodes",
      description: "Create one or more nodes. They are appended on top of the z-order in the given order. Returns the new ids.",
      inputSchema: z.object({ nodes: z.array(newNodeSchema).min(1) }),
      eager_input_streaming: true,
      run: async ({ nodes: specs }) => {
        const created = specs.map(createNode);
        for (const node of created) apply({ op: "create", node });
        return JSON.stringify(created.map((n) => ({ id: n.id, name: n.name })));
      },
    }),
    betaZodTool({
      name: "update_nodes",
      description: "Update properties of existing nodes. Only the given fields change.",
      inputSchema: z.object({
        updates: z.array(z.object({ id: z.string(), ...nodeFields })).min(1),
      }),
      eager_input_streaming: true,
      run: async ({ updates }) => {
        const missing: string[] = [];
        for (const { id, ...patch } of updates) {
          if (!exists(id)) missing.push(id);
          else apply({ op: "update", id, patch: stripUndefined(patch) });
        }
        return missing.length ? `Updated. Unknown ids skipped: ${missing.join(", ")}` : "Updated.";
      },
    }),
    betaZodTool({
      name: "delete_nodes",
      description: "Delete nodes by id.",
      inputSchema: z.object({ ids: z.array(z.string()).min(1) }),
      eager_input_streaming: true,
      run: async ({ ids }) => {
        for (const id of ids) if (exists(id)) apply({ op: "delete", id });
        return "Deleted.";
      },
    }),
    betaZodTool({
      name: "reorder_node",
      description: "Move a node to a z-order index (0 = bottom, larger = higher).",
      inputSchema: z.object({ id: z.string(), index: z.number().int().min(0) }),
      eager_input_streaming: true,
      run: async ({ id, index }) => {
        if (!exists(id)) return `Unknown id ${id}`;
        apply({ op: "reorder", id, index });
        return "Reordered.";
      },
    }),
  ];

  const context = `Document "${req.document.name}" — current nodes (z-order, bottom to top):
${JSON.stringify(nodes)}

Selected node ids: ${JSON.stringify(req.selection)}`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...req.history.map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: `${context}\n\n${req.prompt}` },
  ];

  const runner = client.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: 64000,
      output_config: { effort: EFFORT },
      // On a safety-classifier refusal, let the API re-run the request on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01", ...(mcpServers.length ? ["mcp-client-2025-11-20" as const] : [])],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      // Remote MCP servers: the Anthropic API connects to them and runs their tools server-side.
      ...(mcpServers.length && {
        mcp_servers: mcpServers.map((m) => ({
          type: "url" as const,
          name: m.name,
          url: m.url,
          ...(m.authorizationToken && { authorization_token: m.authorizationToken }),
        })),
      }),
      tools: [...tools, ...mcpServers.map((m) => ({ type: "mcp_toolset" as const, mcp_server_name: m.name }))],
      messages,
      max_iterations: 20,
      stream: true,
    },
    { signal },
  );

  for await (const stream of runner) {
    stream.on("text", (text) => emit({ type: "text", text }));
    stream.on("contentBlock", (block) => {
      if (block.type === "mcp_tool_use") emit({ type: "mcp", server: block.server_name, tool: block.name });
    });
    const message = await stream.finalMessage();
    // A long server-side (MCP) turn can pause; the runner doesn't resume it on its own.
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "Claude recusou este pedido." });
      return;
    }
    if (message.stop_reason === "max_tokens") {
      emit({ type: "error", message: "A resposta excedeu o limite de tokens." });
      return;
    }
  }
}
