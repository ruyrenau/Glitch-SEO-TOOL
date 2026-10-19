# Pendientes de G.SEO

Lista viva de lo que falta. Al terminar algo, se marca con [x] y se anota el commit.

## SEO técnico
- [ ] **Comparar dos crawls**: URLs nuevas y eliminadas, títulos, canonicals y redirecciones que cambiaron (antes y después de un deploy o una migración).
- [ ] **Asistente de migraciones**: mapa de URLs viejas → nuevas, revisar que cada 301 llegue bien, cadenas y bucles.
- [ ] **Auditoría de hreflang a fondo**: enlaces de regreso, códigos de idioma válidos, destinos indexables.
- [ ] **Enlazado interno**: páginas huérfanas, "PageRank interno", sugerencias de enlaces entre páginas del mismo tema.
- [ ] **Robots.txt y sitemaps**: probar una URL contra robots.txt; cruzar sitemap contra lo indexable.
- [ ] **Presupuesto de rastreo**: cruzar logs + crawl + GSC.

## IA (AEO y GEO)
- [ ] **Bots de IA en los logs**: cuánto visitan GPTBot, ClaudeBot, PerplexityBot, Google-Extended; qué páginas leen.
- [ ] **Automatizar Visibilidad en IA**: consultar ChatGPT, Gemini, Claude y Perplexity con las claves de Configuración y llenar la matriz sola cada semana.
- [ ] **Cuota frente a competidores**: qué dominios citan las IAs en tus preguntas y con qué frecuencia.
- [ ] **Generador y validador de llms.txt y llms-full.txt** desde el crawl.
- [ ] **Consenso de marca y entidades off-page (co-citaciones)**: buscar menciones de la marca en fuentes semilla (Reddit, Quora, Wikipedia, medios, directorios) y comparar el contexto con lo que dice el sitio.
- [ ] **Simulador de RAG / "Vista de bot de IA"** en el Explorador: Markdown limpio, fragmentos (chunks), marcar en rojo tablas o datos partidos y contenido que depende de JavaScript.
- [ ] **Optimizador de "Information Gain"**: comparar la página con las fuentes que citan Perplexity o AI Overviews y decir qué dato único, tabla o estadística agregar.

## Google Analytics (GA4), fase 2
- [ ] Columnas de GA4 en el Explorador.
- [ ] Ordenar "En declive" y "Listo para IA" por conversiones.
- [ ] Importación diaria en Monitoreo y avisos si caen las conversiones.
- [ ] Sección de GA4 en los Reportes para clientes.

## Hecho recientemente
- [x] Avisos de Monitoreo a Slack/Teams/Discord/webhook y Reportes para clientes (c09d423)
- [x] Listo para IA y canibalización completa (b317bfb)
- [x] Análisis de contenido: duplicados, poco texto, en declive, temas de keywords (7f11a64)
- [x] Manual e Inicio guiado actualizados (adebea7)
- [x] Google Analytics 4: conexión, orgánico por página, tráfico desde IAs, canales (f8f409c, f96d55a)
