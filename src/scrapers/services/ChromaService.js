const { ChromaClient } = require("chromadb");
const OpenAI = require('openai');

class ChromaService {
    constructor() {
        // Mismo enfoque que tu profesor - ChromaDB en memoria
        this.client = new ChromaClient();
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.collection = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            console.log('🔄 Inicializando ChromaDB (modo memoria)...');
            
            // Crear colección igual que tu profesor
            this.collection = await this.client.getOrCreateCollection({
                name: "idealista_properties",
            });
            
            this.isInitialized = true;
            console.log('✅ ChromaDB listo - igual que el ejemplo del profesor');
            
        } catch (error) {
            console.error('❌ Error inicializando ChromaDB:', error.message);
            throw error;
        }
    }

    async generatePropertyEmbedding(property) {
        try {
            // Enfoque similar al de tu profesor pero simplificado
            const prompt = `
            Propiedad: ${property.titulo_completo}
            Ubicación: ${property.ciudad}, ${property.barrio}
            Precio: ${property.price_num}€
            Habitaciones: ${property.habitaciones}
            Metros: ${property.metros}m²
            Extras: ${property.extras}
            Descripción: ${property.descripcion_detallada}
            `.trim();

            // Generar embedding como en el ejemplo
            const response = await this.openai.embeddings.create({
                model: "text-embedding-ada-002",
                input: prompt
            });

            return {
                embedding: response.data[0].embedding,
                document: prompt
            };
            
        } catch (error) {
            console.error('❌ Error con OpenAI, usando fallback...');
            // Fallback sin embeddings - solo documento de texto
            return {
                embedding: [], // Array vacío como fallback
                document: `Propiedad en ${property.ciudad} - ${property.price_num}€ - ${property.habitaciones}hab`
            };
        }
    }

    async storeProperty(property) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            const propertyId = `prop_${property.url?.split('/').pop() || Date.now()}`;
            
            console.log(`📝 Procesando: ${property.titulo_completo}`);
            const { embedding, document } = await this.generatePropertyEmbedding(property);
            
            const metadata = {
                titulo: property.titulo_completo,
                ciudad: property.ciudad,
                barrio: property.barrio,
                precio: property.price_num,
                habitaciones: property.habitaciones,
                metros: property.metros,
                url: property.url,
                timestamp: new Date().toISOString()
            };

            // Método igual al de tu profesor
            await this.collection.add({
                ids: [propertyId],
                documents: [document],
                embeddings: embedding.length > 0 ? [embedding] : undefined,
                metadatas: [metadata]
            });

            console.log(`✅ Guardado en ChromaDB: ${property.titulo_completo}`);
            return propertyId;
            
        } catch (error) {
            console.error('❌ Error guardando en ChromaDB:', error.message);
            return null;
        }
    }

    async semanticSearch(query, limit = 5) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            console.log(`🔍 Buscando: "${query}"`);
            
            // Búsqueda por texto como en el ejemplo de tu profesor
            const results = await this.collection.query({
                queryTexts: [query],
                nResults: limit
            });

            console.log(`✅ Encontrados ${results.ids[0].length} resultados`);
            
            // Mismo formato de respuesta que tu profesor
            return results.metadatas[0].map((metadata, index) => ({
                id: results.ids[0][index],
                document: results.documents[0][index],
                metadata: metadata,
                distance: results.distances ? results.distances[0][index] : 0
            }));
            
        } catch (error) {
            console.error('❌ Error en búsqueda:', error.message);
            return [];
        }
    }

    async testSearch() {
        // Prueba idéntica a la de tu profesor
        try {
            const results = await this.collection.query({
                queryTexts: ["apartamento mallorca terraza"],
                nResults: 3
            });

            const properties = results.metadatas[0].map(result => result);
            console.log('🔍 Resultados de prueba:', properties);
            return properties;
            
        } catch (error) {
            console.error('❌ Error en prueba:', error);
            return [];
        }
    }

    async close() {
        console.log('🔌 ChromaService cerrado');
    }
}

module.exports = { ChromaService };