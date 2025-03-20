require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const bot = new Telegraf(process.env.BOT_TOKEN);

const CONFIG_FILE = './configs.json';
const GROUP_CONFIG_FILE = './group_configs.json';

const userStates = {};

let configs = {};
if (fs.existsSync(CONFIG_FILE)) {
    configs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

let groupConfigs = {};
if (fs.existsSync(GROUP_CONFIG_FILE)) {
    groupConfigs = JSON.parse(fs.readFileSync(GROUP_CONFIG_FILE, 'utf8'));
}

bot.start((ctx) => {
    if (ctx.chat.type === 'private') {
        ctx.reply('Bienvenid@ a Charlotte. Usa /config para configurar palabras clave en este chat privado. Luego, añádeme a un grupo.');
    } else {
        ctx.reply('Hola, soy Charlotte. Ya estoy preparada para responder en este grupo. ¡Pruébame!');
    }
});

bot.command('config', (ctx) => {
    if (ctx.chat.type !== 'private') {
        return ctx.reply('La configuración solo se puede hacer en mi chat privado. Habla conmigo directamente.');
    }
    ctx.reply(
        '¿Qué te gustaria hacer?',
        Markup.inlineKeyboard([
            [Markup.button.callback('Añadir palabra clave', 'add_keyword')],
            [Markup.button.callback('Ver palabras clave', 'view_keywords')],
            [Markup.button.callback('Eliminar palabra clave', 'delete_keyword')]
        ])
    );
});

bot.action('add_keyword', (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const userId = ctx.from.id.toString();
    userStates[userId] = 'awaiting_keyword';
    ctx.reply('Por favor, envía la palabra clave que quieres añadir.');
});

bot.action('view_keywords', (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const userId = ctx.from.id.toString();
    const userConfig = configs[userId] || {};
    if (Object.keys(userConfig).length === 0) {
        ctx.reply('No tienes palabras clave configuradas aún.');
    } else {
        const keywordList = Object.entries(userConfig)
            .map(([key, value]) => `${key}: ${value.type === 'text' ? value.content : '[Imagen]'}`)
            .join('\n');
        ctx.reply(`Tus palabras clave:\n${keywordList}`);
    }
});

bot.action('delete_keyword', (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const userId = ctx.from.id.toString();
    const userConfig = configs[userId] || {};
    if (Object.keys(userConfig).length === 0) {
        ctx.reply('No tienes palabras clave para eliminar.');
        return;
    }
    userStates[userId] = 'awaiting_keyword_to_delete';
    ctx.reply('Envía la palabra clave que quieres eliminar.');
});

bot.on('new_chat_members', (ctx) => {
    console.log('Evento new_chat_members disparado:', ctx.message.new_chat_members);
    const newMembers = ctx.message.new_chat_members;
    if (newMembers.some(member => member.id === bot.botInfo.id)) {
        const inviterId = ctx.from.id.toString();
        const chatId = ctx.chat.id.toString();
        groupConfigs[chatId] = inviterId;
        try {
            fs.writeFileSync(GROUP_CONFIG_FILE, JSON.stringify(groupConfigs, null, 2));
            ctx.reply('¡Hola! He sido añadida al grupo. Ahora ya podemos disfrutar todos-as de mi presencia.');
            console.log(`Bot añadido al grupo ${chatId} por el usuario ${inviterId}`);
        } catch (err) {
            console.error('Error al escribir group_configs.json:', err);
        }
    }
});

bot.on('text', (ctx) => {
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id.toString();

    if (ctx.chat.type === 'private' && userStates[userId]) {
        if (userStates[userId] === 'awaiting_keyword') {
            const keyword = ctx.message.text.toLowerCase();
            userStates[userId] = 'awaiting_response';
            configs[userId] = configs[userId] || {};
            configs[userId][keyword] = { type: null, content: null };
            ctx.reply(`Palabra clave "${keyword}" recibida. Ahora, envía la respuesta (texto o imagen).`);
        } else if (userStates[userId] === 'awaiting_response') {
            const keyword = Object.keys(configs[userId]).find(k => !configs[userId][k].type);
            configs[userId][keyword] = { type: 'text', content: ctx.message.text };
            userStates[userId] = null;
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
            ctx.reply(`Palabra clave "${keyword}" configurada. Usa /config o añádeme a un Grupo.`);
        } else if (userStates[userId] === 'awaiting_keyword_to_delete') {
            const keyword = ctx.message.text.toLowerCase();
            if (configs[userId] && configs[userId][keyword]) {
                delete configs[userId][keyword];
                fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
                ctx.reply(`Palabra clave "${keyword}" eliminada con éxito.`);
            } else {
                ctx.reply(`No encontré la palabra clave "${keyword}" en tu configuración.`);
            }
            userStates[userId] = null;
        }
        return;
    }

    if (ctx.chat.type === 'private') {
        const messageText = ctx.message.text.toLowerCase();
        const userConfig = configs[userId] || {};
        const username = ctx.from.first_name || ctx.from.username || 'Usuario'; // Nombre o @username, o 'Usuario' si no hay ninguno
        for (const [keyword, response] of Object.entries(userConfig)) {
            if (messageText.includes(keyword)) {
                console.log(`Palabra clave "${keyword}" detectada en privado para el usuario ${userId}`);
                const mention = `[${username}](tg://user?id=${userId})`;
                if (response.type === 'text') {
                    ctx.reply(`${mention}, ${response.content}`, { parse_mode: 'Markdown' });
                } else if (response.type === 'photo') {
                    ctx.replyWithPhoto(response.content, { caption: `${mention}`, parse_mode: 'Markdown' });
                }
            }
        }
        return;
    }

    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        const configOwnerId = groupConfigs[chatId];
        if (!configOwnerId) {
            console.log(`No hay configuración para el grupo ${chatId}`);
            return;
        }
    
        const messageText = ctx.message.text.toLowerCase();
        const userConfig = configs[configOwnerId] || {};
        const username = ctx.from.first_name || ctx.from.username || 'Usuario'; // Nombre o @username
        for (const [keyword, response] of Object.entries(userConfig)) {
            if (messageText.includes(keyword)) {
                console.log(`Palabra clave "${keyword}" detectada en el grupo ${chatId}`);
                const mention = `[${username}](tg://user?id=${userId})`;
                if (response.type === 'text') {
                    ctx.reply(`${mention}, ${response.content}`, { parse_mode: 'Markdown' });
                } else if (response.type === 'photo') {
                    ctx.replyWithPhoto(response.content, { caption: `${mention}`, parse_mode: 'Markdown' });
                }
            }
        }
    }
});

bot.on('photo', (ctx) => {
    const userId = ctx.from.id.toString();
    if (ctx.chat.type !== 'private' || userStates[userId] !== 'awaiting_response') return;

    const keyword = Object.keys(configs[userId]).find(k => !configs[userId][k].type);
    configs[userId][keyword] = { type: 'photo', content: ctx.message.photo[ctx.message.photo.length - 1].file_id };
    userStates[userId] = null;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
    ctx.reply(`Palabra clave "${keyword}" configurada con una imagen. Usa /config o añádeme a un Grupo.`);
});

bot.catch((err, ctx) => {
    console.error(`Error en el bot:`, err);
    ctx.reply('Ocurrió un error, por favor intenta más tarde.');
});

// Importar 'http' para crear un servidor básico
const http = require('http');

// Configurar el puerto desde la variable de entorno de Heroku (o 5000 por defecto)
const PORT = process.env.PORT || 5000;

// Configurar el webhook con la URL de tu app en Heroku
const HEROKU_URL = process.env.HEROKU_URL || `https://charlotte-bot-b07eafb7460c.herokuapp.com/`; // Cambia esto por el nombre de tu app en Heroku
bot.telegram.setWebhook(`${HEROKU_URL}/bot${process.env.BOT_TOKEN}`);

// Crear un servidor básico para Heroku
http.createServer(bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`)).listen(PORT, () => {
    console.log(`Bot corriendo en el puerto ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));