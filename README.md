# 🌐 KomoVPN Web — Landing Page + API Backend

Лендинг и REST API для VPN-сервиса KomoVPN. Пользователи могут войти через Telegram, управлять подпиской, скачивать конфиги и получать поддержку через AI-чат.

## Возможности

- **Лендинг** — SEO-оптимизированная страница с описанием тарифов
- **Telegram авторизация** — вход через Telegram WebApp initData
- **Личный кабинет** — просмотр подписки, трафика, скачивание VLESS-конфига
- **Mini App** — Telegram Mini App для управления VPN прямо в боте
- **AI-поддержка** — встроенный GPT-чат для помощи пользователям
- **FastAPI бэкенд** — REST API с JWT авторизацией
- **Общая БД** — использует базу данных vpn-bot'а напрямую

## Стек

- **Backend:** Python + FastAPI
- **Auth:** JWT + Telegram initData verification
- **БД:** SQLite + aiosqlite (общая с vpn-bot)
- **AI:** aitunnel.ru API
- **Frontend:** Vanilla JS + HTML/CSS (без фреймворков)
- **SEO:** sitemap.xml, robots.txt, Open Graph, метатеги

## Установка

```bash
git clone https://github.com/kurumi-mProject/vpn-web.git
cd vpn-web/api
pip install fastapi uvicorn aiosqlite python-jose httpx python-dotenv
# .env берётся из vpn-bot директории
uvicorn main:app --host 0.0.0.0 --port 8000
```

Фронтенд — статические файлы, раздаются nginx или любым веб-сервером.

## API эндпоинты

| Метод | Endpoint | Описание |
|---|---|---|
| `POST` | `/auth/telegram` | Вход через Telegram initData |
| `GET` | `/me` | Данные текущего пользователя |
| `GET` | `/subscription` | Статус подписки и трафик |
| `GET` | `/config` | Скачать VLESS-конфиг |
| `POST` | `/support/chat` | AI-чат поддержки |

## Структура проекта

```
vpn-web/
├── api/
│   ├── main.py          # FastAPI приложение
│   └── gpt_config.py    # Конфиг AI-поддержки
└── frontend/
    ├── index.html       # Лендинг
    ├── style.css        # Стили лендинга
    ├── app.js           # JS лендинга
    ├── miniapp.html     # Telegram Mini App
    ├── miniapp.js       # Логика Mini App
    ├── miniapp.css      # Стили Mini App
    ├── help.html        # Страница помощи
    ├── favicon.svg      # Иконка
    ├── sitemap.xml      # SEO sitemap
    └── robots.txt       # SEO robots
```
