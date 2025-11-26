require('dotenv').config();

(async () => {
    const { ChromaClient } = require("chromadb")
    
    console.log('🧪 Probando ChromaDB en modo memoria...');
    
    try {
        // Esto inicia ChromaDB automáticamente
        const client = new ChromaClient()
        
        const collection = await client.getOrCreateCollection({
            name: "test_collection",
        })

        console.log('✅ ChromaDB iniciado automáticamente en modo memoria');
        console.log('✅ Colección creada: test_collection');
        
        // Probar agregar datos
        await collection.add({
            ids: ["test1"],
            documents: ["Este es un documento de prueba"],
            metadatas: [{ test: true }]
        })
        
        console.log('✅ Datos agregados correctamente');
        
        // Probar búsqueda
        const results = await collection.query({
            queryTexts: ["documento prueba"],
            nResults: 1
        });
        
        console.log('✅ Búsqueda funcionando:', results.metadatas[0]);
        
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
})()