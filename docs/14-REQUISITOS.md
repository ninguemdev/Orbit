# Matriz de cobertura e aceite da 0.9

Cada linha precisa de evidência de implementação antes de `0.9.0`. Versões abaixo são a primeira entrega planejada; o gate 0.9 verifica a integração. Os IDs referem-se a [09-TASKS.md](09-TASKS.md).

| ID | Requisito | Versão/tarefas | Evidência de aceite |
| --- | --- | --- | --- |
| R01 | 2D top down, gráficos super simples, multiplayer no navegador | 0.1: V01.04–V01.07 | Dois navegadores jogam na mesma sala com arte geométrica |
| R02 | Equipe numa nave compartilhada em setor aberto | 0.3/0.4: V03.03, V04.01 | Tripulantes caminham e pilotam a mesma nave |
| R03 | Recolher recompensas, fugir e guardar no inventário permanente | 0.3: V03.04–V03.10 | Resultado conserva itens após novo login e segunda missão |
| R04 | Piloto melhora velocidade e giro | 0.4: V04.03 | Comparação por classe no console confirma vantagem |
| R05 | Piloto recarrega boost mais rápido | 0.4: V04.03–V04.04 | Cooldown efetivo depende do operador sem reset |
| R06 | Boost da nave por alguns instantes a 400% | 0.4: V04.04 | Multiplicador ×4 documentado; sweep impede atravessar obstáculo |
| R07 | Engenheiro usa ferramentas mais rápido | 0.4: V04.05 | Trabalho com mesma ferramenta completa mais cedo |
| R08 | Engenheiro faz EVA mais rápido | 0.5: V05.03 | Mesma rota de EVA demora menos |
| R09 | Reparo de rachaduras/casco e motor | 0.4/0.5: V04.05, V05.06 | Dano real reduz e recursos são consumidos |
| R10 | Engenheiro aplica boost temporário no motor, combinável | 0.4: V04.06 | Habilidade e boost simultâneos usam fórmula prevista |
| R11 | Médico aplica seringas em si e tripulantes | 0.6: V06.06 | Dois alvos e autoaplicação respeitam dose/alcance |
| R12 | Buffs de movimento, trabalho, stamina e vida | 0.6: V06.06–V06.07 | Quatro efeitos temporários medidos e encerrados no servidor |
| R13 | Médico cria seringas na estação | 0.6: V06.05 | Receita exige classe, estação e ingredientes |
| R14 | Médico planta/colhe ingredientes dentro da nave | 0.6: V06.04 | Crescimento e colheita reais numa expedição |
| R15 | Oficial tem mais vida/stamina e EVA melhor | 0.5/0.6: V05.03, V06.02 | Atributos e tempo de rota comparados |
| R16 | Oficial usa rifles/outras armas; demais só pistolas | 0.6: V06.02–V06.03 | Mensagem forjada de outra classe é recusada |
| R17 | Oficial recarrega mais rápido e dá mais dano pessoal | 0.6: V06.02, V06.07 | Medição de recarga e dano por classe |
| R18 | Oficial dá mais dano naval e demora mais a esquentar armas | 0.7: V07.01–V07.02 | Operação da arma naval mede dano/calor distintos |
| R19 | Cadastro só de nick/senha, salvo em SQL | 0.2: V02.01–V02.03 | Conta persiste com hash, sem e-mail obrigatório |
| R20 | Menu e convite para party | 0.2: V02.04 | Convidar/entrar/sair com controle de acesso |
| R21 | Menu permite gerir inventário e loja | 0.2/0.8: V02.06, V08.01–V08.02 | Compra/venda/organização reais e persistentes |
| R22 | Modificar aparência do personagem | 0.8: V08.03 | Personalização válida aparece para outros e no relogin |
| R23 | Escolher equipamento inicial e classe por jogador | 0.2/0.8: V02.05, V08.07 | Quatro preparações distintas validadas |
| R24 | Líder escolhe nave da união das licenças de todos | 0.2/0.8: V02.07, V08.04 | Nave de um único membro usada pela party inteira |
| R25 | Cada jogador escolhe uma missão própria com recompensa | 0.8: V08.05–V08.06 | Contratos distintos pagos aos titulares elegíveis |
| R26 | Asteroides mineráveis | 0.5: V05.04 | Recursos finitos minerados e extraídos |
| R27 | Ruínas exploráveis | 0.5: V05.05 | Entrada, exploração, carga e retorno |
| R28 | Estações para reparar ou saquear | 0.7: V07.06–V07.07 | Serviço e saque são jornadas funcionais |
| R29 | Naves inimigas roubam, podem ser destruídas e saqueadas | 0.7: V07.03–V07.05 | Item roubado muda de carga e pode ser recuperado |
| R30 | Regras importantes server side; trabalho visual no client | 0.1–0.9: V01.06, V09.03, V09.05 | Fraude recusada e profiling/tráfego registrados |
| R31 | Clean Code e módulos reutilizáveis | 0.1–0.9: V01.03, V04.07, V07.08 | Domínio independente das cenas e adaptadores |
| R32 | GitHub, commits/PRs e versões de 0.1 a 1.0 | V01.01, gates de cada versão | Issues, notas de release e tags correspondem ao entregue |
| R33 | README e licença MIT | V01.01, V10.07 | README honesto e LICENSE completa no repositório |
| R34 | Todas as funções na 0.9; 1.0 dedicada ao polimento | V09.10, V10.01–V10.08 | Gate feature complete antes do ciclo de polimento |
| R35 | Preparação arquitetural para equipes contra equipes | V01.03, V07.08 | teamId/factionId, visibilidade e políticas extensíveis |

Requisitos de configuração/autoria pessoal são tratados pelos materiais de instalação que acompanham o pacote e pela revisão do diff. Não precisam virar uma função na interface do jogo.

## Registro das evidências

Na issue de cada tarefa, registrar commit, teste/roteiro, versão e seed quando relevantes. Antes da 0.9, marcar cada requisito como aprovado, bloqueado ou pendente. Não substituir evidência por vídeo de uma tela visualmente parecida, quando a regra depende de persistência, autoridade ou concorrência.
