# Orbit

Jogo 2D top down de extração espacial cooperativa para navegador. Uma tripulação pilota uma nave, explora o setor, recupera recursos e precisa alcançar a extração para guardar as recompensas no inventário permanente.

**Nome provisório:** Orbit. **Estado atual:** protótipo técnico da versão 0.1.0. Duas ou mais pessoas entram na mesma sala de desenvolvimento, caminham dentro da nave e uma delas pilota a nave pelo setor. Ainda não há contas, inventário, loot, extração nem classes jogáveis; essas funções seguem o [roadmap](docs/08-ROADMAP.md).

## A experiência

- Tripulação inicial de 1 a 4 jogadores, com Piloto, Engenheiro, Médico e Oficial.
- Nave compartilhada, exploração a pé, caminhada espacial e combate.
- Asteroides mineráveis, ruínas, estações e piratas controlados pelo servidor.
- Inventário persistente, equipamentos, contratos individuais, loja e personalização.
- Extração bem-sucedida conserva os itens recuperados; morrer ou perder a nave põe a carga da missão em risco.
- Cooperação PvE até 1.0; equipes contra equipes são uma expansão posterior.

O tamanho da tripulação, a duração das partidas e os números de balanceamento são propostas iniciais configuráveis, não requisitos impostos pela ideia original.

## Stack definida

| Camada | Escolha | Responsabilidade |
| --- | --- | --- |
| Linguagem | TypeScript em modo estrito | Cliente, servidor e módulos de regras compartilhadas |
| Jogo no navegador | Phaser 4 | Canvas/WebGL, cenas, câmera, sprites e entrada |
| Menus | React + Vite | Conta, party, inventário, loja, equipamentos e resultados |
| Backend | Node.js 24 LTS + Colyseus 0.18 | Salas, simulação autoritativa, mensagens e reconexão |
| API HTTP | Rotas do Colyseus | Conta, sessão e operações persistentes |
| Dados | PostgreSQL + Drizzle ORM estável + pg | Migrações e transações do inventário/economia |
| Ferramentas | pnpm, ESLint, Prettier, Vitest e Playwright | Workspace, qualidade e verificação |
| Operação | Docker Compose + Caddy | Backend, banco, arquivos estáticos e HTTPS/WSS |

As versões exatas estão travadas em `pnpm-lock.yaml` e listadas em [docs/04-ARQUITETURA.md](docs/04-ARQUITETURA.md), junto com os critérios de compatibilidade. Não usar pacotes beta/RC como padrão. Na 0.1, Caddy e o deploy ainda não foram configurados.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [Visão e escopo](docs/01-VISAO-E-ESCOPO.md) | Objetivo, premissas e limite da primeira entrega |
| [Regras de gameplay](docs/02-GAMEPLAY.md) | Exploração, sobrevivência, loot e extração |
| [Classes e balanceamento](docs/03-CLASSES.md) | Passivos, habilidades, fórmulas e combinações |
| [Arquitetura](docs/04-ARQUITETURA.md) | Stack, módulos, dependências e organização |
| [Rede e autoridade](docs/05-REDE-E-AUTORIDADE.md) | Simulação, segurança, mensagens e desempenho |
| [Dados e economia](docs/06-DADOS-E-ECONOMIA.md) | SQL, reservas, compras e liquidação da partida |
| [Fluxos e interface](docs/07-FLUXOS-E-INTERFACE.md) | Menus, controles, arte simples e onboarding |
| [Roadmap](docs/08-ROADMAP.md) | Marcos de 0.1 a 1.0 e critérios de liberação |
| [Tarefas](docs/09-TASKS.md) | Backlog com IDs, dependências e aceite |
| [GitHub e versões](docs/10-GITHUB-E-VERSOES.md) | Issues, branches, PRs, tags e releases |
| [Qualidade](docs/11-QUALIDADE.md) | Testes necessários e matriz de aceite |
| [Operação](docs/12-OPERACAO.md) | Deploy, observabilidade, backup e falhas |
| [Decisões](docs/13-DECISOES.md) | Escolhas iniciais, riscos e pontos ajustáveis |
| [Cobertura dos requisitos](docs/14-REQUISITOS.md) | Onde cada função será entregue e verificada |
| [Fontes](docs/15-FONTES.md) | Documentação oficial consultada |

## Marcos principais

| Versão | Resultado esperado |
| --- | --- |
| 0.1 | Duas pessoas conectam e movimentam personagem/nave no mesmo protótipo |
| 0.2 | Contas, party, preparação e inventário básico |
| 0.3 | Primeira missão completa: entrar, coletar, extrair e guardar |
| 0.4 | Nave com funções cooperativas, Piloto e Engenheiro |
| 0.5 | EVA, mineração e ruínas |
| 0.6 | Médico, cultivo, seringas e combate pessoal do Oficial |
| 0.7 | Estações, armamento da nave e piratas capazes de roubar carga |
| 0.8 | Loja, personalização, mais naves e contratos individuais |
| 0.9 | Todas as funções integradas e fluxo completo aprovado |
| 1.0 | Polimento, balanceamento, desempenho e lançamento |

Cada marco tem seu próprio critério de aceite. Um título de release não substitui os testes nem implica que funções futuras já estejam prontas.

## Desenvolvimento

Monorepo pnpm com `apps/web` (React + Phaser), `apps/server` (Colyseus) e os pacotes `contracts` (mensagens e schemas de validação), `catalog` (definições versionadas), `simulation` (matemática pura de movimento e colisão) e `database` (pool, schema e migrações). O domínio não depende de Phaser, React, Colyseus nem do banco; uma regra de lint impede essas importações. O servidor simula posições e colisões; o cliente envia intenções, interpola e apresenta o estado autorizado.

### Requisitos

- Node.js 24 LTS (`.node-version`).
- pnpm 12.9.1, a versão declarada em `packageManager`.
- Docker, apenas para o PostgreSQL de desenvolvimento.

### Comandos

Executados e verificados no Windows 11 com Node 24.18.0 e pnpm 12.9.1, e no CI (Ubuntu):

| Comando | Efeito |
| --- | --- |
| `pnpm install --frozen-lockfile` | Instala exatamente as versões do lockfile |
| `pnpm dev` | Servidor de jogo em `ws://127.0.0.1:2567` e cliente em `http://127.0.0.1:5173` |
| `pnpm lint` / `pnpm format:check` | ESLint e Prettier |
| `pnpm typecheck` | TypeScript estrito em todos os pacotes |
| `pnpm test` | Testes unitários e de integração com servidor e clientes SDK reais |
| `pnpm build` | Bundle do servidor (`apps/server/dist`) e build estático do cliente (`apps/web/dist`) |
| `pnpm check` | lint, format:check, typecheck, test e build em sequência |
| `pnpm db:up` / `pnpm db:down` | Sobe/derruba o PostgreSQL 18 de `infra/compose.dev.yml` |
| `pnpm db:migrate` | Aplica as migrações em `DATABASE_URL` |
| `pnpm db:smoke` | Cria um banco descartável, migra duas vezes, confere o schema e as conexões encerradas |
| `pnpm build && pnpm e2e` | Teste multiplayer com dois navegadores sobre o build de produção |

Copie `.env.example` para `.env` antes de usar os comandos de banco. O `pnpm e2e` usa as portas 2567 e 4173; encerre o `pnpm dev` antes. Na primeira vez, instale o navegador com `pnpm exec playwright install chromium`.

### Abrir duas sessões no protótipo

1. Rode `pnpm install --frozen-lockfile` e depois `pnpm dev`.
2. Abra `http://127.0.0.1:5173` em duas janelas separadas (por exemplo, uma janela normal e outra anônima, ou dois navegadores).
3. Em cada janela, informe um nome (opcional) e clique em **Entrar na sala**. As duas entram na mesma sala e aparecem na lista do painel.
4. **WASD** ou setas movem o tripulante dentro da nave. Para pilotar, passe pela porta da ponte até o círculo amarelo do console e pressione **E**. No comando, **W/S** aceleram/freiam e **A/D** giram. **E** ou **Esc** liberam o comando.
5. A outra janela vê a mesma nave se mover. Se ela tentar assumir o comando ocupado, o painel informa o motivo.

### Limitações da 0.1

- Sala de desenvolvimento anônima: não há conta nem sessão. Origem e versão de protocolo são validadas; sem cabeçalho Origin, a conexão só é aceita fora de produção.
- Até 4 tripulantes por sala; uma quinta pessoa cria outra sala.
- Sem previsão local: o próprio personagem aparece com cerca de 100 ms mais a latência. Os outros jogadores e a nave são interpolados; previsão e reconciliação do jogador local ficam para depois de estabilizar o fluxo.
- Uma queda reserva o assento por 60 s. O tripulante aparece como "reconectando", e fechar a aba deixa o personagem na sala até esse prazo. A detecção depende do heartbeat do servidor e pode levar alguns segundos.
- Um único setor fixo, um casco de nave e colisão por círculos contra asteroides. Não há dano, boost, consoles extras, EVA nem combate.
- O banco tem só a migração baseline (`app_metadata`); o servidor de jogo ainda não usa o PostgreSQL.
- Sem deploy, HTTPS nem proxy. Use apenas em ambiente de desenvolvimento.

Para contribuir, veja [CONTRIBUTING.md](CONTRIBUTING.md). Alterações de escopo precisam aparecer no roadmap e na matriz de requisitos.

## Licença

Código e documentação própria sob a [licença MIT](LICENSE), Copyright (c) 2026 Dionel. Licenças de dependências e assets de terceiros devem ser registradas junto aos arquivos correspondentes.
