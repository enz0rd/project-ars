# Figma Claude

Um clone simples do Figma com o Claude integrado: descreva o que você quer no painel de IA e o Claude
cria e edita as camadas do canvas ao vivo.

## Recursos

- **Editor vetorial** em SVG: frames, retângulos, elipses e texto, com sombra, borda, cantos e opacidade
- **Guias inteligentes**: encaixe nas bordas e centros das outras camadas ao mover e redimensionar
  (segure Ctrl para desligar)
- Alinhar e distribuir, copiar/colar, duplicar (Ctrl+D ou Alt+arrastar), ordem de camadas, ocultar/bloquear
- Menu de clique direito, painel de atalhos (`?`), campos numéricos com arrastar no rótulo e contas (`375/2`)
- Zoom em direção ao cursor, ajustar à tela (Shift+1) e à seleção (Shift+2), grade de pontos
- Painel de camadas com busca, renomear e reordenar arrastando
- Tema claro/escuro, desfazer/refazer, salvamento automático no navegador
- Exportar **PNG** (1x/2x), **SVG** ou JSON — da seleção ou do documento inteiro
- **Painel do Claude**: o Claude usa ferramentas (`create_nodes`, `update_nodes`, `delete_nodes`,
  `reorder_node`, `get_document`) para editar o documento; cada operação é transmitida por SSE e
  aplicada no canvas enquanto ele trabalha. Toda a resposta vira **um único passo de desfazer**.
- **Tela de configurações (⚙)**: chave da API do Claude (com teste de validade), servidores MCP
  remotos que dão ferramentas extras ao Claude, e instruções para conectar o Claude Code.

## Começando

```bash
npm install
npm run dev
```

Abra http://localhost:5173 e clique em **⚙** para colar sua chave da API. (Alternativa: `cp .env.example .env`
e preencha `ANTHROPIC_API_KEY`; a chave salva pela tela tem prioridade.) A API roda em
http://127.0.0.1:8787 (o Vite faz proxy de `/api`).

## Configurações e MCP

- As configurações ficam em `data/settings.json` no servidor (fora do git, permissão `600`). A chave e os
  tokens MCP **nunca voltam para o navegador** — a tela mostra só os últimos 4 caracteres.
- O servidor escuta apenas em `127.0.0.1` e recusa `Host` e `Origin` diferentes de localhost, porque os endpoints de
  configuração podem trocar a chave em uso. Se expor com `HOST=0.0.0.0`, coloque autenticação na frente.
- Servidores MCP usam o [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
  (beta `mcp-client-2025-11-20`): quem se conecta ao servidor MCP é a API da Anthropic, então a URL precisa
  ser pública e HTTPS (`localhost` não funciona). Cada servidor pode ter um token Bearer opcional e ser
  ativado/desativado sem ser removido. As chamadas MCP aparecem no chat como `⚡ servidor › ferramenta`.

Produção: `npm run build && npm start` (o servidor Express também serve o `dist/`).

## Controlar o editor pelo Claude Code / Claude Desktop (MCP)

O servidor também é um **servidor MCP** em `http://127.0.0.1:8787/mcp` (Streamable HTTP). Com o editor
aberto no navegador, o Claude Code ou o Desktop consegue ler e editar o canvas ao vivo.

```bash
claude mcp add --transport http figma-claude http://127.0.0.1:8787/mcp
```

Ferramentas: `get_document`, `create_nodes`, `update_nodes`, `delete_nodes`, `reorder_node`, `select_nodes`.
Cada chamada vira um passo de desfazer no editor. Sem nenhum editor aberto, as ferramentas respondem com
erro pedindo para abrir o app. Com várias abas abertas, o MCP age **só na aba usada mais recentemente**
(o indicador no topo mostra "MCP nesta aba").

Como funciona: cada aba abre `GET /api/live` (SSE), recebe um id de sessão e envia um snapshot do documento
a cada mudança (`PUT /api/live/document`). As ferramentas MCP editam o snapshot da aba ativa e transmitem as
operações só para ela. Snapshots atrasados (anteriores à última operação MCP) são ignorados.

## Arquitetura

```
shared/types.ts        modelo do documento (DesignNode), operações (DocOp) e eventos SSE
server/index.ts        Express: POST /api/ai (SSE) + arquivos estáticos em produção
server/ai.ts           agente de design: Tool Runner do SDK da Anthropic + ferramentas Zod + MCP
server/docTools.ts     ferramentas de edição do canvas, compartilhadas entre o agente e o MCP
server/live.ts         ponte ao vivo navegador ↔ servidor (snapshot + SSE)
server/mcp.ts          servidor MCP em /mcp
server/settings.ts     chave da API e servidores MCP persistidos em data/settings.json
src/store.ts           estado do editor (zustand), histórico de undo, persistência
src/actions.ts         comandos do editor (alinhar, colar, zoom, exportar…) usados por atalhos e menus
src/geometry.ts        caixas, guias inteligentes e snapping
src/export.ts          exportação SVG/PNG
src/ui.ts              estado da interface (tema, abas, menus, toasts)
src/settings.ts        estado da tela de configurações
src/live.ts            sincroniza o editor com a ponte ao vivo
src/components/        Canvas, TopBar, ToolDock, LayersPanel, RightPanel, PropertiesPanel, AiPanel, …
```

A chave da API fica só no servidor. O cliente envia o documento atual, a seleção e o histórico do
chat; o servidor executa o loop de ferramentas sobre uma cópia do documento e envia cada mutação
como um evento `op`, que o editor aplica com a mesma função `applyOp` usada no servidor.

### Configuração do modelo

| Variável | Padrão | |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-5-5` | modelo usado |
| `CLAUDE_EFFORT` | `medium` | `low` / `medium` / `high` / `xhigh` / `max` |
| `HOST` | `127.0.0.1` | interface de rede da API |
| `DATA_DIR` | `./data` | onde fica `settings.json` |

As requisições usam `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): se um
classificador de segurança recusar o pedido, a API refaz a chamada automaticamente em um modelo de
fallback recomendado.

## Atalhos

Aperte `?` no app para ver a lista completa. Os principais:

| Tecla | Ação |
|---|---|
| V / H / F / R / O / T | Mover / Mão / Frame / Retângulo / Elipse / Texto |
| Espaço + arrastar, Ctrl + scroll | Pan, zoom |
| Shift+1 / Shift+2 / Shift+0 | Ajustar à tela / à seleção / 100% |
| Ctrl+Z / Ctrl+Shift+Z | Desfazer / refazer |
| Ctrl+C / X / V / D | Copiar / recortar / colar / duplicar |
| Ctrl+] / Ctrl+[ (com Shift: frente/trás) | Ordem das camadas |
| Alt+A / D / W / S / H / V | Alinhar |
| Ctrl+K | Perguntar ao Claude |

## Próximos passos

- Grupos e frames aninhados, auto layout
- Enviar uma captura do canvas ao Claude (visão) para ele avaliar o próprio layout
- Colaboração em tempo real (CRDT/Yjs)
