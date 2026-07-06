# 🌐 KomoVPN Web — Landing Page + API Backend

Лендинг и REST API для VPN-сервиса KomoVPN. Пользователи авторизуются через Telegram, управляют подпиской в личном кабинете, скачивают конфиги и получают поддержку через AI-чат. Включает Telegram Mini App для управления VPN прямо в боте.

## Возможности

### Лендинг
- **SEO-оптимизация** — метатеги, Open Graph, sitemap.xml, robots.txt, canonical URL
- **Описание тарифов** — цены, лимиты трафика, сравнение планов
- **Инструкции** — как подключиться на iOS, Android, Windows, macOS
- **FAQ** — ответы на частые вопросы

### Личный кабинет (веб)
- **Telegram авторизация** — вход через Telegram initData (cryptographic verification)
- **Статус подписки** — дни до истечения, использованный трафик
- **Скачать конфиг** — VLESS URL, QR-код, ссылка на подписку
- **AI поддержка** — чат с GPT-ассистентом прямо на сайте

### Telegram Mini App
- **Встроен в бота** — открывается кнопкой прямо в чате
- **Полный личный кабинет** — без перехода в браузер
- **Нативный UI** — следует теме Telegram (тёмная/светлая)

### FastAPI бэкенд
- **JWT авторизация** — 30-дневные токены
- **Telegram initData** — верификация подлинности Telegram авторизации
- **Подписки через токены** — ссылка `/sub/{token}` совместима с Clash/Sing-box
- **Несколько форматов подписки** — full / noru / ru — фильтрация серверов
- **Прокси к Xray** — получение актуального конфига из vpn-bot БД

## Стек

| Компонент | Технология |
|---|---|
| Backend | Python + FastAPI |
| Auth | JWT + Telegram initData |
| БД | SQLite + aiosqlite (общая с vpn-bot) |
| AI | Grok через aitunnel.ru |
| Frontend | Vanilla JS + HTML/CSS |
| Mini App | HTML + JS + Telegram SDK |

## Установка

```bash
git clone https://github.com/kurumi-mProject/vpn-web.git
cd vpn-web/api
pip install fastapi uvicorn aiosqlite python-jose httpx python-dotenv
uvicorn main:app --host 0.0.0.0 --port 8000
```

> Бэкенд использует `vpn-bot` как источник данных — путь к БД берётся из `.env` vpn-bot'а.

Фронтенд — статические файлы, раздаются nginx:

```nginx
server {
    listen 443 ssl;
    root /root/vpn_web/frontend;
    location /api/ { proxy_pass http://localhost:8000; }
}
```

## API эндпоинты

| Метод | Endpoint | Описание |
|---|---|---|
| `POST` | `/api/auth/telegram` | Вход через Telegram initData |
| `POST` | `/api/auth/create_code` | Создать код для входа |
| `POST` | `/api/auth/code` | Войти по коду |
| `GET` | `/api/me` | Данные пользователя |
| `GET` | `/api/traffic` | Статус трафика и подписки |
| `GET` | `/api/config/vpn` | VLESS конфиг пользователя |
| `GET` | `/api/config/sub` | Ссылка на подписку (Clash/Sing-box) |
| `GET` | `/sub/{token}` | Подписка (все серверы) |
| `GET` | `/sub-noru/{token}` | Подписка (без российских) |
| `GET` | `/sub-ru/{token}` | Подписка (только российские) |

## Структура проекта

```
vpn-web/
├── api/
│   ├── main.py           # FastAPI приложение (все эндпоинты)
│   └── gpt_config.py     # Настройки AI-поддержки
└── frontend/
    ├── index.html        # Лендинг
    ├── style.css         # Стили лендинга
    ├── app.js            # JS лендинга (авторизация, личный кабинет)
    ├── miniapp.html      # Telegram Mini App
    ├── miniapp.js        # Логика Mini App
    ├── miniapp.css       # Стили Mini App
    ├── help.html         # Страница помощи по подключению
    ├── favicon.svg       # Иконка сайта
    ├── sitemap.xml       # SEO sitemap
    └── robots.txt        # SEO robots
```
