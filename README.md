# Orbit

Jogo 2D top down de extração espacial cooperativa para navegador. Uma tripulação pilota uma nave, explora o setor, recupera recursos e precisa alcançar a extração para guardar as recompensas no inventário permanente.

**Nome provisório:** Orbit. **Estado atual:** planejamento; este pacote ainda não contém o jogo implementado. Os comandos de execução serão adicionados e verificados na versão 0.1.0.

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

As versões exatas serão travadas no lockfile em 0.1. Não usar pacotes beta/RC como padrão. A arquitetura e os critérios de compatibilidade estão em [docs/04-ARQUITETURA.md](docs/04-ARQUITETURA.md).

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

Monorepo com `apps/web`, `apps/server` e pacotes de contratos, catálogo, simulação e acesso a dados. O domínio deve funcionar sem depender do Phaser ou do Colyseus. Dados valiosos e regras de partida pertencem ao servidor; o cliente renderiza, prevê movimento e apresenta o estado autorizado.

O primeiro milestone criará o workspace executável, `.env.example`, migrações, scripts e CI. Este README deve ser atualizado com instruções realmente executadas, sem apresentar comandos planejados como se já funcionassem.

Para contribuir, veja [CONTRIBUTING.md](CONTRIBUTING.md). Alterações de escopo precisam aparecer no roadmap e na matriz de requisitos.

## Licença

Código e documentação própria sob a [licença MIT](LICENSE), Copyright (c) 2026 Dionel. Licenças de dependências e assets de terceiros devem ser registradas junto aos arquivos correspondentes.
