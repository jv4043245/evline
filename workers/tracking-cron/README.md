# EVLine CRM Tracking Cron

Cloudflare Worker для фоновой синхронизации треков Meest China с CRM.

## Secrets

В Worker нужно добавить secret:

- `CRON_SYNC_TOKEN` - тот же секрет, что и в Pages-проекте `evline`.

Значение секрета не хранится в Git.

## Расписание

`wrangler.toml` запускает синхронизацию каждые 2 часа:

```toml
[triggers]
crons = ["0 */2 * * *"]
```

Cloudflare Cron Triggers работают по UTC.

## Проверка

После деплоя можно проверить:

```bash
curl https://evline-crm-tracking-cron.<account>.workers.dev/health
```

Ручной запуск:

```bash
curl -X POST https://evline-crm-tracking-cron.<account>.workers.dev/run
```
