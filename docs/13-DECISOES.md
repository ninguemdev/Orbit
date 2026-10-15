# Decisões iniciais e riscos

## Registro

| ID | Decisão | Situação | Quando rever |
| --- | --- | --- | --- |
| D01 | Orbit é nome provisório | Proposta | Antes de branding/publicação |
| D02 | 1–4 jogadores por nave, classes repetidas | Proposta | Playtests e medidas de carga |
| D03 | Um setor instanciado por expedição, uma equipe humana no PvE | Base de arquitetura | Laboratório PvP após 1.0 |
| D04 | Licença de nave compõe união da party e não é consumida | Proposta | Feedback de risco/progressão |
| D05 | Boost a 400% = velocidade final ×4 | Interpretação explícita | Se a intenção for aumento de +400%, alterar para ×5 |
| D06 | Stash permanente; equipamentos levados e carga ficam em risco | Base do extractor | Playtests de frustração e onboarding |
| D07 | Kit gratuito temporário, sem venda e sem ganho de estoque | Proteção econômica | Avaliar acesso de conta sem recursos |
| D08 | Carga comum dividida sem multiplicar itens | Base econômica | Feedback de distribuição e coordenação |
| D09 | Contratos são pessoais, pagamento exige extração elegível | Base de gameplay | Balanceamento de esforço/recompensa |
| D10 | Nick/senha, sem e-mail; recuperação por código opcional | Proposta de UX | Antes de abrir cadastro público |
| D11 | Médico fabrica; todos podem usar doses prontas | Interpretação para equipe flexível | Composição sem Médico em playtest |
| D12 | Engenheiro e Oficial têm EVA ×1,25 | Balanceamento inicial | Testes de rota/tempo |
| D13 | Pg/Drizzle, estado de sala em memória e liquidação transacional | Base técnica | Volume, instrumentação e compatibilidade |
| D14 | Compensação técnica devolve originais e não loot novo | Política operacional | Dados reais de incidentes |
| D15 | PvP posterior não bloqueia 0.9/1.0 | Escopo solicitado | Definição da expansão |
| D16 | TypeScript 6.0.x em vez de 7.0: typescript-eslint 8.71 aceita apenas `<6.1` | Adotada na 0.1 | Quando typescript-eslint suportar TS 7 |
| D17 | 0.1 usa mensagens de intenção, porta de entrada própria e só interpolação; previsão nativa do Colyseus 0.18 (`defineInput`/`Predict`) fica para quando houver previsão, como mecanismo único | Adotada na 0.1 | Ao introduzir previsão do jogador local (boost na 0.4) |
| D18 | Validação manual com zod nos handlers, não `validate()` do Colyseus, que desconecta na primeira mensagem inválida | Adotada na 0.1 | Se o Colyseus oferecer rejeição sem desconexão |
| D19 | Respeitar o `minimumReleaseAge` do pnpm sem exceções; versões com menos de um dia esperam | Adotada na 0.1 | Correção de segurança que afete o projeto |
| D20 | Sala de desenvolvimento anônima, com Origin e `protocolVersion` validados; contas e ticket de assento substituem na 0.2 | Temporária (0.1) | V02.02 |
| D21 | Drizzle 0.45.4 + drizzle-kit 0.31.11 estáveis com `pg`; migração baseline `app_metadata` | Adotada na 0.1 | Ao migrar para Drizzle 1.0 estável |
| D22 | Argon2id via `@node-rs/argon2` (binários pré-compilados, sem script de instalação), máximo de 2 hashes simultâneos | Adotada na 0.2 | Medição de capacidade na máquina alvo |
| D23 | Limites de login/cadastro em memória do processo | Adotada na 0.2 | Ao rodar mais de um processo de jogo |
| D24 | Substituir a política de CORS padrão do Colyseus (reflete qualquer Origin com credenciais) pela lista `ALLOWED_ORIGINS` | Adotada na 0.2 | Se o Colyseus mudar o padrão |
| D25 | Servidor de jogo exige `DATABASE_URL` desde a 0.2 | Adotada na 0.2 | — |

Quando modificar uma decisão, registrar motivação, nova regra e documentos/tarefas afetados. Não alterar silenciosamente números centrais como velocidade de boost ou elegibilidade de extração.

## Riscos e tratamento

| Risco | Efeito | Tratamento planejado |
| --- | --- | --- |
| Escopo grande para desenvolvimento solo | Sistemas incompletos ou polimento atrasado | Ciclo completo na 0.3, conteúdo pequeno, gates e WIP limitado |
| Duplicação/perda de itens | Economia inválida e perda de confiança | Reserva, IDs, ledger, manifesto e testes concorrentes |
| Boost muito rápido | Colisões atravessadas e combate sem resposta | Sweep/subpassos, combo documentado e playtest |
| Movimentação da nave e interior | Coordenadas divergentes e desync | `spaceId`, interior local e transições autoritativas |
| Classes obrigatórias demais | Partidas inviáveis sem composição ideal | Ações básicas universais, consumíveis na loja e duplicatas permitidas |
| Roubo de pirata sem recuperação | Frustração sem contrajogo | Progresso de roubo interrompível e item rastreável na nave inimiga |
| Cultivo lento demais | Médico não consegue usar função durante expedição | Crescimento da missão em 60–120 s e teste de ponta a ponta |
| Excesso de sincronização | Servidor/clientes fracos ficam saturados | Interesse, frequência limitada, grid e UI fora do tick |
| Pacotes/frameworks de versões diferentes | Falha de handshake/prediction | Spike de compatibilidade e lockfile no primeiro marco |
| Perda de senha sem e-mail | Conta sem recuperação | Código opcional e aviso claro no cadastro |
| Crash de sala em memória | Missão não pode continuar | Recuperação idempotente e devolução técnica do loadout original |
| Deploy em subcaminho | Assets e WebSocket apontam ao lugar errado | Base URL configurável e smoke test de rotas |

## Mudanças de escopo

Variedade de conteúdo pode ser ajustada sem remover função, se a decisão for registrada. Uma função original só pode sair por decisão do responsável pelo projeto; não deve desaparecer porque sua tarefa ficou difícil. A 1.0 não é uma reserva para implementar funções que deveriam estar na 0.9.
