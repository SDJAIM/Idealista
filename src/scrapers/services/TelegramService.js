const TelegramBot = require('node-telegram-bot-api');
const { ChromaService } = require('./ChromaService.js');
const { Neo4jService } = require('./Neo4jService.js');
const OpenAI = require('openai');

class TelegramService {
    constructor(telegramToken, openaiApiKey) {
        this.bot = new TelegramBot(telegramToken, { polling: true });
        this.openai = new OpenAI({ apiKey: openaiApiKey });
        this.vectorService = new ChromaService();
        this.graphService = new Neo4jService();
        this.assistantId = process.env.OPENAI_ASSISTANT_ID;
        if (!this.assistantId) {
            throw new Error("❌ La variable de entorno OPENAI_ASSISTANT_ID es obligatoria.");
        }
        this.userThreads = new Map();
        
        // --- INICIO DE LA CORRECCIÓN ---
        // Llamamos a la inicialización, pero no esperamos aquí.
        // El constructor debe ser rápido. La lógica de manejo de estado se hará dentro.
        this.initializeServices();
        // --- FIN DE LA CORRECCIÓN ---

        this.setupHandlers();
        console.log(`✅ Telegram Bot iniciado para Asistente: ${this.assistantId}`);
    }

    // --- FUNCIÓN DE INICIALIZACIÓN ROBUSTA ---
    async initializeServices() {
        console.log("🔄 Inicializando todos los servicios...");
        
        const services = [
            this.vectorService.initialize(),
            this.graphService.connect()
        ];

        const results = await Promise.allSettled(services);
        let allServicesReady = true;

        if (results[0].status === 'rejected') {
            console.error('❌ Falló la inicialización de ChromaDB:', results[0].reason.message);
            allServicesReady = false;
        } else {
            console.log('✅ ChromaDB listo y conectado.');
        }

        if (results[1].status === 'rejected') {
            console.error('❌ Falló la inicialización de Neo4j:', results[1].reason.message);
            allServicesReady = false;
        } else {
            console.log('✅ Neo4j listo y conectado.');
        }

        if (allServicesReady) {
            console.log("✅ ¡Todos los servicios están conectados y listos para operar!");
        } else {
            console.error("⚠️ Uno o más servicios no pudieron iniciarse. El bot podría no funcionar correctamente.");
        }
    }

    setupHandlers() {
        this.bot.on('message', async (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                await this.handleAssistantMessage(msg);
            }
        });
        this.bot.onText(/\/start/, (msg) => {
            this.userThreads.delete(msg.chat.id);
            this.sendWelcome(msg.chat.id);
        });
    }

    // ... (El resto de las funciones: formatPropertyMessage, escapeMarkdown, handleAssistantMessage, etc., se quedan exactamente igual que en la versión anterior)
    escapeMarkdown(text) {
        if (typeof text !== 'string' || text === null) return '';
        const specials = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
        const regex = new RegExp(`[${specials.map(c => `\\${c}`).join('')}]`, 'g');
        return text.replace(regex, '\\$&');
    }

    formatPropertyMessage(property) {
        const title = this.escapeMarkdown(property.title || "Propiedad sin título");
        const price = this.escapeMarkdown(property.precio ? `${property.precio.toLocaleString('es-ES')}€` : "Precio no disponible");
        const location = this.escapeMarkdown(`${property.barrio || 'Ubicación no especificada'}, ${property.ciudad || ''}`.trim());
        const rooms = this.escapeMarkdown(property.habitaciones ? `${property.habitaciones} hab.` : "N/A");
        const area = this.escapeMarkdown(property.metros ? `${property.metros} m²` : "N/A");

        let message = `🏠 *${title}*\n\n`;
        message += `💰 *Precio:* ${price}\n`;
        message += `📍 *Ubicación:* ${location}\n`;
        message += `🛏️ ${rooms} \\- 📐 ${area}\n`;

        return message;
    }

    async handleAssistantMessage(msg) {
        const chatId = msg.chat.id;
        await this.bot.sendChatAction(chatId, 'typing');

        try {
            let threadId = this.userThreads.get(chatId);
            if (!threadId) {
                const thread = await this.openai.beta.threads.create();
                threadId = thread.id;
                this.userThreads.set(chatId, threadId);
            }

            await this.openai.beta.threads.messages.create(threadId, { role: "user", content: msg.text });

            const run = await this.openai.beta.threads.runs.createAndPoll(threadId, {
                assistant_id: this.assistantId,
            });

            if (run.status === 'requires_action') {
                const toolCall = run.required_action.submit_tool_outputs.tool_calls[0];
                const functionName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments);
                
                if (functionName === 'find_properties') {
                    const searchResults = await this.graphService.searchProperties(args);
                    const finalResults = searchResults.slice(0, 3);

                    if (finalResults.length > 0) {
                        await this.bot.sendMessage(chatId, `¡Genial! He encontrado ${finalResults.length} ${finalResults.length > 1 ? 'opciones' : 'opción'} que podrían interesarte:`);

                        for (const property of finalResults) {
                            const formattedMessage = this.formatPropertyMessage(property);
                            
                            const options = {
                                parse_mode: 'MarkdownV2',
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: '🔗 Ver Anuncio', url: property.id },
                                            { text: '🗺️ Ver en Mapa', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(property.barrio + ',' + property.ciudad )}` }
                                        ]
                                    ]
                                }
                            };
                            await this.bot.sendMessage(chatId, formattedMessage, options);
                            await this.sleep(400);
                        }
                    } else {
                        await this.bot.sendMessage(chatId, "😕 Lo siento, no he encontrado propiedades que coincidan con tus criterios. ¿Quieres probar con una búsqueda más amplia?");
                    }
                }
                return;
            }
            
            if (run.status === 'completed') {
                const messages = await this.openai.beta.threads.messages.list(threadId);
                const responseText = messages.data[0].content[0].text.value;
                await this.bot.sendMessage(chatId, responseText);
            }

        } catch (error) {
            console.error("❌ Error fatal en el flujo del asistente:", error);
            await this.bot.sendMessage(chatId, "Ha ocurrido un error grave. Por favor, intenta reiniciar la conversación con /start.");
        }
    }
    
    async sendWelcome(chatId) {
        const welcomeMessage = `
👋 ¡Hola! Soy tu **Asistente Inmobiliario con IA**.

He reiniciado nuestra conversación. Ahora puedes preguntarme lo que necesites sobre propiedades.

**Ejemplos:**
- "Busca un ático con mucha luz y una terraza grande en Valencia"
- "Encuéntrame pisos de 2 habitaciones en el barrio de Gràcia, Barcelona, el más barato"

¡Dime qué estás buscando! 🏡
        `;
        await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    }
    async close() {
        console.log("🔌 Cerrando el bot de Telegram y las conexiones a servicios...");
        if (this.bot.isPolling()) {
            await this.bot.stopPolling();
        }
        await this.graphService.close();
        await this.vectorService.close();
        console.log("✅ Todas las conexiones han sido cerradas.");
    }
    sleep = ms => new Promise(r => setTimeout(r, ms));
}

module.exports = { TelegramService };
