# Qualidade e validação

## Estratégia

Verificar os riscos reais: autoridade, perda/duplicação de valor, sincronização, colisão, permissões e fluxo completo. Não buscar uma porcentagem de cobertura por si só. Testes unitários servem para regras puras; integração usa PostgreSQL real; E2E cobre journeys com navegadores; carga usa clientes sintéticos que executam ações plausíveis.

## Camadas

| Camada | Casos importantes | Ferramenta proposta |
| --- | --- | --- |
| Domínio | Modificadores, boosts, classe/arma, calor, receitas, distribuição e elegibilidade | Vitest |
| Banco | Constraints, reservas, compras, concorrência e liquidação | Vitest + PostgreSQL isolado |
| Servidor/sala | Entrada falsa, console, timers, coleta, AI e reconexão | Testes do Colyseus/adaptadores |
| Navegador | Cadastro, party, duas pessoas, extração, loja e segunda partida | Playwright |
| Carga | Tick, event loop, bytes, CPU, RAM e entidades | Clientes sintéticos compatíveis com o SDK |
| Produto | Leitura de perigo, controles, cooperação e diversão | Playtest com roteiro e registro |

Usar seeds e relógio controlado nos testes de regras. Não depender de sleeps longos para crescimento, cooldown ou extração. Testes do navegador usam condições observáveis em vez de espera arbitrária.

## Cenários de economia

- Duas compras disputando o mesmo saldo.
- Duas partidas tentando reservar o mesmo equipamento.
- Repetição do pedido de iniciar ou comprar com a mesma chave.
- Loot comum com pilha que não divide igualmente entre quatro pessoas.
- Um item único recebido por exatamente uma pessoa.
- Pirata rouba carga; recuperação mantém origem e quantidade.
- Um morto tem seu equipamento recuperado pelos sobreviventes.
- Stash cheio na extração manda o item ao inbox.
- Processo cai antes da transação, durante operação e depois do commit antes do ACK.
- Retry devolve o mesmo manifesto e não concede novo pagamento.
- Contrato concluído sem extração elegível não paga.
- Preparação vencida libera todas as reservas.

## Cenários de gameplay e rede

- Piloto ganha atributos apenas no console; cooldown não reseta com troca.
- Melhor combo de boost colide com obstáculo fino.
- Dois jogadores disputam o mesmo console ou contêiner.
- EVA troca de espaço uma única vez e não teletransporta para posição enviada pelo browser.
- Médico planta/colhe/crafta usando estoque real e timer do servidor.
- Classe não autorizada não usa rifle mesmo com mensagem forjada.
- Calor da arma permanece ao trocar operador; Oficial aplica um único bônus naval.
- Mensagens duplicadas, fora de ordem, infinitas ou com quantidade negativa são recusadas.
- Desconexão dentro/fora da nave respeita vulnerabilidade, timer e recompensa.
- Liderança muda sem parar a sala; último dono saindo antes de começar invalida a nave.
- Receber estado filtrado não revela loot oculto e inventários privados.
- Foco em outro campo/tab não mantém entrada antiga para sempre.

## Critério de pronto de uma tarefa

Código/regras entregues, aceite reproduzido, checks adequados aprovados, documentação pertinente atualizada, nenhum segredo e nenhuma falha econômica conhecida introduzida. Se o teste exigiu uma seed, salvar o identificador na issue. Status Done deve ter evidência, não só declaração.

Para documentos e ajustes visuais pequenos, revisão de conteúdo/renderização basta. Para saldo, inventário, permissões e protocolo, testes automatizados são obrigatórios. Não escrever testes que apenas copiam a função e validam sua própria cópia.

## Gate específico da 0.9

Quatro contas novas formam uma party com diferentes licenças, classes, equipamentos e contratos. O líder escolhe uma nave que apenas um membro possui. A tripulação navega, usa combo de boost, sofre/repara dano, faz EVA, minera, entra numa ruína, cultiva e cria seringas, enfrenta pirata, perde e recupera carga, usa uma estação e extrai. Cada recompensa vai uma vez ao destinatário e o resultado sobrevive a novo login. Depois iniciar uma segunda missão.

Ensaiar também fracasso, stash cheio, um membro morto, liderança perdida e queda técnica. Uma missão roteirizada muito longa pode ser dividida em seeds específicas, desde que todos os fluxos estejam cobertos e exista ao menos um ciclo completo sem ferramentas administrativas.

Todas as linhas de [14-REQUISITOS.md](14-REQUISITOS.md) precisam passar. Assim a 1.0 não vira uma etapa de completar o que faltou na 0.9.

## Gate da 1.0

Nenhum bug P0/P1 conhecido: P0 = perda/duplicação de valor, acesso indevido ou indisponibilidade crítica; P1 = fluxo principal impossível ou falha recorrente de partida. Ajustes menores conhecidos podem existir com registro e workaround aceitável.

Validar tutorial, feedback de extração/perda, modo econômico, volumes, navegação por teclado nos menus essenciais e resultados sem ambiguidades. Repetir carga após mudanças de performance. Ensaiar backup/restore e rollback da aplicação compatível com o schema.
