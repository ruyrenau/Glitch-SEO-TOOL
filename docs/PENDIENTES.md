# Pendientes de G.SEO

Lista viva de lo que falta. Al terminar algo, se marca con [x] y se anota el commit.

## SEO técnico
- [ ] **Comparar dos crawls**: URLs nuevas y eliminadas, títulos, canonicals y redirecciones que cambiaron (antes y después de un deploy o una migración).
- [ ] **Asistente de migraciones**: subir un mapa de URLs viejas → nuevas y revisar que cada 301 llegue bien, cadenas y bucles (el rescate de 404 ya está en Arquitectura).
- [ ] **Auditoría de hreflang a fondo**: enlaces de regreso, códigos de idioma válidos, destinos indexables.
- [ ] **Robots.txt y sitemaps**: probar una URL contra robots.txt; cruzar sitemap contra lo indexable.
- [ ] **Presupuesto de rastreo**: cruzar logs + crawl + GSC.

## IA (AEO y GEO)
- [ ] **Bots de IA en los logs**: cuánto visitan GPTBot, ClaudeBot, PerplexityBot, Google-Extended; qué páginas leen.
- [ ] **Automatizar Visibilidad en IA**: consultar ChatGPT, Gemini, Claude y Perplexity con las claves de Configuración y llenar la matriz sola cada semana.
- [ ] **Cuota frente a competidores**: qué dominios citan las IAs en tus preguntas y con qué frecuencia.
- [ ] **Consenso de marca y entidades off-page (co-citaciones)**: buscar menciones de la marca en fuentes semilla (Reddit, Quora, Wikipedia, medios, directorios) y comparar el contexto con lo que dice el sitio.
  - Necesita: clave de SerpAPI (ya está en Configuración) para buscar menciones y clave de Anthropic para que Claude compare el contexto. Reddit y algunos medios bloquean bots: a veces solo se lee el fragmento de Google. Cada análisis cuesta centavos de dólar y se lanza con un botón.
- [ ] **Optimizador de "Information Gain"**: comparar la página con las fuentes que citan Perplexity o AI Overviews y decir qué dato único, tabla o estadística agregar.
  - Necesita: clave de Perplexity (agregarla en Configuración) para obtener sus citas, SerpAPI para AI Overviews y Anthropic para que Claude compare los textos. Solo sugiere; no escribe ni publica nada. Cada análisis cuesta centavos de dólar y se lanza con un botón.

## Plataforma
- [ ] **Alojar G.SEO en un VPS** (Docker, Nginx, HTTPS, PostgreSQL, respaldos; verificación de la app de Google para usuarios externos).
- [ ] **Plugin de WordPress "G.SEO Connector"**: etapa 1 (metas, canonical, robots, OG, sitemaps, redirecciones, llms.txt, bot blocker, importador de Yoast/Rank Math), etapa 2 (panel en el editor con análisis y sugerencias con IA), etapa 3 (migas de pan, bloques FAQ/HowTo, contenido pilar, edición masiva).
- [ ] Enviar a Slack/Teams las explicaciones de SERP (hoy solo en pantalla y en "En declive").

## Google Analytics (GA4), fase 2
- [ ] Columnas de GA4 en el Explorador.
- [ ] Ordenar "En declive" y "Listo para IA" por conversiones.
- [ ] Importación diaria en Monitoreo y avisos si caen las conversiones.
- [ ] Sección de GA4 en los Reportes para clientes.

## Hecho recientemente
- [x] Agentes de IA: navegación de agentes con Chrome (controles, etiquetas, ventanas, captcha, precios, tareas) y catálogo para agentes en WordPress (agent.json, catálogo, servidor MCP de solo lectura, plugin glitch-agents.php)
- [x] Registro solo con tickets de la cuenta maestra; Administración con tickets, interruptor de registro, espacios por cuenta, usuarios y espacios de la instancia (3a850e3)
- [x] Cuentas y colaboradores: registro con espacio propio y límites, varios espacios por persona, invitaciones por correo con rol, quitar miembros, recuperar contraseña por correo, panel de administración de la instancia (0ea036e)
- [x] Autoridad y SERP: inspector de backlinks desde CSV (vivos, perdidos, rel, 404 a rescatar → 301, sospechosos, disavow) y seguimiento semanal de SERP e IA con SerpAPI (bloques, AI Overview, explicación de caídas) (622cdfd)
- [x] Entidades y E-E-A-T (organización, autores, Wikidata about/mentions, grafo JSON-LD conectado publicable en WordPress, auditoría) y Consolidación asistida (borrador con Claude o manual, WordPress + 301, revertir) (5803483)
- [x] Arquitectura: Link Score, huérfanas y profundidad; sugerencias de enlaces insertables en WordPress; mapa de 301 (.htaccess, Nginx, CSV, plugin Redirection); auditoría de renderizado lado a lado (3160adc)
- [x] Simulador de RAG ("Vista de bot de IA" en el Explorador) y generador/validador de llms.txt y llms-full.txt (en Listo para IA) (110ede7)
- [x] Avisos de Monitoreo a Slack/Teams/Discord/webhook y Reportes para clientes (c09d423)
- [x] Listo para IA y canibalización completa (b317bfb)
- [x] Análisis de contenido: duplicados, poco texto, en declive, temas de keywords (7f11a64)
- [x] Manual e Inicio guiado actualizados (adebea7)
- [x] Google Analytics 4: conexión, orgánico por página, tráfico desde IAs, canales (f8f409c, f96d55a)
