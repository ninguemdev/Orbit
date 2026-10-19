# Fluxos, interface e apresentação

## Menu principal

Após autenticar, mostrar o personagem, créditos, stash, caixa de recebimento e party. Telas de preparo não executam simulação de setor. Party atualiza por eventos; inventário e compras usam respostas autenticadas da API.

O menu é feito para janela de PC em 16:9: barra superior com a conta, o modo econômico e as ações, e três colunas abaixo (party e código de recuperação; nave, classe e prontidão; inventário e loadout). Em janela alta o bastante cada coluna rola sozinha e a barra fica visível; em janela menor as colunas se reduzem a duas ou uma e a página inteira rola.

| Área | Ações e informações |
| --- | --- |
| Conta | Entrar/cadastrar com nick e senha, sair e recuperar com código opcional |
| Party | Criar, convidar por código/nick online, entrar, sair, expulsar antes da missão e trocar líder |
| Personagem | Cor, uniforme simples e acessórios disponíveis; prévia top down |
| Inventário | Stash permanente, inbox, mochila de preparação e equipamento por slot |
| Loja | Comprar/vender com moeda do jogo; preço e quantidade confirmados |
| Classe | Quatro funções com descrição clara de passivos e exclusividades |
| Missão | Selecionar um contrato por pessoa; ver objetivos da equipe sem impor contrato único |
| Nave | Lista resultante da união das licenças da party; líder escolhe |
| Prontidão | Estado de cada membro, validações de loadout e botão de iniciar do líder |

Mostrar por que a nave está disponível: “Liberada por: nick”. Isso comunica uso compartilhado sem afirmar transferência permanente da licença. Uma mudança de membros, nave, classe, contrato ou equipamento relevante cancela prontidão afetada e incrementa a revisão da preparação.

Não permitir início quando um membro tem estado inválido, item reservado em outra partida ou escolha incompatível. O servidor confirma a revisão; o botão desativado no cliente é apenas uma ajuda visual.

Depois da confirmação (V03.02), cada membro da expedição pede um ticket de missão e entra sozinho na sala da missão, a partir do menu ou da sala de testes; a tela do jogo abre com o HUD e o botão **Sair da missão**. A entrada automática espera enquanto um código de recuperação novo estiver na tela, e uma sessão vencida leva ao login. Antes da partida começar, uma queda volta ao menu na hora (sem tentar reconectar a um lugar que o servidor já liberou); depois, vale a reconexão normal. Quem entrou na party depois da partida começar vê que ela está em andamento, sem botão de entrar, e a prontidão só volta quando ela termina. Se a entrada falha, o menu mostra o erro e o botão **Entrar na missão** tenta de novo enquanto houver prazo; com a partida em andamento, o mesmo botão leva de volta à tripulação. O cancelamento por prazo ou mudança da party e o fim da partida aparecem como aviso da party.

## Durante a missão

HUD informa vida, stamina, oxigênio/EVA, buffs, mochila e contrato pessoal. Dados comuns: casco, motor, oxigênio da nave, combustível, carga, calor, boost, sobrecarga e posição dos tripulantes. Radar apresenta informação autorizada dos sensores; não revela loot oculto.

Na 0.3 (V03.04), o painel **Inventário da missão** fica à esquerda da tela, acima do minimapa, e mostra só o que o servidor enviou ao jogador: equipado, mochila, porão da nave e, enquanto ele está na eclusa de carga (círculo lilás na popa) com a nave encostada num contêiner, o conteúdo do contêiner.

- **Botões:** **Pegar** e **Ao porão** levam o item inteiro; para pilhas de loot comum também há a variante de 1 unidade. Os botões só aparecem na eclusa, com a partida em andamento e a conexão ativa, e equipamento de outro membro não tem botão. Depois de um clique, os botões esperam a resposta do servidor.
- **Atualização:** clicar só envia o pedido; a lista muda quando chega a nova visão do servidor.
- **Recusas:** aparecem no HUD (fora da eclusa, contêiner longe, item já pego, sem espaço).

Ao interagir com console, câmera e controles mudam de modo. É possível sair do console e caminhar de novo. Ter indicação visível do operador evita disputa silenciosa. Teclas de ação contextual mostram o alvo e a duração antes de começar.

O piloto vê mapa e alertas de EVA; demais tripulantes podem consultar radar sem receber controle da nave. A equipe tem marcação de ponto de interesse/ping com cooldown. Comunicação por voz externa é suficiente para a primeira entrega; não implementar voz embutida.

## Controles propostos

| Contexto | Controle |
| --- | --- |
| Personagem/EVA | WASD para mover; Shift para esforço; mouse para mirar |
| Interação | E para iniciar/confirmar; Escape para sair/cancelar |
| Arma pessoal | Clique para disparar; R para recarregar |
| Inventário temporário | Tab ou I |
| Nave no console | W/S aceleração/freio, A/D giro, Espaço boost |
| Armamento da nave | Mouse para mira; clique para disparar |
| Habilidade contextual | Q, com alvo e cooldown exibidos |
| Mapa/ping | M para mapa; botão contextual para marcar |

Evitar conflitos de foco com campos de texto. Remapeamento básico entra em polimento. Solicitar áudio após uma interação do usuário e salvar volume/preferência visual localmente. Preferências locais não incluem saldo, equipamentos ou efeitos de classe.

## Extração e relatório

Console apresenta quem está a bordo, quem está fora e qual carga será levada. Se houver pessoas fora, mostrar confirmação explícita. A contagem deve usar deadline do servidor; o browser anima o contador sem decidir a conclusão.

Resultado tem estados distintos: aguardando liquidação, confirmado e pendente por erro técnico. Exibir itens próprios retornados, loot comum recebido, recompensa de contrato, itens perdidos, itens que foram para inbox e condição de cada membro. Não mostrar “guardado” antes do commit.

No próximo login, uma expedição pendente deve reaparecer como pendente ou resultado consolidado. O jogador não precisa acompanhar o socket conectado para a transação terminar.

## Arte super simples

Personagens como círculos/cápsulas com visor e marcador de classe. Naves em poucas formas planas. Asteroides em polígonos ou sprites pequenos. Piso e paredes em tiles sem iluminação dinâmica pesada. Ruínas e estações reutilizam linguagem visual com ícones diferentes.

Cor não é o único sinal: usar ícone/texto para classe, perigo, propriedade e estado. Tamanho das hitboxes não varia com skin. Não depender de texto pequeno sobre sprites para entender ações.

Limitar partículas, trilhas e flashes. Criar atlas pequeno ou texturas geradas e cacheadas; não redesenhar centenas de `Graphics` complexos a cada frame. Sons curtos para colisão, alerta, coleta, boost, ferramenta e extração.

## Modo econômico

Selecionar 30 FPS, reduzir resolução de renderização, partículas, efeitos de fundo e número de rótulos. Opção disponível no menu e durante a missão. Renderizar o necessário para leitura do perigo mesmo com efeitos reduzidos. Não alterar tick do servidor, alcance, colisão ou informação de radar ao reduzir qualidade.

## Primeiro contato

Tutorial curto em local seguro ensina caminhar, usar console, pilotar, pegar carga e extrair. Depois introduz ferramentas, EVA e funções de classe em mensagens contextuais. O botão de jogar não depende de ler todo o GDD.

Mensagens de erro apresentam ação concreta: escolha incompatível, inventário cheio, item indisponível, nave sem dono na party ou conexão interrompida. Detalhes de banco, protocolo, logs e arquitetura ficam na documentação de desenvolvimento, não no fluxo do jogador.
