import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { normalize } from "../shared/tree.ts";
import { applyOp, type AiEvent, type AiRequest } from "../shared/types.ts";
import * as docTools from "./docTools.ts";
import type { DocTarget } from "./docTools.ts";
import { env } from "./env.ts";
import { UserError } from "./errors.ts";
import { enabledMcpServers, getAiConfig, type AiConfig } from "./secrets.ts";

const SYSTEM_PROMPT = `You are a design assistant embedded in Project Ars, a vector design editor.
You edit the user's canvas only through the provided tools; every tool call is applied live to their screen.

${docTools.CANVAS_GUIDE}
- When the user refers to "this" or "selected", use the selected node ids.
- You may also have tools from connected MCP servers (data, icons, design systems…). Use them when they help.
- Call get_document if you need fresh coordinates.
- After editing, reply with one or two short sentences describing what you changed. Reply in the user's language.`;

/** Upper bound on tool-use rounds for providers without a managed tool runner. */
const MAX_ROUNDS = 25;

export async function runDesignAgent(userId: string, req: AiRequest, emit: (e: AiEvent) => void, signal: AbortSignal) {
  const config = await getAiConfig(userId);
  if (!config) throw new UserError("no_ai_provider");

  // Working copy the tools mutate, so later tool calls see earlier results.
  let nodes = structuredClone(req.document.nodes);
  const doc: DocTarget = {
    nodes: () => nodes,
    apply: (ops) => {
      for (const op of ops) {
        nodes = applyOp(nodes, op);
        emit({ type: "op", op });
      }
      nodes = normalize(nodes);
    },
  };

  const tools = toolDefinitions(doc, userId, () => nodes);
  const context = `Document "${req.document.name}" — current nodes (z-order, bottom to top):
${JSON.stringify(nodes)}

Selected node ids: ${JSON.stringify(req.selection)}`;
  const history = req.history.map((t) => ({ role: t.role, content: t.text }));
  const prompt = `${context}\n\n${req.prompt}`;

  if (config.provider === "anthropic") await runAnthropic(config, userId, tools, history, prompt, emit, signal);
  else await runOpenAi(config, tools, history, prompt, emit, signal);
}

interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (input: never) => string | Promise<string>;
}

/** The canvas tools, shared by every provider. */
function toolDefinitions(doc: DocTarget, userId: string, nodes: () => unknown): ToolDef[] {
  const def = <S extends z.ZodType>(name: string, description: string, schema: S, run: (input: z.infer<S>) => string | Promise<string>) =>
    ({ name, description, schema, run }) as ToolDef;
  return [
    def("get_document", docTools.descriptions.getDocument, z.object({}), () => JSON.stringify(nodes())),
    def("create_nodes", docTools.descriptions.createNodes, docTools.schemas.createNodes, (i) => docTools.createNodes(doc, i)),
    def("update_nodes", docTools.descriptions.updateNodes, docTools.schemas.updateNodes, (i) => docTools.updateNodes(doc, i)),
    def("delete_nodes", docTools.descriptions.deleteNodes, docTools.schemas.deleteNodes, (i) => docTools.deleteNodes(doc, i)),
    def("reorder_node", docTools.descriptions.reorderNode, docTools.schemas.reorderNode, (i) => docTools.reorderNode(doc, i)),
    def("group_nodes", docTools.descriptions.groupNodes, docTools.schemas.groupNodes, (i) => docTools.groupNodesTool(doc, i)),
    def("ungroup_nodes", docTools.descriptions.ungroupNodes, docTools.schemas.ungroupNodes, (i) => docTools.ungroupNodesTool(doc, i)),
    def("organize_layers", docTools.descriptions.organizeLayers, docTools.schemas.organizeLayers, () => docTools.organizeLayers(doc)),
    def("import_image", docTools.descriptions.importImage, docTools.schemas.importImage, (i) =>
      docTools.importImage(doc, userId, i),
    ),
  ];
}

async function callTool(tool: ToolDef, raw: unknown): Promise<string> {
  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) return `Invalid input: ${parsed.error.message}`;
  try {
    return await tool.run(parsed.data as never);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Claude (Anthropic Messages API, tool runner, remote MCP connector)

async function runAnthropic(
  config: Extract<AiConfig, { provider: "anthropic" }>,
  userId: string,
  defs: ToolDef[],
  history: { role: "user" | "assistant"; content: string }[],
  prompt: string,
  emit: (e: AiEvent) => void,
  signal: AbortSignal,
) {
  const client = new Anthropic({ apiKey: config.apiKey });
  const mcpServers = await enabledMcpServers(userId);
  const tools = defs.map((d) =>
    betaZodTool({ name: d.name, description: d.description, inputSchema: d.schema, eager_input_streaming: true, run: (i) => callTool(d, i) }),
  );

  const runner = client.beta.messages.toolRunner(
    {
      model: env.model,
      max_tokens: 64000,
      output_config: { effort: env.effort },
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
      messages: [...history, { role: "user", content: prompt }],
      max_iterations: MAX_ROUNDS,
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
    if (message.stop_reason === "refusal") return emit({ type: "error", message: "refusal" });
    if (message.stop_reason === "max_tokens") return emit({ type: "error", message: "max_tokens" });
  }
}

// Any OpenAI-compatible Chat Completions API (OpenAI, OpenRouter, Gemini, Groq, Mistral…)

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

async function runOpenAi(
  config: Extract<AiConfig, { provider: "openai" }>,
  defs: ToolDef[],
  history: { role: "user" | "assistant"; content: string }[],
  prompt: string,
  emit: (e: AiEvent) => void,
  signal: AbortSignal,
) {
  const tools = defs.map((d) => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: z.toJSONSchema(d.schema) },
  }));
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...history, { role: "user", content: prompt }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, tools }),
      redirect: "error",
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new UserError(`${res.status === 401 ? "key_rejected" : "provider_error"}: HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
    const message = body.choices?.[0]?.message;
    if (!message) throw new UserError("provider_error: empty response");
    if (message.content) emit({ type: "text", text: message.content });
    if (!message.tool_calls?.length) return;
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
    for (const call of message.tool_calls) {
      const def = defs.find((d) => d.name === call.function.name);
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments || "{}");
      } catch {
        input = undefined;
      }
      const output = def ? await callTool(def, input) : `Unknown tool ${call.function.name}`;
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }
  emit({ type: "text", text: "\n\n(stopped: too many tool rounds)" });
}
