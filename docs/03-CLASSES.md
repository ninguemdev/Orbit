# Classes e balanceamento

Os efeitos descritos pelo usuário são requisitos. Os números abaixo, exceto o boost de 400% interpretado explicitamente, são valores de partida para playtests. Armazenar em configuração versionada; o servidor aplica os valores efetivos e envia a versão ao cliente.

## Base universal

Vida 100, stamina 100, velocidade a pé 100%, EVA 100%, trabalho 100%. Todos usam pistolas, ferramentas básicas, consoles, seringas prontas e reparos lentos. Craft de seringas é exclusivo do Médico; armas longas são exclusivas do Oficial; sobrecarga temporária do motor é habilidade do Engenheiro.

Classe é escolhida antes da partida e fica travada enquanto a expedição estiver ativa. Permitir classes repetidas. Arma incompatível não pode ser equipada, atirada ou usada por trocar a classe durante o carregamento.

## Piloto

| Efeito no comando da nave | Valor inicial |
| --- | --- |
| Velocidade máxima | ×1,15 |
| Aceleração normal | ×1,20 |
| Velocidade angular | ×1,30 |
| Recuperação da carga de boost | ×1,30 |

Os bônus só existem quando o Piloto ocupa o console de comando. Trocar operador não reseta cooldown, não recarrega instantaneamente e não acumula os bônus de vários Pilotos.

O boost da nave pode ser ativado por qualquer operador. Interpretamos **400% como velocidade final ×4**, equivalente a +300% sobre a velocidade pré-boost. Se a intenção for **+400%**, a configuração muda para ×5; esta diferença precisa continuar explícita no design.

Boost inicial dura 1,5 s, consome uma carga completa e recarrega em 12 s sem bônus. Usa rampa de aceleração curta, impulso na direção da nave e limite de velocidade próprio. A sensação deve ser de uma esquiva forte; não de teletransporte. Casco continua sujeito a colisões, com detecção contínua para evitar atravessar asteroides.

## Engenheiro

| Efeito | Valor inicial |
| --- | --- |
| Velocidade de trabalho com ferramentas de engenharia | ×1,50 |
| Movimento em EVA | ×1,25 |
| Reparo de rachaduras/casco e motor | Mesmas ações básicas, com eficiência de especialista |
| Habilidade: sobrecarga do motor | Velocidade ×1,25 e aceleração ×1,20 por 8 s |
| Recarga da habilidade | 35 s, mais consumo de um componente |

Sobrecarga requer presença no console do motor, motor funcional e material disponível. Cooldown pertence à nave, evitando que dois Engenheiros alternem para renová-la sem limite. Reparar trabalha sobre dano real, consome recursos e interrompe se o alvo deixa de estar acessível.

O bônus do motor combina com o boost do Piloto ou de outro operador. Não permitir renovar múltiplas sobrecargas de mesma origem; reaplicar substitui o tempo restante de acordo com a regra configurada, sem somar magnitudes.

## Médico

| Efeito | Valor inicial |
| --- | --- |
| Aplicação de seringas em si ou em aliado próximo | Trabalho ×1,50 |
| Habilidade | Criar seringas na estação da nave |
| Reanimação de caído | 5 s em vez de 8 s |

O Médico planta, acompanha e colhe ingredientes na horta da nave. Três espécies iniciais produzem ingredientes para quatro receitas. Todos podem transportar ingredientes; somente Médico executa craft. Cultivo avança no relógio da partida, não no relógio do navegador. Crescimento inicial de 60 a 120 s permite plantar e produzir durante uma missão.

| Seringa | Efeito inicial | Duração | Ingredientes propostos |
| --- | --- | --- | --- |
| Agilidade | Movimento a pé/EVA ×1,20 | 20 s | Folha cinética + solvente |
| Trabalho | Velocidade de trabalho ×1,25 | 20 s | Fibra técnica + solvente |
| Recuperação | Regeneração de stamina ×1,75 | 25 s | Seiva vital + solvente |
| Regeneração | +3 de vida por segundo, limitada à vida máxima | 20 s | Seiva vital + folha cinética + solvente |

Aplicação base de 2 s, reduzida pela velocidade de trabalho médica. Consumir uma unidade uma única vez ao concluir. Distância, linha de acesso, alvo, estoque e cooldown validados no servidor. O alvo mostra os buffs e aceita aplicação de aliados da mesma equipe; não permitir efeito hostil com seringas.

Mesmo tipo de buff não soma; reaplicação pode renovar a duração até o limite permitido. Tipos diferentes combinam. Regeneração para ao morrer e não faz um morto voltar à vida. Horta tem três canteiros iniciais, estoque de sementes limitado e crescimento apenas enquanto a sala está ativa.

## Oficial

| Efeito | Valor inicial |
| --- | --- |
| Vida máxima | 130 |
| Stamina máxima | 130 |
| Movimento em EVA | ×1,25 |
| Duração de recarga | ×0,80 |
| Dano de armas pessoais | ×1,15 |
| Habilidade | Equipar fuzis e outras armas longas autorizadas |
| Dano da arma da nave sob seu comando | ×1,15 |
| Calor por disparo da arma da nave | ×0,75 |

Não aplicar bônus da nave quando ninguém estiver no console ou quando o Oficial estiver longe. Permissão de arma e bônus são calculados com a classe persistida no roster da partida. Aquecimento pertence à arma, não ao operador; trocar de pessoa nunca zera o calor.

## Combinações e ordem dos modificadores

Usar uma função pura de atributos, com ordem estável: atributo base → dano/estado do sistema → passivo da classe aplicável → buff de tipo permitido → habilidade da nave → boost → limites de segurança documentados. Não somar percentuais de fontes multiplicativas por acidente.

Com motor saudável, Piloto e sobrecarga: `velocidade = base × 1,15 × 1,25 × 4 = base × 5,75`. Proposta de teto: ×6 da base, que preserva esse combo. Se o boost for alterado para ×5, revisar o teto e as colisões para preservar a intenção da combinação.

Seringa de trabalho pode acelerar reparo de Engenheiro: `1,50 × 1,25 = 1,875` da taxa básica. Seringa de movimento não melhora automaticamente a nave; é buff do personagem. Bônus de dano pessoal não se aplica de novo ao dano da arma da nave.

## Aceite de balanceamento

- Classe especialista sente vantagem mensurável sem tornar outra composição inviável.
- Melhor combo de boost não atravessa obstáculos nem elimina todas as chances de resposta dos piratas.
- Craft exige ingredientes reais; troca de alvo e repetição de mensagens não fabricam doses extras.
- Rifle é recusado em todas as camadas de uso para classes não autorizadas.
- Troca de console, desconexão e morte removem os bônus certos e preservam cooldown/calor.
- Todos os atributos e tempos efetivos podem ser inspecionados em logs de desenvolvimento sem expor segredos de partida ao cliente.
