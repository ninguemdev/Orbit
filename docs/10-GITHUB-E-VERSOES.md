# GitHub, commits e versionamento

## Repositório

`main` deve refletir o último estado integrado e verificável. Usar branches curtas: `feat/v03-extraction-settlement`, `fix/v04-boost-collision` ou `docs/class-balance`. GitHub Flow é suficiente para um projeto solo; não manter `develop` e múltiplas branches de release sem necessidade.

O repositório recebe código, assets, configuração, testes, migrações e documentação do jogo. Material de trabalho pessoal, arquivos temporários e credenciais ficam fora do versionamento. Arte de terceiros só entra com origem/licença registradas.

## Milestones, issues e board

Criar milestones `0.1.0` até `1.0.0`. Importar cada task do backlog como issue, com seu ID no título. Labels sugeridas: `area:client`, `area:server`, `area:data`, `area:gameplay`, `area:ui`, `area:ops`, `type:bug`, `type:feature`, `size:P`, `size:M`, `size:G`, `risk:economy`, `risk:network` e `blocked`.

Board: Backlog → Ready → In progress → Review → Done. Ready exige dependências concluídas e aceite claro. Limite inicial de WIP: uma tarefa principal em desenvolvimento e uma em revisão. G deve virar subtarefas revisáveis sem perder a issue que descreve o resultado completo.

## Commits

Conventional Commits: `feat`, `fix`, `refactor`, `test`, `docs`, `perf`, `build`, `ci` e `chore`. Scope é o módulo do produto. Exemplos:

- `feat(ship): combinar boost com sobrecarga do motor`
- `fix(inventory): impedir compra concorrente sem saldo`
- `test(extraction): verificar retry depois de confirmação perdida`
- `perf(network): limitar entidades enviadas aos sensores da equipe`

Autor deve ser a pessoa responsável. Não adicionar trailers de coautoria automáticos nem assinatura extra de ferramenta. Título e corpo descrevem a mudança no jogo e a validação relevante.

## Pull requests e integração

Um PR referencia as tarefas, explica problema/resultado e informa verificações. Commits e corpo do PR usam autoria humana e descrição do produto. Não inserir arquivos pessoais no diff.

Preferir squash merge para uma tarefa pequena; conferir a mensagem resultante antes de confirmar. Rebase/merge tradicional é válido quando preservar commits separados ajuda a revisão. Corrigir conflitos na branch da tarefa e repetir somente os checks afetados.

Quando existir CI em 0.1, proteger `main` com os checks disponíveis no plano do GitHub. Para trabalho solo, não exigir revisor adicional inexistente; exigir pipeline e revisão do próprio diff. Configuração remota de proteção será feita conscientemente ao criar o repositório, não presumida por estes arquivos.

## Semântica das versões

| Tipo | Uso |
| --- | --- |
| `0.MINOR.0` | Novo marco de funcionalidades durante desenvolvimento |
| `0.MINOR.PATCH` | Correção/ajuste da release atual sem mudar seu escopo principal |
| `1.0.0-rc.N` | Candidato de lançamento para validação final |
| `1.0.0` | Escopo 0.9 polido e gate de lançamento aprovado |
| `1.MINOR.0` | Expansões compatíveis posteriores, como laboratório PvP |
| `MAJOR.0.0` | Mudança incompatível relevante após estabilização |

Usar uma versão de produto em todos os pacotes do workspace. Mantê-los `private: true` se não houver intenção de publicá-los no npm. Protocolo (`protocolVersion`), catálogo (`catalogVersion`) e migrações do banco têm identificadores separados.

Antes de 1.0, mudanças incompatíveis podem ocorrer entre minors, mas exigem nota de migração e tratamento dos dados. Não justificar corrupção de inventário pelo fato de ser versão 0.x.

## Release verificável

1. Concluir as tarefas obrigatórias e rodar o gate do milestone.
2. Revisar matriz de requisitos, testes, migrations e limitações conhecidas.
3. Atualizar versão única e changelog datado com comportamento efetivo.
4. Gerar build/image reproduzível e ensaiar o ambiente de validação.
5. Preparar PR de release e revisar autoria, diff e resultados dos checks.
6. Integrar, criar tag `vX.Y.Z` e GitHub Release com notas do produto.
7. Fazer deploy controlado, verificar saúde e guardar o caminho de rollback.

Não criar tags antecipadas só para preencher a sequência 0.1–1.0. Não lançar 0.9 se qualquer função original estiver marcada como “depois”.
