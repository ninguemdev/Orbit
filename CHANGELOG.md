# Changelog

O projeto usa versões `MAJOR.MINOR.PATCH` e tags `vX.Y.Z`. Os marcos 0.1 a 1.0 são planejados; cada versão recebe tag quando seu gate é aprovado.

## Unreleased

### Adicionado

- Reserva atômica de expedição no banco (migração `0007_expeditions`): expedição `PREPARING` com chave de início idempotente, snapshot de classe e loadout de cada membro, participação ativa única por conta e reserva única por item, revalidando classe, loadout e licença da nave sob lock. Cancelar a preparação devolve as reservas.
- A confirmação do líder reserva os loadouts da party numa expedição `PREPARING`. O stash mostra os itens reservados, o loadout fica travado e qualquer mudança na party cancela a preparação e devolve os itens. Sem sala da missão ainda, a preparação expira em 30 s; ao reiniciar, o servidor cancela as preparações deixadas pelo processo anterior.
- Sala da missão por expedição, criada pelo servidor: só os membros entram, com ticket de uso único de `POST /api/missions/tickets`; a expedição fica `ACTIVE` quando o roster inteiro carregou dentro do prazo, e senão é cancelada e devolve os itens. Até existirem extração e liquidação, fechar a sala encerra a partida como aborto técnico que devolve os itens; ao reiniciar, o servidor aborta as partidas deixadas em andamento.
- Depois da confirmação, os membros entram sozinhos na missão da party (tela do jogo com **Sair da missão**); se a entrada falha, **Entrar na missão** tenta de novo antes do prazo.

### Alterado

- Menu principal em colunas para janela de PC 16:9 (party; nave, classe e prontidão; inventário e loadout), com barra superior de conta e ações.

### Corrigido

- O menu e as telas de acesso voltam a rolar quando não cabem na janela.

## 0.2.0 — 2026-10-15

### Adicionado

- Tabelas de identidade (`accounts`, `sessions`, `account_recovery`, `profiles`) com nick único sem diferenciar maiúsculas, apenas hashes Argon2id/SHA-256 e testes de integração SQL (`pnpm test:db`).
- API de conta: cadastro com nick e senha, login, logout com revogação, `GET /api/me` e alteração da própria cor, com sessão em cookie HttpOnly/SameSite=Strict, Argon2id, limites de tentativa, proteção de Origin/CSRF e CORS restrito às origens permitidas.
- Telas de acesso no cliente: criar conta (só nick e senha, sem e-mail), entrar, sair e recuperar acesso com código opcional de uso único, gerado após o cadastro e mostrado uma vez.
- Party de até 4 contas: cada jogador começa numa party solo com código de convite, entra em outra pelo código ou aceitando convite por nick online. O líder remove membros e passa a liderança, e a saída do líder promove o membro mais antigo. A entrada exige ticket de uso único emitido pela API.
- Escolha de classe por jogador na party (repetição permitida), salva no perfil da conta (migração `0003_profile_class`), com roster visível a todos e descrição honesta de quando cada efeito entra no jogo.
- Inventário persistente: carteira com 200 créditos iniciais, licença da Batedora, stash de 40 espaços com pilhas pelo catálogo e caixa de recebimento para o excedente; painel de inventário no menu; `pnpm db:seed-dev` para dados de teste.
- União das naves da party: cada membro traz as próprias licenças, o líder escolhe entre elas e a escolha é desfeita quando sai o último dono; nova nave Cargueira no catálogo.
- Loadout da próxima missão: arma principal, arma secundária, ferramenta e mochila de 8 espaços, escolhidos do próprio stash e conferidos no servidor (dono, espaço e classe), sem mexer no stash.
- Prontidão da party: cada membro fica pronto na revisão atual, qualquer mudança relevante desfaz a prontidão de todos e o líder confirma o roster quando todos estão prontos.
- Gate da 0.2: E2E com duas contas (classes, loadouts, nave da união, prontidão, confirmação e relogin mantendo tudo) e matriz de autorização das rotas de conta.
- `pnpm db:seed-dev <nick> --no-ships` concede só os itens de teste.

### Corrigido

- `POST /api/me/recovery-code` passa a recusar corpo com campos, como as outras rotas.
- Naves liberadas no inventário aparecem na ordem do catálogo (a Batedora primeiro), como na party.
- Uma queda antes de concluir a entrada numa sala não derruba mais o servidor de jogo.

### Alterado

- O cliente exige conta para entrar na sala; o nick da conta identifica o tripulante.
- O servidor de jogo exige `DATABASE_URL`; rode `pnpm db:up` e `pnpm db:migrate` antes do `pnpm dev`.

## 0.1.0 — 2026-10-15

Fundação técnica e primeiro multiplayer real. Protótipo de desenvolvimento: sem contas, inventário, loot ou extração.

### Adicionado

- Sala de desenvolvimento `dev_sector` (Colyseus 0.18) com simulação autoritativa a 20 Hz, até 4 tripulantes e reconexão em até 60 s.
- Tripulantes caminham dentro da nave por intenção (WASD/setas); o servidor aplica uma entrada por tick, colide com paredes e ignora posições enviadas pelo cliente.
- Comando exclusivo da nave: assumir perto do console (E), pilotar com W/S/A/D, liberar com E/Esc, queda ou saída.
- Nave com rotação, empuxo, amortecimento, teto de velocidade e colisão contínua contra asteroides e limites do setor.
- Cliente Phaser 4 com arte geométrica, interpolação de 100 ms, HUD React a 5 Hz, modo econômico de 30 FPS e contador de FPS.
- Contratos de rede versionados com validação zod, catálogo versionado e matemática de movimento pura e testada.
- PostgreSQL 18 de desenvolvimento, pool limitado, migração baseline e migration smoke.
- CI com lint, formatação, tipos, testes, build, migrações e teste multiplayer com dois navegadores.
- Planejamento do jogo, arquitetura e critérios de aceite.
- Roadmap e backlog de desenvolvimento de 0.1 a 1.0.
- Política de contribuição, testes, operação e licença MIT.

### Limitações conhecidas

- Sala anônima de desenvolvimento, até 4 tripulantes; uma quinta pessoa cria outra sala.
- Sem previsão do jogador local; quem cai ou fecha a aba aparece como "reconectando" por 60 s.
- Um setor e um casco, sem dano, boost, EVA ou combate; o servidor de jogo não usa o banco.
- Sem deploy, HTTPS ou limite de conexões por IP/conta.

Ao implementar, registrar o comportamento entregue, as correções e os impactos de migração. Criar uma seção datada somente quando a release realmente for preparada.
