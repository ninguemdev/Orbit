# Visão e escopo

## Proposta

Orbit é um loot extractor espacial cooperativo, 2D top down, com arte muito simples e acesso pelo navegador. O centro da experiência é operar uma nave em equipe: alguém dirige, alguém mantém sistemas, alguém cuida dos tripulantes e alguém protege a carga. Recuperar um item é apenas metade do objetivo; levá-lo para fora do setor transforma a descoberta em progresso permanente.

O jogador cadastra nick e senha, forma uma party, escolhe classe e equipamentos, entra numa expedição, coleta recursos e decide quando fugir. No retorno, organiza o inventário, compra itens e prepara a próxima missão.

## Pilares

| Pilar | Consequência para o design |
| --- | --- |
| Cooperação por funções | Consoles e emergências criam tarefas simultâneas; qualquer classe pode assumir funções básicas |
| Risco de extração | Loot de missão fica temporário até a liquidação autorizada pelo servidor |
| Leitura imediata | Formas, ícones, estados e cores simples tornam perigos e interações claros |
| Nave como espaço compartilhado | Tripulantes caminham dentro da nave enquanto ela se move pelo setor |
| Navegador acessível | Carregamento curto, efeitos limitados e opção de 30 FPS |
| Base extensível | Equipes, relações de hostilidade e entidades usam IDs e políticas explícitas |

## Escopo até 1.0

Todas as funções pedidas entram até 0.9: quatro classes, boosts combináveis, reparos, EVA, seringas produzidas com plantas da nave, armas pessoais e da nave, cadastro SQL, party, stash, loja, personalização, seleção de equipamentos e nave, disponibilidade compartilhada de naves, uma missão por jogador, mineração, ruínas, estações e piratas.

O lançamento 1.0 refina esse mesmo conjunto. Não adicionar funções novas de escopo na etapa de polimento.

## Premissas operacionais propostas

| Tema | Proposta inicial | Motivo |
| --- | --- | --- |
| Tripulação | 1 a 4 jogadores, limite configurável | Quatro funções com custo controlado; permitir solo para teste e acesso |
| Classes repetidas | Permitidas | Não bloquear grupos pela composição; especialização melhora eficiência |
| Partida | Instância de setor aberta, com uma equipe humana e NPCs | Garantir coop e extração sem resolver PvP na primeira entrega |
| Duração | Alvo de 15 a 20 minutos; limite de 25 minutos | Produzir decisões de risco sem depender de sessões longas |
| Plataformas | Desktop com teclado e mouse, Chrome/Edge/Firefox atuais | Priorizar fluxo e desempenho; mobile fica posterior |
| Conta | Nick e senha, sem e-mail obrigatório | Cumprir cadastro solicitado; recuperação precisa de código opcional |
| Progressão | Itens, créditos e licenças de naves | Evitar árvore de progressão extensa antes do ciclo funcionar |
| Loja | Moeda do jogo, compra e venda de itens | Fechar a economia sem pagamentos reais |
| Naves | Licenças desbloqueadas, utilizáveis por party | Destruição perde carga e equipamentos da missão, não a licença |
| Arte | Geometria simples, poucos sprites, ícones e sons curtos | Manter produção e renderização leves |

Essas escolhas resolvem lacunas do pedido e podem ser alteradas na configuração. Capacidade do servidor será medida, não inferida do limite por equipe.

## Fora do escopo inicial

Equipes contra equipes, mapa persistente compartilhado, comércio entre jogadores, leilão, voz embutida, clãs, construção de naves peça a peça, economia com dinheiro real e suporte mobile completo. Preparar políticas para PvP sem implementar matchmaking competitivo ou prometer que PvP será apenas ligar uma flag.

## Conteúdo mínimo na 0.9

Um setor aberto com variação de seed; três layouts simples de nave; pelo menos três tipos de asteroide/recurso, três layouts de ruína, estação de reparo e estação saqueável, dois comportamentos de nave pirata, pistola e duas armas longas para Oficial, quatro receitas de seringas, três espécies de planta, seis modelos de missão e um conjunto pequeno de opções de aparência.

São quantidades propostas para comprovar os sistemas. Se o prazo exigir redução de variedade, preservar todas as funções e registrar a alteração em decisões; não chamar uma função ausente de polimento futuro.

## Métricas para decidir se o jogo funciona

- Uma party completa entrada, exploração, extração, stash e segunda partida sem intervenção administrativa.
- A equipe encontra motivo concreto para dividir funções sem ser obrigada a ter as quatro classes.
- O jogador entende por que perdeu ou ganhou cada item no relatório final.
- A simulação mantém o orçamento definido para a máquina de referência e o cliente oferece modo de 30 FPS.
- Não há duplicação de carga ao repetir pedidos, reconectar ou derrubar o processo durante a liquidação.
