# Regras de gameplay

## Ciclo completo

1. Cadastrar ou entrar com nick e senha.
2. Criar ou entrar na party e convidar pessoas por código ou nick online.
3. Escolher classe, aparência, equipamento e uma missão pessoal opcional.
4. O líder escolhe uma nave da união das licenças disponíveis na party.
5. Todos confirmam prontidão; o servidor valida a preparação e reserva os itens.
6. A nave aparece em um setor aberto com asteroides, ruínas, estações e piratas.
7. A equipe pilota, explora, combate, coleta e mantém nave/tripulantes vivos.
8. A equipe chega ao ponto de extração e conclui a contagem regressiva.
9. O servidor liquida a partida em uma transação, guarda os itens elegíveis e confirma o resultado.
10. A party volta ao menu com o stash atualizado.

## Nave e tripulantes

A nave inicial tem cockpit, área de motor, enfermaria/horta e depósito/eclusa. Um console de armamento pode ficar no cockpit. O interior é uma pequena malha de colisão independente da posição externa. Tripulantes caminham em coordenadas locais; o servidor transforma a posição para o espaço ao sair pela eclusa.

Qualquer classe pode pilotar, usar console, reparar com ferramenta básica e operar a nave. Passivos tornam especialistas mais eficientes. Um console só tem um operador por vez, com reserva temporária e liberação ao sair, morrer ou desconectar. O dono da party escolhe a partida, mas não é o servidor da simulação.

Estado mínimo da nave: casco, motor, oxigênio, combustível, capacidade de carga, carga de boost e calor das armas. Não simular gases célula a célula, circuitos elétricos complexos ou física orbital.

Rachaduras aumentam a perda de oxigênio; o motor danificado reduz a velocidade. Ferramentas consomem materiais e trabalho autorizado. Reparos básicos em pontos acessíveis funcionam dentro da nave; rupturas externas exigem EVA. Nunca gerar um estado sem solução: existe reparo lento universal, recursos básicos acessíveis e opção de retornar cedo.

## Setor aberto

Mapa finito por partida, alvo inicial de 12.000 × 12.000 unidades. A nave nasce em zona segura. Uma seed privada do servidor posiciona pontos de interesse e loot. O cliente recebe somente geometria e descobertas autorizadas; não recebe uma seed que permita antecipar toda a carga oculta.

| Local ou entidade | O que oferece | Risco |
| --- | --- | --- |
| Asteroides | Minérios, sucata e ingredientes industriais | Colisão, EVA e exposição a piratas |
| Ruínas | Contêineres, itens e objetivos de contrato | Sentinelas, oxigênio e espaço de mochila |
| Estação de serviço | Doca e reparo por materiais da carga | Tempo parado e custo |
| Estação saqueável | Depósitos e componentes raros | Alarmes, drones e hostilidade ao saquear |
| Nave pirata | Carga e componentes recuperáveis após destruição | Ataque, interceptação e roubo de carga |
| Zona de extração | Saída definitiva da expedição | Permanecer dentro da zona durante a evacuação |

A geração precisa garantir caminho viável entre spawn, pelo menos um ponto de loot e extração. Não colocar a única saída atrás de um obstáculo impossível de atravessar.

**Setor mínimo da 0.3 (V03.03).** Cada missão gera seu setor no servidor a partir de uma seed privada de 256 bits, com os parâmetros de `OPEN_SECTOR` no catálogo:

- Quadrado de 12.000 × 12.000 com bordas sólidas.
- A nave nasce a 4.500 unidades do centro, virada para ele, sem asteroide ou contêiner a menos de 1.400 unidades.
- Uma zona de extração de raio 600, aproximadamente do lado oposto ao spawn, sem asteroides dentro.
- Três contêineres de loot com espaço livre em volta para a nave encostar.
- Até 70 asteroides de raio 90 a 320.

Entre dois asteroides, ou entre um asteroide e a borda, sempre sobra mais que o diâmetro da maior nave, então nenhum grupo de asteroides fecha uma área. Além disso, o servidor procura em grade uma rota da maior nave do spawn até cada contêiner e até a zona de extração antes de aceitar o setor; se faltar alguma, gera outro a partir da mesma seed. Asteroides e contêineres colidem com a nave; a zona de extração não. Abrir contêineres e extrair chegam nas tarefas V03.04 e V03.05. A missão usa a nave escolhida pelo líder.

## Caminhada espacial e exploração

EVA usa traje com reserva de oxigênio, movimento por propulsor simples e retorno pela eclusa. Engenheiro e Oficial se movem mais rápido em EVA. Ao sair, o personagem herda a velocidade da nave; ao entrar, o servidor valida distância, eclusa, velocidade relativa e estado do traje. Distâncias de interação e oxigênio sempre vêm do servidor.

A nave pode deixar alguém para trás, portanto HUD indica tripulantes externos e a extração exige uma confirmação explícita ao tentar sair sem todos. EVA sem oxigênio causa dano, não teletransporte automático. Estações e ruínas usam mapas internos pequenos, abertos apenas enquanto ocupados ou envolvidos em combate.

## Sobrevivência

Vida e stamina são separadas. Correr, carregar objetos pesados e ações definidas consomem stamina. Ações essenciais lentas continuam disponíveis sem stamina, evitando travas permanentes.

Zero vida leva a estado caído por 45 s. Outro tripulante pode levantar o jogador com uma interação de 8 s e um recurso básico; Médico reduz para 5 s. Se o prazo acaba, o jogador morre e deixa a mochila no local. Seringas de regeneração não revivem mortos.

Jogador morto acompanha a equipe e vê o resultado, mas não se torna elegível para a extração. Sobreviventes podem recuperar os itens da mochila dele como carga da missão. Dano entre aliados fica desligado no PvE inicial, tanto a pé quanto nas armas da nave. Colisões e perda de oxigênio continuam perigosas para todos.

## Itens, risco e distribuição

O stash é permanente; mochila e carga da nave são temporárias durante a missão. Levar um item do stash move sua disponibilidade para uma reserva da partida. O item não pode ser vendido nem levado para outra missão enquanto estiver reservado.

- Itens na mochila retornam ao proprietário se ele extrair vivo ou caído a bordo.
- Carga comum da nave é dividida entre os tripulantes elegíveis na extração.
- Um item indivisível vai para uma pessoa; nunca criar uma cópia para cada membro.
- Pilhas são repartidas em quantidades inteiras cuja soma é exatamente a quantidade original.
- A distribuição usa roster ordenado e cursor rotativo gravados no manifesto da extração. Desconectar/reconectar não altera o sorteio.
- Equipamentos próprios depositados na nave preservam seu proprietário; só loot marcado como comum entra na divisão.
- Recompensa de missão é individual, prevista pelo contrato e entregue uma única vez após objetivo e extração elegível.

Antes da missão, o menu informa perda possível e regras de distribuição. Durante a partida, o HUD diferencia equipamento próprio, loot comum e itens de objetivo. Capacidade proposta: mochila de 8 slots e carga inicial de 24 slots, com empilhamento por tipo.

**Coleta na 0.3 (V03.04).** Antes de existir EVA (0.5), a coleta acontece pela eclusa de carga, na popa da nave:

- **Acesso:** um tripulante a pé na eclusa alcança o porão e, com o casco encostado num contêiner, o conteúdo desse contêiner.
- **Movimentos:** ele pode mover itens entre o contêiner, a própria mochila (8 espaços) e o porão (24 espaços na Batedora, 40 na Cargueira). Contêineres só fornecem itens.
- **Loot:** cada contêiner tem de 2 a 4 pilhas sorteadas da tabela `CONTAINER_LOOT` pela seed da missão, com IDs temporários aleatórios.
- **Pilhas:** loot comum do mesmo item e da mesma origem se empilha até o limite do catálogo, e uma parte de uma pilha vira outra pilha com ID novo. A soma é sempre a original.
- **Equipamento próprio:** o que veio do stash conserva o ID reservado e o dono, só se move inteiro, sem dividir nem juntar, e só o dono o move, mesmo depois de deixá-lo no porão. O equipamento dos espaços de arma e ferramenta fica equipado.
- **Espaço:** um movimento que não cabe inteiro é recusado sem mudar nada.

Por enquanto nada disso é gravado: o manifesto (V03.06) e a liquidação (V03.07) levarão esse estado ao stash.

Se o stash estiver cheio ao extrair, itens vão para caixa de recebimento permanente. Falta de espaço nunca descarta uma recompensa já confirmada. A caixa tem controle de abuso e histórico; não substitui a capacidade normal para entrar equipado.

## Extração

A equipe entra numa zona, mantém a nave abaixo do limite de velocidade e ativa o console de saída. Evacuação inicial: 10 s. Sair da zona, perder energia mínima ou destruir a nave cancela a contagem; dano comum não cancela automaticamente. O servidor calcula tempo, posições e elegibilidade.

Conta como extraído quem estiver vivo ou caído dentro da nave no momento da conclusão, incluindo reconexão pendente dentro da janela permitida. Mortos, abandonados e personagens em EVA ficam de fora. As regras aparecem na confirmação de saída.

Depois da contagem, o servidor congela alterações econômicas da sala, gera o manifesto e inicia a liquidação. A tela mostra confirmação pendente até o banco confirmar. Repetir a conclusão não multiplica itens. O processo de persistência está em [dados e economia](06-DADOS-E-ECONOMIA.md).

**Extração básica da 0.3 (V03.05).** Casco, zona, velocidade e contagem já funcionam na simulação da missão; manifesto (V03.06) e liquidação (V03.07) ainda não existem, então todo fim de partida continua voltando os itens reservados, sem conceder nada.

- **Casco:** cada nave tem pontos de casco básicos (Batedora 100, Cargueira 140). Uma colisão só causa dano acima de 60 de velocidade de impacto (a parcela da velocidade realmente absorvida pela colisão); acima disso, cada unidade de impacto custa 0,3 ponto de casco. Casco a zero destrói a nave e perde a expedição. Rachaduras, motor e reparo chegam com os sistemas completos da 0.4 (V04.02).
- **Console de saída:** por enquanto é o próprio console de comando. Quem está no leme ativa a evacuação; não existe um terceiro console dedicado nesta versão.
- **Zona e velocidade:** a evacuação só começa com o casco inteiro dentro da zona de extração e a nave a, no máximo, 30% da velocidade máxima do próprio modelo.
- **Contagem:** 10 s, contados pelo servidor; o cliente só exibe o valor recebido, nunca decide a conclusão. Sair da zona ou ultrapassar o limite de velocidade cancela a contagem; dano comum de colisão não cancela, só a destruição encerra a partida.
- **Prazo da missão:** sem ninguém extrair em 1200 s (20 min), a expedição é perdida, igual à destruição.
- **Elegibilidade:** ao concluir a evacuação, a sala calcula quem está a bordo (conectado; antes da EVA da 0.5, todo conectado está a bordo) e envia esse resultado a todos, pronto para o manifesto da V03.06.

## Falha, desconexão e cancelamento

| Evento | Resultado |
| --- | --- |
| Nave destruída ou tempo máximo vencido | Expedição perdida; consumíveis e itens levados que não retornaram são perdidos |
| Líder desconecta | Liderança da party passa para outro membro; a missão continua no servidor |
| Jogador cai da conexão | Janela inicial de 60 s; personagem continua vulnerável e libera consoles |
| Janela termina | Personagem vira abandonado, mochila cai; nenhuma recompensa por abandono |
| Todos desconectam | Sala aguarda a janela; depois encerra com perda normal da missão |
| Carregamento inicial falha antes da ativação | Cancelamento técnico devolve reservas sem criar recompensas |
| Processo do servidor cai | Política de aborto técnico e reconciliação definida em operação; não simular extração fictícia |
| Banco falha na liquidação | Resultado permanece pendente, sem confirmação falsa nem desbloqueio prematuro de itens |

Kit inicial gratuito é temporário, não vendável e não vira estoque permanente ao retornar. Assim jogadores sem recursos podem jogar sem fabricar moeda por missões vazias. A licença da nave não é consumida quando a nave é perdida.
