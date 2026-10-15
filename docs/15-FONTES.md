# Fontes oficiais de referência

Consultadas em 14/10/2026. Estas fontes sustentam as escolhas de tecnologia e segurança; números de gameplay, metas de desempenho e roadmap são propostas do projeto, não benchmarks das bibliotecas.

| Fonte | Uso neste planejamento |
| --- | --- |
| [Phaser: release estável](https://phaser.io/download/stable) | Referência inicial Phaser 4.2.1 |
| [Phaser: renderer 4](https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games) | Renderização WebGL/Canvas e foco em efeitos simples |
| [Colyseus: documentação](https://docs.colyseus.io/) | Servidor autoritativo e salas |
| [Colyseus: release 0.18](https://colyseus.io/blog/colyseus-018-is-here/) | SDK/Schema compatíveis e APIs de previsão |
| [Colyseus: servidor](https://docs.colyseus.io/server) | Rotas HTTP e configuração do backend |
| [Colyseus: estado](https://docs.colyseus.io/state) | Mutação autoritativa e patches |
| [Colyseus: StateView](https://docs.colyseus.io/state/view) | Filtragem de estado por destinatário |
| [Colyseus: autenticação de sala](https://docs.colyseus.io/auth/room) | Identidade e acesso à partida |
| [Colyseus: reconexão](https://docs.colyseus.io/room/reconnection) | Lifecycle e retomada de sessão |
| [Node.js: releases](https://nodejs.org/en/about/previous-releases) | Linha LTS do runtime |
| [Vite: guia](https://vite.dev/guide/) | Build estático do cliente |
| [Drizzle: PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql) | Integração com `pg`; atenção à edição RC do guia |
| [PostgreSQL: constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) | Unicidade e invariantes persistentes |
| [PostgreSQL: locks](https://www.postgresql.org/docs/current/explicit-locking.html) | Serialização de operações concorrentes |
| [PostgreSQL: isolamento](https://www.postgresql.org/docs/current/transaction-iso.html) | Transações e tratamento de conflitos |
| [OWASP: password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | Hash de senha Argon2id |
| [OWASP: WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) | Origem, autenticação, limites e logs seguros |
| [Open Source Initiative: MIT](https://opensource.org/license/mit) | Texto da licença do repositório |

Revalidar a versão exata e a compatibilidade no bootstrap. Documentação de versões antigas do Colyseus e tutoriais Phaser 3 não são especificação automática para este projeto.
