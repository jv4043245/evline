# EVLine — сайт (запчастини з Китаю + програмування BYD)

Статичний сайт: дві сторінки, без бекенду.

## Структура
- `index.html` — Запчастини з Китаю (головна)
- `byd.html` — Програмування BYD
- `assets/` — логотип і зображення (12 файлів: digi-1..4.png, gallery-1..8.jpg)
- `sitemap.xml`, `robots.txt`, `404.html`

## Деплой (GitHub Pages)
1. Створити репозиторій, залити вміст цієї папки (без assets/download-images.html).
2. Settings → Pages → Branch: main, folder: / (root) → Save.
3. Сайт буде на `https://<нік>.github.io/<репозиторій>/`.

## Перед прив'язкою домену evline.com.ua
- canonical у сторінках вже вказує на evline.com.ua — менять не треба.
- Після перемикання DNS: у Settings → Pages вписати custom domain, увімкнути Enforce HTTPS.
- Додати сайт у Google Search Console і відправити sitemap.xml.

## Що ще не підключено
- Форми: зараз копіюють повідомлення в буфер і відкривають Telegram. Бекенд (Web3Forms/бот) підключається у функції submitLead().
- Аналітика: GA4 + події на відправку форм — додати перед запуском реклами.
