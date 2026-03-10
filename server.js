require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Senior Architect Note: 
 * Использование строгой нормализации ID (trim и toString) предотвращает 99% проблем 
 * с доступом в Telegram-ботах при развертывании через Docker/Portainer.
 */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID ? process.env.ADMIN_CHAT_ID.toString().trim() : null;
const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID ? process.env.DEVELOPER_CHAT_ID.toString().trim() : null;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: Переменные TELEGRAM_BOT_TOKEN или ADMIN_CHAT_ID отсутствуют в окружении.");
    process.exit(1);
}

/**
 * Функция проверки прав доступа с расширенным логированием для отладки
 */
function hasAccess(chatId) {
    if (!chatId) return false;
    const currentId = chatId.toString().trim();
    const isAllowed = (currentId === ADMIN_CHAT_ID || currentId === DEVELOPER_CHAT_ID);
    
    if (!isAllowed) {
        console.warn(`⚠️ [SECURITY] Попытка несанкционированного доступа. ID: ${currentId}. Разрешенные ID: [Admin: ${ADMIN_CHAT_ID}, Dev: ${DEVELOPER_CHAT_ID}]`);
    }
    return isAllowed;
}

// ==========================================
// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ (JSON)
// ==========================================
const dataDir = path.join(__dirname, 'data');
const configPath = path.join(dataDir, 'config.json');

// Гарантируем наличие директории для хранения данных (Persistence)
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Конфигурация по умолчанию (Master Schema)
const defaultConfig = {
    phone: "+7 776 963 69 66",
    whatsapp: "https://wa.me/77769636966",
    isFreeConsultation: true,
    showPriceList: false,
    prices: {
        bankruptcy: "150000",
        arrests: "50000",
        schedule: "70000", 
        land: "200000",
        lawsuits: "15000"
    }
};

let siteConfig;

/**
 * Загрузка конфигурации с автоматическим исправлением структуры (Auto-Fix)
 */
function loadOrCreateConfig() {
    if (fs.existsSync(configPath)) {
        try {
            const savedData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            // Слияние объектов для поддержки новых полей без потери старых данных
            siteConfig = { ...defaultConfig, ...savedData };
            
            // Нормализация цен (только цифры)
            for (let key in siteConfig.prices) {
                if (siteConfig.prices[key]) {
                    siteConfig.prices[key] = siteConfig.prices[key].toString().replace(/\D/g, '');
                }
                if (!siteConfig.prices[key]) siteConfig.prices[key] = "0";
            }
            
            // Миграция устаревших ключей (МФО -> График)
            if (siteConfig.prices.mfo && !siteConfig.prices.schedule) {
                siteConfig.prices.schedule = siteConfig.prices.mfo;
                delete siteConfig.prices.mfo;
            }
            
            saveConfig();
        } catch (err) {
            console.error("⚠️ Ошибка парсинга config.json. Используются дефолтные настройки.");
            siteConfig = defaultConfig;
        }
    } else {
        console.log("📄 Файл БД не найден. Генерация начальной конфигурации...");
        siteConfig = defaultConfig;
        saveConfig();
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(siteConfig, null, 2), 'utf8');
    } catch (err) {
        console.error("❌ Ошибка записи базы данных:", err);
    }
}

loadOrCreateConfig();

// ==========================================
// TELEGRAM BOT ENGINE
// ==========================================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const adminStates = {}; 

// Форматирование цен для вывода (UI Helper)
function formatPrice(priceStr) {
    return Number(priceStr).toLocaleString('ru-RU') + ' ₸';
}

function getMainMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: `📞 Номер: ${siteConfig.phone}`, callback_data: 'edit_phone' }],
                [{ text: `📱 WhatsApp: ${siteConfig.whatsapp}`, callback_data: 'edit_whatsapp' }],
                [{ text: siteConfig.isFreeConsultation ? '🟢 Консультация: БЕСПЛАТНО' : '🔴 Консультация: ПЛАТНО', callback_data: 'toggle_consultation' }],
                [{ text: siteConfig.showPriceList ? '🟢 Прайс: ПОКАЗАН' : '🔴 Прайс: СКРЫТ', callback_data: 'toggle_prices' }],
                [{ text: `💵 Настроить цены на услуги`, callback_data: 'menu_prices' }]
            ]
        }
    };
}

function getPricesMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: `Банкротство: ${formatPrice(siteConfig.prices.bankruptcy)}`, callback_data: 'edit_price_bankruptcy' }],
                [{ text: `Снятие арестов: ${formatPrice(siteConfig.prices.arrests)}`, callback_data: 'edit_price_arrests' }],
                [{ text: `График в банке/МФО: ${formatPrice(siteConfig.prices.schedule)}`, callback_data: 'edit_price_schedule' }],
                [{ text: `Составление исков: ${formatPrice(siteConfig.prices.lawsuits)}`, callback_data: 'edit_price_lawsuits' }],
                [{ text: `Оформление земли: ${formatPrice(siteConfig.prices.land)}`, callback_data: 'edit_price_land' }],
                [{ text: `🔙 Назад в главное меню`, callback_data: 'menu_main' }]
            ]
        }
    };
}

const cancelKeyboard = {
    reply_markup: {
        inline_keyboard: [[{ text: '❌ Отменить ввод', callback_data: 'cancel_input' }]]
    }
};

// Проверка работоспособности бота при старте
bot.getMe().then((me) => {
    console.log(`🚀 Justice Company Bot [@${me.username}] успешно авторизован.`);
});

bot.onText(/\/(start|admin)/, (msg) => {
    const chatId = msg.chat.id;
    if (!hasAccess(chatId)) return;
    
    delete adminStates[chatId];
    bot.sendMessage(chatId, '⚖️ *Justice Company: Панель управления*\nВыберите раздел для редактирования:', { parse_mode: 'Markdown', ...getMainMenu() });
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (!hasAccess(chatId)) return;

    const data = query.data;
    const messageId = query.message.message_id;

    if (data === 'cancel_input') {
        delete adminStates[chatId];
        bot.deleteMessage(chatId, messageId).catch(() => {});
        bot.sendMessage(chatId, '🚫 Действие отменено.', getMainMenu());
        return bot.answerCallbackQuery(query.id);
    }

    if (data === 'menu_main') {
        bot.editMessageText('⚖️ *Justice Company: Панель управления*', { parse_mode: 'Markdown', chat_id: chatId, message_id: messageId, ...getMainMenu() });
        delete adminStates[chatId];
    } else if (data === 'menu_prices') {
        bot.editMessageText('💵 *Управление ценами*', { parse_mode: 'Markdown', chat_id: chatId, message_id: messageId, ...getPricesMenu() });
        delete adminStates[chatId];
    } else if (data === 'toggle_consultation') {
        siteConfig.isFreeConsultation = !siteConfig.isFreeConsultation;
        saveConfig();
        bot.editMessageReplyMarkup(getMainMenu().reply_markup, { chat_id: chatId, message_id: messageId });
        bot.answerCallbackQuery(query.id, { text: "Статус консультации изменен" });
    } else if (data === 'toggle_prices') {
        siteConfig.showPriceList = !siteConfig.showPriceList;
        saveConfig();
        bot.editMessageReplyMarkup(getMainMenu().reply_markup, { chat_id: chatId, message_id: messageId });
        bot.answerCallbackQuery(query.id, { text: "Видимость прайса изменена" });
    } else if (data.startsWith('edit_')) {
        adminStates[chatId] = data;
        let promptText = '📝 Введите новое значение в ответном сообщении:';
        if (data.startsWith('edit_price_')) promptText = '💰 Введите новую стоимость ЦИФРАМИ (например: 150000):';
        
        bot.sendMessage(chatId, promptText, cancelKeyboard);
    }
    bot.answerCallbackQuery(query.id);
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (!hasAccess(chatId) || (msg.text && msg.text.startsWith('/'))) return;

    const activeState = adminStates[chatId];
    if (activeState && msg.text) {
        let newValue = msg.text.trim();

        // Санитайзер цен (Senior Level Security)
        if (activeState.startsWith('edit_price_')) {
            newValue = newValue.replace(/\D/g, ''); 
            if (!newValue) newValue = "0"; 
            const priceKey = activeState.replace('edit_price_', '');
            siteConfig.prices[priceKey] = newValue;
        } else if (activeState === 'edit_phone') {
            siteConfig.phone = newValue;
        } else if (activeState === 'edit_whatsapp') {
            siteConfig.whatsapp = newValue;
        }

        saveConfig();
        
        const display = activeState.startsWith('edit_price_') ? formatPrice(newValue) : newValue;
        bot.sendMessage(chatId, `✅ *Данные обновлены!*\nНовое значение на сайте: \`${display}\``, { parse_mode: 'Markdown' });
        
        // Возврат в соответствующее меню
        const returnMenu = activeState.startsWith('edit_price_') ? getPricesMenu() : getMainMenu();
        const returnLabel = activeState.startsWith('edit_price_') ? '💵 Цены:' : '⚖️ Главное меню:';
        bot.sendMessage(chatId, returnLabel, returnMenu);
        
        delete adminStates[chatId];
    }
});

// ==========================================
// EXPRESS SERVER (WEB FRONTEND)
// ==========================================
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
    res.render('index', { config: siteConfig, query: req.query });
});

/**
 * Обработка лидов с отправкой уведомлений админу и разработчику
 */
app.post('/submit-lead', async (req, res) => {
    const { name, phone, problem } = req.body;
    const leadMessage = `🚨 *НОВАЯ ЗАЯВКА С САЙТА!*\n\n👤 *Имя:* ${name || '—'}\n📞 *Телефон:* ${phone || '—'}\n⚠️ *Проблема:* ${problem || '—'}`;

    try {
        // Уведомление основному админу
        await bot.sendMessage(ADMIN_CHAT_ID, leadMessage, { parse_mode: 'Markdown' });
        
        // Дублирование разработчику
        if (DEVELOPER_CHAT_ID && DEVELOPER_CHAT_ID !== ADMIN_CHAT_ID) {
            await bot.sendMessage(DEVELOPER_CHAT_ID, `🛠 *[DEV COPY]*\n\n${leadMessage}`, { parse_mode: 'Markdown' });
        }
        
        res.redirect('/?success=1#contact');
    } catch (error) {
        console.error("❌ Ошибка при обработке заявки:", error.message);
        res.status(500).send("Ошибка отправки заявки.");
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Web-сервер Justice Company запущен на порту ${PORT}`);
});