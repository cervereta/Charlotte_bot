require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const bot = new Telegraf(process.env.BOT_TOKEN);

// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Necesario para Heroku
});

const userStates = {};

// Inicializar tablas
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS configs (
        user_id VARCHAR(255) PRIMARY KEY,
        config JSONB
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_configs (
        chat_id VARCHAR(255) PRIMARY KEY,
        config_owner_id VARCHAR(255)
      );
    `);
    console.log('Tablas creadas o verificadas');
  } catch (err) {
    console.error('Error al inicializar la base de datos:', err);
  } finally {
    client.release();
  }
}

initializeDatabase();

// Funciones para manejar configs
async function getConfigs() {
  const configs = {};
  try {
    const res = await pool.query('SELECT user_id, config FROM configs');
    res.rows.forEach(row => {
      try {
        configs[row.user_id] = JSON.parse(row.config);
      } catch (e) {
        console.error(`Error parsing config for user ${row.user_id}:`, e.message);
        configs[row.user_id] = {}; // Usar un objeto vacío como fallback
      }
    });
  } catch (e) {
    console.error('Error fetching configs:', e.message);
  }
  return configs;
}

async function saveConfig(userId, config) {
  try {
    const serializedConfig = JSON.stringify(config); // Asegurar que se serialice correctamente
    await pool.query(
      'INSERT INTO configs (user_id, config) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET config = $2',
      [userId, serializedConfig]
    );
  } catch (e) {
    console.error('Error saving config for user', userId, ':', e.message);
    throw e;
  }
}

async function deleteConfigKeyword(userId, keyword) {
  const configs = await getConfigs();
  if (configs[userId] && configs[userId][keyword]) {
    delete configs[userId][keyword];
    await saveConfig(userId, configs[userId]);
  }
}

// Funciones para manejar group_configs
async function getGroupConfigs() {
  const result = await pool.query('SELECT * FROM group_configs');
  const groupConfigs = {};
  result.rows.forEach(row => {
    groupConfigs[row.chat_id] = row.config_owner_id;
  });
  return groupConfigs;
}

async function saveGroupConfig(chatId, configOwnerId) {
  await pool.query(
    'INSERT INTO group_configs (chat_id, config_owner_id) VALUES ($1, $2) ON CONFLICT (chat_id) DO UPDATE SET config_owner_id = $2',
    [chatId, configOwnerId]
  );
}

bot.start(async (ctx) => {
  console.log('Comando /start recibido de:', ctx.from.id);
  if (ctx.chat.type === 'private') {
    ctx.reply('Bienvenid@ a Charlotte. Usa /config para configurar palabras clave en este chat privado. Luego, añádeme a un grupo.');
  } else {
    ctx.reply('Hola, soy Charlotte. Ya estoy preparada para responder en este grupo. ¡Pruébame!');
  }
});

bot.command('config', async (ctx) => {
  console.log('Comando /config recibido de:', ctx.from.id);
  if (ctx.chat.type !== 'private') {
    return ctx.reply('La configuración solo se puede hacer en mi chat privado. Habla conmigo directamente.');
  }
  ctx.reply(
    '¿Qué te gustaría hacer?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Añadir palabra clave', 'add_keyword')],
      [Markup.button.callback('Ver palabras clave', 'view_keywords')],
      [Markup.button.callback('Eliminar palabra clave', 'delete_keyword')]
    ])
  );
});

bot.action('add_keyword', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const userId = ctx.from.id.toString();
  userStates[userId] = 'awaiting_keyword';
  ctx.reply('Por favor, envía la palabra clave que quieres añadir.');
});

bot.action('view_keywords', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const userId = ctx.from.id.toString();
  const configs = await getConfigs();
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

bot.action('delete_keyword', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const userId = ctx.from.id.toString();
  const configs = await getConfigs();
  const userConfig = configs[userId] || {};
  if (Object.keys(userConfig).length === 0) {
    ctx.reply('No tienes palabras clave para eliminar.');
    return;
  }
  userStates[userId] = 'awaiting_keyword_to_delete';
  ctx.reply('Envía la palabra clave que quieres eliminar.');
});

bot.on('new_chat_members', async (ctx) => {
  const newMembers = ctx.message.new_chat_members;
  if (newMembers.some(member => member.id === bot.botInfo.id)) {
    const inviterId = ctx.from.id.toString();
    const chatId = ctx.chat.id.toString();
    await saveGroupConfig(chatId, inviterId);
    ctx.reply('¡Hola! He sido añadida al grupo. Ahora ya podemos disfrutar todos-as de mi presencia.');
    console.log(`Bot añadido al grupo ${chatId} por el usuario ${inviterId}`);
  }
});

bot.on('text', async (ctx) => {
    console.log('Mensaje recibido:', ctx.message.text, 'de:', ctx.from.id); // Mantener el console log
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id.toString();
    const configs = await getConfigs();
    const groupConfigs = await getGroupConfigs();
  
    if (ctx.chat.type === 'private' && userStates[userId]) {
      if (userStates[userId] === 'awaiting_keyword') {
        const keyword = ctx.message.text.toLowerCase();
        // Asegúrate de que configs[userId] exista
        configs[userId] = configs[userId] || {};
        configs[userId][keyword] = { type: null, content: null };
        // Guardar inmediatamente en la base de datos
        await saveConfig(userId, configs[userId]);
        userStates[userId] = { state: 'awaiting_response', keyword: keyword };
        ctx.reply(`Palabra clave "${keyword}" recibida. Ahora, envía la respuesta (texto o imagen).`);
      } else if (userStates[userId]?.state === 'awaiting_response') {
        const keyword = userStates[userId].keyword;
        // Asegúrate de que configs[userId] exista
        configs[userId] = configs[userId] || {};
        if (!configs[userId][keyword]) {
          ctx.reply('Error: La palabra clave no está registrada. Intenta de nuevo con /config.');
          userStates[userId] = null;
          return;
        }
        configs[userId][keyword] = { type: 'text', content: ctx.message.text };
        await saveConfig(userId, configs[userId]);
        userStates[userId] = null;
        ctx.reply(`Palabra clave "${keyword}" configurada. Usa /config o añádeme a un Grupo.`);
      } else if (userStates[userId] === 'awaiting_keyword_to_delete') {
        const keyword = ctx.message.text.toLowerCase();
        await deleteConfigKeyword(userId, keyword);
        ctx.reply(`Palabra clave "${keyword}" eliminada con éxito.`);
        userStates[userId] = null;
      }
      return;
    }
  
    // Resto del manejo de texto en privado y grupos
    if (ctx.chat.type === 'private') {
      const messageText = ctx.message.text.toLowerCase();
      const userConfig = configs[userId] || {};
      const username = ctx.from.first_name || ctx.from.username || 'Usuario';
      for (const [keyword, response] of Object.entries(userConfig)) {
        if (messageText.includes(keyword) && response.type) { // Solo responder si tiene tipo definido
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
      const username = ctx.from.first_name || ctx.from.username || 'Usuario';
      for (const [keyword, response] of Object.entries(userConfig)) {
        if (messageText.includes(keyword) && response.type) { // Solo responder si tiene tipo definido
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

  bot.on('photo', async (ctx) => {
    const userId = ctx.from.id.toString();
    if (ctx.chat.type !== 'private' || userStates[userId]?.state !== 'awaiting_response') return;
  
    const configs = await getConfigs();
    const keyword = userStates[userId].keyword; // Usar keyword desde userStates
    if (!configs[userId] || !configs[userId][keyword]) {
      ctx.reply('Error: La palabra clave no está registrada. Intenta de nuevo con /config.');
      userStates[userId] = null;
      return;
    }
    configs[userId][keyword] = { type: 'photo', content: ctx.message.photo[ctx.message.photo.length - 1].file_id };
    await saveConfig(userId, configs[userId]);
    userStates[userId] = null;
    ctx.reply(`Palabra clave "${keyword}" configurada con una imagen. Usa /config o añádeme a un Grupo.`);
  });

bot.catch((err, ctx) => {
  console.error(`Error en el bot:`, err);
  ctx.reply('Ocurrió un error, por favor intenta más tarde.');
});

const http = require('http');
const PORT = process.env.PORT || 5000;
const HEROKU_URL = process.env.HEROKU_URL || `https://charlotte-bot-b07eafb7460c.herokuapp.com`;
bot.telegram.setWebhook(`${HEROKU_URL}/bot${process.env.BOT_TOKEN}`);
http.createServer(bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`)).listen(PORT, () => {
  console.log(`Bot corriendo en el puerto ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));