const neo4j = require('neo4j-driver');

class Neo4jService {
    constructor() {
        this.driver = null;
        this.isConnected = false;
    }

    async connect() {
        if (this.isConnected) return;
        if (!process.env.NEO4J_URI || !process.env.NEO4J_USERNAME || !process.env.NEO4J_PASSWORD) {
            throw new Error('❌ Variables de entorno de Neo4j no configuradas. Revisa tu .env');
        }
        try {
            console.log('🔗 Conectando a Neo4j...');
            this.driver = neo4j.driver(
                process.env.NEO4J_URI,
                neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
                { disableLosslessIntegers: true }
            );
            await this.driver.verifyConnectivity();
            this.isConnected = true;
            console.log('✅ Conectado a Neo4j.');
            await this.createIndexes();
        } catch (error) {
            console.error('❌ Error conectando a Neo4j:', error.message);
            console.log('💡 Asegúrate de que la base de datos Neo4j esté en ejecución y las credenciales sean correctas.');
            throw error;
        }
    }

    async createIndexes() {
        const session = this.driver.session();
        try {
            console.log('🔄 Creando índices en Neo4j para optimizar consultas...');
            await session.run('CREATE INDEX property_id IF NOT EXISTS FOR (p:Property) ON (p.id)');
            await session.run('CREATE INDEX feature_name IF NOT EXISTS FOR (f:Feature) ON (f.name)');
            await session.run('CREATE INDEX city_name IF NOT EXISTS FOR (c:City) ON (c.name)');
            await session.run('CREATE INDEX neighborhood_name IF NOT EXISTS FOR (n:Neighborhood) ON (n.name)');
            console.log('✅ Índices de Neo4j asegurados.');
        } finally {
            await session.close();
        }
    }

    async saveProperty(property) {
        if (!this.isConnected) await this.connect();
        const session = this.driver.session();
        try {
            const propertyId = property.url;
            if (!propertyId) {
                console.warn('⚠️ Propiedad sin URL, no se puede guardar en Neo4j.');
                return false;
            }
            
            await session.executeWrite(tx => tx.run(
                `
                MERGE (p:Property {id: $id})
                SET p.title = $title, p.price = $price, p.rooms = $rooms, p.sqft = $sqft, p.lastUpdated = datetime()
                
                MERGE (city:City {name: $cityName})
                MERGE (neighborhood:Neighborhood {name: $neighborhoodName})
                MERGE (neighborhood)-[:IN_CITY]->(city)
                MERGE (p)-[:IN_NEIGHBORHOOD]->(neighborhood)

                WITH p
                UNWIND $features as featureName
                MERGE (f:Feature {name: trim(featureName)})
                MERGE (p)-[:HAS_FEATURE]->(f)
                `,
                {
                    id: propertyId,
                    title: property.titulo_completo,
                    price: property.price_num,
                    rooms: property.habitaciones,
                    sqft: property.metros,
                    cityName: property.ciudad,
                    neighborhoodName: property.barrio,
                    features: property.caracteristicas_detalle || []
                }
            ));
            return true;
        } catch (error) {
            console.error('❌ Error guardando en Neo4j:', error.message);
            return false;
        } finally {
            await session.close();
        }
    }

    async findRelatedProperties(propertyId, limit = 5) {
        if (!this.isConnected) await this.connect();
        const session = this.driver.session();
        try {
            console.log(`[Neo4j] 🧠 Buscando propiedades relacionadas con: ${propertyId}`);
            const result = await session.run(`
                MATCH (p1:Property {id: $propertyId})-[:HAS_FEATURE]->(f:Feature)<-[:HAS_FEATURE]-(p2:Property)
                WHERE p1 <> p2
                WITH p2, COUNT(f) AS sharedFeatures
                ORDER BY sharedFeatures DESC
                LIMIT $limit
                MATCH (p2)-[:IN_NEIGHBORHOOD]->(n)-[:IN_CITY]->(c)
                RETURN p2.id as id, p2.title as title, p2.price as precio, p2.rooms as habitaciones, p2.sqft as metros, n.name as barrio, c.name as ciudad, sharedFeatures
            `, { limit: neo4j.int(limit) }); // Forzar a entero por seguridad
            return result.records.map(record => record.toObject());
        } catch (error) {
            console.error('❌ Error buscando propiedades relacionadas:', error);
            return [];
        } finally {
            await session.close();
        }
    }

    async searchProperties(filters, limit = 10) {
        if (!this.isConnected) await this.connect();
        const session = this.driver.session();
        try {
            console.log(`[Neo4j] 🔍 Búsqueda por filtros:`, filters);
            let query = `MATCH (p:Property)-[:IN_NEIGHBORHOOD]->(n:Neighborhood)-[:IN_CITY]->(c:City) WHERE 1=1`;
            
            // --- INICIO DE LA CORRECCIÓN ---
            // Forzamos el límite a ser un entero de Neo4j desde el principio
            const params = { limit: neo4j.int(limit) };
            // --- FIN DE LA CORRECCIÓN ---

            if (filters.city) { 
                query += ` AND c.name CONTAINS $city`; 
                params.city = filters.city; 
            }
            if (filters.rooms) { 
                query += ` AND p.rooms = $rooms`; 
                params.rooms = neo4j.int(filters.rooms); // Forzar a entero por seguridad
            }

            query += ` RETURN p.id as id, p.title as title, p.price as precio, p.rooms as habitaciones, p.sqft as metros, n.name as barrio, c.name as ciudad`;
            
            if (filters.sort_by_price) {
                if (filters.sort_by_price === 'asc') {
                    query += ` ORDER BY precio ASC`;
                } else if (filters.sort_by_price === 'desc') {
                    query += ` ORDER BY precio DESC`;
                }
            }
            
            query += ` LIMIT $limit`;

            console.log("[Neo4j] Query:", query);
            const result = await session.run(query, params);
            return result.records.map(record => record.toObject());
        } catch (error) {
            console.error('❌ Error en búsqueda por filtros:', error);
            return [];
        } finally {
            await session.close();
        }
    }

    async getCities() {
        if (!this.isConnected) await this.connect();
        const session = this.driver.session();
        try {
            const result = await session.run('MATCH (c:City) RETURN c.name as city ORDER BY city');
            return result.records.map(record => record.get('city'));
        } finally { await session.close(); }
    }

    async getNeighborhoods(city) {
        if (!this.isConnected) await this.connect();
        const session = this.driver.session();
        try {
            const result = await session.run(
                'MATCH (c:City {name: $city})<-[:IN_CITY]-(n:Neighborhood) RETURN n.name as neighborhood ORDER BY neighborhood',
                { city }
            );
            return result.records.map(record => record.get('neighborhood'));
        } finally { await session.close(); }
    }

    async close() {
        if (this.driver) {
            await this.driver.close();
            this.isConnected = false;
            console.log('🔌 Conexión a Neo4j cerrada.');
        }
    }
}

module.exports = { Neo4jService };
