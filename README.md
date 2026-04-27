
## Local Runtime Layout

This server keeps runtime files outside the repository.

Expected local paths:
- `~/runtime/diary/.env`
- `~/runtime/diary/database/`
- `~/runtime/diary/uploads/`
- `~/runtime/diary/logs/`

The repository may use local symlinks pointing to those runtime paths.

## Onde mexer

### Diary
Se a alteração for do diary, estes são os sítios certos:

- Código, rotas, lógica da app, documentação e scripts de bootstrap:
  - `~/diary-server`
- Runtime do diary, incluindo `.env`, base de dados, uploads e logs:
  - `~/runtime/diary`

### Regra prática
- Se queres mudar funcionalidade do diary, mexe em `~/diary-server`
- Se queres mudar configuração, dados ou ficheiros de runtime do diary, mexe em `~/runtime/diary`

### Infraestrutura partilhada
Estas partes não pertencem só ao diary e podem afetar mais do que um serviço:

- `nginx`
- `pm2`
- `cron`
- `ngrok` / `localtunnel`
- `~/server-admin`

## Onde mexer

### Diary
Se a alteração for do diary, estes são os sítios certos:

- Código, rotas, lógica da app, documentação e scripts de bootstrap:
  - `~/diary-server`
- Runtime do diary, incluindo `.env`, base de dados, uploads e logs:
  - `~/runtime/diary`

### Regra prática
- Se queres mudar funcionalidade do diary, mexe em `~/diary-server`
- Se queres mudar configuração, dados ou ficheiros de runtime do diary, mexe em `~/runtime/diary`

### Infraestrutura partilhada
Estas partes não pertencem só ao diary e podem afetar mais do que um serviço:

- `nginx`
- `pm2`
- `cron`
- `ngrok` / `localtunnel`
- `~/server-admin`
