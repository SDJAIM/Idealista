require('dotenv').config();
const { TelegramService } = require('./services/TelegramService.js');

console.log('🤖 Iniciando el Asistente Inmobiliario AI...');

const token = process.env.TELEGRAM_BOT_TOKEN;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!token || !openaiApiKey) {
    console.error("❌ Error: Faltan las variables de entorno TELEGRAM_BOT_TOKEN o OPENAI_API_KEY.");
    console.error("Asegúrate de que tu archivo .env esté completo.");
    process.exit(1);
}

try {
    // Inicializa los servicios y el bot
    const botService = new TelegramService(token, openaiApiKey);
    
    // El constructor de TelegramService ya se encarga de todo.
    // Podemos añadir un listener para cerrar conexiones correctamente.
    process.on('SIGINT', async () => {
        console.log("\n🔌 Cerrando conexiones de forma segura...");
        await botService.close();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log("\n🔌 Cerrando conexiones de forma segura...");
        await botService.close();
        process.exit(0);
    });

} catch (error) {
    console.error("❌ Error al iniciar el servicio de Telegram:", error);
    process.exit(1);
}
