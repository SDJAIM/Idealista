const { ChromaClient } = require("chromadb");
const OpenAI = require('openai');

class ChromaService {
    constructor() {
        this.client = new ChromaClient({
            path: process.env.CHROMADB_URL,
            tenant: 'default_tenant',     
            database: 'default_database'  
        });
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.collection = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        try {
            console.log('🔄 Inicializando ChromaDB...');
            this.collection = await this.client.getOrCreateCollection({
                name: "idealista_properties",
                metadata: { "hnsw:space": "cosine" }
            });
            this.isInitialized = true;
            console.log('✅ ChromaDB listo y conectado.');
        } catch (error) {
            console.error('❌ Error inicializando ChromaDB:', error.message);
            throw error;
        }
    }

    async generatePropertyEmbedding(property) {
        const prompt = `
            Propiedad: ${property.titulo_completo}
            Ubicación: ${property.ciudad}, ${property.barrio}
            Precio: ${property.price_num}€
            Características: ${property.habitaciones} habitaciones, ${property.metros}m².
            Extras: ${property.extras}. ${property.caracteristicas_detalle.join(', ')}
            Descripción: ${property.descripcion_detallada}
        `.trim().replace(/\s+/g, ' ');

        try {
            const response = await this.openai.embeddings.create({
                model: "text-embedding-3-small", // Modelo más nuevo y eficiente
                input: prompt
            });
            return { embedding: response.data[0].embedding, document: prompt };
        } catch (error) {
            console.error('❌ Error generando embedding con OpenAI:', error.message);
            // Fallback sin embedding para no detener el proceso
            return { embedding: null, document: prompt };
        }
    }

    async storeProperty(property) {
        if (!this.isInitialized) await this.initialize();

        try {
            // Usar la URL como ID único y robusto
            const propertyId = property.url;
            if (!propertyId) {
                console.warn('⚠️ Propiedad sin URL, no se puede guardar en ChromaDB.');
                return null;
            }
            
            console.log(`[ChromaDB] Procesando: ${property.titulo_completo}`);
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

            const payload = {
                ids: [propertyId],
                documents: [document],
                metadatas: [metadata]
            };
            if (embedding) {
                payload.embeddings = [embedding];
            }

            await this.collection.upsert(payload); // Upsert es más seguro que 'add'

            console.log(`[ChromaDB] ✅ Guardado: ${property.titulo_completo}`);
            return propertyId;
        } catch (error) {
            console.error('❌ Error guardando en ChromaDB:', error.message);
            return null;
        }
    }

    async semanticSearch(query, limit = 5) {
        if (!this.isInitialized) await this.initialize();

        try {
            console.log(`[ChromaDB] 🔍 Búsqueda semántica: "${query}"`);
            const queryEmbedding = await this.openai.embeddings.create({
                model: "text-embedding-3-small",
                input: query
            });

            const results = await this.collection.query({
                queryEmbeddings: [queryEmbedding.data[0].embedding],
                nResults: limit
            });

            console.log(`[ChromaDB] ✅ Encontrados ${results.ids[0].length} resultados.`);
            return results.metadatas[0].map((metadata, index) => ({
                id: results.ids[0][index],
                document: results.documents[0][index],
                metadata: metadata,
                distance: results.distances[0][index]
            }));
        } catch (error) {
            console.error('❌ Error en búsqueda semántica:', error.message);
            return [];
        }
    }

    async close() {
        // ChromaDB http client no requiere un cierre explícito, pero lo mantenemos por consistencia
        console.log('🔌 ChromaService desconectado.' );
    }
}

module.exports = { ChromaService };
