# Конфиг моделей для FastAPI (дублирует gpt_bot/config.py)
MODELS = {
    "gpt-5-nano":                    {"name": "GPT-5 Nano",              "desc": "Быстрая и лёгкая модель от OpenAI",                    "tier": 0},
    "glm-4.7-flash":                 {"name": "GLM-4.7 Flash",           "desc": "Молниеносная модель от Zhipu AI",                      "tier": 0},
    "gemini-3.1-flash-lite-preview": {"name": "Gemini 3.1 Flash Lite",   "desc": "Лёгкая версия Gemini от Google",                       "tier": 0},
    "gpt-4.1-nano":                  {"name": "GPT-4.1 Nano",            "desc": "Компактная версия GPT-4.1",                            "tier": 1},
    "qwen3.5-flash-02-23":           {"name": "Qwen 3.5 Flash",          "desc": "Быстрая модель от Alibaba Cloud",                      "tier": 1},
    "minimax-m2.5":                  {"name": "MiniMax M2.5",            "desc": "Эффективная модель от MiniMax",                        "tier": 1},
    "gpt-5-mini":                    {"name": "GPT-5 Mini",              "desc": "Компактная версия GPT-5",                              "tier": 3},
    "qwen3-235b-a22b-2507":          {"name": "Qwen3 235B",              "desc": "Мощная модель 235B параметров от Alibaba",             "tier": 3},
    "deepseek-v3.2-special":         {"name": "DeepSeek V3.2 Special",   "desc": "Специальная версия DeepSeek V3.2",                     "tier": 3},
    "mistral-medium-3.1":            {"name": "Mistral Medium 3.1",      "desc": "Сбалансированная модель от Mistral AI",                "tier": 3},
    "qwen3.5-35b-a3b":               {"name": "Qwen 3.5 35B",            "desc": "Продвинутая модель 35B от Alibaba",                    "tier": 6},
    "deepseek-r1-0528":              {"name": "DeepSeek R1",             "desc": "Мощная reasoning-модель от DeepSeek",                  "tier": 6},
    "grok-4.1-fast":                 {"name": "Grok 4.1 Fast",           "desc": "Быстрая версия Grok 4.1 от xAI",                      "tier": 6},
    "deepseek-v3.2-exp":             {"name": "DeepSeek V3.2 Exp",       "desc": "Экспериментальная версия DeepSeek V3.2",               "tier": 6},
    "grok-4-fast":                   {"name": "Grok 4 Fast",             "desc": "Топовая модель от xAI — быстрая версия",              "tier": 12},
}

TIER_LABELS = {0: "Пробный+", 1: "1+ мес", 3: "3+ мес", 6: "6+ мес", 12: "12 мес"}
