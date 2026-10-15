# Changelog

O projeto usa versões `MAJOR.MINOR.PATCH` e tags `vX.Y.Z`. Os marcos 0.1 a 1.0 são planejados. A 0.1.0 está em revisão e ainda não tem tag.

## Unreleased

Conteúdo previsto para a 0.1.0, em revisão.

### Adicionado

- Sala de desenvolvimento `dev_sector` (Colyseus 0.18) com simulação autoritativa a 20 Hz, até 4 tripulantes e reconexão em até 60 s.
- Tripulantes caminham dentro da nave por intenção (WASD/setas); o servidor aplica uma entrada por tick, colide com paredes e ignora posições enviadas pelo cliente.
- Comando exclusivo da nave: assumir perto do console (E), pilotar com W/S/A/D, liberar com E/Esc, queda ou saída.
- Nave com rotação, empuxo, amortecimento, teto de velocidade e colisão contínua contra asteroides e limites do setor.
- Cliente Phaser 4 com arte geométrica, interpolação de 100 ms, HUD React a 5 Hz, modo econômico de 30 FPS e contador de FPS.
- Contratos de rede versionados com validação zod, catálogo versionado e matemática de movimento pura e testada.
- PostgreSQL 18 de desenvolvimento, pool limitado, migração baseline e migration smoke.
- CI com lint, formatação, tipos, testes, build, migrações e teste multiplayer com dois navegadores.
- Planejamento do jogo, arquitetura e critérios de aceite.
- Roadmap e backlog de desenvolvimento de 0.1 a 1.0.
- Política de contribuição, testes, operação e licença MIT.

Ao implementar, registrar o comportamento entregue, as correções e os impactos de migração. Criar uma seção datada somente quando a release realmente for preparada.
