# Orbit

Jogo 2D top down de extração espacial cooperativa para navegador. Uma tripulação pilota uma nave, explora o setor, recupera recursos e precisa alcançar a extração para guardar as recompensas no inventário permanente.

**Nome provisório:** Orbit. **Estado atual:** versão 0.2 (preparação persistente). Cada jogador cria uma conta com nick e senha, forma uma party de até 4, escolhe classe, loadout do próprio stash e uma nave da união das licenças da party, e o líder confirma a prontidão; tudo fica salvo na conta. A sala de testes da 0.1 continua disponível: duas ou mais pessoas caminham dentro da nave e uma pilota pelo setor. Ainda não há missão com a party, loot, extração nem efeitos de classe; essas funções seguem o [roadmap](docs/08-ROADMAP.md).

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
| `pnpm dev` | Servidor de jogo e API de conta em `http://127.0.0.1:2567` (WebSocket na mesma porta) e cliente em `http://127.0.0.1:5173`; exige o banco migrado |
| `pnpm lint` / `pnpm format:check` | ESLint e Prettier |
| `pnpm typecheck` | TypeScript estrito em todos os pacotes |
| `pnpm test` | Testes unitários e de integração com servidor e clientes SDK reais |
| `pnpm build` | Bundle do servidor (`apps/server/dist`) e build estático do cliente (`apps/web/dist`) |
| `pnpm check` | lint, format:check, typecheck, test e build em sequência |
| `pnpm db:up` / `pnpm db:down` | Sobe/derruba o PostgreSQL 18 de `infra/compose.dev.yml` |
| `pnpm db:migrate` | Aplica as migrações em `DATABASE_URL` |
| `pnpm db:smoke` | Cria um banco descartável, migra duas vezes, confere o schema e as conexões encerradas |
| `pnpm db:seed-dev <nick> [--no-ships]` | Concede um conjunto fixo de itens de teste e, sem `--no-ships`, a licença da Cargueira a uma conta (recusado em produção) |
| `pnpm test:db` | Testes de integração SQL (constraints, concorrência, rollback) em bancos descartáveis; exige `pnpm db:up` |
| `pnpm build && pnpm e2e` | Teste multiplayer com dois navegadores sobre o build de produção |

Copie `.env.example` para `.env` antes de tudo: o servidor exige `DATABASE_URL` desde a 0.2. Antes do `pnpm dev`, rode `pnpm db:up` e `pnpm db:migrate`. O `pnpm e2e` usa as portas 2567 a 2569 e 4173 (servidor, um proxy TCP que simula quedas de rede e o cliente); encerre o `pnpm dev` antes. Na primeira vez, instale o navegador com `pnpm exec playwright install chromium`.

### Abrir duas sessões no protótipo

1. Rode `pnpm install --frozen-lockfile`, copie `.env.example` para `.env`, rode `pnpm db:up`, `pnpm db:migrate` e depois `pnpm dev`.
2. Abra `http://127.0.0.1:5173` em duas janelas separadas (por exemplo, uma janela normal e outra anônima, ou dois navegadores). Cada janela precisa da sua própria sessão.
3. Em cada janela, crie uma conta em **Criar conta** (nick e senha de pelo menos 12 caracteres) ou entre com uma existente, e clique em **Entrar na sala**. As duas entram na mesma sala, identificadas pelo nick.
4. **WASD** ou setas movem o tripulante dentro da nave. Para pilotar, passe pela porta da ponte até o círculo amarelo do console e pressione **E**. No comando, **W/S** aceleram/freiam e **A/D** giram. **E** ou **Esc** liberam o comando.
5. A outra janela vê a mesma nave se mover. Se ela tentar assumir o comando ocupado, o painel informa o motivo.

### Party

Depois de entrar na conta, cada jogador já está numa party só sua, com um código de 6 caracteres. Para jogar junto:

- Digite o código de outra party em **Entrar em outra party**; ou
- Como líder, convide pelo nick em **Convidar jogador online**; a outra pessoa aceita no próprio menu.

Cada jogador escolhe a própria classe para a próxima missão (Piloto, Engenheiro, Médico ou Oficial; repetir é permitido), a escolha fica salva na conta e todos veem o roster. Nesta versão a classe só identifica a função e restringe armas (o fuzil longo é do Oficial); os efeitos entram nas versões indicadas no menu. O líder pode **Passar liderança** e **Remover** membros (até 4 por party). Quem sai volta para uma party só sua; se o líder sai, o membro mais antigo assume. A sala de desenvolvimento ainda é compartilhada por todos, independentemente da party.

Para preparar a missão:

- **Inventário:** toda conta começa com 200 créditos e a licença da Batedora. Para ter itens de teste, rode `pnpm db:seed-dev <nick>` e clique em **Atualizar** no inventário.
- **Loadout:** escolha arma principal, arma secundária, ferramenta e até 8 itens de mochila entre os itens do seu stash e clique em **Salvar loadout**. O servidor recusa item de outra conta, espaço errado e arma de outra classe. Os itens continuam no stash; a reserva para a partida começa na 0.3.
- **Nave:** a party pode usar qualquer nave liberada por um dos membros, e o painel mostra quem libera cada uma. O líder escolhe.
- **Prontidão:** cada membro clica em **Estou pronto**, e o líder clica em **Confirmar preparação** quando todos estiverem prontos. Qualquer mudança na party, na classe, na nave ou no loadout desfaz a prontidão de todos.

### API de conta

Rotas JSON no servidor de jogo, com sessão em cookie `orbit_session` (HttpOnly, SameSite=Strict, 7 dias; `Secure` em produção):

| Rota | Uso |
| --- | --- |
| `POST /api/accounts` | Cadastro com `{ nick, password }` (nick de 3 a 20 caracteres `[A-Za-z0-9_]`, senha de 12 a 128) |
| `POST /api/sessions` | Login; erro igual para nick inexistente e senha errada |
| `DELETE /api/sessions/current` | Logout, revogando a sessão no servidor |
| `GET /api/me` | Conta e perfil da sessão |
| `PATCH /api/me/profile` | Altera a cor do próprio perfil (opções do catálogo) |
| `POST /api/me/recovery-code` | Gera um código de recuperação (mostrado uma vez; substitui o anterior) |
| `GET /api/me/inventory` | Créditos, stash, caixa de recebimento e naves liberadas da própria conta |
| `GET /api/me/loadout` | Loadout da próxima missão, com o problema de cada item (ex.: classe trocada) |
| `PUT /api/me/loadout` | Substitui o loadout (`{ picks: [{ slot, instanceId }] }`); o servidor confere dono, espaço e classe |
| `POST /api/me/stash/move` | Move um item entre espaços do próprio stash (`{ fromSlot, toSlot }`) |
| `POST /api/recovery` | Define nova senha com `{ nick, code, newPassword }`; o código vale uma vez e encerra as outras sessões |

O cliente chama a API pela própria origem: em `pnpm dev` e `vite preview`, o Vite repassa `/api` ao servidor de jogo, como fará o proxy reverso em produção.

Escritas exigem `Content-Type: application/json` e uma origem de `ALLOWED_ORIGINS`. Login e cadastro têm limite por endereço e por nick. Atrás de proxy reverso, configure `TRUST_PROXY` com o número de saltos.

### Limitações atuais

- Sala de desenvolvimento anônima: não há conta nem sessão. Origem e versão de protocolo são validadas; sem cabeçalho Origin, a conexão só é aceita fora de produção.
- Até 4 tripulantes por sala; uma quinta pessoa cria outra sala.
- Sem previsão local: o próprio personagem aparece com cerca de 100 ms mais a latência. Os outros jogadores e a nave são interpolados; previsão e reconciliação do jogador local ficam para depois de estabilizar o fluxo.
- Uma queda reserva o assento por 60 s. O tripulante aparece como "reconectando", e fechar a aba deixa o personagem na sala até esse prazo. A detecção depende do heartbeat do servidor e pode levar alguns segundos.
- Um único setor fixo, um casco de nave e colisão por círculos contra asteroides. Não há dano, boost, consoles extras, EVA nem combate.
- A sala de desenvolvimento ainda não valida a sessão: o nick da conta é usado como rótulo, e o roster autenticado chega na V03.02.
- Parties ficam na memória do processo de jogo: reiniciar o servidor desfaz as parties e a prontidão (conta, classe, inventário, licenças e loadout permanecem).
- A preparação confirmada ainda não inicia uma missão: a partida com a party, a reserva dos itens e o retorno da mochila chegam na 0.3.
- Licença de nave ganha durante a party aparece ao entrar de novo em uma party.
- Sem e-mail: quem perder a senha e não tiver gerado o código de recuperação não recupera a conta.
- Sem deploy, HTTPS nem proxy. Use apenas em ambiente de desenvolvimento.

Para contribuir, veja [CONTRIBUTING.md](CONTRIBUTING.md). Alterações de escopo precisam aparecer no roadmap e na matriz de requisitos.

## Licença

Código e documentação própria sob a [licença MIT](LICENSE), Copyright (c) 2026 Dionel. Licenças de dependências e assets de terceiros devem ser registradas junto aos arquivos correspondentes.
