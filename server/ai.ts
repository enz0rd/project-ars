import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { applyOp, type AiEvent, type AiRequest } from "../shared/types.ts";
import * as docTools from "./docTools.ts";
import type { DocTarget } from "./docTools.ts";
import { getSettings, resolveApiKey } from "./settings.ts";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";

const SYSTEM_PROMPT = `You are a design assistant embedded in a Figma-like vector editor.
You edit the user's canvas only through the provided tools; every tool call is applied live to their screen.

${docTools.CANVAS_GUIDE}
- When the user refers to "this" or "selected", use the selected node ids.
- You may also have tools from connected MCP servers (data, icons, design systems…). Use them when they help.
- Call get_document if you need fresh coordinates.
- After editing, reply with one or two short sentences describing what you changed. Reply in the user's language.`;

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
  const doc: DocTarget = {
    nodes: () => nodes,
    apply: (ops) => {
      for (const op of ops) {
        nodes = applyOp(nodes, op);
        emit({ type: "op", op });
      }
    },
  };

  const tool = <S extends z.ZodType>(name: string, description: string, inputSchema: S, run: (input: z.infer<S>) => string) =>
    betaZodTool({ name, description, inputSchema, eager_input_streaming: true, run: async (input) => run(input) });

  const tools = [
    tool("get_document", docTools.descriptions.getDocument, z.object({}), () => JSON.stringify(nodes)),
    tool("create_nodes", docTools.descriptions.createNodes, docTools.schemas.createNodes, (i) => docTools.createNodes(doc, i)),
    tool("update_nodes", docTools.descriptions.updateNodes, docTools.schemas.updateNodes, (i) => docTools.updateNodes(doc, i)),
    tool("delete_nodes", docTools.descriptions.deleteNodes, docTools.schemas.deleteNodes, (i) => docTools.deleteNodes(doc, i)),
    tool("reorder_node", docTools.descriptions.reorderNode, docTools.schemas.reorderNode, (i) => docTools.reorderNode(doc, i)),
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
