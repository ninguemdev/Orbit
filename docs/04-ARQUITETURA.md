# Arquitetura e stack

## Decisão principal

Usar um monorepo TypeScript com Phaser no jogo, React nos menus e Node/Colyseus no servidor. Colyseus oferece salas, sincronização e reconexão, mas as regras do produto continuam em módulos próprios. PostgreSQL mantém contas, inventário, economia e resultados.

Escolha adequada para um jogo de navegador com entidades simples, física arcade e partidas pequenas. A capacidade real depende de simulação, quantidade de entidades e tráfego; o framework sozinho não garante milhares de jogadores.

## Versões e compatibilidade

Consulta de referência: 14/10/2026. Phaser 4.2.1 aparece como release estável oficial; Colyseus publica a linha 0.18. Node 24 está em LTS. Usar essas famílias como ponto inicial e validar a integração no primeiro milestone.

- Phaser 4 estável, sem copiar APIs antigas de renderer do Phaser 3.
- Colyseus 0.18 com SDK `@colyseus/sdk` e pacote Schema compatível; não misturar SDK de tutorial 0.15/0.16.
- Node 24 LTS e pnpm com versão exata declarada em `packageManager`.
- React, Vite, Vitest e Playwright estáveis e compatíveis com o Node escolhido.
- PostgreSQL em uma versão suportada, inicialmente 18 como baseline conservador.
- Drizzle ORM e ferramenta de migração em versões estáveis compatíveis com `pg`. A documentação corrente pode mostrar RC; não copiar esse install automaticamente. Se a combinação estável falhar no spike, usar `pg` com SQL e registrar a decisão antes de ampliar o projeto.

Travar o lockfile, não depender de tags `latest` no deploy e atualizar dependências por PR pequeno com validação. A versão do jogo não é a versão das bibliotecas.

### Versões verificadas na 0.1 (15/10/2026)

Instaladas pelo `pnpm-lock.yaml` e exercitadas por build, testes de integração e teste com dois navegadores.

| Componente | Versão | Observação |
| --- | --- | --- |
| Node.js | 24 LTS (24.18.0 no ambiente local) | `.node-version` e `engines` |
| pnpm | 12.9.1 | `packageManager`; `minimumReleaseAge` padrão mantido, sem exceções |
| TypeScript | 6.0.3 | 7.0 existe, mas typescript-eslint 8.71 aceita apenas `<6.1` (D16) |
| Phaser | 4.2.1 | Importado como `import * as Phaser`; carregado sob demanda |
| React / React DOM | 19.3.0 | 19.3.1 tinha menos de um dia e só altera Server Components |
| Vite / plugin React | 8.3.4 / 6.1.2 | |
| @colyseus/core / ws-transport | 0.18.18 / 0.18.4 | Sem o pacote agregador `colyseus` (Redis, monitor, playground) |
| @colyseus/schema | 5.0.39 | API `schema()`/`t`, sem decorators; 5.0.40 tinha menos de um dia |
| @colyseus/sdk | 0.18.5 | Mesmo SDK no navegador e nos testes de integração |
| zod | 4.6.7 | Validação de mensagens em runtime |
| PostgreSQL | 18.6 (imagem `postgres:18.6-alpine`) | Desenvolvimento e CI |
| pg / drizzle-orm / drizzle-kit | 8.23.1 / 0.45.4 / 0.31.11 | Linha estável; a combinação funcionou, sem RC |
| Vitest / Playwright | 5.0.4 / 1.64.0 | Playwright 1.64.1 tinha menos de um dia |
| ESLint / typescript-eslint / Prettier | 10.12.0 / 8.71.2 / 3.9.10 | |

## Organização planejada

| Caminho | Conteúdo |
| --- | --- |
| `apps/web/src/ui` | React: acesso, party, inventário, loja e resultados |
| `apps/web/src/game` | Phaser: cenas, câmera, entrada, renderização e áudio |
| `apps/web/src/network` | Adaptador do SDK, estado remoto, reconexão e ponte com UI |
| `apps/server/src/transport` | Rotas HTTP, autenticação e adaptadores Colyseus |
| `apps/server/src/modules` | Casos de uso de contas, party, expedição, extração e loja |
| `apps/server/src/simulation` | Orquestração da sala e sistemas do tick |
| `apps/server/src/infrastructure` | Banco, logs, relógio e adaptadores externos |
| `packages/contracts` | Mensagens públicas, schemas de entrada, DTOs e códigos de erro |
| `packages/simulation` | Matemática pura de movimento, modificadores e colisões simples |
| `packages/catalog` | IDs e definições versionadas de classes, itens, naves e receitas |
| `packages/database` | Schema, migrações e implementação dos repositórios SQL |
| `tests/e2e` | Fluxos completos com clientes reais |
| `tests/load` | Clientes sintéticos e relatórios reproduzíveis de carga |
| `infra` | Dockerfiles, Compose, proxy e instruções de operação |
| `docs` | Regras e documentação do produto |

Na 0.1 existem `apps/web` (`ui`, `game`, `network`), `apps/server` (`transport`, `simulation`), os quatro pacotes, `tests/e2e` e `infra/compose.dev.yml`. `apps/server/src/modules`, `apps/server/src/infrastructure` e `tests/load` serão criados quando existirem casos de uso persistentes e ensaios de carga.

## Fronteiras de responsabilidade

| Módulo | Responsável por | Não deve controlar |
| --- | --- | --- |
| Identity | Cadastro, hash de senha, sessão e recuperação | Posição da nave ou distribuição de loot |
| Party | Membros, líder, convite, prontidão e seleção | Inventário confiando em dados do cliente |
| Loadout | Validar/reservar equipamento e acesso à nave | Simulação visual |
| Expedition | Roster congelado, lifecycle e estado do setor | SQL a cada frame |
| Ship | Comando, motor, casco, oxigênio, consoles e armas | Propriedade de conta |
| Crew | Vida, stamina, classe, EVA, movimento e buffs | Pagamento final de contratos |
| Exploration | Mineração, ruínas, docas e interações | Confirmar extração no navegador |
| Combat/AI | Projéteis, dano, facções, calor e piratas | Conceder itens permanentes diretamente |
| Medical | Horta, ingredientes, craft e aplicação | Crescimento pelo relógio do cliente |
| Loot | Itens temporários, origem, transporte e transferências | Saldo permanente fora de liquidação |
| Economy | Stash, caixa de recebimento, compra e venda | Resultado de dano recebido do cliente |
| Contracts | Objetivos e progresso autorizado | Recompensa por simples botão de conclusão |
| Settlement | Manifesto, elegibilidade e transação final | Renderização ou retry que repete concessão |

## Regras de dependência

Domínio usa tipos simples, funções e portas de repositório/relógio. Adaptadores HTTP, Colyseus, Phaser e SQL dependem do domínio; o domínio não importa esses frameworks. Pacotes compartilhados não importam código de apps. Cliente não importa `packages/database` nem módulos privados do servidor.

Uma cena Phaser apresenta estado e produz intenção; não é dona de inventário, dano ou classe. React acompanha eventos e projeções da partida, sem colocar cada posição e projétil no ciclo de renderização da UI. Atualizar HUD por eventos ou em frequência limitada, por exemplo 5 a 10 Hz.

`ExpeditionRoom` valida e encaminha mensagens, administra conexões e chama o tick. Separar sistemas de movimento, trabalho, combate, efeitos, loot e objetivos em vez de concentrar tudo em uma classe de sala.

Não criar uma interface para toda função. Portas são úteis nas fronteiras que precisam de substituição ou verificação: transações, relógio, aleatoriedade, repositórios e emissão de eventos. Preferir composição e dados explícitos a heranças extensas.

## Simulação e espaços de coordenadas

Setor externo usa coordenadas mundiais e colisores circulares simplificados. Interiores usam malha estática de retângulos ou tiles. O `spaceId` identifica setor, nave ou interior de ponto de interesse. Mover entre espaços é uma transição validada pelo servidor.

O exterior não precisa simular o peso de cada tripulante. Dentro da nave, a velocidade e colisão do personagem são locais. EVA recebe a posição transformada e a velocidade da nave ao sair. Essa separação permite a nave se mover sem recalcular toda a geometria interna em cada tick.

## Preparação para equipes contra equipes

Toda entidade tem `entityId`, `teamId`, `factionId` e regras de relacionamento. Uma equipe possui nave, roster e política de distribuição de carga. `CombatPolicy` decide quem pode atacar quem, em vez de comparações espalhadas como `isPlayer`.

Usar múltiplas equipes na estrutura de dados mesmo com uma equipe humana inicial. Filtrar visibilidade por destinatário; não enviar loot oculto ou todos os inventários aos clientes. Protocolos recebem versão e limites de entidade por setor.

Expansão PvP vai exigir matchmaking, múltiplos spawns, distribuição de extrações, proteção de início, análise de latência, antiabuso e testes com adversários reais. A base reduz retrabalho; não elimina essas tarefas.

## Deploy inicial

Cliente estático e backend ficam sob a mesma origem HTTPS. Caddy entrega arquivos e encaminha HTTP/WSS para o processo Node. Banco privado, pool de conexões limitado e logs estruturados. Começar com um processo de jogo; adicionar múltiplos processos, presença compartilhada ou Redis somente após medir necessidade.

Não usar serverless de curta duração para hospedar a simulação. Ela precisa de conexão WebSocket e processo contínuo. Sem SSR no loop do jogo. Detalhes em [operação](12-OPERACAO.md).
