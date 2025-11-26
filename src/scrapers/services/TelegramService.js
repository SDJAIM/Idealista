const TelegramBot = require('node-telegram-bot-api');
const { ChromaService } = require('./ChromaService.js');
const { Neo4jService } = require('./Neo4jService.js');
const OpenAI = require('openai');
const { IdealistaScraper } = require('../scraper/IdealistaScraper.js');

class TelegramService {
    constructor(telegramToken, openaiApiKey) {
        this.token = telegramToken;
        this.vectorService = new ChromaService();
        this.graphService = new Neo4jService();
        this.openai = new OpenAI({ apiKey: openaiApiKey });
        
        this.bot = new TelegramBot(this.token, { polling: true });
        this.setupHandlers();
        
        console.log("✅ Telegram Bot iniciado con ChatGPT como agente");
    }

    setupHandlers() {
        this.bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            if (msg.text?.startsWith('/')) return; // Ignorar comandos
            if (msg.text) await this.handleChatGPTMessage(msg);
        });

        this.bot.onText(/\/start/, async (msg) => {
            await this.sendWelcome(msg.chat.id);
        });

        this.bot.onText(/\/scrape (.+)/, async (msg, match) => {
            await this.handleScrapeCommand(msg, match[1]);
        });

        this.bot.onText(/\/search (.+)/, async (msg, match) => {
            await this.handleSearchCommand(msg, match[1]);
        });
    }

    async handleChatGPTMessage(msg) {
        const chatId = msg.chat.id;
        try {
            await this.bot.sendChatAction(chatId, 'typing');
            
            const tools = [
                {
                    type: "function",
                    function: {
                        name: "search_semantic_properties",
                        description: "Buscar propiedades usando búsqueda semántica",
                        parameters: {
                            type: "object",
                            properties: {
                                query: { type: "string" },
                                limit: { type: "number", default: 5 }
                            },
                            required: ["query"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "search_filtered_properties",
                        description: "Buscar propiedades usando filtros específicos",
                        parameters: {
                            type: "object",
                            properties: {
                                ciudad: { type: "string" },
                                minPrice: { type: "number" },
                                maxPrice: { type: "number" },
                                minHabitaciones: { type: "number" },
                                minMetros: { type: "number" },
                                barrio: { type: "string" }
                            }
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_available_cities",
                        description: "Obtener lista de ciudades disponibles",
                        parameters: { type: "object", properties: {} }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "get_available_neighborhoods",
                        description: "Obtener barrios disponibles para una ciudad",
                        parameters: {
                            type: "object",
                            properties: {
                                city: { type: "string" }
                            },
                            required: ["city"]
                        }
                    }
                }
            ];

            const response = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo-1106",
                messages: [
                    {
                        role: "system",
                        content: `Eres un asistente especializado en búsqueda de propiedades inmobiliarias. 
                                Usa las funciones disponibles para buscar propiedades cuando el usuario lo solicite.
                                Presenta los resultados de manera clara y organizada con todos los detalles importantes.
                                Si no hay resultados, sugiere alternativas o ajusta los filtros.`
                    },
                    { role: "user", content: msg.text }
                ],
                tools: tools,
                tool_choice: "auto"
            });

            const responseMessage = response.choices[0].message;
            
            if (responseMessage.tool_calls) {
                for (const toolCall of responseMessage.tool_calls) {
                    const functionName = toolCall.function.name;
                    const functionArgs = JSON.parse(toolCall.function.arguments);
                    
                    let functionResult;
                    switch (functionName) {
                        case "search_semantic_properties":
                            functionResult = await this.vectorService.semanticSearch(
                                functionArgs.query, 
                                functionArgs.limit || 5
                            );
                            break;
                        case "search_filtered_properties":
                            functionResult = await this.graphService.searchProperties(functionArgs);
                            break;
                        case "get_available_cities":
                            functionResult = await this.graphService.getCities();
                            break;
                        case "get_available_neighborhoods":
                            functionResult = await this.graphService.getNeighborhoods(functionArgs.city);
                            break;
                    }

                    const finalResponse = await this.openai.chat.completions.create({
                        model: "gpt-3.5-turbo-1106",
                        messages: [
                            {
                                role: "system",
                                content: `Eres un asistente de propiedades. Presenta los resultados de manera clara.
                                        FORMATO:
                                        🏠 [Título]
                                        📍 [Ubicación]
                                        💰 Precio: [Precio]€
                                        🛏️ Habitaciones: [Número]
                                        📐 Metros: [Metros]m²
                                        ⭐ Características: [Lista]
                                        🌱 Certificado: [Certificado]
                                        🔗 Enlace: [URL]`
                            },
                            { role: "user", content: msg.text },
                            responseMessage,
                            {
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: JSON.stringify(functionResult, null, 2)
                            }
                        ]
                    });

                    await this.bot.sendMessage(
                        chatId, 
                        finalResponse.choices[0].message.content,
                        { parse_mode: 'Markdown' }
                    );
                }
            } else {
                await this.bot.sendMessage(chatId, responseMessage.content);
            }
        } catch (error) {
            console.error("Error con ChatGPT:", error);
            await this.bot.sendMessage(chatId, "❌ Lo siento, hubo un error procesando tu mensaje.");
        }
    }

    async sendWelcome(chatId) {
        const welcomeMessage = `
👋 ¡Hola! Soy tu asistente de búsqueda de propiedades con IA.

🏠 **¿Qué puedo hacer?**
• Buscar propiedades por descripción o características
• Filtrar por ciudad, precio, habitaciones, metros
• Mostrar propiedades similares
• Informar sobre ciudades y barrios disponibles

💬 **Ejemplos:**
- "Busca apartamentos en Madrid centro"
- "Quiero un piso de 3 habitaciones por menos de 1000€"
- "¿Qué barrios tienes disponibles en Valencia?"

🔧 **Comandos:**
/scrape [url] - Extraer propiedades
/search [términos] - Búsqueda directa

¡Estoy aquí para ayudarte! 🏡
        `.trim();

        await this.bot.sendMessage(chatId, welcomeMessage);
    }

    async handleScrapeCommand(msg, url) {
        const chatId = msg.chat.id;
        if (!url) {
            await this.bot.sendMessage(chatId, "❌ Usa: /scrape [url_idealista]");
            return;
        }

        await this.bot.sendMessage(chatId, "🔄 Iniciando scraping... Esto puede tomar unos minutos.");
        try {
            const scraper = new IdealistaScraper();
            const propiedades = await scraper.scrape(url);
            await this.bot.sendMessage(chatId, `✅ Scraping completado! ${propiedades.length} propiedades procesadas.`);
        } catch (error) {
            console.error("Error en scraping:", error);
            await this.bot.sendMessage(chatId, "❌ Error: " + error.message);
        }
    }

    async handleSearchCommand(msg, query) {
        const chatId = msg.chat.id;
        try {
            const results = await this.vectorService.semanticSearch(query, 5);
            if (results.length === 0) {
                await this.bot.sendMessage(chatId, "❌ No se encontraron propiedades.");
                return;
            }

            let response = `🔍 **Resultados para: \"${query}\"**\n\n`;
            results.forEach((result, index) => {
                const meta = result.metadata;
                response += `🏠 **Propiedad ${index + 1}**\n`;
                response += `📍 ${meta.titulo}\n`;
                response += `🏙️ ${meta.ciudad}, ${meta.barrio}\n`;
                response += `💰 ${meta.precio}€ | 🛏️ ${meta.habitaciones}hab | 📐 ${meta.metros}m²\n`;
                if (meta.energetico) response += `🌱 Certificado: ${meta.energetico}\n`;
                if (meta.garaje) response += `🚗 ${meta.garaje}\n`;
                response += `🔗 [Ver propiedad](${meta.url})\n\n`;
            });

            await this.bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error("Error en búsqueda:", error);
            await this.bot.sendMessage(chatId, "❌ Error en la búsqueda: " + error.message);
        }
    }
}

module.exports = { TelegramService };