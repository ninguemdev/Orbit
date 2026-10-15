# Backlog de desenvolvimento

As tarefas V01.01 a V01.09 tiveram o aceite verificado (issues #1 a #9 e PR #10 do GitHub); as demais estão **pendentes**. IDs são estáveis e são usados nos títulos das issues. Cada task tem entrega, dependências e aceite.

P = revisão pequena; M = funcionalidade de porte moderado; G = subdividir em PRs menores antes de começar. Tamanhos são relativos, sem promessa de horas ou datas. Os gates finais de cada versão são obrigatórios. Não declarar a release pronta só porque o código compila.

| Versão | Tarefas | Objetivo |
| --- | --- | --- |
| 0.1.0 | 9 | Fundação técnica e primeiro multiplayer real |
| 0.2.0 | 10 | Contas e preparação persistente |
| 0.3.0 | 10 | Primeiro ciclo completo de loot e extração |
| 0.4.0 | 9 | Nave cooperativa, Piloto e Engenheiro |
| 0.5.0 | 9 | EVA, mineração e ruínas |
| 0.6.0 | 10 | Médico, Oficial e sobrevivência pessoal |
| 0.7.0 | 10 | Armamento naval, estações e piratas |
| 0.8.0 | 9 | Progressão, contratos e variedade de preparação |
| 0.9.0 | 10 | Integração completa e congelamento de funcionalidades |
| 1.0.0 | 8 | Polimento do escopo completo e lançamento |

**Total: 94 tarefas.** Prioridade principal: primeiro concluir 0.1 → 0.2 → 0.3, validando o ciclo persistente; depois avançar sistemas conforme dependências. Uma tarefa G precisa ser dividida mantendo seu aceite de integração.

## 0.1.0 — Fundação técnica e primeiro multiplayer real

### V01.01 — Preparar repositório e convenções

- [x] Concluída — aceite verificado em 15/10/2026

**Área:** projeto. **Tamanho:** P. **Depende de:** nenhuma.

**Entregar:** Aplicar documentos, licença MIT, templates e estrutura de issues/branches.

**Aceite:** README distingue planejamento de implementação; arquivos do repositório têm finalidade no produto.

**Verificação:** Revisar árvore, links, licença e diff do commit inicial.

### V01.02 — Criar workspace executável e travar ferramentas

- [x] Concluída — aceite verificado em 15/10/2026

**Área:** build. **Tamanho:** M. **Depende de:** V01.01.

**Entregar:** Criar apps web/server, pacotes, TypeScript estrito, pnpm e scripts dev/lint/typecheck/test/build.

**Aceite:** Instalação limpa pelo lockfile inicia cliente e servidor; versão do runtime está declarada.

**Verificação:** Rodar instalação e build em checkout limpo; registrar versões exatas.

### V01.03 — Definir catálogo, contratos e matemática básica

- [x] Concluída — aceite verificado em 15/10/2026

**Área:** domínio. **Tamanho:** M. **Depende de:** V01.02.

**Entregar:** Criar IDs estáveis, DTOs, schemas de runtime e funções puras de movimento/modificadores.

**Aceite:** Pacotes não importam frameworks do cliente nem banco; valores inválidos são recusados.

**Verificação:** Testar vetores, limites, sequências e NaN/infinito.

### V01.04 — Abrir sala autoritativa mínima

- [x] Concluída — aceite verificado em 15/10/2026

**Área:** server. **Tamanho:** M. **Depende de:** V01.02, V01.03.

**Entregar:** Configurar Colyseus, sala de desenvolvimento, lifecycle e timestep fixo de 20 Hz.

**Aceite:** Dois clientes recebem o mesmo estado; simulação vive no servidor.

**Verificação:** Executar dois SDK clients e inspecionar estado/tick.

### V01.05 — Renderizar nave e interior simples

- [x] Concluída — aceite verificado em 15/10/2026

**Área:** client. **Tamanho:** M. **Depende de:** V01.02, V01.04.

**Entregar:** Criar cenas Phaser geométricas, câmera, tripulantes e ponte de rede.

**Aceite:** Nave e dois personagens aparecem sem usar React para cada frame; cliente econômico pode limitar FPS.

**Verificação:** Abrir dois navegadores e verificar cena, resize e contador de FPS.

### V01.06 — Sincronizar movimento de tripulantes

- [x] Concluída — aceite verificado em 15/10/2026

**Área:** network. **Tamanho:** M. **Depende de:** V01.03, V01.04, V01.05.

**Entregar:** Processar intenção, colisão interior e interpolação remota.

**Aceite:** Enviar posição falsa não move personagem; mais mensagens não geram mais passos por tick.

**Verificação:** Testar colisão e spam de entrada; ensaiar RTT simulado.

### V01.07 — Pilotar nave no protótipo

- [x] Concluída — aceite verificado em 15/10/2026

**Área:** gameplay. **Tamanho:** M. **Depende de:** V01.06.

**Entregar:** Criar comando inicial exclusivo e movimento externo básico com rotação.

**Aceite:** Um operador move a nave vista por ambos; sair libera o comando.

**Verificação:** Dois jogadores disputam comando e observam a mesma trajetória.

### V01.08 — Preparar banco, migrações e CI

- [x] Concluída — aceite verificado em 15/10/2026

**Área:** data/build. **Tamanho:** M. **Depende de:** V01.02, V01.03.

**Entregar:** Criar PostgreSQL de desenvolvimento, pool, migrations e pipeline com lint/types/tests/build.

**Aceite:** Migração sobe banco vazio; CI instala pelo lockfile e falha em erro real.

**Verificação:** Rodar pipeline e migration smoke; confirmar conexão encerrada corretamente.

### V01.09 — Aprovar integração e gate 0.1

- [x] Concluída — gate verificado em 15/10/2026; tag `v0.1.0` somente após revisão e integração do PR

**Área:** qualidade. **Tamanho:** M. **Depende de:** V01.07, V01.08.

**Entregar:** Verificar Phaser 4/Colyseus 0.18/SDK, auth hook, previsão disponível e limites de conexão.

**Aceite:** Dois navegadores conectam/movem/pilotam; SDKs compatíveis e estratégia de autenticação estão registrados.

**Verificação:** Smoke multiplayer, queda curta e build limpo; registrar limitações e preparar release 0.1.0.

## 0.2.0 — Contas e preparação persistente

### V02.01 — Migrar identidade e sessão

- [ ] Pendente

**Área:** data. **Tamanho:** M. **Depende de:** V01.08.

**Entregar:** Criar accounts, sessions, recovery e profiles com constraints e índices.

**Aceite:** Nick normalizado único; hashes não têm senha/token bruto; migration é reproduzível.

**Verificação:** Integração SQL com cadastro concorrente e rollback.

### V02.02 — Implementar cadastro, login e autorização

- [ ] Pendente

**Área:** server/security. **Tamanho:** M. **Depende de:** V02.01, V01.09.

**Entregar:** Criar Argon2id, cookies, revogação, proteção de escrita e limites de autenticação.

**Aceite:** Nick/senha autenticam; logout revoga; rotas privadas negam outra conta.

**Verificação:** Testar login correto/incorreto, sessão expirada, CSRF/Origin e concorrência de hash.

### V02.03 — Construir acesso e recuperação opcional

- [ ] Pendente

**Área:** ui. **Tamanho:** M. **Depende de:** V02.02.

**Entregar:** Criar tela de nick/senha, estado autenticado e código opcional de recuperação.

**Aceite:** Cadastro não pede e-mail; erros são claros sem enumerar contas; código só funciona uma vez.

**Verificação:** Playwright cadastra, entra, sai e recupera uma conta de teste.

### V02.04 — Formar party e convidar jogadores

- [ ] Pendente

**Área:** server/ui. **Tamanho:** M. **Depende de:** V02.02, V02.03.

**Entregar:** Criar party privada, código de convite, convite por nick online, limite e liderança.

**Aceite:** Somente membros/autorizados entram; líder pode gerir membros antes da missão; saída troca liderança.

**Verificação:** Testar conta externa, código inválido, party cheia e líder saindo.

### V02.05 — Selecionar classe e apresentar funções

- [ ] Pendente

**Área:** ui/gameplay. **Tamanho:** P. **Depende de:** V02.04.

**Entregar:** Mostrar quatro classes, seleção por jogador e roster, ainda sem prometer habilidades não entregues.

**Aceite:** Cada jogador escolhe classe própria; repetição permitida; todos veem seleção atual.

**Verificação:** Teste com quatro sessões e mudança de escolha.

### V02.06 — Persistir stash, carteira e licenças básicas

- [ ] Pendente

**Área:** data. **Tamanho:** M. **Depende de:** V02.01.

**Entregar:** Criar itens/slots, wallets, inbox e ship_unlocks; conceder nave inicial e dados controlados de teste.

**Aceite:** Novo login conserva estoque e licença; contas não leem/movem itens de outra pessoa.

**Verificação:** Integração de isolamento por conta e constraints.

### V02.07 — Disponibilizar união das naves da party

- [ ] Pendente

**Área:** server/ui. **Tamanho:** M. **Depende de:** V02.04, V02.06.

**Entregar:** Calcular união/deduplicação das licenças; líder escolhe nave e UI mostra quem libera.

**Aceite:** Nave de um membro aparece para todos; ao sair o último dono antes do início, escolha fica inválida.

**Verificação:** Party com licenças distintas, donos duplicados e saída do dono.

### V02.08 — Validar loadout básico

- [ ] Pendente

**Área:** server/ui. **Tamanho:** M. **Depende de:** V02.05, V02.06.

**Entregar:** Criar slots de preparação, mochila, seleção de itens e validação de propriedade/classe.

**Aceite:** Arma incompatível e item inexistente são recusados no servidor; stash não muda por arraste visual.

**Verificação:** Teste de payload forjado e revisão de inventário.

### V02.09 — Controlar prontidão e revisão da preparação

- [ ] Pendente

**Área:** server/ui. **Tamanho:** M. **Depende de:** V02.07, V02.08.

**Entregar:** Versionar seleção de party e congelar roster proposto após confirmação válida.

**Aceite:** Mudança relevante invalida prontidão; pedido com revisão antiga falha; missão com risco ainda depende da reserva de 0.3.

**Verificação:** Dois clientes alteram seleção e confirmam simultaneamente.

### V02.10 — Aprovar gate de conta/party/preparação

- [ ] Pendente

**Área:** qualidade. **Tamanho:** M. **Depende de:** V02.09, V02.03.

**Entregar:** Fechar fluxo de acesso, party, escolha e persistência sem placeholders enganosos.

**Aceite:** Duas ou mais contas escolhem classes/equipamentos e nave disponível na união; relogin mantém dados.

**Verificação:** E2E e regressão de autorização; preparar release 0.2.0.

## 0.3.0 — Primeiro ciclo completo de loot e extração

### V03.01 — Reservar equipamento atomicamente

- [ ] Pendente

**Área:** data/server. **Tamanho:** G. **Depende de:** V02.10.

**Entregar:** Criar expedição PREPARING, active_participations, snapshots, reservas e chave de início.

**Aceite:** Mesmo item/usuário não participa de duas partidas; retry retorna mesma expedição.

**Verificação:** Concorrência SQL com dois pedidos e rollback parcial.

### V03.02 — Ativar sala com roster autenticado

- [ ] Pendente

**Área:** network/server. **Tamanho:** M. **Depende de:** V03.01.

**Entregar:** Ligar reserva de assento/ticket a usuário/party/run e ativar somente após preparação válida.

**Aceite:** Cliente externo não ocupa assento; timeout anterior à ativação cancela e devolve reservas.

**Verificação:** Testar carregamento falho, replay de ticket e nova tentativa.

### V03.03 — Gerar setor mínimo navegável

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V03.02, V01.07.

**Entregar:** Criar mapa aberto finito, spawn seguro, colisões, contêiner e ponto de saída.

**Aceite:** Existe rota entre entrada, loot e extração; seed privada não é exposta.

**Verificação:** Teste de seeds e missão manual sem ferramenta administrativa.

### V03.04 — Coletar e transportar loot identificável

- [ ] Pendente

**Área:** gameplay/data. **Tamanho:** M. **Depende de:** V03.03, V02.08.

**Entregar:** Criar IDs temporários, mochila/carga, limites, pilhas e transferências autorizadas.

**Aceite:** Dois coletores não recebem cópias do mesmo item; soma das pilhas é preservada.

**Verificação:** Race de coleta, distância falsa, quantidade negativa e inventário cheio.

### V03.05 — Resolver extração e fracasso básicos

- [ ] Pendente

**Área:** server/gameplay. **Tamanho:** M. **Depende de:** V03.03, V03.04.

**Entregar:** Criar casco básico, derrota por destruição/timeout, zona, velocidade e timer de evacuação.

**Aceite:** Só nave na zona extrai; timer vem do servidor; destruir/sair cancela; elegibilidade inicial é explícita.

**Verificação:** Alterar relógio do browser e sair da zona no último tick.

### V03.06 — Criar manifesto e distribuição sem cópias

- [ ] Pendente

**Área:** domínio/data. **Tamanho:** M. **Depende de:** V03.04, V03.05.

**Entregar:** Definir loot pessoal/comum, divisão de pilhas, origem de itens e manifesto imutável.

**Aceite:** Item único tem um destinatário; pilhas somam o total original; retries mantêm os destinos.

**Verificação:** Testes com 1–4 participantes, número ímpar de recursos e dados conflitantes.

### V03.07 — Liquidar partida em transação idempotente

- [ ] Pendente

**Área:** data/server. **Tamanho:** G. **Depende de:** V03.01, V03.06.

**Entregar:** Persistir manifesto, ledger, sucesso/perda, inbox, reservas e resultado terminal.

**Aceite:** Commit concede uma vez e resolve todos os membros; ACK perdido não causa nova recompensa.

**Verificação:** Falhas injetadas antes/depois de commit e duas liquidações concorrentes.

### V03.08 — Recuperar cancelamento e aborto técnico

- [ ] Pendente

**Área:** ops/data. **Tamanho:** M. **Depende de:** V03.02, V03.07.

**Entregar:** Adicionar dono do processo, heartbeat e reconciliação segura em processo único.

**Aceite:** PREPARING vencida devolve originais; run órfã comprovada não cria loot novo; término normal não vira refund técnico.

**Verificação:** Encerrar processo em estados diferentes e reiniciar em banco isolado.

### V03.09 — Exibir resultado persistido e repetir missão

- [ ] Pendente

**Área:** ui. **Tamanho:** M. **Depende de:** V03.07, V03.08.

**Entregar:** Mostrar pendente/confirmado, retornados/perdidos, carga distribuída e inbox.

**Aceite:** Cliente só mostra salvo após confirmação; relogin consulta resultado; segunda missão usa dados atualizados.

**Verificação:** E2E com fechamento da aba durante confirmação e stash cheio.

### V03.10 — Aprovar primeiro ciclo ponta a ponta

- [ ] Pendente

**Área:** qualidade. **Tamanho:** G. **Depende de:** V03.09.

**Entregar:** Executar jornadas de sucesso, fracasso, preparação falha e retry.

**Aceite:** Duas partidas sucessivas funcionam sem admin, sem reserva pendurada e sem duplicação.

**Verificação:** Suite econômica concorrente e dois navegadores; preparar release 0.3.0.

## 0.4.0 — Nave cooperativa, Piloto e Engenheiro

### V04.01 — Gerir consoles e estações de trabalho

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V03.10.

**Entregar:** Criar cockpit/motor/depósito e posse exclusiva por console com liberação automática.

**Aceite:** Morte/saída/desconexão libera console sem transferir input antigo.

**Verificação:** Disputa por console, desconexão do operador e troca rápida.

### V04.02 — Simular sistemas da nave

- [ ] Pendente

**Área:** server/gameplay. **Tamanho:** M. **Depende de:** V04.01.

**Entregar:** Adicionar casco, rachaduras, motor, combustível e reserva única de oxigênio.

**Aceite:** Dano no motor reduz desempenho; rachadura drena oxigênio; estados têm feedback.

**Verificação:** Testar dano, consumo e fim de recurso com relógio controlado.

### V04.03 — Aplicar vantagens do Piloto

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V04.02, V02.05.

**Entregar:** Configurar velocidade, aceleração, giro e recarga melhores apenas sob operador Piloto.

**Aceite:** Atributos mudam conforme operador e não acumulam ao alternar dois Pilotos.

**Verificação:** Comparar trajetórias/cooldowns por classe e trocar de console.

### V04.04 — Implementar boost e colisão contínua

- [ ] Pendente

**Área:** simulation. **Tamanho:** G. **Depende de:** V04.03.

**Entregar:** Implementar ×4, duração, carga, cooldown e sweep/subpassos da nave.

**Aceite:** Boost esquiva com impulso visível e nunca atravessa asteroide fino.

**Verificação:** Teste do maior deslocamento por tick e RTT simulado.

### V04.05 — Reparar casco e motor com ferramentas

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V04.02, V03.04.

**Entregar:** Criar trabalhos de reparo, consumo de materiais, cancelamento e velocidade do Engenheiro.

**Aceite:** Reparo muda dano real; mesma ferramenta é mais rápida com Engenheiro; ação inacessível cancela.

**Verificação:** Teste de falta de material e dois reparadores no mesmo alvo.

### V04.06 — Sobrecarregar motor e combinar boosts

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V04.04, V04.05.

**Entregar:** Criar habilidade do Engenheiro com recurso, duração, cooldown da nave e combo.

**Aceite:** Piloto + sobrecarga + boost atingem ×5,75 com motor saudável; dois Engenheiros não resetam recarga.

**Verificação:** Teste de ordem de modificadores e troca de operador durante combo.

### V04.07 — Centralizar modificadores e passivos

- [ ] Pendente

**Área:** domínio. **Tamanho:** M. **Depende de:** V04.03, V04.05, V04.06.

**Entregar:** Criar cálculo único de atributos e regras de empilhamento; preparar passivos EVA de Engenheiro/Oficial.

**Aceite:** Ordem estável e limites documentados; cliente usa previsão compatível, sem autoridade.

**Verificação:** Testar efeitos ativos/inativos e remoção por saída do console.

### V04.08 — Apresentar operação e emergências no HUD

- [ ] Pendente

**Área:** client/ui. **Tamanho:** M. **Depende de:** V04.01, V04.07.

**Entregar:** Criar modos de console, indicadores de dano/reparo/boost e alertas compartilhados.

**Aceite:** Equipe entende quem opera cada sistema e vê cooldowns reais sem React atualizar a cada frame.

**Verificação:** Playtest de pane e inspeção da frequência de atualização.

### V04.09 — Aprovar cooperação da nave

- [ ] Pendente

**Área:** qualidade. **Tamanho:** M. **Depende de:** V04.08.

**Entregar:** Rodar operação com dois ou mais jogadores, incluindo pane e combo.

**Aceite:** Composição sem especialista ainda resolve reparo básico; especialistas têm vantagem mensurável.

**Verificação:** Roteiro cooperativo e regressão de colisão/economia; preparar release 0.4.0.

## 0.5.0 — EVA, mineração e ruínas

### V05.01 — Unificar espaços e transformações

- [ ] Pendente

**Área:** simulation. **Tamanho:** M. **Depende de:** V04.09.

**Entregar:** Modelar spaceId, coordenadas locais, transformações e herança de velocidade.

**Aceite:** Sair de nave em movimento produz posição/velocidade corretas e uma entidade única.

**Verificação:** Testar giro, movimento e retorno entre espaços.

### V05.02 — Operar eclusa autoritativa

- [ ] Pendente

**Área:** server/gameplay. **Tamanho:** M. **Depende de:** V05.01, V04.01.

**Entregar:** Criar entrar/sair com proximidade, velocidade relativa e reserva de transição.

**Aceite:** Pedido repetido não duplica personagem nem teleporta; eclusa inacessível recusa.

**Verificação:** Testar spam, distância forjada e nave em boost.

### V05.03 — Implementar traje, EVA e oxigênio

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V05.02, V04.07.

**Entregar:** Criar propulsor de EVA, reserva de traje, dano por falta de oxigênio e vantagens de classe.

**Aceite:** Engenheiro/Oficial são mais rápidos em EVA; tempo e dano não dependem do cliente.

**Verificação:** Teste de oxigênio, mudança de espaço e retorno antes de esgotar.

### V05.04 — Minerar asteroides

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V05.03, V03.04.

**Entregar:** Adicionar ferramenta, trabalho, recurso finito e três tipos iniciais.

**Aceite:** Mineração consome o depósito real; interrupção e falta de alcance não pagam.

**Verificação:** Dois mineradores disputam último recurso e levam resultado à nave.

### V05.05 — Explorar interiores de ruínas

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V05.01, V03.03.

**Entregar:** Criar entrada, mapa pequeno, obstáculos, contêineres e saída.

**Aceite:** Cliente não recebe conteúdo oculto antes da descoberta; a ruína permite ir/voltar.

**Verificação:** E2E nave → EVA → ruína → nave com carga.

### V05.06 — Recuperar carga e reparar ruptura externa

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V05.03, V05.04, V04.05.

**Entregar:** Transportar objetos/carga em EVA e executar reparo exterior em ponto acessível.

**Aceite:** O mesmo item troca localização uma vez; reparar por fora exige alcance real.

**Verificação:** Teste de ruptura, transferência e tentativa desde outro spaceId.

### V05.07 — Garantir geração e filtragem de interesse

- [ ] Pendente

**Área:** server/network. **Tamanho:** G. **Depende de:** V05.04, V05.05.

**Entregar:** Criar grid espacial, densidade de POIs, rotas válidas e StateView compatível.

**Aceite:** Seeds de teste têm caminho viável; cliente recebe apenas objetos autorizados/relevantes.

**Verificação:** Testar várias seeds e inspecionar payload para loot privado.

### V05.08 — Criar radar, mapa e ping de equipe

- [ ] Pendente

**Área:** ui. **Tamanho:** M. **Depende de:** V05.07, V04.08.

**Entregar:** Mostrar descobertas/sensores e marcar locais com limite de frequência.

**Aceite:** Mapa não revela loot secreto; tripulantes externos ficam visíveis à própria equipe.

**Verificação:** Comparar visão de espaços distintos e testar spam de ping.

### V05.09 — Aprovar expedição externa

- [ ] Pendente

**Área:** qualidade. **Tamanho:** M. **Depende de:** V05.06, V05.08.

**Entregar:** Verificar extração com tripulante a bordo, em EVA, morto por oxigênio e desconectado.

**Aceite:** Aviso de saída sem todos e elegibilidade funcionam; mineração/ruína persistem pela extração.

**Verificação:** Roteiro com dois navegadores e regressão de reservas; preparar release 0.5.0.

## 0.6.0 — Médico, Oficial e sobrevivência pessoal

### V06.01 — Completar vida, stamina e estados de sobrevivência

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V05.09.

**Entregar:** Criar regeneração base, custo de esforço, caído, morte, reanimação e espectador.

**Aceite:** Ações essenciais lentas continuam possíveis sem stamina; revive só atua em caído.

**Verificação:** Testar deadlines, dano, esforço e corrida com input forjado.

### V06.02 — Aplicar Oficial e autorização de armas

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V06.01, V02.08.

**Entregar:** Criar vida/stamina extras, rifles autorizados e tempos de recarga/dano por classe.

**Aceite:** Oficial usa armas longas; qualquer outra classe é recusada no servidor.

**Verificação:** Testar troca fraudulenta de classe/arma e cadência.

### V06.03 — Implementar combate pessoal e sentinelas

- [ ] Pendente

**Área:** server/gameplay. **Tamanho:** G. **Depende de:** V06.02, V05.05.

**Entregar:** Adicionar pistola, armas longas, munição, projétil/sweep e drone simples nas ruínas.

**Aceite:** Dano/munição são autoritativos; cliente não informa acertos; aliados seguem política PvE.

**Verificação:** Teste de alvos, paredes, spam de tiro e equipamento recuperado.

### V06.04 — Cultivar ingredientes na nave

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V06.01, V04.01.

**Entregar:** Criar canteiros, três plantas, sementes, crescimento por tick e colheita.

**Aceite:** Plantas crescem em 60–120 s de sala ativa; duas colheitas simultâneas não duplicam ingrediente.

**Verificação:** Relógio controlado e mudança do relógio do navegador.

### V06.05 — Fabricar seringas como Médico

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V06.04, V03.04.

**Entregar:** Criar quatro receitas, estação, estoque, ação de craft e consumo transacional na simulação.

**Aceite:** Somente Médico fabrica com ingredientes reais; cancelamento tem regra de consumo definida.

**Verificação:** Testar craft paralelo, receita inexistente e ingrediente faltante.

### V06.06 — Aplicar seringas e buffs temporários

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V06.05, V06.01.

**Entregar:** Criar autoaplicação/aliado, velocidade, trabalho, regenerações e duração.

**Aceite:** Dose é consumida uma vez; mesmo tipo não soma; tipos distintos combinam; morto não revive por regen.

**Verificação:** Testar dois médicos/alvos, distância e remoção de buff na morte.

### V06.07 — Integrar passivos médicos e do Oficial

- [ ] Pendente

**Área:** domínio/gameplay. **Tamanho:** M. **Depende de:** V06.03, V06.06, V04.07.

**Entregar:** Aplicar uso mais rápido do Médico e danos/recarga/EVA do Oficial sem duplicar modificadores.

**Aceite:** Trabalho + seringa e dano por classe seguem fórmulas documentadas; bônus naval ainda entra em 0.7.

**Verificação:** Testes parametrizados por classe, estado e origem de atributo.

### V06.08 — Liquidar morte e salvamento de equipamentos

- [ ] Pendente

**Área:** data/gameplay. **Tamanho:** M. **Depende de:** V06.01, V03.07.

**Entregar:** Criar mochila de cadáver, proveniência, salvamento comum e elegibilidade vivo/caído.

**Aceite:** Morto não recebe contrato; item recuperado vai uma vez a destinatário elegível; nenhuma reserva fica presa.

**Verificação:** Teste de quatro membros com morto, caído, abandono e recuperação.

### V06.09 — Criar interface médica e de combate

- [ ] Pendente

**Área:** ui/client. **Tamanho:** M. **Depende de:** V06.04, V06.07.

**Entregar:** Mostrar horta, receitas, doses, buffs, stamina, recarga, queda e espectador.

**Aceite:** Jogador entende ingrediente faltante e tempo restante; instrumentos mostram estado do servidor.

**Verificação:** Playtest de cultivo/craft e tela de combate com efeitos reduzidos.

### V06.10 — Aprovar ciclo das quatro classes

- [ ] Pendente

**Área:** qualidade. **Tamanho:** M. **Depende de:** V06.08, V06.09.

**Entregar:** Rodar plantar → colher → craftar → aplicar e combate/extração.

**Aceite:** Todos os efeitos pessoais de classe funcionam; equipe sem Médico consegue usar doses prontas.

**Verificação:** E2E, testes de permissão e regressão econômica; preparar release 0.6.0.

## 0.7.0 — Armamento naval, estações e piratas

### V07.01 — Implementar armas e calor da nave

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V06.10, V04.01.

**Entregar:** Criar console de mira, projéteis, cadência, dano, aquecimento e resfriamento.

**Aceite:** Calor impede tiro no limite; sair/trocar operador não limpa aquecimento.

**Verificação:** Teste de tiro contínuo, colisão e disparo sem operador.

### V07.02 — Aplicar vantagens navais do Oficial

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V07.01, V06.07.

**Entregar:** Adicionar dano ×1,15 e calor por tiro ×0,75 quando Oficial opera.

**Aceite:** Bônus pessoal não é aplicado de novo ao tiro naval; classe/console determinam atributos.

**Verificação:** Comparar operadores e trocar durante sobreaquecimento.

### V07.03 — Criar AI de naves piratas

- [ ] Pendente

**Área:** server/AI. **Tamanho:** G. **Depende de:** V07.01, V05.07.

**Entregar:** Adicionar patrulha/interceptação e agressão com decisões de frequência limitada.

**Aceite:** NPC navega/ataca pelo servidor e não fica preso indefinidamente em obstáculo.

**Verificação:** Seed de combate, perfil de CPU e teste de estados/limites.

### V07.04 — Fazer pirata roubar carga de verdade

- [ ] Pendente

**Área:** server/gameplay. **Tamanho:** M. **Depende de:** V07.03, V03.04.

**Entregar:** Criar tentativa interrompível de roubo após interceptação, com alcance e prazo.

**Aceite:** Carga sai da nave humana e passa ao pirata com mesmo ID; escapar/atacar interrompe conforme regra.

**Verificação:** Testar última unidade, duas tentativas e interrupção no último tick.

### V07.05 — Destruir e saquear nave inimiga

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V07.04, V05.06.

**Entregar:** Gerar destroços e carga recuperável, inclusive itens roubados.

**Aceite:** Destruição cria um único conjunto de destroços; recuperação mantém soma/proveniência.

**Verificação:** Matar NPC com tiros simultâneos e resgatar carga por EVA.

### V07.06 — Usar estação de reparo

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V07.01, V04.05.

**Entregar:** Criar doca, condição de serviço, custo em materiais da missão e reparo.

**Aceite:** Custo vem da carga real; reparo não ultrapassa máximo nem permite crédito negativo de recursos.

**Verificação:** Testar recursos insuficientes, dois serviços e afastamento da doca.

### V07.07 — Saquear estação e sofrer reação

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V07.03, V06.03, V05.05.

**Entregar:** Criar interior saqueável, alarme, drones/torres e loot.

**Aceite:** Saquear é uma ação real com reação hostil; prêmio depende de levar itens à extração.

**Verificação:** Roteiro de serviço seguro e saque hostil em seeds distintas.

### V07.08 — Centralizar equipe, facção e dano

- [ ] Pendente

**Área:** domínio. **Tamanho:** M. **Depende de:** V07.02, V07.07.

**Entregar:** Criar CombatPolicy para humanos/NPCs, aliados e relações de hostilidade.

**Aceite:** PvE não tem fogo amigo indevido; permissões não dependem de flags frágeis do cliente.

**Verificação:** Matriz de dano entre facções e dois jogadores aliados.

### V07.09 — Integrar conteúdo e intensidade de ameaças

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V07.05, V07.06, V07.07.

**Entregar:** Distribuir estações/piratas, escolher dois comportamentos e ajustar densidade.

**Aceite:** Há risco e oportunidade de recuperação, com spawn inicial e caminho de saída viáveis.

**Verificação:** Playtest curto de retorno cedo e missão longa.

### V07.10 — Aprovar combate, roubo e estações

- [ ] Pendente

**Área:** qualidade. **Tamanho:** M. **Depende de:** V07.08, V07.09.

**Entregar:** Executar roubo → perseguição → destruição → recuperação → extração.

**Aceite:** Inventário confirma carga uma vez; Oficial melhora arma naval; reparo e saque funcionam.

**Verificação:** E2E com várias conexões e testes de IDs; preparar release 0.7.0.

## 0.8.0 — Progressão, contratos e variedade de preparação

### V08.01 — Implementar compra e venda na loja

- [ ] Pendente

**Área:** data/server. **Tamanho:** G. **Depende de:** V07.10, V02.06.

**Entregar:** Criar preços de catálogo, chaves idempotentes, débito/crédito e ledger.

**Aceite:** Saldo nunca negativo; itens reservados/kit gratuito não podem ser vendidos; retry não paga duas vezes.

**Verificação:** Concorrência SQL, quantidade falsa e repetição da chave.

### V08.02 — Construir loja e gestão de inventário

- [ ] Pendente

**Área:** ui. **Tamanho:** M. **Depende de:** V08.01, V03.09.

**Entregar:** Criar compra/venda, organização de stash, recebimento do inbox e feedback de transação.

**Aceite:** UI reflete resposta do servidor, resolve estoque cheio e mostra itens indisponíveis.

**Verificação:** Playwright compra, vende, retira inbox e entra na segunda partida.

### V08.03 — Personalizar personagem

- [ ] Pendente

**Área:** ui/client. **Tamanho:** M. **Depende de:** V02.05, V08.02.

**Entregar:** Criar paleta, uniformes/acessórios simples, persistência e renderização.

**Aceite:** Seleção aparece para a party e no jogo; opções inválidas não são aceitas; hitbox não muda.

**Verificação:** Relogin, multiplayer e validação de catálogo.

### V08.04 — Disponibilizar três modelos de nave

- [ ] Pendente

**Área:** gameplay. **Tamanho:** M. **Depende de:** V07.10, V02.07.

**Entregar:** Criar catálogo de layouts/carga/mobilidade e desbloqueios por progresso.

**Aceite:** Qualquer nave disponível por um membro funciona para todos; cada layout tem consoles necessários.

**Verificação:** Testar união com três modelos e partida em cada nave.

### V08.05 — Criar catálogo e progresso de missões

- [ ] Pendente

**Área:** gameplay/server. **Tamanho:** M. **Depende de:** V07.10, V06.05.

**Entregar:** Criar ao menos seis objetivos baseados em eventos reais de mineração, exploração, salvamento, combate, reparo ou produção.

**Aceite:** Objetivos têm parâmetros viáveis; nenhum é concluído por afirmação do navegador.

**Verificação:** Eventos autorizados, duplicados e ação fora do contexto.

### V08.06 — Escolher e pagar contrato pessoal

- [ ] Pendente

**Área:** server/ui. **Tamanho:** M. **Depende de:** V08.05, V03.07, V02.09.

**Entregar:** Escolher uma missão por jogador, congelar no roster e incluir prêmio no manifesto.

**Aceite:** Jogadores da mesma party têm contratos distintos; pago uma vez só se titular extrai elegível.

**Verificação:** Quatro contratos, um morto, objetivos compartilhados e retry.

### V08.07 — Completar escolha de equipamento e preparação

- [ ] Pendente

**Área:** server/ui. **Tamanho:** M. **Depende de:** V08.02, V08.04, V08.06.

**Entregar:** Integrar classes, armas, doses, ferramentas, nave, contratos e prontidão.

**Aceite:** Toda escolha é validada no lançamento; alterações invalidam revisão; dono da nave pode sair só após autorização congelada.

**Verificação:** Teste de alteração concorrente, carga reservada e última licença removida.

### V08.08 — Equilibrar fontes e sumidouros da economia

- [ ] Pendente

**Área:** design/data. **Tamanho:** M. **Depende de:** V08.07.

**Entregar:** Ajustar créditos, preços, raridades, custos e kit temporário sem farm vazio.

**Aceite:** Conta sem bens consegue recomeçar; extrair kit grátis não produz item vendável ou moeda.

**Verificação:** Simular missões vazias, sobrevivência, perda e progressão curta.

### V08.09 — Aprovar progressão e contratos

- [ ] Pendente

**Área:** qualidade. **Tamanho:** M. **Depende de:** V08.03, V08.08.

**Entregar:** Rodar menu → loja → loadout → contratos distintos → expedição → resultado.

**Aceite:** Customização/nave/itens persistem e cada contrato paga ao titular correto.

**Verificação:** E2E e suites econômicas; preparar release 0.8.0.

## 0.9.0 — Integração completa e congelamento de funcionalidades

### V09.01 — Conferir escopo e conteúdo mínimo

- [ ] Pendente

**Área:** produto. **Tamanho:** M. **Depende de:** V08.09.

**Entregar:** Revisar cada linha da matriz de requisitos e variedade mínima dos sistemas.

**Aceite:** Todas as funções originais existem com comportamento jogável; lacunas viram correção antes da tag.

**Verificação:** Percorrer 14-REQUISITOS e catalogar evidências por versão/seed.

### V09.02 — Executar jornadas completas com quatro contas

- [ ] Pendente

**Área:** qualidade. **Tamanho:** G. **Depende de:** V09.01.

**Entregar:** Automatizar os fluxos principais e executar playtest integrando os sistemas.

**Aceite:** Party completa duas missões; diferentes contratos/classes e nave de apenas um membro funcionam.

**Verificação:** Playwright/multiplayer e roteiro com cultivo, EVA, roubo, reparo e extração.

### V09.03 — Revisar autoridade e limites de abuso

- [ ] Pendente

**Área:** security. **Tamanho:** M. **Depende de:** V09.01.

**Entregar:** Auditar mensagens, Origin, rate limits, privacidade, tickets, sessões e operações econômicas.

**Aceite:** Cliente modificado não cria loot, usa rifle indevido ou acessa dados de outra conta.

**Verificação:** Payloads forjados, replay, spam e inspeção de estado filtrado.

### V09.04 — Ensaiar reconexão e falhas duráveis

- [ ] Pendente

**Área:** network/data. **Tamanho:** G. **Depende de:** V09.02, V09.03.

**Entregar:** Cobrir dropout, abandono, líder perdido, DB indisponível e processo encerrado.

**Aceite:** Timers/perdas/refunds seguem política; nenhum dupe ou reserva pendurada.

**Verificação:** Falhas antes/depois de commit, relogin e restart em banco isolado.

### V09.05 — Medir capacidade e otimizar o que pesar

- [ ] Pendente

**Área:** performance. **Tamanho:** G. **Depende de:** V09.02.

**Entregar:** Executar 3 salas × 4 clientes por 30 min com entidades/ações de referência.

**Aceite:** Relatório mostra tick, loop, tráfego, RAM e FPS; gargalos que violam metas são corrigidos.

**Verificação:** Perfis reproduzíveis; repetir somente cenários afetados por mudanças.

### V09.06 — Preparar implantação reproduzível

- [ ] Pendente

**Área:** ops. **Tamanho:** M. **Depende de:** V09.03, V09.05.

**Entregar:** Criar imagens, Compose, Caddy, HTTPS/WSS, healthchecks, secrets e modo de drenagem.

**Aceite:** Deploy limpo serve jogo/API/socket; banco privado; raiz/subcaminho configurável funciona.

**Verificação:** Smoke em ambiente de validação e upgrade drenado.

### V09.07 — Ensaiar backup, restore e recuperação

- [ ] Pendente

**Área:** ops/data. **Tamanho:** M. **Depende de:** V09.04, V09.06.

**Entregar:** Criar runbook e executar backup/restore isolado, migrations e recuperação de pendências.

**Aceite:** Dados restaurados preservam contas/itens/settlements; rollback compatível é conhecido.

**Verificação:** Registrar tempos, limites de RPO/RTO e verificações de integridade.

### V09.08 — Fechar erros e transições de interface

- [ ] Pendente

**Área:** ui. **Tamanho:** M. **Depende de:** V09.04.

**Entregar:** Eliminar telas incompletas e tratar timeout, alvo inválido, estoque cheio e resultado pendente.

**Aceite:** Nenhum fluxo principal depende de refresh manual sem indicação; usuário sabe próxima ação.

**Verificação:** Roteiros de erro e segunda partida após abandono/fracasso.

### V09.09 — Ajustar equilíbrio inicial das funções

- [ ] Pendente

**Área:** design. **Tamanho:** M. **Depende de:** V09.02, V09.05.

**Entregar:** Ajustar combo, calor, oxigênio, preços, cultivo e risco por composição.

**Aceite:** Especialistas têm utilidade e grupos sem quatro classes podem concluir uma missão.

**Verificação:** Playtests com composição variada e registro de perdas/recompensas.

### V09.10 — Aprovar gate feature complete 0.9

- [ ] Pendente

**Área:** release. **Tamanho:** M. **Depende de:** V09.07, V09.08, V09.09, V09.03.

**Entregar:** Consolidar evidências, matriz, changelog e limitações residuais.

**Aceite:** Todas as funções originais e ciclo completo aprovados; sem bloqueador econômico ou funcional.

**Verificação:** Revisão do gate; preparar release 0.9.0 e congelar novos sistemas.

## 1.0.0 — Polimento do escopo completo e lançamento

### V10.01 — Polir primeiro contato e tutorial

- [ ] Pendente

**Área:** ui/design. **Tamanho:** M. **Depende de:** V09.10.

**Entregar:** Criar tutorial seguro e mensagens contextuais curtas para controles/extrair/funções.

**Aceite:** Novo jogador completa expedição básica sem instrução externa extensa.

**Verificação:** Playtest com pessoa que não leu os documentos.

### V10.02 — Polir feedback visual e áudio

- [ ] Pendente

**Área:** client. **Tamanho:** M. **Depende de:** V09.10.

**Entregar:** Ajustar formas, alertas, impactos, som, timers e relatório final.

**Aceite:** Perigo e sucesso/perda são legíveis; arte simples e modo econômico preservam informação.

**Verificação:** Inspeção em 720p e playtest com volume/efeitos reduzidos.

### V10.03 — Polir acessibilidade e preferências

- [ ] Pendente

**Área:** ui. **Tamanho:** M. **Depende de:** V10.01, V10.02.

**Entregar:** Melhorar contraste, navegação essencial por teclado, volumes e remapeamento básico.

**Aceite:** Ícones/texto complementam cor; preferências persistem sem conter estado econômico.

**Verificação:** Verificação de foco, teclado, resize e restauração de preferências.

### V10.04 — Refinar desempenho do lançamento

- [ ] Pendente

**Área:** performance. **Tamanho:** M. **Depende de:** V09.05, V10.02.

**Entregar:** Ajustar pontos medidos de renderização/memória/tráfego e presets 30/60 FPS.

**Aceite:** Metas de referência continuam aprovadas após efeitos finais.

**Verificação:** Repetir benchmark afetado e ensaio de memória.

### V10.05 — Refinar ritmo e balanceamento

- [ ] Pendente

**Área:** design. **Tamanho:** M. **Depende de:** V09.09, V10.01.

**Entregar:** Ajustar duração, alertas, fontes de loot e vantagem de classe sem adicionar sistemas.

**Aceite:** Decisão de extrair cedo é útil; missão não obriga todas as classes.

**Verificação:** Playtests curtos e comparação de métricas com baseline 0.9.

### V10.06 — Estabilizar candidato de lançamento

- [ ] Pendente

**Área:** qualidade. **Tamanho:** G. **Depende de:** V10.03, V10.04, V10.05.

**Entregar:** Corrigir regressões e bugs de experiência/estabilidade; fechar P0/P1.

**Aceite:** Nenhum fluxo principal bloqueado ou bug conhecido de acesso/perda/dupe.

**Verificação:** Regressão pertinente, E2E completo e soak final.

### V10.07 — Preparar RC e documentação final

- [ ] Pendente

**Área:** release/docs. **Tamanho:** M. **Depende de:** V10.06, V09.07.

**Entregar:** Atualizar README executável, changelog, instruções, versão 1.0.0-rc.N e pacote reproduzível.

**Aceite:** Instruções foram executadas; licenças e procedimentos de rollback/restore estão claros.

**Verificação:** Instalação limpa e validação em ambiente de staging.

### V10.08 — Aprovar e liberar 1.0

- [ ] Pendente

**Área:** release. **Tamanho:** M. **Depende de:** V10.07.

**Entregar:** Revisar gate final, tag, notas do produto e implantação controlada.

**Aceite:** Escopo da 0.9 está polido, build reproduzível e smoke/rollback preparados.

**Verificação:** Conferir checks/diff/autoria, preparar release 1.0.0 e registrar smoke do lançamento.
