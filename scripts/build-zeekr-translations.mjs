import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
import { withSellerIdentity } from "./lib/seller-identity.mjs";
import { applyRomanianZeekrSeo } from "./lib/zeekr-ro-seo.mjs";

export const routes = { uk: "/zeekr-9x-8x/", ru: "/ru/zeekr-9x-8x/", ro: "/ro/zeekr-9x-8x/" };

// Russian is the layout source; translations stay static and work without JavaScript.
// Service values/data-service remain unchanged for the existing programming CRM route.
const copy = [
  ["Zeekr 9X и 8X: приложения, SIM и онлайн-сервисы | EVLine", "Zeekr 9X та 8X: застосунки, SIM та онлайн-сервіси | EVLine", "Zeekr 9X și 8X: aplicații, SIM și servicii online | EVLine"],
  ["Настройка Zeekr 9X и 8X в EVLine: приложения и магазин приложений, SIM-карта, защита от региональных блокировок, приложение Zeekr через MA/FA. Видео нашей работы.", "Налаштування Zeekr 9X та 8X в EVLine: застосунки та магазин застосунків, SIM-картка, захист від регіональних блокувань, застосунок Zeekr через MA/FA. Відео нашої роботи.", "Configurare Zeekr 9X și 8X la EVLine: aplicații și magazin de aplicații, cartelă SIM, protecție împotriva blocărilor regionale, aplicația Zeekr prin MA/FA. Vezi rezultatul în video."],
  ["Перейти к содержанию", "Перейти до вмісту", "Mergi la conținut"],
  ["EVLine: главная", "EVLine: головна", "EVLine: pagina principală (în ucraineană)"],
  ["Разделы страницы", "Розділи сторінки", "Secțiunile paginii"],
  ["Услуги", "Послуги", "Servicii"],
  ["Наша работа", "Наша робота", "Rezultate"],
  ["Вопросы", "Запитання", "Întrebări"],
  ["Обсудить", "Обговорити", "Contact"],
  ["EVLine · программирование и настройка", "EVLine · програмування та налаштування", "EVLine · programare și configurare"],
  ["Салон Zeekr 9X со штатным мультимедийным экраном", "Салон Zeekr 9X зі штатним мультимедійним екраном", "Interior Zeekr 9X cu ecranul multimedia original"],
  ["Фото: AutoLab", "Фото: AutoLab", "Foto: AutoLab"],
  ["кадрировано", "кадровано", "încadrat"],
  ["Приложения, связь и онлайн-функции для вашего автомобиля.", "Застосунки, зв'язок та онлайн-функції для вашого автомобіля.", "Aplicații, conectivitate și funcții online pentru mașina ta."],
  ["Узнать возможности", "Дізнатися про можливості", "Descoperă opțiunile"],
  ["Смотреть нашу работу", "Переглянути нашу роботу", "Vezi rezultatul"],
  ["Что делаем", "Що робимо", "Ce oferim"],
  ["Возможности вашего Zeekr", "Можливості вашого Zeekr", "Mai multe posibilități pentru Zeekr-ul tău"],
  ["Приложения и магазин", "Застосунки та магазин", "Aplicații și magazin"],
  ["Установим приложения и магазин, проверим их работу на штатном экране.", "Встановимо застосунки та магазин, перевіримо їхню роботу на штатному екрані.", "Instalăm aplicațiile și magazinul de aplicații și verificăm funcționarea lor pe ecranul original."],
  ["Выбрать приложения", "Обрати застосунки", "Alege aplicațiile"],
  ["SIM-карта и интернет", "SIM-картка та інтернет", "Cartelă SIM și internet"],
  ["Установим SIM-карту и настроим интернет. Тариф согласуем отдельно.", "Встановимо SIM-картку та налаштуємо інтернет. Тариф узгодимо окремо.", "Instalăm cartela SIM și configurăm internetul. Stabilim separat tariful de date."],
  ["Подключить связь", "Підключити зв'язок", "Conectează mașina"],
  ["Защита от блокировок", "Захист від блокувань", "Protecție regională"],
  ["Настроим доступную защиту от региональных блокировок с учётом версии ПО.", "Налаштуємо доступний захист від регіональних блокувань з урахуванням версії ПЗ.", "Configurăm protecția disponibilă împotriva blocărilor regionale, în funcție de versiunea software."],
  ["Проверить возможности", "Перевірити можливості", "Verifică opțiunile"],
  ["Приложение Zeekr · MA/FA", "Застосунок Zeekr · MA/FA", "Aplicația Zeekr · MA/FA"],
  ["Настроим связь с сервером Zeekr и удалённое управление через приложение с MA/FA.", "Налаштуємо зв'язок із сервером Zeekr і дистанційне керування через застосунок із MA/FA.", "Configurăm conexiunea la serverul Zeekr și controlul de la distanță prin aplicație, cu MA/FA."],
  ["Настроить управление", "Налаштувати керування", "Configurează controlul"],
  ["Возможности зависят от автомобиля, ПО и сторонних сервисов. Работы и цену согласуем заранее.", "Можливості залежать від автомобіля, ПЗ і сторонніх сервісів. Роботи та ціну узгодимо заздалегідь.", "Opțiunile depind de mașină, software și serviciile terțe. Stabilim lucrările și prețul în prealabil."],
  ["Две модели", "Дві моделі", "Două modele"],
  ["Настройка под ваш автомобиль", "Налаштування для вашого автомобіля", "Configurare pentru mașina ta"],
  ["Уточним возможности по модели и версии ПО.", "Уточнимо можливості за моделлю та версією ПЗ.", "Verificăm opțiunile în funcție de model și versiunea software."],
  ["Zeekr 9X, вид сбоку", "Zeekr 9X, вигляд збоку", "Zeekr 9X, vedere laterală"],
  ["Красный Zeekr 8X", "Червоний Zeekr 8X", "Zeekr 8X roșu"],
  ["У меня 9X", "У мене 9X", "Am un 9X"],
  ["У меня 8X", "У мене 8X", "Am un 8X"],
  ["Снято командой EVLine", "Знято командою EVLine", "Filmat de echipa EVLine"],
  ["Ваш Zeekr может так же", "Ваш Zeekr теж так може", "Și Zeekr-ul tău poate face asta"],
  ["Показываем работу мультимедиа после нашей настройки.", "Показуємо роботу мультимедіа після нашого налаштування.", "Vezi sistemul multimedia în acțiune după configurare."],
  ["Приложения", "Застосунки", "Aplicații"],
  ["YouTube и Chrome на штатном экране.", "YouTube і Chrome на штатному екрані.", "YouTube și Chrome pe ecranul original."],
  ["Навигация", "Навігація", "Navigație"],
  ["Google Maps и Waze, управление масштабом карты.", "Google Maps і Waze, керування масштабом карти.", "Google Maps și Waze, cu reglarea scării hărții."],
  ["Переключение задач", "Перемикання завдань", "Comutarea între aplicații"],
  ["Переход между навигацией и приложениями.", "Перехід між навігацією та застосунками.", "Trecerea de la navigație la alte aplicații."],
  ["Совместимость приложений с вашим 9X или 8X проверим перед установкой.", "Сумісність застосунків із вашим 9X або 8X перевіримо перед встановленням.", "Verificăm compatibilitatea aplicațiilor cu modelul tău 9X sau 8X înainte de instalare."],
  ["Хочу такую настройку", "Хочу таке налаштування", "Vreau această configurare"],
  ["Видео EVLine: работа мультимедиа после настройки", "Відео EVLine: робота мультимедіа після налаштування", "Video EVLine: sistemul multimedia după configurare"],
  ["Ваш браузер не поддерживает видео.", "Ваш браузер не підтримує відео.", "Browserul tău nu poate reda acest videoclip."],
  ["Открыть видео", "Відкрити відео", "Deschide videoclipul"],
  ["Воспроизвести видео EVLine", "Відтворити відео EVLine", "Redă videoclipul EVLine"],
  ["Воспроизвести видео", "Відтворити відео", "Redă videoclipul"],
  ["Видео EVLine · 1 мин 25 сек", "Відео EVLine · 1 хв 25 с", "Video EVLine · 1 min 25 sec"],
  ["Частые вопросы", "Поширені запитання", "Întrebări frecvente"],
  ["Можно ли установить любое приложение?", "Чи можна встановити будь-який застосунок?", "Se poate instala orice aplicație?"],
  ["Это зависит от приложения и версии ПО. Назовите нужные приложения, и мы проверим совместимость.", "Це залежить від застосунку та версії ПЗ. Назвіть потрібні застосунки, і ми перевіримо сумісність.", "Depinde de aplicație și de versiunea software. Spune-ne ce aplicații dorești, iar noi verificăm compatibilitatea."],
  ["Что нужно для приложения Zeekr и MA/FA?", "Що потрібно для застосунку Zeekr і MA/FA?", "Ce este necesar pentru aplicația Zeekr și MA/FA?"],
  ["Проверим аккаунт, автомобиль и доступ к сервисам, затем согласуем подключение. Пароли и коды входа в форме не нужны.", "Перевіримо обліковий запис, автомобіль і доступ до сервісів, потім узгодимо підключення. Паролі та коди входу у формі не потрібні.", "Verificăm contul, mașina și accesul la servicii, apoi stabilim conectarea. Nu trimite parole sau coduri de autentificare în formular."],
  ["Защита исключает любые будущие блокировки?", "Чи виключає захист будь-які майбутні блокування?", "Protecția exclude orice blocare viitoare?"],
  ["Нет. Производитель может менять работу сервисов. Мы заранее объясним возможности и ограничения доступной защиты.", "Ні. Виробник може змінювати роботу сервісів. Ми заздалегідь пояснимо можливості й обмеження доступного захисту.", "Nu. Producătorul poate modifica funcționarea serviciilor. Îți explicăm din timp posibilitățile și limitele protecției disponibile."],
  ["Сколько стоит настройка?", "Скільки коштує налаштування?", "Cât costă configurarea?"],
  ["Цена зависит от услуг и состояния автомобиля. Уточним данные и согласуем стоимость до начала работ.", "Ціна залежить від послуг і стану автомобіля. Уточнимо дані та узгодимо вартість до початку робіт.", "Prețul depinde de servicii și de starea mașinii. Clarificăm detaliile și stabilim costul înainte de a începe."],
  ["EVLine · Zeekr 9X и 8X", "EVLine · Zeekr 9X та 8X", "EVLine · Zeekr 9X și 8X"],
  ["Начнём с вашего автомобиля", "Почнімо з вашого автомобіля", "Să începem cu mașina ta"],
  ["Выберите модель и расскажите, что хотите настроить.", "Оберіть модель і розкажіть, що хочете налаштувати.", "Alege modelul și spune-ne ce dorești să configurezi."],
  ["Обсудить настройку", "Обговорити налаштування", "Discută configurarea"],
  ["Написать в Telegram ↗", "Написати в Telegram ↗", "Scrie pe Telegram ↗"],
  ["Написать в Telegram", "Написати в Telegram", "Scrie pe Telegram"],
  ["Telegram: программирование", "Telegram: програмування", "Telegram: programare auto"],
  ["Конфиденциальность", "Конфіденційність", "Confidențialitate (în ucraineană)"],
  ["Настройки cookies", "Налаштування cookies", "Setări cookies"],
  ["Позвонить", "Зателефонувати", "Sună"],
  ["Оставить заявку", "Залишити заявку", "Trimite o solicitare"],
  ["EVLine · программирование", "EVLine · програмування", "EVLine · programare auto"],
  ["Закрыть форму", "Закрити форму", "Închide formularul"],
  ["Закрыть", "Закрити", "Închide"],
  ["Настройка Zeekr 9X и 8X", "Налаштування Zeekr 9X та 8X", "Configurare Zeekr 9X și 8X"],
  ["Модель", "Модель", "Model"],
  ["Телефон", "Телефон", "Telefon"],
  ["Что хотите настроить", "Що хочете налаштувати", "Ce dorești să configurezi"],
  ["Нужна консультация", "Потрібна консультація", "Doresc o consultație"],
  ["SIM-карта и связь", "SIM-картка та зв'язок", "SIM și conectivitate"],
  ["Региональная защита", "Регіональний захист", "Protecție regională"],
  ["Имя", "Ім'я", "Nume"],
  ["необязательно", "необов'язково", "opțional"],
  ["17 символов", "17 символів", "17 caractere"],
  ["Ваш вопрос", "Ваше запитання", "Întrebarea ta"],
  ["Какие приложения или функции нужны?", "Які застосунки або функції потрібні?", "Ce aplicații sau funcții dorești?"],
  ["Отправляя заявку, вы соглашаетесь с", "Надсилаючи заявку, ви погоджуєтеся з", "Prin trimiterea solicitării, ești de acord cu"],
  ["обработкой персональных данных", "обробкою персональних даних", "prelucrarea datelor personale (politica în ucraineană)"],
  ["Отправить заявку", "Надіслати заявку", "Trimite solicitarea"],
  ["Заявка получена", "Заявку отримано", "Solicitare primită"],
  ["Менеджер по программированию свяжется с вами по указанному телефону.", "Менеджер із програмування зв'яжеться з вами за вказаним телефоном.", "Un specialist în programare auto te va contacta la numărul indicat."],
  ["Для отправки заявки включите JavaScript или позвоните", "Щоб надіслати заявку, увімкніть JavaScript або зателефонуйте", "Pentru a trimite solicitarea, activează JavaScript sau sună la"],
];

export function translatedPage(source, language) {
  if (!["uk", "ro"].includes(language)) throw new Error(`Unsupported language: ${language}`);
  const dictionary = new Map(copy.map(row => [row[0], row[language === "uk" ? 1 : 2]]));
  const dom = new JSDOM(source);
  const { document, NodeFilter } = dom.window;
  const translate = value => {
    const key = value.trim();
    if (dictionary.has(key)) return value.replace(key, dictionary.get(key));
    if (/[\u0400-\u04ff]/.test(key)) throw new Error(`Missing ${language} translation: ${key}`);
    return value;
  };
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest("script, style, .language-switch, [data-seller-identity]")) node.data = translate(node.data);
  }
  for (const element of document.querySelectorAll("*")) {
    if (element.closest(".language-switch, [data-seller-identity]")) continue;
    for (const attribute of ["alt", "title", "aria-label", "placeholder", "data-form-name"]) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, translate(element.getAttribute(attribute)));
    }
  }
  const description = document.querySelector('meta[name="description"]');
  description.content = translate(description.content);
  document.documentElement.lang = language;
  document.querySelector('link[rel="canonical"]').href = `https://evline.com.ua${routes[language]}`;
  const schema = document.querySelector('script[type="application/ld+json"]');
  const data = JSON.parse(schema.textContent);
  data.url = `https://evline.com.ua${routes[language]}`;
  schema.textContent = JSON.stringify(data);
  for (const link of document.querySelectorAll('a[href="/ru/"], a[href^="/ru/privacy/"]')) {
    link.setAttribute("href", link.getAttribute("href").replace("/ru/", "/"));
  }
  const summary = document.querySelector(".language-switch summary");
  summary.firstChild.data = language === "uk" ? "UA" : "RO";
  summary.setAttribute("aria-label", language === "uk" ? "Обрати мову: українська" : "Alege limba: română");
  summary.title = language === "uk" ? "Обрати мову" : "Alege limba";
  for (const link of document.querySelectorAll(".language-switch a")) {
    link.removeAttribute("aria-current");
    if (link.lang === language) link.setAttribute("aria-current", "page");
  }
  if (language === "ro") applyRomanianZeekrSeo(document);
  const result = withSellerIdentity(dom.serialize());
  dom.window.close();
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = await readFile(path.join(root, "ru/zeekr-9x-8x/index.html"), "utf8");
  for (const language of ["uk", "ro"]) {
    const directory = path.join(root, routes[language]);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.html"), translatedPage(source, language));
    console.log(`${language}: ${routes[language]}`);
  }
}
