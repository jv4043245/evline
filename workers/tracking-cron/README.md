# EVLine CRM Tracking Cron

Общий Cloudflare Worker для синхронизации треков Meest China, напоминаний о
документах поставщика и чтения поступлений ПУМБ.

## Secrets

В Worker нужно добавить secret:

- `CRON_SYNC_TOKEN` - тот же секрет, что и в Pages-проекте `evline`.
- `SUPPLIER_DOCS_CRON_TOKEN` — существующий секрет напоминаний.
- `PUMB_CRON_TOKEN` — отдельный секрет ПУМБ, совпадающий с Pages. Банковские
  логин, пароль, client secret и ключ шифрования этому Worker не передаются.

Значение секрета не хранится в Git.

## Расписание

Один существующий триггер запускается каждые 15 минут. ПУМБ вызывается при
каждом запуске; треки и напоминания — только в прежние чётные часы UTC,
на нулевой минуте. Ограничение напоминаний рабочими часами Киева сохраняется.
Проверяется `scheduledTime`, поэтому задержка доставки события не сдвигает задачи.
Сетевые ошибки одной задачи не мешают запуску других.

```toml
[triggers]
crons = ["*/15 * * * *"]
```

Cloudflare Cron Triggers работают по UTC.
Новый триггер не добавляется. Отдельный `workers/pumb-incoming/wrangler.toml`
имеет пустой список расписаний, чтобы избежать дублирования и лимита Free.

Установка: сначала добавить `PUMB_CRON_TOKEN` через `wrangler secret bulk`
с существующим приватным `.local-data/pumb/worker-secrets.json` и этим конфигом,
затем `wrangler deploy --config workers/tracking-cron/wrangler.toml`.
Не заменять и не удалять существующие секреты. Health показывает только наличие
токенов и `schedule_revision`, не их значения. Ручной `/run` запускает только треки.

## Проверка

После деплоя можно проверить:

```bash
curl https://evline-crm-tracking-cron.<account>.workers.dev/health
```

Ручной запуск:

```bash
curl -X POST https://evline-crm-tracking-cron.<account>.workers.dev/run \
  -H "Authorization: Bearer $CRON_SYNC_TOKEN"
```
