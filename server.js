require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Загрузка переменных окружения
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Не заданы TELEGRAM_BOT_TOKEN или ADMIN_CHAT_ID в переменных окружения");
    process.exit(1);
}

// ==========================================
// УМНАЯ ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ (JSON)
// ==========================================
const dataDir = path.join(__dirname, 'data');
const configPath = path.join(dataDir, 'config.json');

// Создаем папку data, если её нет (важно для Docker)
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Дефолтные настройки сайта
const defaultConfig = {
    phone: "+7 776 963 69 66",
    whatsapp: "https://wa.me/77769636966",
    isFreeConsultation: true,
    showPriceList: false,
    prices: {
        bankruptcy: "от 150 000 ₸",
        arrests: "от 50 000 ₸",
        mfo: "от 70 000 ₸",
        land: "от 200 000 ₸"
    }
};

let siteConfig;

// Читаем или создаем конфиг
if (fs.existsSync(configPath)) {
    try {
        siteConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
        console.error("Ошибка чтения config.json. Загружаем дефолтные настройки.", err);
        siteConfig = defaultConfig;
    }
} else {
    console.log("Файл config.json не найден. Создаем новый с дефолтными настройками...");
    siteConfig = defaultConfig;
    fs.writeFileSync(configPath, JSON.stringify(siteConfig, null, 2), 'utf8');
}

function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(siteConfig, null, 2), 'utf8');
    } catch (err) {
        console.error("Ошибка записи в config.json:", err);
    }
}

// Инициализация Telegram-бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const adminStates = {};

// Настройка Express
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==========================================
// МАРШРУТЫ ВЕБ-СЕРВЕРА
// ==========================================
app.get('/', (req, res) => {
    res.render('index', { config: siteConfig, query: req.query });
});

app.post('/submit-lead', async (req, res) => {
    const { name, phone, problem } = req.body;
    const text = `🚨 НОВАЯ ЗАЯВКА С САЙТА!\n\n👤 Имя: ${name || 'Не указано'}\n📞 Телефон: ${phone || 'Не указан'}\n⚠️ Проблема: ${problem || 'Не указана'}`;

    try {
        await bot.sendMessage(ADMIN_CHAT_ID, text);
        res.redirect('/?success=1#contact');
    } catch (error) {
        console.error('Ошибка отправки лида в Telegram:', error);
        res.status(500).send('Ошибка сервера. Попробуйте позже.');
    }
});

// ==========================================
// ЛОГИКА TELEGRAM БОТА (CMS ПАНЕЛЬ)
// ==========================================
function getMainMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: `📞 Номер: ${siteConfig.phone}`, callback_data: 'edit_phone' }],
                [{ text: `📱 WhatsApp: ${siteConfig.whatsapp}`, callback_data: 'edit_whatsapp' }],
                [{ text: `Консультация: ${siteConfig.isFreeConsultation ? '🟢 БЕСПЛАТНО' : '🔴 ПЛАТНО'}`, callback_data: 'toggle_consultation' }],
                [{ text: `Прайс-лист: ${siteConfig.showPriceList ? '🟢 ПОКАЗАН' : '🔴 СКРЫТ'}`, callback_data: 'toggle_prices' }],
                [{ text: `💵 Изменить цены`, callback_data: 'menu_prices' }]
            ]
        }
    };
}

function getPricesMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: `Банкротство: ${siteConfig.prices.bankruptcy}`, callback_data: 'edit_price_bankruptcy' }],
                [{ text: `Аресты: ${siteConfig.prices.arrests}`, callback_data: 'edit_price_arrests' }],
                [{ text: `МФО: ${siteConfig.prices.mfo}`, callback_data: 'edit_price_mfo' }],
                [{ text: `Земля: ${siteConfig.prices.land}`, callback_data: 'edit_price_land' }],
                [{ text: `🔙 Назад в главное меню`, callback_data: 'menu_main' }]
            ]
        }
    };
}

bot.onText(/\/(start|admin)/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_CHAT_ID) return;
    bot.sendMessage(chatId, '⚙️ Панель управления Justice Company:', getMainMenu());
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (chatId.toString() !== ADMIN_CHAT_ID) return;

    const data = query.data;
    const messageId = query.message.message_id;

    if (data === 'menu_main') {
        bot.editMessageText('⚙️ Панель управления Justice Company:', { chat_id: chatId, message_id: messageId, ...getMainMenu() });
        delete adminStates[chatId];
    } else if (data === 'menu_prices') {
        bot.editMessageText('💵 Управление ценами:', { chat_id: chatId, message_id: messageId, ...getPricesMenu() });
        delete adminStates[chatId];
    } else if (data === 'toggle_consultation') {
        siteConfig.isFreeConsultation = !siteConfig.isFreeConsultation;
        saveConfig();
        bot.editMessageReplyMarkup(getMainMenu().reply_markup, { chat_id: chatId, message_id: messageId });
    } else if (data === 'toggle_prices') {
        siteConfig.showPriceList = !siteConfig.showPriceList;
        saveConfig();
        bot.editMessageReplyMarkup(getMainMenu().reply_markup, { chat_id: chatId, message_id: messageId });
    } else if (data.startsWith('edit_')) {
        adminStates[chatId] = { action: data, messageId: messageId };

        let promptText = 'Отправьте новое значение:';
        if (data === 'edit_phone') promptText = 'Отправьте новый номер телефона (например, +7 776 963 69 66):';
        if (data === 'edit_whatsapp') promptText = 'Отправьте новую ссылку на WhatsApp:';
        if (data.startsWith('edit_price_')) promptText = 'Отправьте новую цену (например, от 150 000 ₸):';

        bot.sendMessage(chatId, promptText);
    }
    bot.answerCallbackQuery(query.id);
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_CHAT_ID) return;
    if (msg.text && msg.text.startsWith('/')) return;

    const state = adminStates[chatId];
    if (state && msg.text) {
        const action = state.action;
        const newValue = msg.text;

        if (action === 'edit_phone') siteConfig.phone = newValue;
        else if (action === 'edit_whatsapp') siteConfig.whatsapp = newValue;
        else if (action === 'edit_price_bankruptcy') siteConfig.prices.bankruptcy = newValue;
        else if (action === 'edit_price_arrests') siteConfig.prices.arrests = newValue;
        else if (action === 'edit_price_mfo') siteConfig.prices.mfo = newValue;
        else if (action === 'edit_price_land') siteConfig.prices.land = newValue;

        saveConfig();
        bot.sendMessage(chatId, '✅ Данные успешно обновлены! Сайт изменен.');

        if (action.startsWith('edit_price_')) {
            bot.sendMessage(chatId, '💵 Управление ценами:', getPricesMenu());
        } else {
            bot.sendMessage(chatId, '⚙️ Панель управления Justice Company:', getMainMenu());
        }
        delete adminStates[chatId];
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});