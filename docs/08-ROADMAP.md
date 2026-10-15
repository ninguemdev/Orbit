# Roadmap de 0.1 a 1.0

## Política

Cada versão entrega comportamento verificável. A numeração não representa porcentagem de código nem calendário. Começar com `0.1.0`; patches corrigem a release atual, por exemplo `0.3.1`. Não esperar até 0.9 para testar extração, persistência ou reconexão.

As tarefas completas estão em [09-TASKS.md](09-TASKS.md). Todas começam pendentes. Só concluir uma tarefa com seu aceite verificado; só criar tag quando o gate da versão passa.

## Marcos

| Versão | Objetivo | Entrega principal | Gate da release |
| --- | --- | --- | --- |
| 0.1.0 | Fundação com multiplayer real | Workspace, CI, catálogo mínimo, simulação, cliente e duas conexões | Dois navegadores movem tripulantes/nave, sem cliente ditar posição |
| 0.2.0 | Preparação persistente | Nick/senha, sessão SQL, menu, party, classe selecionável, stash e licenças | Criar conta, entrar em party, preparar loadout e validar união de naves |
| 0.3.0 | Primeira extração completa | Reserva, setor mínimo, loot, casco básico, extração e transação final | Duas missões seguidas, sucesso/perda e retry sem duplicação |
| 0.4.0 | Operação cooperativa da nave | Consoles, Piloto, Engenheiro, rachaduras, motor, boost e combo | Bônus por operador, reparos reais, combo e colisão contínua aprovados |
| 0.5.0 | Exploração externa | EVA, oxigênio, eclusa, mineração e ruínas | Coletar fora da nave e voltar; classes com EVA mais rápido verificadas |
| 0.6.0 | Sobrevivência e especializações | Vida/stamina, Médico, cultivo, craft, seringas, Oficial e armas pessoais | Plantar → colher → criar → aplicar; restrição de rifle e dano no servidor |
| 0.7.0 | Ameaças e estações | Armas da nave, calor, bônus do Oficial, serviços e saque, AI pirata | Reparar na estação, saque hostil e roubo/recuperação real de carga |
| 0.8.0 | Progressão e escolha | Loja, personalização, três naves, contratos pessoais e loadout completo | Cada jogador leva escolhas próprias e recebe sua missão sem pagamento duplicado |
| 0.9.0 | Todas as funções integradas | Cobertura total, equilíbrio inicial, falhas tratadas e operação completa | Matriz de requisitos e fluxo ponta a ponta aprovados com 4 jogadores |
| 1.0.0 | Polimento para lançamento | Tutorial, feedback, ajustes de dificuldade, renderização e experiência | RC aprovado, nenhum bloqueador e rollback/restore ensaiados |

Na 0.2, classes são selecionáveis e contratos ainda não precisam existir. Na 0.4, entram Piloto/Engenheiro e regras de passivos de EVA; Médico completo vem na 0.6 e bônus naval do Oficial na 0.7. Relatar essas diferenças com precisão na release.

## Gates que valem em todas as versões

- Build reproduzível e lockfile atualizado.
- Verificações de código adequadas à mudança.
- Nenhum bug conhecido que duplique itens ou confirme perda/ganho incorretamente.
- Regras implementadas documentadas; limitações da release listadas no changelog.
- Dados existentes tratados por migração ou reset de desenvolvimento explicitamente permitido.
- Pelo menos um teste com navegadores separados para mudança de fluxo multiplayer.

Antes da 0.3, ambiente é apenas de desenvolvimento/preview e não possui um ciclo de jogo completo. Nenhuma release anterior à 1.0 deve ser anunciada como entrega final.

## Caminho crítico

O caminho de maior risco passa por simulação/rede (0.1), identidade e preparação (0.2), reserva/liquidação (0.3), sistemas cooperativos (0.4–0.6), combate/AI (0.7), progressão (0.8) e integração (0.9). Resolver esse caminho antes de ampliar conteúdo artístico.

Arte geométrica, UI e catálogo podem evoluir ao lado das tarefas do mesmo marco, depois que os contratos necessários existirem. Não iniciar mais de uma alteração de protocolo ou economia incompatível simultaneamente.

## Depois de 1.0

O próximo marco proposto é 1.1 com laboratório de múltiplas equipes, seguido de beta PvPvE. Primeiro medir quantas equipes/cenas o servidor suporta e quais efeitos de latência são aceitáveis. Depois definir matchmaking, spawns, relação entre equipes, competição por loot, extração e permissões de combate.

Essa expansão é uma proposta posterior e não bloqueia 0.9/1.0.

## Como estimar trabalho

Usar os tamanhos relativos P/M/G do backlog. P costuma caber em uma revisão pequena; M combina uma funcionalidade e verificações; G deve ser subdividida antes de começar. Após 0.3, usar a velocidade real dos PRs para estimar datas. Não tratar uma estimativa inicial sem implementação como compromisso de prazo.
