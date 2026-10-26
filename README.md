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

## Começando

```bash
npm install
cp .env.example .env   # preencha ANTHROPIC_API_KEY
npm run dev
```

Abra http://localhost:5173. A API roda em http://localhost:8787 (o Vite faz proxy de `/api`).

Produção: `npm run build && npm start` (o servidor Express também serve o `dist/`).

## Arquitetura

```
shared/types.ts        modelo do documento (DesignNode), operações (DocOp) e eventos SSE
server/index.ts        Express: POST /api/ai (SSE) + arquivos estáticos em produção
server/ai.ts           agente de design: Tool Runner do SDK da Anthropic + ferramentas Zod
src/store.ts           estado do editor (zustand), histórico de undo, persistência
src/components/        Canvas, Toolbar, LayersPanel, PropertiesPanel, AiPanel
```

A chave da API fica só no servidor. O cliente envia o documento atual, a seleção e o histórico do
chat; o servidor executa o loop de ferramentas sobre uma cópia do documento e envia cada mutação
como um evento `op`, que o editor aplica com a mesma função `applyOp` usada no servidor.

### Configuração do modelo

| Variável | Padrão | |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-5-5` | modelo usado |
| `CLAUDE_EFFORT` | `medium` | `low` / `medium` / `high` / `xhigh` / `max` |

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
