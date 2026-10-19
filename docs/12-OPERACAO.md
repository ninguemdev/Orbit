# Operação, deploy e falhas

## Base de implantação

Servidor Node contínuo, PostgreSQL privado e proxy Caddy. Cliente estático servido sob a mesma origem. Endpoints de API e WebSocket configuráveis; não fixar caminhos em cenas. Aceitar instalação em raiz ou subcaminho com base URL, rotas e endereços de conexão explicitamente configurados e testados.

Artefatos Docker construídos no pipeline ou na máquina de desenvolvimento; produção roda apenas imagens e banco. Não desenvolver nem compilar repetidamente na VM de produção. Publicar apenas os componentes necessários e manter banco sem porta pública.

Começar com um processo de jogo. SQL é compartilhável, mas salas ativas pertencem a esse processo e não migram automaticamente. Escalar para vários processos exige roteamento de salas, presença compartilhada, limites globais, testes de sessão única e drenagem por processo.

## Ambiente planejado

`NODE_ENV`, `DATABASE_URL`, `PUBLIC_ORIGIN`, `PUBLIC_BASE_PATH`, endpoint público do jogo, segredos de sessão/tickets, limites de sala e parâmetros do proxy. Adicionar `.env.example` sem segredos na 0.1. Não armazenar passwords ou tokens nas imagens.

Em desenvolvimento, usar dados fictícios e reset explícito. Migração de produção nunca deve executar seed destrutiva. O pipeline precisa separar migração de teste, build e deploy.

## Saúde e observabilidade

Liveness testa o processo; readiness testa dependências necessárias e estado de drenagem. Monitorar conexões, salas, jogadores, tick p95/p99, atraso do event loop, CPU, memória, bytes enviados, rejeições de mensagens, falhas de autenticação e backlog de liquidações.

Logs estruturados usam `requestId`, `expeditionId`, `operationId` e tipo de evento. Não logar senha, cookie, ticket ou token de reconexão. Histórico econômico guarda IDs/deltas; logs públicos não precisam expor nick ou conteúdo privado completo.

Criar alertas simples para queda do backend, falta de disco, banco indisponível, fila de resultado pendente e aumento de tick/erro. Não instalar uma pilha extensa de observabilidade antes do protótipo; métricas básicas devem existir cedo.

## Drenagem e atualização

Ao preparar deploy, parar novas missões e manter as salas existentes até concluir ou vencer uma janela anunciada. Jogadores voltam ao menu com motivo claro. Atualização limpa não deve abortar partidas como procedimento normal.

Depois de drenar, aplicar migrations compatíveis, trocar imagem, verificar readiness e fazer smoke test de conta/party/extração. Cliente desatualizado recebe indicação de recarregar se o protocolo não for compatível; não decodificar estados de outra versão silenciosamente.

## Recuperação técnica da partida

Cada processo tem ID de inicialização aleatório e envia heartbeat durável limitado, por exemplo a cada 5 s. Cada expedição ativa indica seu dono e versão. SQL indisponível por período relevante faz o processo impedir novas missões e entrar em estado seguro, para não disputar propriedade com recuperação.

Primeira entrega com processo único: a recuperação de salas órfãs só ocorre na inicialização, depois de garantir que o processo anterior foi encerrado. Não decidir devolver itens apenas porque o heartbeat ficou lento. Antes de múltiplos processos, adicionar lease/fencing transacional e detecção de dono, que impeçam um processo antigo de liquidar depois de perder autorização.

| Estado encontrado | Ação |
| --- | --- |
| `PREPARING` sem sala/dono e prazo vencido | Cancelar e devolver reservas |
| `ACTIVE`/`EXTRACTING` órfã com dono comprovadamente encerrado | Marcar aborto técnico, devolver o snapshot original reservado e não conceder loot novo |
| `SETTLING` com settlement já confirmado | Recuperar o resultado persistido e não repetir pagamento |
| `SETTLING` sem commit, manifesto durável disponível | Repetir transação com mesmo manifesto/chave |
| `SETTLING` sem manifesto durável recuperável | Abortar tecnicamente, devolver apenas originais e registrar incidente |

O manifesto deve ser persistido de forma recuperável junto ao início da liquidação, antes de reconhecer resultado. Uma queda antes dessa persistência pode perder o progresso da missão; o mecanismo de aborto devolve equipamento original, sem inventar loot. Não prometer continuação do setor em memória após restart.

Retornar o snapshot inicial significa também devolver consumíveis originalmente reservados durante aborto técnico. Isso é uma compensação de falha do servidor, não uma opção acionável por sair do navegador. Fechar a conexão normalmente continua sujeito à regra de abandono/perda.

Implementado na 0.3 (V03.08, processo único): `ExpeditionService` identifica o próprio processo por um `bootId` aleatório, prefixado em todo `start_key` que ele cria; `recover()` roda uma vez, na inicialização, depois do processo escutar a porta (garantindo que o processo anterior não está mais rodando). Toda expedição `PREPARING` com prazo vencido é cancelada (reservas devolvidas); toda expedição `ACTIVE`/`EXTRACTING` órfã é abortada tecnicamente (reservas originais devolvidas, nenhum item novo). A liquidação (V03.07) é uma única transação SQL: ou commita por inteiro (manifesto, loot concedido, expedição `CLOSED`/`FAILED`) ou não deixa rastro algum, então não existe um estado `SETTLING` intermediário para recuperar — um processo que cai no meio da liquidação deixa a expedição `ACTIVE`, que a próxima inicialização aborta tecnicamente como qualquer outra órfã, sem inventar loot. `recover()` nunca toca uma expedição já terminal (`CLOSED`/`FAILED`/`CANCELLED`/`ABORTED_TECHNICAL`): fim normal não vira reembolso técnico. Heartbeat periódico, coluna de dono/versão na expedição e lease/fencing transacional continuam adiados para quando houver mais de um processo (parágrafo anterior).

## Banco indisponível

Antes do lançamento de missão, recusar início se não houver banco. Durante uma sala ativa, manter gameplay por uma janela curta controlada, interromper novas operações persistentes e avisar o estado de conexão. Ao extrair, congelar a parte econômica e manter resultado pendente enquanto retry seguro tenta persistir.

Se o processo precisar encerrar, persistir o manifesto quando possível. Nunca transformar timeout em “salvo com sucesso”. No próximo login, consultar resultado ou compensação. As mesmas constraints protegem contra um retry depois de commit sem ACK.

## Backup, rollback e migrações

Backup diário do banco e antes de migração relevante, com política inicial de retenção de 7 diários e 4 semanais. Medir RPO/RTO reais; a meta inicial proposta é RPO de até 24 h e RTO de até 2 h, sujeita ao volume e aos ensaios.

Ensaiar restore em banco isolado e verificar contas, licenças, saldos, itens, reservas e settlements. Nunca restaurar snapshot antigo de produção sem analisar operações que aconteceram depois: um restore pode perder progressão.

Preferir migrações expand/contract: adicionar estruturas compatíveis, lançar aplicação que usa ambas quando necessário e remover a antiga numa etapa posterior. Reverter a imagem não significa que o schema também pode ser revertido. Não lançar migrations destrutivas sem estratégia de recuperação.

## Ensaio de capacidade

Máquina inicial de referência proposta: Linux, 2 vCPU e 4 GB de RAM, com cenário de teste declarado. Não afirmar que esse hardware é suficiente antes das medições. Se banco e jogo dividirem host, medir a disputa de memória/IO.

Começar com 3 salas × 4 clientes, registrar métricas por 30 min e aumentar por degraus até a primeira meta romper. Usar carga que minera, dispara, crafta, movimenta e extrai; conexões ociosas não representam a capacidade de jogo. Resultado define limite de admissão e tamanho da implantação.
