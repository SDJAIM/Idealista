const neo4j = require('neo4j-driver');

class Neo4jService {
    constructor() {
        this.driver = null;
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxAttempts = 3;
    }

    async connect() {
        // Verificar variables de entorno
        if (!process.env.NEO4J_URI || !process.env.NEO4J_USER || !process.env.NEO4J_PASSWORD) {
            console.error('❌ Faltan variables de entorno para Neo4j');
            console.log('   Asegúrate de tener en tu .env:');
            console.log('   NEO4J_URI=bolt://localhost:7687');
            console.log('   NEO4J_USER=neo4j');
            console.log('   NEO4J_PASSWORD=tu_password');
            throw new Error('Variables de entorno de Neo4j no configuradas');
        }

        console.log('🔗 Intentando conectar a Neo4j...');
        console.log(`   URI: ${process.env.NEO4J_URI}`);
        console.log(`   User: ${process.env.NEO4J_USER}`);
        
        try {
            this.driver = neo4j.driver(
                process.env.NEO4J_URI,
                neo4j.auth.basic(
                    process.env.NEO4J_USER,
                    process.env.NEO4J_PASSWORD
                ),
                {
                    maxConnectionLifetime: 3 * 60 * 60 * 1000, // 3 hours
                    maxConnectionPoolSize: 50,
                    connectionAcquisitionTimeout: 60000, // 60 seconds
                    disableLosslessIntegers: true
                }
            );

            // Verificar conexión
            await this.driver.verifyConnectivity();
            this.isConnected = true;
            this.connectionAttempts = 0;
            
            // Obtener información de la base de datos
            const serverInfo = await this.driver.getServerInfo();
            console.log('✅ Conectado a Neo4j');
            console.log(`   Neo4j Version: ${serverInfo.protocolVersion}`);
            
            return true;
            
        } catch (error) {
            this.connectionAttempts++;
            console.error(`❌ Error conectando a Neo4j (intento ${this.connectionAttempts}/${this.maxAttempts}):`, error.message);
            
            if (this.connectionAttempts < this.maxAttempts) {
                console.log('🔄 Reintentando en 5 segundos...');
                await this.sleep(5000);
                return await this.connect();
            } else {
                console.log('💡 Posibles soluciones:');
                console.log('   1. Verifica que Neo4j esté ejecutándose');
                console.log('   2. Verifica las credenciales en el archivo .env');
                console.log('   3. Verifica que la URI sea correcta');
                console.log('   4. Si usas Neo4j Desktop, abre la base de datos');
                throw error;
            }
        }
    }

    sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

    async saveProperty(property) {
        if (!this.isConnected) {
            try {
                await this.connect();
            } catch (error) {
                console.log('⚠️ No se pudo conectar a Neo4j, omitiendo guardado...');
                return false;
            }
        }

        const session = this.driver.session();
        try {
            console.log(`💾 Guardando propiedad en Neo4j: ${property.titulo_completo}`);
            
            await session.executeWrite(tx => tx.run(
                `MERGE (p:Property {id: $id})
                 SET p.title = $title,
                     p.address = $address,
                     p.sqft_m2 = $metros,
                     p.rooms = $habitaciones,
                     p.floor_elevator = $extras,
                     p.garage = $garaje,
                     p.description = $descripcion,
                     p.url = $url,
                     p.lastUpdated = datetime(),
                     p.source = 'idealista'
                 
                 MERGE (ciudad:City {name: $ciudad})
                 MERGE (barrio:Neighborhood {name: $barrio})-[:IN_CITY]->(ciudad)
                 MERGE (calle:Street {name: $calle})-[:IN_NEIGHBORHOOD]->(barrio)
                 
                 MERGE (p)-[:LOCATED_AT]->(calle)
                 MERGE (p)-[:IN_NEIGHBORHOOD]->(barrio)
                 MERGE (p)-[:IN_CITY]->(ciudad)
                 
                 WITH p
                 UNWIND $features as feature
                 MERGE (f:Feature {name: trim(feature)})
                 MERGE (p)-[:HAS_FEATURE]->(f)
                 
                 WITH p
                 MERGE (e:EnergyCertificate {rating: $energyRating})
                 MERGE (p)-[:HAS_CERTIFICATE]->(e)
                 
                 WITH p
                 CREATE (p)-[:HAS_PRICE {amount: $price, date: date()}]->(:Price)`,
                {
                    id: property.url || `prop_${Date.now()}`,
                    title: property.titulo_completo || 'Sin título',
                    address: `${property.calle || ''}, ${property.barrio || ''}, ${property.ciudad || ''}`.trim(),
                    metros: property.metros || 0,
                    habitaciones: property.habitaciones || 0,
                    extras: property.extras || '',
                    garaje: property.garaje || '',
                    descripcion: property.descripcion_detallada || '',
                    url: property.url || '',
                    ciudad: property.ciudad || 'Desconocida',
                    barrio: property.barrio || 'Desconocido',
                    calle: property.calle || 'Desconocida',
                    price: property.price_num || 0,
                    features: property.caracteristicas_detalle || [],
                    energyRating: property.energetico || 'Unknown'
                }
            ));
            
            console.log(`✅ Propiedad guardada en Neo4j: ${property.titulo_completo}`);
            return true;
            
        } catch (error) {
            console.error('❌ Error guardando en Neo4j:', error.message);
            return false;
        } finally {
            await session.close();
        }
    }

    async close() {
        if (this.driver) {
            await this.driver.close();
            this.isConnected = false;
            console.log('🔌 Conexión a Neo4j cerrada');
        }
    }
}

module.exports = { Neo4jService };