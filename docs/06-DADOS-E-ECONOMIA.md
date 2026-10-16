# Dados, inventário e economia

## Princípios

Contas, permissões, créditos, licenças e inventário ficam em PostgreSQL. Estado de movimento fica em memória no processo da sala. Guardar transições e resultados duráveis, não posições a cada tick. Toda operação que move valor deve ser transacional, idempotente e autorizada.

Persistência não é salvar um JSON enviado pelo navegador. A conta vem da sessão; a classe e o loadout vêm de registros validados; a recompensa vem do resultado calculado no servidor.

## Modelo proposto

| Tabela | Campos/conceitos principais | Invariante |
| --- | --- | --- |
| `accounts` | UUID, nick exibido, nick normalizado, hash da senha, datas, estado | Nick normalizado único; nunca senha em texto |
| `sessions` | ID, hash de token, usuário, expiração e revogação | Token bruto não é guardado no banco/log |
| `account_recovery` | Hash de código, usuário e data de uso | Opcional, uso único, não substitui senha conhecida |
| `profiles` | Usuário e aparência autorizada | Somente opções existentes no catálogo |
| `wallets` | Usuário, créditos inteiros e versão | Saldo nunca negativo |
| `item_instances` | ID, tipo, dono atual, origem, quantidade, durabilidade, localização | Quantidade positiva; uma localização por instância |
| `inventory_slots` | Usuário, slot, item | Slot único; item não aparece em duas posições |
| `inbox_entries` | Usuário, item e motivo de recebimento | Recebimento sem espaço não apaga item |
| `ship_unlocks` | Usuário e ID da licença de nave | Par usuário/nave único |
| `expeditions` | ID, estado, dono do processo, heartbeat, seed privada, versões, prazo | Transições válidas e terminal único |
| `expedition_members` | Expedição, usuário, equipe, classe, loadout snapshot, estado final | Uma participação por usuário/expedição |
| `active_participations` | Usuário e expedição | Uma expedição por usuário, por constraint única |
| `item_reservations` | Expedição, usuário, item e quantidade reservada | Quantidade reservada não excede disponível |
| `mission_assignments` | ID, expedição, usuário, modelo, parâmetros, progresso e resultado | Um contrato por jogador/partida |
| `settlements` | Expedição, tipo de desfecho, manifesto imutável, hash e data | Uma liquidação por expedição |
| `economy_operations` | Usuário, tipo, chave idempotente e resultado | Chave única por usuário/operação |
| `economy_entries` | Operação, item/crédito, origem, destino e delta | Histórico auditável de alterações de valor |

Catálogo de itens, classes, receitas, naves e missões fica versionado no código. Guardar `catalogVersion` na partida e IDs estáveis em SQL. Não reutilizar ID de item para outro significado; itens antigos precisam de migração ou definição compatível.

Implementado na 0.2 (V02.06): `wallets`, `item_instances`, `inventory_slots`, `inbox_entries` e `ship_unlocks`. Slot e caixa de recebimento apontam para o item por chave composta (item, dono, localização), então o banco garante que o item está no stash ou na caixa do próprio dono e em um único lugar. Toda conta nova recebe 200 créditos e a licença da Batedora na transação do cadastro; o stash tem 40 espaços e o excedente vai para a caixa de recebimento. Concessões à mesma conta são serializadas por lock na linha da conta (`FOR NO KEY UPDATE`, que não bloqueia logins), completam pilhas parciais antes de abrir espaços novos e aceitam até 10.000 unidades por vez; a leitura do inventário usa um único snapshot.

Loadout (V02.08): `loadout_items` guarda o que o jogador escolheu para a próxima missão, em três espaços de equipamento (arma principal, arma secundária e ferramenta) e 8 de mochila. A linha aponta para o item por chave composta (item, dono, `stash`), então só entra item do próprio stash, uma vez, e o item não sai do stash enquanto estiver escolhido. Escolher não move nem reserva nada: a reserva da partida começa na 0.3. O servidor substitui o loadout inteiro numa transação e recusa tudo se algum espaço for inválido (item de outra conta ou inexistente, espaço errado, arma de outra classe, repetição). Arma de classe só é exigida no espaço de equipamento; a mochila leva qualquer item do catálogo. Se a classe mudar depois, a leitura do loadout aponta o item que deixou de valer.

`item_instances` representa tanto equipamento único quanto pilhas. Ao dividir uma pilha, criar subinstâncias com origem registrada e soma preservada. Um item em estado reservado deixa de estar disponível no stash, mesmo se a linha física ainda existe na tabela. As constraints e repositórios devem impedir estados incompatíveis.

## Cadastro e sessão

Proposta de nick: 3 a 20 caracteres ASCII entre letras, números e `_`, comparação sem diferenciar maiúsculas. Guardar versão exibida e normalizada. A restrição evita regras ambíguas e colisões de normalização; pode ser ampliada com testes específicos depois.

Senha com 12 a 128 caracteres, sem truncar, processada por Argon2id com salt aleatório gerenciado pela biblioteca. Ponto inicial mínimo: memória 19 MiB, duas iterações, paralelismo 1; medir na máquina alvo e limitar concorrência de hash. Não usar SHA puro nem armazenar senha recuperável.

Sessão com token aleatório, cookie HttpOnly/Secure/SameSite e validade inicial de 7 dias. Validar Origin e proteção CSRF em operações HTTP que alteram estado. Revogar no logout/troca de senha. Erros de login não revelam se a conta existe. Não guardar token de sessão em `localStorage`.

Cadastro exige só nick e senha. Depois de criar, oferecer código opcional de recuperação mostrado uma vez. Sem e-mail ou código, não existe recuperação automática confiável; a interface deve explicar isso. Não inventar recuperação com apenas o nick. Não cadastrar contato adicional obrigatoriamente.

## Party e licenças de nave

Disponibilidade é `UNION` das licenças válidas dos membros atuais, deduplicada por tipo de nave. Não exigir que todos tenham a nave e não conceder permanentemente a licença a quem apenas jogou nela.

O líder seleciona um tipo disponível. Se o último dono dessa licença sai antes do lançamento, invalidar a seleção e a prontidão. Ao iniciar, revalidar no servidor e congelar autorização, roster, classe e configuração. Se o dono sai durante a missão ativa, a equipe continua com a nave autorizada para aquela expedição.

Na V1, licença não é consumida nem perdida com destruição da nave. Não há disputa de uma instância física entre duas parties: acesso é a um modelo desbloqueado. Uma conta só pode estar em uma expedição ativa.

## Reserva e ativação

1. Receber confirmação do líder com versão da preparação e chave idempotente.
2. Em transação, bloquear os registros necessários em ordem estável por usuário/ID de item.
3. Confirmar prontidão, propriedade, classe/arma, disponibilidade da nave e nenhuma participação ativa.
4. Criar expedição `PREPARING`, participantes, snapshots e reservas. O equipamento fica indisponível para outras operações.
5. Criar a sala e entregar assentos autenticados. Essa etapa de memória não está na mesma transação SQL; usar estado e timeout para compensação.
6. Todos os clientes necessários carregam; o servidor marca `ACTIVE` antes de permitir consumo/recompensas. Prazo proposto de preparação: 30 s.
7. Se a criação/carregamento falha antes da ativação, cancelar e devolver as reservas em transação única.

Nenhum retry cria uma segunda expedição com os mesmos itens. Se o processo cair entre SQL e sala, a rotina de reconciliação encontra `PREPARING` vencida e cancela com segurança.

Implementado na 0.3 (V03.01, parte de dados): `expeditions`, `expedition_members`, `active_participations` e `item_reservations`. `startExpedition` recebe a chave de início escolhida pelo servidor, trava as contas dos membros numa única consulta em ordem de ID (o mesmo lock de toda alteração de inventário) e, sob o lock, confere a classe salva, o loadout salvo (exatamente os itens confirmados, no stash do dono e válidos para a classe) e a licença da nave na união dos membros. Grava a expedição `PREPARING` com prazo de 30 s (no máximo 600) pelo relógio do banco, os membros com snapshot de classe e loadout, as participações e as reservas, tudo na mesma transação. Repetir a chave com o mesmo pedido devolve a mesma expedição sem criar outra; se ela já terminou (por exemplo, a preparação expirou), a resposta é `expedition_ended` com o ID dela, nunca um início novo. A mesma chave com outro pedido é recusada (`key_reused`), e IDs fora do formato UUID minúsculo recusam o pedido antes do banco. O banco garante as invariantes: participação ativa tem a conta como chave primária (uma expedição por conta); reserva tem o item como chave primária (um item reservado uma vez) e aponta para a participação ativa e para o item no stash do dono com a mesma quantidade, então a pilha reservada não pode ser apagada, sair do stash nem mudar de tamanho; concessões novas abrem outra pilha. Enquanto a conta está numa expedição, o loadout salvo não muda (`in_expedition`); reorganizar o stash continua permitido, porque a reserva não depende do espaço. Apagar a conta do líder de uma expedição é recusado, para não apagar o histórico dos outros membros. `cancelPreparation` devolve as reservas e encerra as participações de uma expedição ainda `PREPARING`, uma única vez. A party ainda não chama a reserva: isso chega na parte de servidor da V03.01.

## Durante a partida

Loot, consumo, craft, roubo de piratas e transferências são fatos da simulação autoritativa. Cada objeto tem ID de expedição e origem; manter trilha de alterações suficiente para compor o manifesto final. Não escrever o banco a cada movimento.

Equipamento levado preserva o ID original. Ao ser perdido em morte e recuperado como salvamento, preservar a proveniência e permitir novo destinatário elegível. Equipamento próprio guardado na carga conserva o dono enquanto ele for elegível; ao morrer/abandonar, o que a equipe recuperar pode virar salvamento comum. Essa conversão precisa ser explícita no relatório.

Uma carga roubada por pirata sai da nave do jogador e passa para a carga do pirata, sem cópia. Destruir o pirata permite recuperá-la com o mesmo ID/proveniência. Não alterar stash durante roubo, pois os itens ainda estão na expedição.

## Liquidação da extração

Ao completar a extração, congelar interações que alteram itens. Criar no servidor um manifesto com expedição, participantes elegíveis, destinos, quantidades, itens devolvidos/perdidos, contratos concluídos e versões. O cliente não fornece esse manifesto.

Uma transação curta faz:

1. Bloquear expedição e consultar `settlements` por ID único. Se já existe, devolver o resultado persistido.
2. Verificar estado e hash do manifesto; duas propostas diferentes para a mesma expedição não são aceitas silenciosamente.
3. Bloquear reservas, itens e saldos afetados em ordem estável.
4. Resolver TODOS os participantes: transferir/devolver itens sobreviventes, registrar perdidos e consumir quantidades realmente usadas. Não deixar reservas de mortos ou desconectados penduradas.
5. Conceder o loot novo e recompensas de contratos aos destinatários definidos, sem repetir IDs/quantidades.
6. Enviar excesso ao inbox permanente; não rejeitar a extração por stash cheio.
7. Registrar operações/entradas econômicas e o manifesto imutável, encerrar a expedição e liberar participações/reservas.
8. Commit; somente depois emitir confirmação de sucesso ao navegador.

Timeout, deadlock ou falha de conexão exige retry com a mesma chave/manifesto e consulta do resultado anterior. Transação com erro precisa de rollback; o pool não pode receber uma conexão em estado inválido. Não usar chamadas SQL em conexões diferentes dentro da mesma transação.

Falha normal da missão usa liquidação idempotente para destruir o equipamento perdido e liberar reservas. Aborto técnico usa outra política, descrita em [operação](12-OPERACAO.md), sem conceder loot novo.

## Loja e contratos

Loja do menu compra/vende por preços do catálogo no servidor, com moedas inteiras. Cliente envia ID, quantidade e chave idempotente. Bloquear saldo/itens, aplicar limites e gravar a operação com resultado. Repetir o mesmo pedido retorna o mesmo resultado; um pedido diferente com a mesma chave é rejeitado.

Itens reservados, kit gratuito, ingredientes em uma partida ativa e licenças não vendáveis são recusados. Preço, desconto e saldo do navegador não são usados como autoridade.

Cada participante pode escolher uma missão. Um objetivo compartilhado pode satisfazer contratos diferentes de vários jogadores, mas cada pagamento corresponde ao contrato individual válido e à extração do seu titular. Missões não exigem que a equipe inteira escolha o mesmo contrato.

## Casos obrigatórios de verificação

Compra dupla concorrente; venda de item reservado; início em duas parties; último dono da nave saindo; stack dividida; recuperado de morto; pirata roubando o mesmo item duas vezes; stash cheio; repetição da liquidação; queda antes/depois de commit; contrato repetido; pagamento de morto/abandonado; cancelamento antes de ativar; retorno técnico de itens originais.
