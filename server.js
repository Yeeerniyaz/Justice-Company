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
const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА: Не заданы TELEGRAM_BOT_TOKEN или ADMIN_CHAT_ID");
    process.exit(1);
}

function hasAccess(chatId) {
    const idStr = chatId.toString();
    return idStr === ADMIN_CHAT_ID || idStr === DEVELOPER_CHAT_ID;
}

// ==========================================
// УМНАЯ ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
// ==========================================
const dataDir = path.join(__dirname, 'data');
const configPath = path.join(dataDir, 'config.json');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Дефолтные настройки (теперь цены — это просто чистые цифры)
const defaultConfig = {
    phone: "+7 776 963 69 66",
    whatsapp: "https://wa.me/77769636966",
    isFreeConsultation: true,
    showPriceList: false,
    prices: {
        bankruptcy: "150000",
        arrests: "50000",
        schedule: "70000", 
        land: "200000"
    }
};

let siteConfig;

if (fs.existsSync(configPath)) {
    try {
        siteConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        // Очищаем старые цены от букв при перезапуске (если там было "от 150 000 ₸")
        for (let key in siteConfig.prices) {
            siteConfig.prices[key] = siteConfig.prices[key].toString().replace(/\D/g, '');
            if (!siteConfig.prices[key]) siteConfig.prices[key] = "0"; // Защита от пустой строки
        }
        
        if (siteConfig.prices.mfo && !siteConfig.prices.schedule) {
            siteConfig.prices.schedule = siteConfig.prices.mfo;
            delete siteConfig.prices.mfo;
        }
        saveConfig();
    } catch (err) {
        siteConfig = defaultConfig;
    }
} else {
    siteConfig = defaultConfig;
    fs.writeFileSync(configPath, JSON.stringify(siteConfig, null, 2), 'utf8');
}

function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(siteConfig, null, 2), 'utf8');
    } catch (err) {}
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
    const text = `🚨 *НОВАЯ ЗАЯВКА С САЙТА!*\n\n👤 *Имя:* ${name || 'Не указано'}\n📞 *Телефон:* ${phone || 'Не указан'}\n⚠️ *Проблема:* ${problem || 'Не указана'}`;

    try {
        await bot.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'Markdown' });
        
        if (DEVELOPER_CHAT_ID && DEVELOPER_CHAT_ID !== ADMIN_CHAT_ID) {
            await bot.sendMessage(DEVELOPER_CHAT_ID, `🛠 *[Копия разработчику]*\n\n${text}`, { parse_mode: 'Markdown' });
        }
        
        res.redirect('/?success=1#contact');
    } catch (error) {
        res.status(500).send('Ошибка сервера.');
    }
});

// ==========================================
// ЛОГИКА TELEGRAM БОТА
// ==========================================
function formatPrice(priceStr) {
    return Number(priceStr).toLocaleString('ru-RU') + ' ₸';
}

function getMainMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: `📞 Изменить номер (${siteConfig.phone})`, callback_data: 'edit_phone' }],
                [{ text: `📱 Изменить ссылку WhatsApp`, callback_data: 'edit_whatsapp' }],
                [{ text: siteConfig.isFreeConsultation ? '🟢 Сделать консультацию ПЛАТНОЙ' : '🔴 Сделать консультацию БЕСПЛАТНОЙ', callback_data: 'toggle_consultation' }],
                [{ text: siteConfig.showPriceList ? '🟢 СКРЫТЬ прайс на сайте' : '🔴 ПОКАЗАТЬ прайс на сайте', callback_data: 'toggle_prices' }],
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
                [{ text: `Оформление земли: ${formatPrice(siteConfig.prices.land)}`, callback_data: 'edit_price_land' }],
                [{ text: `🔙 Вернуться в главное меню`, callback_data: 'menu_main' }]
            ]
        }
    };
}

const cancelKeyboard = {
    reply_markup: {
        inline_keyboard: [[{ text: '❌ Отменить ввод', callback_data: 'cancel_input' }]]
    }
};

bot.onText(/\/(start|admin)/, (msg) => {
    const chatId = msg.chat.id;
    if (!hasAccess(chatId)) return;
    
    delete adminStates[chatId];
    bot.sendMessage(chatId, '👨‍⚖️ *Панель управления Justice Company*\n\nВыберите, что вы хотите настроить на сайте:', { parse_mode: 'Markdown', ...getMainMenu() });
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (!hasAccess(chatId)) return;

    const data = query.data;
    const messageId = query.message.message_id;

    if (data === 'cancel_input') {
        delete adminStates[chatId];
        bot.deleteMessage(chatId, messageId).catch(()=>{});
        bot.sendMessage(chatId, '🚫 Действие отменено.\nГлавное меню:', getMainMenu());
        return bot.answerCallbackQuery(query.id);
    }

    if (data === 'menu_main') {
        bot.editMessageText('👨‍⚖️ *Панель управления Justice Company*\n\nВыберите, что вы хотите настроить:', { parse_mode: 'Markdown', chat_id: chatId, message_id: messageId, ...getMainMenu() });
        delete adminStates[chatId];
    } else if (data === 'menu_prices') {
        bot.editMessageText('💵 *Управление ценами*\n\nНажмите на услугу, чтобы изменить её стоимость:', { parse_mode: 'Markdown', chat_id: chatId, message_id: messageId, ...getPricesMenu() });
        delete adminStates[chatId];
    } else if (data === 'toggle_consultation') {
        siteConfig.isFreeConsultation = !siteConfig.isFreeConsultation;
        saveConfig();
        bot.editMessageReplyMarkup(getMainMenu().reply_markup, { chat_id: chatId, message_id: messageId });
        bot.answerCallbackQuery(query.id, { text: siteConfig.isFreeConsultation ? 'Консультация теперь бесплатная!' : 'Консультация теперь платная!' });
        return;
    } else if (data === 'toggle_prices') {
        siteConfig.showPriceList = !siteConfig.showPriceList;
        saveConfig();
        bot.editMessageReplyMarkup(getMainMenu().reply_markup, { chat_id: chatId, message_id: messageId });
        bot.answerCallbackQuery(query.id, { text: siteConfig.showPriceList ? 'Прайс показан на сайте!' : 'Прайс скрыт с сайта!' });
        return;
    } else if (data.startsWith('edit_')) {
        adminStates[chatId] = { action: data, messageId: messageId };
        
        let promptText = 'Отправьте мне новое значение:';
        if (data === 'edit_phone') promptText = '📞 Отправьте новый номер телефона:';
        if (data === 'edit_whatsapp') promptText = '📱 Отправьте новую ссылку на WhatsApp:';
        if (data.startsWith('edit_price_')) promptText = '💰 Отправьте новую цену ПРОСТО ЦИФРАМИ (например: 150000):';

        bot.sendMessage(chatId, promptText, cancelKeyboard);
    }
    
    bot.answerCallbackQuery(query.id);
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (!hasAccess(chatId)) return;
    if (msg.text && msg.text.startsWith('/')) return;

    const state = adminStates[chatId];
    if (state && msg.text) {
        const action = state.action;
        let newValue = msg.text.trim();

        // Если это цена, жестко вырезаем всё, кроме цифр (защита от дурака)
        if (action.startsWith('edit_price_')) {
            newValue = newValue.replace(/\D/g, ''); 
            if (!newValue) newValue = "0"; // Если стерли всё, ставим 0
        }

        if (action === 'edit_phone') siteConfig.phone = newValue;
        else if (action === 'edit_whatsapp') siteConfig.whatsapp = newValue;
        else if (action === 'edit_price_bankruptcy') siteConfig.prices.bankruptcy = newValue;
        else if (action === 'edit_price_arrests') siteConfig.prices.arrests = newValue;
        else if (action === 'edit_price_schedule') siteConfig.prices.schedule = newValue;
        else if (action === 'edit_price_land') siteConfig.prices.land = newValue;

        saveConfig();
        
        const displayValue = action.startsWith('edit_price_') ? formatPrice(newValue) : newValue;
        bot.sendMessage(chatId, `✅ *Отлично!* Значение успешно обновлено.\nНа сайте теперь: \`${displayValue}\``, { parse_mode: 'Markdown' });

        if (action.startsWith('edit_price_')) {
            bot.sendMessage(chatId, '💵 Управление ценами:', getPricesMenu());
        } else {
            bot.sendMessage(chatId, '👨‍⚖️ Главное меню:', getMainMenu());
        }
        
        delete adminStates[chatId];
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});