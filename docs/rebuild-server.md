# Diary Rebuild

## Objetivo
Recriar o backend do diary num Raspberry Pi novo com o mínimo de passos manuais.

## Fluxo esperado
1. Clonar o repositório.
2. Correr `bash deploy/bootstrap-app.sh`.
3. Rever `~/runtime/diary/.env`.
4. Arrancar PM2 / nginx através do bootstrap global.

## Runtime esperado
- `~/runtime/diary/.env`
- `~/runtime/diary/database/`
- `~/runtime/diary/uploads/`
- `~/runtime/diary/logs/`
- `~/backups/diary/`

## O que não vai para o GitHub
- DB real
- `.env` real
- uploads reais
- logs
- backups
