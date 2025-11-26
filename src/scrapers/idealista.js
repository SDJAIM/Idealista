const { exec } = require("child_process");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const net = require("net");
const readline = require("readline");
const { Neo4jService } = require('./services/Neo4jService.js');
const { ChromaService } = require('./services/ChromaService.js');

class IdealistaScraper {
    constructor() {
        this.neo4jService = new Neo4jService();
        this.chromaService = new ChromaService();
        this.driver = null;
    }

    sleep = ms => new Promise(r => setTimeout(r, ms))
    random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

    async waitForPort(port = 9222, timeout = 15000) {
        const start = Date.now()
        return new Promise((resolve, reject) => {
            const check = () => {
                const socket = new net.Socket()
                socket
                    .once("connect", () => { socket.destroy(); resolve(true) })
                    .once("error", () => {
                        socket.destroy()
                        if (Date.now() - start > timeout) reject(new Error("⏰ Timeout esperando puerto 9222"))
                        else setTimeout(check, 400)
                    })
                    .connect(port, "127.0.0.1")
            }
            check()
        })
    }

    async humanScroll(driver) {
        for (let i = 0; i < this.random(3, 6); i++) {
            await driver.executeScript(`window.scrollBy(0, ${this.random(500, 900)});`)
            await this.sleep(this.random(700, 1600))
        }
    }

    async aceptarCookies(driver) {
        try {
            const btn = await driver.wait(
                until.elementLocated(By.id("didomi-notice-agree-button")),
                5000
            )
            await driver.executeScript("arguments[0].scrollIntoView()", btn)
            await this.sleep(400)
            await btn.click()
        } catch { }
    }

    parseDireccion(texto) {
        if (!texto) return { calle: "", barrio: "", ciudad: "" }
        let clean = texto.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim()
        const idx = clean.toLowerCase().indexOf(" en ")
        if (idx !== -1) clean = clean.substring(idx + 4).trim()
        const partes = clean.split(/,| - /).map(s => s.trim()).filter(Boolean)
        let calle = "", barrio = "", ciudad = ""
        if (partes.length === 1) ciudad = partes[0]
        if (partes.length === 2) { barrio = partes[0]; ciudad = partes[1] }
        if (partes.length >= 3) {
            calle = partes[0]
            barrio = partes[1]
            ciudad = partes.slice(2).join(", ")
        }
        const cap = s => s ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : ""
        return { calle: cap(calle), barrio: cap(barrio), ciudad: cap(ciudad) }
    }

    async extraerDetalles(driver, url) {
        await driver.get(url)
        await this.sleep(1500)
        let descripcion_detallada = ""
        try {
            const p = await driver.findElement(By.css(".comment p"))
            descripcion_detallada = (await p.getAttribute("innerHTML"))
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/?p>/gi, "")
                .trim()
        } catch { }
        const caracteristicas = []
        try {
            const bloques = await driver.findElements(By.css(
                "#details .details-property-feature-one li, #details .details-property-feature-two li"
            ))
            for (const li of bloques) {
                const txt = (await li.getText()).trim()
                if (txt.length > 1) caracteristicas.push(txt)
            }
        } catch { }
        let energetico = "";
        try {
            const icon = await driver.findElement(By.css("span[class*='icon-energy']"));
            const clase = await icon.getAttribute("class");
            const match = clase.match(/icon-energy-([a-g])/i);
            if (match) energetico = match[1].toUpperCase();
            else energetico = clase;
        } catch { }
        return { descripcion_detallada, caracteristicas, energetico }
    }

    async initBrowser() {
        const profile = "C:\\temp\\ChromeProfile"
        if (!fs.existsSync(profile)) fs.mkdirSync(profile, { recursive: true })
        console.log("🌐 Iniciando Chrome con depuración...")
        exec(`"${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="${profile}" --start-maximized`)
        await this.waitForPort()
        const options = new chrome.Options()
        options.options_["debuggerAddress"] = "127.0.0.1:9222"
        this.driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build()
        return this.driver
    }

    async scrape(urlBase) {
        if (!fs.existsSync("./resultados")) fs.mkdirSync("./resultados")
        const driver = await this.initBrowser()
        const propiedades = []
        let propiedadesGuardadas = 0

        console.log("📍 Abriendo:", urlBase)
        await driver.get(urlBase)
        await this.aceptarCookies(driver)
        await driver.wait(until.elementLocated(By.css("div.item-info-container")), 15000)

        let page = 1
        while (true) {
            console.log(`📄 Página ${page}`)
            await this.humanScroll(driver)
            let items = await driver.findElements(By.css("div.item-info-container"))
            if (!items.length) break

            for (let i = 0; i < items.length; i++) {
                items = await driver.findElements(By.css("div.item-info-container"))
                const item = items[i]
                try {
                    const tituloCompleto = await item.findElement(By.css("a.item-link")).getText().catch(() => "")
                    const priceText = await item.findElement(By.css("span.item-price")).getText().catch(() => "")
                    const priceNum = parseInt(priceText.replace(/[^\d]/g, ""), 10) || null
                    const link = await item.findElement(By.css("a.item-link")).getAttribute("href").catch(() => "")
                    const detailsEls = await item.findElements(By.xpath(".//span[@class='item-detail']"))
                    const details = await Promise.all(detailsEls.map(d => d.getText()))
                    let habitaciones = null, metros = null, extrasArray = []
                    for (const d of details) {
                        if (/hab/i.test(d)) habitaciones = parseInt(d)
                        else if (/m²/i.test(d)) metros = parseInt(d)
                        else extrasArray.push(d)
                    }
                    const extras = extrasArray.join(" | ")
                    const { calle, barrio, ciudad } = this.parseDireccion(tituloCompleto)
                    const garaje = /garaje|parking/i.test(extras) ? "Garaje incluido" : ""
                    const detalles = await this.extraerDetalles(driver, link)
                    const propiedad = {
                        titulo_completo: tituloCompleto,
                        calle, barrio, ciudad,
                        price_num: priceNum,
                        habitaciones, metros, extras, garaje,
                        url: link,
                        descripcion_detallada: detalles.descripcion_detallada,
                        caracteristicas_detalle: detalles.caracteristicas,
                        energetico: detalles.energetico
                    }
                    propiedades.push(propiedad)
                    // 🔄 GUARDAR EN SERVICIOS
                    await this.neo4jService.saveProperty(propiedad)
                    await this.chromaService.storeProperty(propiedad)
                    propiedadesGuardadas++
                    console.log(`💾 Propiedad ${propiedadesGuardadas} guardada`)
                    await driver.navigate().back()
                    await this.sleep(1500)
                } catch (e) {
                    console.log("❌ Error en anuncio:", e.message)
                }
            }
            let next
            try { next = await driver.findElement(By.css("li.next:not(.disabled) a")) } catch { }
            if (!next) break
            await driver.executeScript("arguments[0].scrollIntoView()", next)
            await this.sleep(1000)
            await next.click()
            await this.sleep(1800)
            page++
        }
        await driver.quit()
        await this.neo4jService.close()
        await this.chromaService.close()
        this.guardarResultados(propiedades)
        return propiedades
    }

    guardarResultados(propiedades) {
        fs.writeFileSync("./resultados/Todas_propiedades.json", JSON.stringify(propiedades, null, 2))
        console.log(`💾 Guardadas ${propiedades.length} viviendas en archivo.`)
        
        // Estadísticas
        const stats = {
            total: propiedades.length,
            conPrecio: propiedades.filter(p => p.price_num).length,
            promedioPrecio: Math.round(propiedades.reduce((sum, p) => sum + (p.price_num || 0), 0) / propiedades.filter(p => p.price_num).length),
            porCiudad: propiedades.reduce((acc, p) => {
                acc[p.ciudad] = (acc[p.ciudad] || 0) + 1;
                return acc;
            }, {})
        }
        
        fs.writeFileSync("./resultados/estadisticas.json", JSON.stringify(stats, null, 2))
        console.log("✅ Scraping finalizado.")
    }
}

module.exports = { IdealistaScraper };