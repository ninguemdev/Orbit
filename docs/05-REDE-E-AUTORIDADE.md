# Rede, autoridade e otimização

## Divisão cliente/servidor

| Sistema | Servidor autoritativo | Cliente |
| --- | --- | --- |
| Movimento | Entrada validada, velocidade, colisão, posição real | Previsão local, interpolação e câmera |
| Nave | Operador, buffs, combustível, boost, casco e motor | Efeitos, som e apresentação de instrumentos |
| Combate | Munição, calor, cadência, projéteis, dano e morte | Mira, efeito de disparo e animações previstas |
| Trabalho | Alcance, ferramenta, materiais e tempo de conclusão | Barra visual de progresso |
| EVA | Espaço, oxigênio e transição pela eclusa | Traje visual e alerta |
| Horta/craft | Relógio, ingredientes, receita e consumo | Aparência da planta e interface |
| Loot | Spawn, coleta, capacidade, origem e transferências | Arraste de slots e lista exibida |
| Contratos | Objetivo, progresso e elegibilidade | Descrição e notificações |
| Extração | Zona, timer, manifesto e resultado | Confirmação e tela de resultado pendente |
| Conta/economia | Sessão, stash, saldo e transações | Formulários e projeções autorizadas |
| Arte/áudio | Apenas eventos relevantes | Partículas, estrelas, sombras simples e mixagem |

O navegador pode executar funções compartilhadas para previsão, mas nunca confirmar a própria previsão como resultado oficial. Mineração, crescimento, coleta, AI e dano continuam no servidor porque mudam a partida. Mover essas regras para o cliente criaria fraude e divergência, não uma otimização segura.

## Ciclo da sala

`PREPARING → ACTIVE → EXTRACTING → SETTLING → CLOSED`. Preparação pode terminar em `CANCELLED`; partida ativa pode terminar em `FAILED`; uma queda técnica recebe `ABORTED_TECHNICAL`. Falha normal e aborto técnico têm liquidações diferentes.

Usar timestep fixo inicial de 20 Hz, patches de estado a 10 a 20 Hz e renderização independente a 30/60 FPS. O spike em 0.1 confirma API e limitações do Colyseus 0.18. Ajustar frequência com medições, sem aumentar tick automaticamente para 60 Hz.

Cada tick usa o relógio do servidor, aplica entradas válidas e avança sistemas em ordem estável. Não fazer consultas SQL dentro do loop. Ações econômicas e transições duráveis têm filas/casos de uso específicos.

## Mensagens planejadas

| Intenção | Dados mínimos | Validação |
| --- | --- | --- |
| `crew.input` | Sequência, eixos limitados e botões | Sessão, estado, frequência e espaço |
| `ship.input` | Sequência, aceleração, giro e boost | Operador do console, limites, cooldown e motor |
| `interaction.start` | ID do alvo e tipo de ação | Distância, ferramenta, papel, espaço e reserva do alvo |
| `interaction.cancel` | ID da ação | Propriedade e estado da ação |
| `weapon.input` | Mira e intenção de disparar/recarregar | Classe, arma, munição, calor e cadência |
| `loot.transfer` | Origem, destino, ID e quantidade | Posse, alcance, capacidade e origem da entidade |
| `medical.craft` | Receita e quantidade limitada | Médico, estação, ingredientes e tempo |
| `medical.inject` | Dose e alvo | Aliado elegível, dose existente e alcance |
| `extraction.start` | ID da zona | Nave, operador, velocidade, zona e estado da sala |

O cliente não envia posição final, dano, vida nova, saldo novo, conteúdo de baú, preço ou recompensa concedida. Payloads precisam de schemas de validação em runtime, não apenas tipos TypeScript. Rejeitar `NaN`, infinito, quantidades negativas e IDs fora do contexto.

No protótipo, nomes de mensagens podem mudar; registrar contrato e versão quando adotados. Não considerar essa tabela uma API já implementada.

### Contrato adotado na 0.1 (`protocolVersion` 1)

Definido em `packages/contracts`. Schemas zod estritos: campo extra, `NaN`, infinito, sequência negativa ou fracionária e eixo fora de [-1, 1] são recusados.

| Mensagem | Payload | Efeito no servidor |
| --- | --- | --- |
| `crew.input` | `{ seq, x, y }` | Direção no eixo local da nave; uma entrada efetiva por tick |
| `ship.input` | `{ seq, thrust, turn }` | Aplicada somente do operador do comando |
| `helm.request` | vazio | Assume o comando se estiver livre e o tripulante estiver a até 34 px do assento |
| `helm.release` | vazio | Libera o comando do próprio operador |
| `action.rejected` (servidor → cliente) | `{ action, code }` | Motivo da recusa: `invalid_payload`, `helm_occupied`, `helm_out_of_range`, `not_helm_operator` |

Opções de entrada na sala: `{ protocolVersion, name? }`. O nome é só rótulo (3–20 caracteres `[A-Za-z0-9_]`), não identidade. O estado sincronizado (`SectorState`) contém versões de protocolo/catálogo, fase, tick, nave (posição, ângulo, velocidade, operador) e tripulantes (posição local, comando, conexão, último `seq` aplicado).

Mensagens inválidas recebem `action.rejected`; 20 inválidas em 10 s encerram a conexão com código 4409, sem reserva de reconexão. Recusas legítimas (comando ocupado, longe do console) e `ship.input` de quem perdeu o comando não contam como abuso. Acima de 60 mensagens/s o Colyseus derruba a conexão. WebSocket com `maxPayload` de 4 KiB e até 4 jogadores por sala.

## Resultado do spike 0.1

Verificado com Colyseus 0.18 (core 0.18.18, schema 5.0.39, SDK 0.18.5) em testes de integração com clientes SDK reais e no teste com dois navegadores:

- **Simulação:** `setFixedTimestep(step, 20)` avança um passo fixo de 50 ms; `patchRate` de 50 ms. A medição em teste fica entre 16 e 24 ticks por segundo.
- **Validação:** `onMessage(tipo, schema, handler)` e `validate()` aceitam Standard Schema (zod 4), mas desconectam o cliente na primeira mensagem inválida. A sala valida manualmente com os parsers de `packages/contracts` para aplicar rejeição controlada e orçamento de abuso.
- **Hook de autenticação:** `static onAuth(token, options, context)` roda na matchmaking HTTP, antes da reserva de assento, e é chamado sem `this`; o resultado chega em `client.auth`. O `onAuth` de instância é ignorado quando o estático existe. `context.headers` traz a Origin da requisição; `WebSocketTransport({ beforeUpgrade })` permite recusar a Origin também no upgrade.
- **Estratégia de autenticação (0.2):** sessão por cookie HttpOnly nas rotas HTTP; uma rota autenticada emite ticket curto de uso único vinculado a usuário, party e expedição; o cliente o envia como token da matchmaking (`client.auth.token`, que o SDK manda no cabeçalho `Authorization`; conferido no código do SDK, ainda não exercitado), e o `static onAuth` valida e consome o ticket. O ticket não é guardado no navegador nem registrado em log. Na 0.1, a sala de desenvolvimento aceita qualquer jogador de origem permitida, sem identidade.
- **Reconexão:** `onDrop` + `allowReconnection(client, 60)`; o SDK reconecta sozinho e `onReconnect` restaura o mesmo `sessionId`. O teste E2E corta as conexões TCP reais de um jogador num proxy, recusa novas conexões por 3 s e confirma a retomada com o mesmo tripulante, enquanto o outro navegador o vê como "reconectando". O SDK só tenta reconectar se a sala estiver aberta há alguns segundos (`minUptime`); antes disso a queda encerra a sessão. A emulação offline do Chromium fecha o socket na página, mas pode manter a conexão TCP local, e o servidor não percebe a queda; por isso não serve como teste de queda.
- **Token na URL:** o SDK envia o token de autenticação também como `_authToken` na query string da URL do WebSocket. Proxy e logs de acesso não podem registrar query strings, e o ticket precisa ser curto e de uso único.
- **Previsão disponível:** o SDK 0.18 exporta `Predict`, `Reconciler` e `SimReconciler`, e a sala oferece `defineInput`, `allowRewindState` e passos com `subSteps`. A 0.1 não usa esses recursos: entrada por mensagens, porta de entrada própria (`ContinuousInputGate`) e somente interpolação no cliente. Ao introduzir previsão, adotar um único mecanismo, avaliando primeiro o nativo e substituindo a porta própria se ele for usado (D17).
- **Latência:** `server.simulateLatency(ms)` permitiu ensaiar 150 ms de RTT nos testes de integração, com estados idênticos nos dois clientes.
- **Limites:** `maxClients`, `maxMessagesPerSecond` (desconecta ao exceder) e `maxPayload` do transporte estão configurados. Limite de conexões por IP/conta ainda não existe; depende de identidade (0.2) e do proxy (operação).

## Conta e sessão (0.2)

- **Hash:** Argon2id (`@node-rs/argon2`) com 19 MiB, 2 iterações e paralelismo 1. No máximo dois hashes simultâneos e fila limitada; acima dela a API responde 503. Nick inexistente gasta o mesmo trabalho de uma senha errada e recebe a mesma resposta.
- **Sessão:** token aleatório de 256 bits em cookie HttpOnly, SameSite=Strict, 7 dias, `Secure` em produção. O banco guarda só o SHA-256. Logout revoga no servidor. A atividade é registrada no máximo a cada 5 minutos.
- **Escritas:** exigem Origin permitida e `Content-Type: application/json`. Isso força preflight e, junto com SameSite=Strict, bloqueia CSRF.
- **CORS:** o Colyseus 0.18 responde a toda requisição HTTP (matchmaking e `/api`) por um listener próprio que, por padrão, reflete qualquer Origin com credenciais e aceita qualquer preflight. O servidor substitui `matchMaker.controller.getCorsHeaders` e `DEFAULT_CORS_HEADERS`: só origens de `ALLOWED_ORIGINS` recebem `Access-Control-Allow-Origin` e credenciais.
- **Limites:** login por endereço, tentativas por nick (5 sem sucesso em 15 minutos bloqueiam o nick, inclusive para a senha certa; cada tentativa conta antes do hash, então chutes simultâneos não escapam) e cadastro por endereço. Endereços IPv6 contam por /64. Atrás de proxy reverso, `TRUST_PROXY` informa quantos saltos confiar para obter o IP real. Os contadores ficam em memória do processo, com tamanho limitado (os mais antigos saem primeiro sob inundação de chaves); vários processos exigirão armazenamento compartilhado.
- **Hash e enumeração:** o hash fictício usado para nicks inexistentes é calculado uma vez, fora da fila, e não fica em cache se falhar; o semáforo entrega a vaga direto ao próximo da fila.
- **Logs:** erros inesperados registram só tipo e código, nunca a mensagem do driver, que traz parâmetros SQL.
- **Recuperação:** código opcional de 160 bits (32 caracteres Crockford base32), mostrado uma vez; o banco guarda o SHA-256. Gerar outro invalida o anterior. O resgate atualiza a senha, consome o código com UPDATE condicional (dois resgates simultâneos: só um vence) e revoga todas as sessões, na mesma transação. Nick inexistente, código errado e código usado recebem a mesma resposta depois do mesmo trabalho (hash e transação de resgate). O limite é só por endereço: um limite por nick deixaria terceiros bloquearem o dono, e o código de 160 bits não é adivinhável. Gerações simultâneas do código são serializadas por lock na conta.

## Party (0.2)

- **Sala `party` por party:** até 4 membros, privada (não listada), com estado de líder, código de convite e membros. Todo jogador conectado está em exatamente uma party, solo por padrão. Entrar em outra remove o jogador da anterior, no servidor.
- **Entrada:** só com ticket de uso único (30 s), emitido por `POST /api/party/tickets` para a sessão do cookie. O ticket diz quem é a conta e onde ela pode entrar: party nova, party do código ou party de um convite endereçado a ela. O ticket vai como token da matchmaking (`Authorization`) e é consumido no `onAuth`. Código de convite: 6 caracteres Crockford base32, com tentativas limitadas por endereço.
- **Líder:** convida por nick de jogador online (online = conectado a alguma party), expulsa (código 4401) e passa a liderança. Quando o líder sai, o membro conectado mais antigo assume. Queda reserva o lugar por 30 s. Quem foi expulso ou entrou em outra party sai da lista na hora, mesmo desconectado, e a reconexão é recusada. Quem foi expulso não volta pelo código, só por novo convite.
- **Classe:** cada membro escolhe a própria classe (`party.class.select`), validada pelo catálogo no servidor; classes repetidas são permitidas e a escolha aparece no estado da party para todos. A escolha é salva no perfil (`profiles.class_id`) e restaurada pelo ticket ao entrar em qualquer party, inclusive depois de novo login.
- **Mesma conta em duas janelas:** a janela mais recente assume a party; a anterior recebe 4402 e espera o jogador escolher, sem disputar a party.
- **Tickets:** até 30 pedidos por minuto por conta, além do limite de códigos por endereço. Aceitar um convite numa party cheia não consome o convite.
- **Estado:** em memória do processo de jogo (D26); reiniciar desfaz as parties.
- **Robustez:** `allowReconnection` rejeita quando o cliente cai antes de concluir a entrada. Sem tratamento, o Colyseus encerrava o processo; as salas tratam a rejeição.

## Entrada, previsão e reconciliação

Enviar entrada contínua no máximo à frequência do tick, inicialmente 20 mensagens/s por jogador, com sequência monotônica. Cada tick aplica uma entrada de movimento efetiva; receber 100 mensagens não pode produzir 100 passos. Limitar fila e descartar entradas vencidas, duplicadas ou muito à frente.

Entrada sem atualização por 250 ms volta para neutro. Ao trocar de console, morrer ou iniciar reconexão, limpar a entrada. Impulso e inércia existentes continuam conforme a física; o personagem não fica acelerando por uma tecla antiga.

Prever personagem local e, quando for o operador, a nave. Interpolar jogadores e entidades remotas com buffer inicial de 100 ms. Usar as funções puras compartilhadas e corrigir divergência ao receber estado. Transição de espaço, dano, extração e transferência de item esperam confirmação do servidor.

Apenas um mecanismo de previsão deve controlar uma entidade. Se usar APIs nativas de previsão do Colyseus 0.18, não manter um segundo reconciliador próprio por cima. Primeiro estabilizar interpolação; depois adicionar previsão ao fluxo verificado.

## Colisões em alta velocidade

Boost aumenta o deslocamento por tick. Colisão discreta só na posição final pode atravessar um obstáculo fino. Implementar varredura entre posição anterior e nova para nave/projéteis, ou subpassos limitados por distância. O servidor usa o resultado; o cliente aproxima para renderização e corrige.

Geometria simples: círculos no exterior e tiles/retângulos nos interiores. Não carregar o Phaser de forma headless no servidor nem executar uma engine de física pesada apenas para representar asteroides.

## Visibilidade e carga

- Índice espacial por grid/hash para interações, colisões e entidades próximas.
- Estados por destinatário com `StateView`/filtros da versão validada.
- Tripulação recebe sensores compartilhados, dados da própria nave e objetos relevantes ao seu espaço.
- Baús não abertos, seed privada, scripts de AI e inventários alheios não entram no estado público.
- Mapas estáticos visíveis são enviados na entrada/descoberta, sem reenviar tiles em cada patch.
- NPCs distantes avaliam decisões a 2 a 5 Hz; entidades em combate usam resolução compatível com o tick.
- Projetéis, loot físico e pontos de interesse têm limites explícitos por sala. Reciclar objetos visuais e descartar efeitos antigos.
- Eventos cosméticos podem ser agregados; eventos econômicos não podem ser descartados.

Coleta e combate ainda são simulados para uma entidade fora da câmera quando isso altera resultados. Interesse de rede e frequência de decisão são otimizações diferentes de desligar autoridade.

## Acesso, reconexão e abuso

Usar HTTP autenticado para obter reserva de assento/ticket curto, vinculados a usuário, party e expedição. Validar a identidade na autenticação da sala; opções enviadas pelo SDK não são identidade confiável. Tickets têm prazo curto, uso único e não são persistidos no navegador.

Confirmar no spike como a versão do SDK transporta autenticação. Não consumir o mesmo ticket duas vezes entre matchmaking e conexão. Não registrar tickets, tokens de reconexão nem URLs completas que possam carregá-los. Reconexão usa o mecanismo suportado pelo SDK e revalida a sessão/participação conforme o lifecycle disponível.

Uma conta só participa de uma expedição ativa. Segundo acesso não pode duplicar personagem; permitir retomada autenticada ou rejeitar de modo explícito. Janela inicial de reconexão: 60 s. Nenhum cooldown, ingrediente ou saldo se restaura ao reconectar.

Validar Origin no HTTP e no upgrade WebSocket; HTTPS/WSS em produção. Limitar tamanho de pacote, mensagens por conexão, conexões por conta/IP e tentativas de login. Colyseus não substitui autorização de ações do produto. Mensagens inválidas geram rejeição controlada; repetição abusiva pode desconectar com motivo auditável.

## Orçamentos de desempenho propostos

| Métrica | Meta inicial de aceitação |
| --- | --- |
| Tick de 20 Hz | p95 de execução da sala abaixo de 15 ms e p99 abaixo de 30 ms |
| Loop do processo | Atraso p95 abaixo de 20 ms durante o cenário de referência |
| Tráfego por cliente | Alvo médio ≤25 KB/s recebidos e ≤5 KB/s enviados na missão de teste |
| Cliente econômico | 30 FPS a 720p em equipamento de referência definido e registrado |
| Cliente padrão | 60 FPS no equipamento de referência padrão |
| Estabilidade | Ensaio de 30 min sem crescimento contínuo de memória após aquecimento |
| Rede simulada | Fluxo jogável com RTT de 150 ms e recuperação de desconexão curta |

Esses números são metas de engenharia, não medições já obtidas. Registrar máquina, versão, seeds, entidades e número de salas junto aos resultados. Testar inicialmente 3 salas × 4 jogadores; capacidade total e tamanho do servidor só serão definidos após esse ensaio.
