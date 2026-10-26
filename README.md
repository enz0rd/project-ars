# Figma Claude

Um clone simples do Figma com o Claude integrado: descreva o que você quer no painel de IA e o Claude
cria e edita as camadas do canvas ao vivo.

## Recursos

- **Editor vetorial** em SVG: frames, retângulos, elipses e texto
- Selecionar, mover, redimensionar (Shift mantém proporção), seleção por área, duplicar, excluir
- Pan (espaço / botão do meio / ferramenta mão) e zoom em direção ao cursor (Ctrl + scroll)
- Painel de camadas (renomear, reordenar arrastando, ocultar, bloquear) e painel de propriedades
- Desfazer/refazer, salvamento automático no navegador, exportar/importar JSON
- **Painel do Claude**: o Claude usa ferramentas (`create_nodes`, `update_nodes`, `delete_nodes`,
  `reorder_node`, `get_document`) para editar o documento; cada operação é transmitida por SSE e
  aplicada no canvas enquanto ele trabalha. Toda a resposta vira **um único passo de desfazer**.
- **Tela de configurações (⚙)**: chave da API do Claude (com teste de validade) e servidores MCP
  remotos que dão ferramentas extras ao Claude enquanto ele desenha.

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
- O servidor escuta apenas em `127.0.0.1` e recusa `Host` diferente de localhost, porque os endpoints de
  configuração podem trocar a chave em uso. Se expor com `HOST=0.0.0.0`, coloque autenticação na frente.
- Servidores MCP usam o [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
  (beta `mcp-client-2025-11-20`): quem se conecta ao servidor MCP é a API da Anthropic, então a URL precisa
  ser pública e HTTPS (`localhost` não funciona). Cada servidor pode ter um token Bearer opcional e ser
  ativado/desativado sem ser removido. As chamadas MCP aparecem no chat como `⚡ servidor › ferramenta`.

Produção: `npm run build && npm start` (o servidor Express também serve o `dist/`).

## Arquitetura

```
shared/types.ts        modelo do documento (DesignNode), operações (DocOp) e eventos SSE
server/index.ts        Express: POST /api/ai (SSE) + arquivos estáticos em produção
server/ai.ts           agente de design: Tool Runner do SDK da Anthropic + ferramentas Zod + MCP
server/settings.ts     chave da API e servidores MCP persistidos em data/settings.json
src/store.ts           estado do editor (zustand), histórico de undo, persistência
src/settings.ts        estado da tela de configurações
src/components/        Canvas, Toolbar, LayersPanel, PropertiesPanel, AiPanel, SettingsModal
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

| Tecla | Ação |
|---|---|
| V / H / F / R / O / T | Mover / Mão / Frame / Retângulo / Elipse / Texto |
| Espaço + arrastar | Pan |
| Ctrl + scroll | Zoom |
| Ctrl+Z / Ctrl+Shift+Z | Desfazer / Refazer |
| Ctrl+D | Duplicar |
| Ctrl+A | Selecionar tudo |
| Setas (Shift = 10px) | Mover seleção |
| Delete | Excluir |
| Duplo clique no texto | Editar texto |

## Próximos passos

- Grupos e frames aninhados, auto layout
- Snapping e guias inteligentes
- Exportar PNG/SVG
- Enviar uma captura do canvas ao Claude (visão) para ele avaliar o próprio layout
- Colaboração em tempo real (CRDT/Yjs)
