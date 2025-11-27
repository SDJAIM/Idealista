const { exec } = require("child_process");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const net = require("net");
const { Neo4jService } = require('./services/Neo4jService.js');
const { ChromaService } = require('./services/ChromaService.js');

class IdealistaScraper {
    constructor() {
        this.neo4jService = new Neo4jService();
        this.chromaService = new ChromaService();
        this.driver = null;
    }

    // --- FUNCIONES DE AYUDA COMPLETAS ---
    sleep = ms => new Promise(r => setTimeout(r, ms));
    random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    async waitForPort(port = 9222, timeout = 15000) {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const check = () => {
                const socket = new net.Socket();
                socket
                    .once("connect", () => { socket.destroy(); resolve(true); })
                    .once("error", () => {
                        socket.destroy();
                        if (Date.now() - start > timeout) reject(new Error("⏰ Timeout esperando el puerto de depuración de Chrome (9222)"));
                        else setTimeout(check, 400);
                    })
                    .connect(port, "127.0.0.1");
            };
            check();
        });
    }

    async initBrowser() {
        const profile = "C:\\temp\\ChromeProfile";
        if (!fs.existsSync(profile)) fs.mkdirSync(profile, { recursive: true });
        console.log("🌐 Iniciando Chrome con modo depuración...");
        const chromePath = `"${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe"`;
        exec(`${chromePath} --remote-debugging-port=9222 --user-data-dir="${profile}" --start-maximized`);
        await this.waitForPort();
        const options = new chrome.Options();
        options.options_["debuggerAddress"] = "127.0.0.1:9222";
        this.driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
        return this.driver;
    }

    async aceptarCookies(driver) {
        try {
            const btn = await driver.wait(until.elementLocated(By.id("didomi-notice-agree-button")), 5000);
            await driver.executeScript("arguments[0].scrollIntoView()", btn);
            await this.sleep(400);
            await btn.click();
        } catch {
            console.log("ℹ️ No se encontró el banner de cookies o ya fue aceptado.");
        }
    }

    parseDireccion(texto) {
        if (!texto) return { calle: "", barrio: "", ciudad: "" };
        let clean = texto.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
        const idx = clean.toLowerCase().indexOf(" en ");
        if (idx !== -1) clean = clean.substring(idx + 4).trim();
        const partes = clean.split(/,| - /).map(s => s.trim()).filter(Boolean);
        let calle = "", barrio = "", ciudad = "";
        if (partes.length === 1) ciudad = partes[0];
        if (partes.length === 2) { barrio = partes[0]; ciudad = partes[1]; }
        if (partes.length >= 3) {
            calle = partes[0];
            barrio = partes[1];
            ciudad = partes.slice(2).join(", ");
        }
        const cap = s => s ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "";
        return { calle: cap(calle), barrio: cap(barrio), ciudad: cap(ciudad) };
    }

    // --- MÉTODO DE SCRAPING CON LÓGICA DE LOTES Y NAVEGACIÓN CORREGIDA ---
    async scrape(urlBase) {
        if (!fs.existsSync("./resultados")) fs.mkdirSync("./resultados");
        
        this.driver = await this.initBrowser();
        const todasLasPropiedades = [];
        
        try {
            await this.neo4jService.connect();
            await this.chromaService.initialize();

            console.log("📍 Abriendo URL base:", urlBase);
            await this.driver.get(urlBase);
            await this.aceptarCookies(this.driver);
            await this.driver.wait(until.elementLocated(By.css("div.item-info-container")), 15000);

            let page = 1;
            let keepScraping = true;
            let totalPropiedadesGuardadas = 0;

            while (keepScraping) {
                console.log(`\n📄 Procesando página de resultados ${page}...`);
                
                // --- INICIO DE LA MODIFICACIÓN ---
                // 1. Guardamos la URL de la página de resultados actual
                const currentPageUrl = await this.driver.getCurrentUrl();
                console.log(`   URL de la página de resultados: ${currentPageUrl}`);
                // --- FIN DE LA MODIFICACIÓN ---

                const urlsDelLote = [];
                const itemLinks = await this.driver.findElements(By.css("a.item-link"));
                const urlsDeLaPagina = await Promise.all(itemLinks.map(link => link.getAttribute('href')));
                
                for (const url of urlsDeLaPagina) {
                    if (url.startsWith('http' )) {
                        urlsDelLote.push(url);
                    } else {
                        urlsDelLote.push(`https://www.idealista.com${url}` );
                    }
                }

                console.log(`📦 Lote de ${urlsDelLote.length} URLs preparado. Iniciando procesamiento...`);

                // --- MINI FASE 2: Procesar el lote actual ---
                for (const link of urlsDelLote) {
                    try {
                        console.log(`\n   🔍 Procesando URL: ${link}`);
                        await this.driver.get(link);
                        await this.sleep(this.random(1000, 1800));

                        const tituloCompleto = await this.driver.findElement(By.css(".main-info__title-main")).getText().catch(() => "");
                        const priceText = await this.driver.findElement(By.css(".info-data-price")).getText().catch(() => "");
                        const priceNum = parseInt(priceText.replace(/[^\d]/g, ""), 10) || null;
                        const detailsEls = await this.driver.findElements(By.css(".info-features span"));
                        const details = await Promise.all(detailsEls.map(d => d.getText()));
                        let habitaciones = null, metros = null;
                        details.forEach(d => {
                            if (/hab/i.test(d)) habitaciones = parseInt(d);
                            else if (/m²/i.test(d)) metros = parseInt(d);
                        });
                        const { barrio, ciudad } = this.parseDireccion(tituloCompleto);
                        let descripcion_detallada = "", caracteristicas_detalle = [];
                        try {
                            const p = await this.driver.findElement(By.css(".comment p"));
                            descripcion_detallada = await p.getAttribute("innerHTML");
                        } catch {}
                        try {
                            const bloques = await this.driver.findElements(By.css("#details .details-property-feature-one li, #details .details-property-feature-two li"));
                            caracteristicas_detalle = await Promise.all(bloques.map(li => li.getText()));
                        } catch {}

                        const propiedad = {
                            titulo_completo: tituloCompleto,
                            barrio, ciudad,
                            price_num: priceNum,
                            habitaciones, metros,
                            url: link,
                            descripcion_detallada,
                            caracteristicas_detalle,
                        };
                        
                        todasLasPropiedades.push(propiedad);
                        
                        await this.neo4jService.saveProperty(propiedad);
                        await this.chromaService.storeProperty(propiedad);
                        
                        totalPropiedadesGuardadas++;
                        console.log(`   💾 Propiedad ${totalPropiedadesGuardadas} guardada: ${tituloCompleto}`);

                    } catch (e) {
                        console.log(`   ❌ Error procesando la URL ${link}:`, e.message);
                    }
                }
                console.log(`✅ Lote procesado.`);

                // --- INICIO DE LA MODIFICACIÓN ---
                // 2. Volvemos a la página de resultados antes de buscar el botón "Siguiente"
                console.log("   ↩️ Volviendo a la página de resultados para continuar...");
                await this.driver.get(currentPageUrl);
                await this.driver.wait(until.elementLocated(By.css("div.item-info-container")), 10000); // Esperar a que cargue
                // --- FIN DE LA MODIFICACIÓN ---

                // --- Navegar a la siguiente página para el próximo lote ---
                try {
                    const nextButton = await this.driver.findElement(By.css("li.next:not(.disabled) a"));
                    await this.driver.executeScript("arguments[0].scrollIntoView({block: 'center'});", nextButton);
                    await this.sleep(500);
                    await nextButton.click();
                    await this.sleep(this.random(1500, 2500));
                    page++;
                } catch {
                    console.log("🏁 No hay más páginas de resultados. Finalizando scraping.");
                    keepScraping = false;
                }
            }

        } finally {
            if (this.driver) await this.driver.quit();
            await this.neo4jService.close();
            await this.chromaService.close();
            this.guardarResultados(todasLasPropiedades);
        }
    }

    guardarResultados(propiedades) {
        if (propiedades.length === 0) {
            console.log("⚠️ No se guardaron propiedades, no se generarán archivos de resultados.");
            return;
        }
        fs.writeFileSync("./resultados/Todas_propiedades.json", JSON.stringify(propiedades, null, 2));
        console.log(`\n💾 Guardadas ${propiedades.length} viviendas en ./resultados/Todas_propiedades.json`);
        
        const stats = {
            total: propiedades.length,
            conPrecio: propiedades.filter(p => p.price_num).length,
            promedioPrecio: Math.round(propiedades.reduce((sum, p) => sum + (p.price_num || 0), 0) / propiedades.filter(p => p.price_num).length),
            porCiudad: propiedades.reduce((acc, p) => {
                acc[p.ciudad] = (acc[p.ciudad] || 0) + 1;
                return acc;
            }, {})
        };
        
        fs.writeFileSync("./resultados/estadisticas.json", JSON.stringify(stats, null, 2));
        console.log("📊 Estadísticas guardadas en ./resultados/estadisticas.json");
    }
}

module.exports = { IdealistaScraper };
