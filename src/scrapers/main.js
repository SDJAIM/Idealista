require('dotenv').config();
const readline = require('readline');
const { IdealistaScraper } = require('./idealista.js');

console.log('🏠 SCRAPER IDEALISTA CON CHROMADB Y NEO4J');
console.log('=========================================');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question("👉 Ingresa la URL de Idealista: ", async url => {
    if (!/^https?:\/\//i.test(url)) {
        console.log("⚠️ La URL debe comenzar con http o https.");
        rl.close();
        return;
    }
    
    rl.close();
    
    try {
        const scraper = new IdealistaScraper();
        await scraper.scrape(url);
    } catch (error) {
        console.error('❌ Error en el scraping:', error);
        process.exit(1);
    }
});