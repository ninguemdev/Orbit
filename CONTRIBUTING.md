# Contribuição

Escolha uma tarefa do [backlog](docs/09-TASKS.md), confira suas dependências e abra uma branch curta a partir de `main`. O projeto usa programação modular, TypeScript estrito e servidor autoritativo.

## Alterações

- Agrupar código por funcionalidade, com regras de domínio e adaptadores separados.
- Usar nomes que descrevam a intenção; funções pequenas quando isso melhora a leitura.
- Extrair abstrações após existir uma necessidade concreta, sem criar frameworks internos genéricos.
- Validar mensagens e operações econômicas no servidor.
- Parametrizar balanceamento em catálogo versionado, sem números espalhados pelas cenas.
- Documentar regras novas e mudanças de protocolo ou banco.

## Pull requests

Usar o template do repositório. Descrever problema, comportamento resultante, validação feita e riscos concretos. Informar o ID da tarefa. Um PR deve fechar uma unidade que possa ser revisada; separar mudanças independentes.

Os scripts `lint`, `typecheck`, `test` e `build` serão criados em 0.1. Depois desse marco, precisam passar antes do merge. Testar transações, permissões, colisões, reconexão e o fluxo afetado. Mudanças de texto e visual de baixo impacto pedem inspeção apropriada, não testes que só reproduzem a implementação.

## Commits e versões

Usar Conventional Commits, por exemplo `feat(extraction): guardar carga ao concluir a evacuação` ou `fix(party): validar acesso à nave ao iniciar missão`. Autor é a pessoa responsável pela alteração. Não incluir trailers de coautoria automáticos. Ver [política de versões](docs/10-GITHUB-E-VERSOES.md).

Adicionar dependências somente com motivação, licença compatível e versão reproduzível. Nunca incluir segredos, dados de jogadores ou dumps de produção em commits.
