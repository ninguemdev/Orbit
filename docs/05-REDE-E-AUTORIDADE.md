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
