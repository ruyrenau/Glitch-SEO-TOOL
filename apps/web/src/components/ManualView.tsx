'use client';
import type { GoFn } from '@/lib/types';

import React from 'react';
import {
  BookOpen, Users, LayoutDashboard, Globe, FileText, ShieldAlert, AlertTriangle, Bell, Code2, Layers, Send, Gauge, Search, Sparkles, Cpu, History, ArrowRight, Lightbulb, TriangleAlert, ScanSearch, PencilLine, Rocket, Activity, KeyRound, FileBarChart, Bot, FileSearch, BarChart3, Network, BadgeCheck, Trophy, MousePointerClick, Target, FlaskConical
} from 'lucide-react';
import { Badge, Button, Card } from './ui';

interface Section {
  id: string;
  nav?: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  status: 'ready' | 'partial' | 'pending';
  what: string;
  why: string;
  steps?: string[];
  read?: Array<[string, string]>;
  tips?: string[];
  limits?: string[];
}

const SECTIONS: Section[] = [
  {
    id: 'wizard',
    nav: 'wizard',
    icon: Rocket,
    title: 'Inicio guiado',
    status: 'ready',
    what: 'Un asistente de cuatro pasos: escribes la URL del sitio, la herramienta lo recorre, te muestra en palabras simples qué encontró (SEO técnico, contenido y preparación para IA) y te sugiere qué conectar después.',
    why: 'Es la forma más rápida de empezar sin conocer la herramienta.',
    steps: [
      'Escribe la URL de la página principal (o elige un sitio que ya agregaste) y pulsa "Guardar y continuar".',
      'Elige cuántas páginas revisar (500 para empezar) y pulsa "Empezar el crawl". Va a unas 2 páginas por segundo.',
      'Lee "Lo primero que revisaría": cada hallazgo explica por qué importa y te lleva al Explorador.',
      'En "Contenido e IA" verás el puntaje medio "Listo para IA", si tu robots.txt bloquea buscadores con IA, y cuántas páginas están duplicadas o tienen poco texto.',
      'En "Siguientes pasos" marca con ✓ lo que ya está listo: Search Console, Monitoreo y avisos, WordPress, Visibilidad en IA y tu primer reporte.',
      'Abajo, las tarjetas explican cada sección agrupadas por tema: SEO técnico, Contenido, Google, IA, y Seguimiento y clientes.'
    ],
    tips: ['Si no tienes sitios, la app abre aquí automáticamente.']
  },
  {
    id: 'overview',
    nav: 'overview',
    icon: LayoutDashboard,
    title: 'Overview',
    status: 'ready',
    what: 'El tablero de todo: arriba, clics de Google, sesiones, issues críticos y alertas; abajo, una tarjeta por módulo con su resultado clave (Search Console, Analytics, crawl, Core Web Vitals, SERP y backlinks, brechas, visibilidad en IA, Listo para IA, agentes, entidades, experimentos, WordPress, logs y monitoreo).',
    why: 'Es el punto de partida del día: te dice en un vistazo cómo va el sitio, si algo se rompió y qué módulos te falta usar.',
    steps: [
      'Elige el sitio en "Sitio activo" (barra lateral).',
      'El menú está ordenado por secciones (Datos y conexiones, SEO técnico, Contenido, IA, Competencia y resultados, Sistema). Abre o cierra cada una con su título, o todas con "Expandir todo". Se recuerda en tu navegador.',
      'En cada tarjeta, "Ver detalle" te lleva al módulo; si nunca lo usaste, "Empezar" te lleva a configurarlo. Las cifras con % comparan los últimos 28 días con los 28 anteriores.',
      'Si aparece la tarjeta "Alertas abiertas", atiéndela primero: son regresiones detectadas entre crawls.',
      'Usa "Siguientes pasos" para ir a lo que falta: importar logs, cargar el sitemap o ejecutar un crawl.'
    ],
    read: [
      ['Solicitudes en el último log', 'Líneas válidas del último archivo importado y el periodo que cubre.'],
      ['Hits de Googlebot', 'Todas las variantes (smartphone, desktop, imágenes…), según el user agent declarado.'],
      ['Hits de bots de IA', 'GPTBot, ClaudeBot, PerplexityBot, ChatGPT-User y similares.']
    ],
    tips: ['Una raya (—) significa "sin datos todavía", no cero.']
  },
  {
    id: 'sites',
    nav: 'sites',
    icon: Globe,
    title: 'Sitios',
    status: 'ready',
    what: 'Lista de sitios del workspace. Cada sitio tiene su propio historial de logs, crawls, issues, alertas, contenido y conexión de WordPress.',
    why: 'Separa clientes o entornos (producción, staging) para que sus datos nunca se mezclen.',
    steps: [
      'Pulsa "Registrar sitio".',
      'Escribe un nombre y la URL canónica (por ejemplo https://www.ejemplo.com). El sitemap se asume en /sitemap.xml.',
      'Elige el entorno. Si es staging o desarrollo, la auditoría te avisará si el sitio se puede indexar por error.',
      'Pulsa "Seleccionar" para trabajar con ese sitio.'
    ],
    tips: ['"Archivar" oculta el sitio sin borrar datos.']
  },
  {
    id: 'logs',
    nav: 'logs',
    icon: FileText,
    title: 'Logs y sitemap',
    status: 'ready',
    what: 'Analiza los logs de acceso del servidor (Nginx o Apache) y los cruza con el sitemap. Muestra qué rastrean de verdad Googlebot, Bing y los bots de IA, y qué errores encuentran.',
    why: 'Search Console no muestra cada petición de Googlebot; los logs sí. Así ves URLs importantes que nunca se rastrean, errores que solo ven los bots y rastreo desperdiciado en parámetros o redirecciones.',
    steps: [
      'Pide a tu hosting o equipo de sistemas el access log (.log, .txt o .gz). Sirve el formato "combined" de Nginx o Apache, con o sin tiempo de respuesta.',
      'Pulsa "Subir log". El worker lo procesa por streams en segundo plano: puede pesar cientos de MB y verás el avance en líneas.',
      'Carga el sitemap: pega su URL y pulsa "Descargar sitemap", o sube el archivo sitemap.xml.',
      'Revisa el reporte de arriba hacia abajo y exporta a CSV lo que vayas a trabajar.'
    ],
    read: [
      ['Desperdicio potencial', 'Porcentaje de hits de bots a redirecciones, errores o URLs con parámetros. Es una estimación para priorizar, no una medida del "crawl budget".'],
      ['Cobertura sitemap ↔ logs', 'Izquierda: URLs del sitemap que Googlebot no visitó en el periodo del log. Derecha: URLs rastreadas con 200 que no están en el sitemap.'],
      ['Verificación de crawlers por DNS', 'Para cada buscador: visitas verificadas (la IP pertenece de verdad a Google, Bing…) y falsas (alguien usa su user agent). Las falsas no son rastreo real.'],
      ['Visitas referidas por asistentes de IA', 'Personas que llegaron desde ChatGPT, Perplexity, Claude, Gemini o Copilot (por el referer).'],
      ['Tiempo de respuesta p50/p90/p99', 'Solo si el log incluye $request_time. Son límites superiores por rango, no valores exactos.']
    ],
    tips: [
      'Las IP nunca se guardan (se hashean) y los parámetros sensibles como token, email o password se borran antes de guardar.',
      'Si subes el mismo archivo dos veces, la herramienta lo detecta y te pregunta si quieres reemplazarlo.'
    ],
    limits: ['Googlebot, Bingbot, Applebot, YandexBot y Baiduspider se verifican por DNS; los bots de IA no publican ese método y se muestran solo como declarados.']
  },
  {
    id: 'crawler',
    nav: 'crawler',
    icon: ShieldAlert,
    title: 'Crawl y auditoría',
    status: 'ready',
    what: 'Rastrea el sitio como lo haría un buscador, guarda los datos SEO de cada página, revisa sus archivos (CSS, JS, imágenes, PDF) y enlaces externos, y compara cada crawl con el anterior. Opcionalmente ejecuta JavaScript.',
    why: 'Detecta problemas técnicos antes de que afecten la indexación, y después de cada deploy te dice exactamente qué cambió.',
    steps: [
      'Ajusta los límites: máximo de URLs (hasta 100,000), profundidad, concurrencia y solicitudes por segundo. Para sitios en producción, empieza con 1 o 2 solicitudes por segundo. A 20 solicitudes por segundo, 100,000 páginas tardan cerca de hora y media.',
      'Deja marcado "Respetar robots.txt" y "Usar URLs del sitemap como semillas".',
      'Si el sitio está hecho con React, Vue, Angular u otro framework que arma la página en el navegador, marca "Ejecutar JavaScript". Cada página se abre en Chrome o Edge sin ventana; es varias veces más lento.',
      'Si quieres excluir secciones, escribe una expresión regular por línea (por ejemplo ^/tag/).',
      'En "Límites avanzados" puedes limitar URLs por carpeta, profundidad de carpetas, largo de URL, parámetros en la URL, enlaces a seguir por página, redirecciones y peso de página, o quedarte en la carpeta inicial. El historial muestra cuántas URLs omitió cada límite.',
      'Con "Lista de URLs" pegas las direcciones exactas que quieres revisar: no se siguen enlaces y no cambian los issues ni las alertas del sitio.',
      'Pulsa "Iniciar crawl". Lo ejecuta el worker: puedes cerrar la página y volver. Puedes cancelarlo; lo rastreado se guarda.',
      'En el historial, pulsa "Ver detalle" para ver los cambios respecto al crawl anterior y la tabla de páginas.'
    ],
    read: [
      ['Indexable', '"sí" si responde 200, no tiene noindex, no está bloqueada y su canonical apunta a sí misma. Si no, se indica el motivo.'],
      ['Enlaces entrantes', 'Cuántas páginas rastreadas enlazan a esta. 0 en una página del sitemap = posible huérfana.'],
      ['Comparar crawls (antes y después)', 'Abajo del crawl elegido. Por defecto compara con el anterior; en "Comparar contra" eliges cualquier otro (por ejemplo, el de antes de un deploy o una migración). Muestra páginas nuevas y desaparecidas, títulos, metas, H1, canonicals, noindex, estados HTTP y redirecciones nuevas, quitadas o con otro destino. En rojo, posibles problemas; en verde, mejoras. Busca por URL y exporta todo a CSV.']
    ],
    tips: [
      'Logout, carrito, checkout, wp-admin y búsquedas internas nunca se solicitan.',
      'Cada sitio conserva el detalle completo (código fuente, enlaces y archivos) de sus 3 crawls más recientes. Los anteriores conservan títulos, estados, indexabilidad e issues, y siguen sirviendo para comparar.',
      'Solo se rastrea el mismo dominio. Las direcciones privadas están bloqueadas por seguridad.'
    ],
    limits: ['Sin "Ejecutar JavaScript" no ve el contenido que se genera en el navegador.', 'Ejecutar JavaScript necesita Chrome, Chromium o Edge instalado en el servidor.', 'Un solo crawl a la vez por sitio.']
  },
  {
    id: 'monitor',
    nav: 'monitor',
    icon: Activity,
    title: 'Monitoreo',
    status: 'ready',
    what: 'Activa, si quieres, el crawl, la importación de Search Console y la medición de Core Web Vitals automáticos, y muestra en una sola pantalla cómo evoluciona el sitio con un análisis de lo que cambió.',
    why: 'Enterarte de una caída de tráfico, de páginas que dejaron de indexarse o de una página que se volvió lenta sin tener que revisar cada sección.',
    steps: [
      'Todo empieza apagado. Activa lo que quieras: crawl (semanal o diario), Search Console (diario) y Core Web Vitals (semanal o diario, sobre las páginas con más clics o las que elijas).',
      'Pulsa "Guardar". Verás cuándo es la próxima ejecución. "Ejecutar ahora lo activo" lo corre en ese momento.',
      'En "Análisis de cambios" revisa lo marcado como Atención y Revisar. Cada punto dice qué cambió, cuánto, qué pasó en las mismas fechas y tiene un botón al detalle.',
      'En "Evolución" pasa el mouse por las gráficas: las líneas rojas son alertas y las verdes, cambios SEO aplicados.',
      'Avisos: en "Avisos a Slack, Teams, Discord o webhook" pega la URL del webhook de tu canal, elige si avisar solo de lo grave o también de lo que hay que revisar, y pulsa "Enviar prueba". Después de cada crawl, importación o medición automática te llega lo importante, una sola vez.'
    ],
    read: [
      ['Variación normal', 'Search Console sube y baja cada semana. Solo se marca un cambio si es mayor que la variación habitual del sitio (al menos 15 %).'],
      ['Al mismo tiempo', 'Alertas y cambios SEO de esas fechas. Es contexto para investigar, no una causa comprobada.'],
      ['Crawl parcial', 'Si un crawl tuvo límites, no se comparan sus páginas indexables con el anterior.']
    ],
    limits: ['Lo programado solo corre mientras la herramienta está encendida; si estaba apagada, se ejecuta al volver a abrirla.', 'El análisis usa reglas fijas, no inteligencia artificial.']
  },
  {
    id: 'explorer',
    nav: 'explorer',
    icon: ScanSearch,
    title: 'Explorador SEO',
    status: 'ready',
    what: 'Una vista tipo Screaming Frog sobre un crawl: pestañas por elemento (títulos, meta description, H1, H2, imágenes, canonicals, directivas, hreflang, datos estructurados, Open Graph, enlaces, paginación), recursos y archivos, y enlaces externos.',
    why: 'Revisar URL por URL qué tiene cada página y encontrar rápido los casos con problemas, sin salir de la herramienta. Desde el detalle puedes proponer correcciones en WordPress.',
    steps: [
      'Elige el crawl arriba. Se usan los datos guardados; no se vuelve a descargar nada.',
      'Elige una pestaña y un filtro (por ejemplo Títulos → Más de 60 caracteres). El resumen de la derecha muestra cuántas URLs hay en cada filtro; haz clic para ir directo.',
      'Ajusta la tabla: arrastra el borde de un encabezado para cambiar el ancho (doble clic lo restablece), elige qué campos ver en "Columnas" y usa "Ajustar texto" para leer títulos completos.',
      'Haz clic en una URL para ver su detalle: enlaces entrantes y salientes, imágenes, vista en Google, vista de bot de IA, código fuente, cabeceras e issues.',
      'Exporta a CSV la pestaña y el filtro actuales.',
      'Arriba cambia entre Tabla, Estructura y Búsqueda personalizada.'
    ],
    read: [
      ['Vista de bot de IA', 'En el detalle de una URL: la página como la ve un sistema de IA que recupera fragmentos (RAG). Muestra el Markdown limpio y los fragmentos con su tamaño en tokens, y marca en rojo las tablas partidas y el contenido o los datos clave que solo aparecen con JavaScript (los bots de IA casi nunca lo ejecutan). Si el crawl ejecutó JavaScript, compara la versión sin JavaScript con la de Google.'],
      ['Recursos y archivos', 'CSS, JavaScript, imágenes, fuentes, PDF y documentos que usan las páginas, con estado, tipo de contenido, peso y en cuántas páginas se usan.'],
      ['Externos', 'Enlaces a otros sitios y recursos de terceros (CDN, scripts), con su código de respuesta. Útil para encontrar enlaces rotos.'],
      ['Tipos de archivo', 'En el resumen: cuántas URLs internas hay de cada tipo, como el panel Overview de Screaming Frog.'],
      ['JavaScript', 'Solo en crawls con "Ejecutar JavaScript". Compara lo que manda el servidor con lo que queda después de JavaScript: contenido, enlaces, título, H1, canonical y meta robots que cambia JavaScript, y errores de JavaScript.'],
      ['Estructura', 'Árbol de carpetas con cuántas URLs hay en cada una, cuántas son indexables y cuántas tienen error, y la distribución de páginas por clics desde la portada.'],
      ['Búsqueda personalizada', 'Busca un texto o expresión en el código o en el texto visible de todas las páginas, o extrae datos con un selector CSS (por ejemplo precios, autores o SKU). Usa el HTML guardado del crawl; no vuelve a rastrear.']
    ],
    tips: ['Los anchos y columnas se recuerdan por pestaña en este navegador.', 'La barra lateral de la app se contrae con el botón junto al título de la sección.'],
    limits: [
      'No ejecuta JavaScript: ve el HTML que entrega el servidor.',
      'Los archivos se comprueban sin descargarlos; si el servidor no envía el tamaño, aparece vacío.',
      'Máximo 2,000 recursos y enlaces externos por crawl.',
      'La extracción no admite XPath; usa selectores CSS o expresiones regulares.'
    ]
  },
  {
    id: 'architecture',
    nav: 'architecture',
    icon: Network,
    title: 'Arquitectura',
    status: 'ready',
    what: 'Tres herramientas sobre el crawl: el enlazado interno (Link Score, huérfanas, profundidad y sugerencias de enlaces que se insertan en WordPress), el mapa de redirecciones 301 para URLs rotas, y la auditoría de renderizado (HTML del servidor contra la página con JavaScript).',
    why: 'Son las tareas que más tiempo consumen en una agencia: repartir la fuerza del sitio hacia las páginas que importan, rescatar el tráfico de URLs rotas y demostrar qué se pierde cuando el contenido depende de JavaScript.',
    steps: [
      'Haz un crawl del sitio (para Renderizado, con "Ejecutar JavaScript").',
      'Enlazado interno: ordena por "Necesitan enlaces" y pulsa "Buscar enlaces" en una página, o abre "Sugerencias de enlaces". Cada sugerencia dice en qué página, con qué frase y hacia dónde enlazar; "Proponer en WordPress" la manda a Cambios SEO para aprobarla, aplicarla, verificarla o revertirla.',
      'Redirecciones 301: revisa el destino propuesto de cada URL rota (puedes cambiarlo), marca las que quieras y descárgalas para .htaccess (Apache), Nginx o CSV, o envíalas a WordPress con el plugin Redirection.',
      'Renderizado JavaScript: mira qué porcentaje del texto y cuántos enlaces solo existen con JavaScript; abre una página para ver el HTML del servidor y la versión renderizada lado a lado. También está en el Explorador → detalle → "HTML vs renderizado".'
    ],
    read: [
      ['Link Score', 'PageRank interno de 0 a 100: cuántos enlaces recibe una página y qué tan fuertes son las páginas que la enlazan.'],
      ['Huérfanas', 'Páginas sin enlaces internos o que solo aparecen en el sitemap o en Search Console.'],
      ['Parecido', 'Similitud del texto de las dos páginas (vectores TF-IDF calculados en tu equipo, sin costo). La frase viene de las búsquedas de Search Console de la página destino, su H1 o su título.'],
      ['Confianza de la 301', 'Alta: la URL rota y la propuesta comparten casi todas las palabras o el contenido anterior se parece mucho. Baja: se propone la carpeta superior o la portada; revísala.'],
      ['Texto que depende de JS', 'Porcentaje de palabras que solo aparecen después de ejecutar JavaScript. Los bots de IA casi nunca lo ejecutan.']
    ],
    limits: ['Insertar enlaces necesita WordPress conectado y que la frase esté en el contenido de la entrada (no en el tema). Solo se enlaza la primera aparición y nunca dentro de títulos o enlaces existentes.', 'Enviar redirecciones a WordPress necesita el plugin gratuito "Redirection".', 'Las sugerencias usan hasta 3,000 páginas del crawl.']
  },
  {
    id: 'seochanges',
    nav: 'seochanges',
    icon: PencilLine,
    title: 'Cambios SEO (editar en WordPress)',
    status: 'ready',
    what: 'Corrige título, slug, título SEO, meta description y alt de imágenes de páginas ya publicadas en WordPress, con propuesta, aprobación, verificación y opción de revertir.',
    why: 'Arreglar lo que encontró el explorador sin entrar a wp-admin página por página, y con registro de quién cambió qué.',
    steps: [
      'Conecta WordPress en la sección WordPress (usuario y contraseña de aplicación).',
      'Para título SEO y meta description: el sitio necesita Yoast SEO o Rank Math, y el archivo docs/wordpress/glitch-seo-meta.php copiado en wp-content/mu-plugins/.',
      'En el Explorador SEO abre una URL y entra a "Editar en WordPress". Escribe el valor nuevo y pulsa "Proponer cambio". WordPress todavía no cambia.',
      'En "Cambios SEO", alguien con permiso lo aprueba y pulsa "Aplicar en WordPress".',
      'Pulsa "Verificar en la página" para comprobar el cambio en la página publicada. Si algo salió mal, "Revertir" regresa al valor anterior.'
    ],
    read: [
      ['Conflicto', 'Alguien cambió ese campo en WordPress después de la propuesta. No se sobrescribe; descártalo y vuelve a proponer.'],
      ['No coincide en la página', 'WordPress ya tiene el valor nuevo, pero la página publicada todavía no lo muestra. Casi siempre es caché: vacíala y verifica de nuevo.']
    ],
    tips: ['Un Editor puede proponer, pero solo un SEO Manager, Admin u Owner puede aprobar y aplicar.', 'Solo se tocan estos campos; nunca el contenido ni el estado de publicación.'],
    limits: [
      'El alt de imágenes se cambia en la biblioteca de medios. Las imágenes ya insertadas en el contenido guardan su alt anterior.',
      'Cambiar el slug cambia la URL. WordPress redirige la URL vieja solo en entradas; en páginas crea una redirección 301.',
      'La portada y los archivos de categoría no se pueden editar por esta vía.'
    ]
  },
  {
    id: 'gsc',
    nav: 'gsc',
    icon: Search,
    title: 'Search Console',
    status: 'ready',
    what: 'Conecta tu cuenta de Google (solo lectura) e importa clics, impresiones, CTR y posición por página y por consulta. Los cruza con el crawl, los logs y el sitemap.',
    why: 'Saber qué páginas traen tráfico real y dónde está la mejora más barata, en lugar de arreglar problemas al azar.',
    steps: [
      'Una sola vez, en Google Cloud: crea un proyecto, habilita "Google Search Console API", configura la pantalla de consentimiento (External, tu correo como usuario de prueba, alcance webmasters.readonly) y crea un cliente OAuth de tipo "Web application" con la URI de redirección http://localhost:4000/api/v1/gsc/oauth/callback.',
      'Pon GSC_CLIENT_ID y GSC_CLIENT_SECRET en el archivo .env y reinicia la app.',
      'En Search Console pulsa "Conectar con Google", elige tu cuenta y acepta.',
      'Elige la propiedad que corresponde al sitio activo y pulsa "Importar ahora".',
      'Revisa Oportunidades, CTR bajo, Canibalización y el Cruce con el crawl. En el Explorador hay una pestaña "Search Console" con las métricas por URL.',
      'Cada importación guarda también los clics de cada página mes a mes (hasta 16 meses). Con eso, Análisis de contenido muestra el contenido en declive y los temas de keywords.'
    ],
    read: [
      ['Impresiones', 'Veces que una página apareció en los resultados de Google, aunque nadie hiciera clic.'],
      ['Posición media', 'Promedio de la posición en la que apareció, ponderado por impresiones. 1 es el primer resultado.'],
      ['Oportunidades', 'Consultas en posición 4 a 15 con al menos 50 impresiones: subirlas a la primera página o al top 3 multiplica los clics.'],
      ['CTR bajo', 'Páginas en buena posición que casi nadie elige: mejora el título y la meta description.'],
      ['Canibalización', 'Varias páginas tuyas compiten por la misma búsqueda (se juntan variantes con y sin acentos). Gravedad alta: dos páginas se reparten la demanda cerca una de otra. Para cada caso propone la página principal y qué hacer con las demás (fusionar y redirigir, diferenciar o revisar su canonical). "Pares de páginas" muestra las que compiten en varias búsquedas.']
    ],
    tips: ['Con la importación diaria activada en Monitoreo, los datos se actualizan solos cada mañana.', 'El token de Google se guarda cifrado. Desconectar revoca el permiso en Google.', 'Los datos de Search Console también alimentan Listo para IA (prioridad por impresiones), Análisis de contenido y los Reportes.'],
    limits: [
      'Google publica los datos con unos 2 días de retraso y guarda 16 meses.',
      'Se importan hasta 100,000 filas por tipo; en sitios muy grandes las consultas con menos impresiones quedan fuera.',
      'Mientras la app de Google esté en modo de prueba, el permiso caduca a los 7 días y hay que reconectar.'
    ]
  },
  {
    id: 'issues',
    nav: 'issues',
    icon: AlertTriangle,
    title: 'Issues técnicos',
    status: 'ready',
    what: 'Lista de problemas detectados en el último crawl (39 reglas): errores 4xx/5xx, redirecciones, canonicals, noindex, sitemap, títulos, descripciones, H1, contenido duplicado o escaso, hreflang, imágenes sin alt, JSON-LD y más.',
    why: 'Convierte el crawl en una lista de trabajo ordenada, con evidencia por URL y una recomendación concreta.',
    steps: [
      'Filtra por estado (activos, resueltos, ignorados) o severidad.',
      'Abre un issue para ver la descripción, la recomendación, las URLs afectadas y la evidencia.',
      'Cambia el estado: "En progreso" cuando alguien lo trabaja, "Ignorado" si es intencional.',
      'Vuelve a rastrear: lo que se arregló se marca como resuelto solo.'
    ],
    read: [
      ['Orden', 'Primero por severidad (crítico, alto, medio, bajo, info) y luego por prioridad.'],
      ['Prioridad', 'Impacto × confianza × URLs afectadas × peso de la severidad ÷ (esfuerzo × riesgo). Sirve para ordenar trabajo, no estima tráfico perdido.']
    ],
    tips: ['Un issue marcado como "Ignorado" sigue ignorado en los siguientes crawls.']
  },
  {
    id: 'alerts',
    nav: 'alerts',
    icon: Bell,
    title: 'Alertas',
    status: 'ready',
    what: 'Avisos automáticos cuando un crawl encuentra regresiones respecto al anterior: noindex añadido, páginas rotas, canonical cambiado, nuevos bloqueos de robots.txt, contenido reducido a menos de la mitad, schema eliminado, cambios masivos de títulos o cambios en robots.txt.',
    why: 'Atrapa errores de deploy (por ejemplo un noindex de staging que llegó a producción) antes de que Google los procese.',
    steps: [
      'Ejecuta un crawl después de cada deploy importante. Las alertas aparecen a partir del segundo crawl.',
      'Revisa las URLs y los detalles de cada alerta.',
      'Pulsa "Marcar como revisada" cuando la hayas atendido.'
    ],
    tips: ['Si configuras ALERT_WEBHOOK_URL en el servidor, las alertas también llegan a ese webhook o a un canal de Slack.']
  },
  {
    id: 'vitals',
    nav: 'vitals',
    icon: Gauge,
    title: 'Core Web Vitals',
    status: 'ready',
    what: 'Mide la velocidad y estabilidad de las páginas en móvil y escritorio. Muestra por separado los datos de usuarios reales (CrUX, cuando hay) y una prueba de laboratorio (Lighthouse), con lo que conviene corregir.',
    why: 'Las Core Web Vitals forman parte de la experiencia de página que evalúa Google, y los diagnósticos dicen qué cambio técnico tiene más efecto.',
    steps: [
      'Elige las URLs: la portada y las páginas más enlazadas del último crawl ya vienen sugeridas; puedes añadir otras del mismo sitio.',
      'Elige Móvil, Escritorio o ambos y pulsa "Medir". El worker mide una URL a la vez (unos 20 segundos cada una).',
      'Cada URL muestra un reporte tipo GTmetrix: captura, nota de la A a la F (70 % rendimiento + 30 % estructura), LCP, TBT y CLS, principales problemas filtrables por métrica, peso y peticiones por tipo de archivo, cascada de peticiones y la secuencia visual de carga.',
      'Abre un problema para ver qué archivos lo causan y cuánto se ahorraría. En el historial, haz clic en una medición anterior para ver su reporte.',
      'Abajo, en "Usuarios reales (CrUX)", están los datos de campo cuando hay clave de PageSpeed.',
      'Al final, "Datos reales de usuarios (CrUX)" muestra la tendencia semana a semana (unos 6–9 meses) del sitio completo y de la página que elijas, en celular o escritorio. Necesita habilitar la "Chrome UX Report API" en tu proyecto de Google Cloud (misma clave de PageSpeed).'
    ],
    read: [
      ['Tendencia CrUX', 'Cada punto es el percentil 75 de los 28 días anteriores. Las líneas punteadas marcan los límites de bueno y malo. "Aprueba Core Web Vitals" = LCP, INP y CLS en bueno. Un cambio tarda hasta 4 semanas en verse completo.'],
      ['Usuarios reales (CrUX)', 'Percentil 75 de visitas reales de Chrome en los últimos 28 días. Es lo que cuenta para Google. Solo con PSI_API_KEY y si la página tiene tráfico suficiente; si no, se usan los datos de todo el sitio y se indica.'],
      ['Laboratorio (simulado)', 'Una carga con red y CPU limitadas en un navegador. Sirve para diagnosticar y comparar cambios; no representa a tus usuarios.'],
      ['Umbrales', 'LCP ≤ 2.5 s, INP ≤ 200 ms y CLS ≤ 0.1 son "Bueno". INP solo existe con usuarios reales; en laboratorio se usa TBT como aproximación.'],
      ['Datos insuficientes', 'Chrome no tiene visitas suficientes para publicar métricas de esa URL ni del sitio. No es un error.']
    ],
    tips: ['Mide antes y después de un cambio para comparar en el historial.', 'Sin PSI_API_KEY funciona igual, pero solo con datos de laboratorio.'],
    limits: ['Una medición a la vez por sitio, hasta 10 URLs.', 'Lighthouse local necesita Chrome, Chromium o Edge instalado en la máquina del worker.']
  },
  {
    id: 'schema',
    nav: 'schema',
    icon: Code2,
    title: 'Schema.org (datos estructurados)',
    status: 'ready',
    what: 'Genera, valida y produce en masa el JSON-LD de cualquier página de cualquier rubro: organización, negocio local (54 giros), producto, servicio, artículo, evento, curso, vacante, receta, FAQ, paso a paso, migas de pan, video, software, persona y cualquier otro tipo de schema.org.',
    why: 'El schema ayuda a Google a mostrar resultados enriquecidos (precio, estrellas, eventos, empleos, recetas) y a las IAs a entender y citar la página. Un error de formato hace que se ignore completo.',
    steps: [
      'Generador: pega la URL de la página y pulsa "Rellenar desde la página"; la herramienta propone los schemas con lo que la página ya dice. O elige el tipo y el giro y llena el formulario.',
      'Los campos con * los exige Google; los marcados "recomendado" mejoran el resultado. "Más campos" muestra el resto y "Propiedades adicionales" acepta cualquier propiedad de schema.org.',
      'La validación en vivo dice qué falta y qué formato está mal. Cuando diga "Listo para Google", copia la etiqueta y pégala en el <head> de la página.',
      'Guarda la configuración como plantilla para reutilizarla.',
      'Masivo (CSV): usa {{columna}} en los campos de una plantilla y pega un CSV; se genera un schema por fila y se descarga en CSV o JSONL.',
      'Validador: pega cualquier JSON-LD o lee el que ya tiene una URL.'
    ],
    read: [
      ['Duraciones', 'Escribe "1 h 30 min" o "45 min"; se convierte solo al formato de Google (PT1H30M).'],
      ['Varios schemas', 'Si la página lleva más de uno (por ejemplo Organización + Sitio web), se combinan en una sola etiqueta con @graph.']
    ],
    limits: ['Cumplir la validación no garantiza que Google muestre el resultado enriquecido: el contenido debe coincidir con lo visible en la página.', 'Todavía no se envía a WordPress automáticamente; copia la etiqueta o usa el CSV.']
  },
  {
    id: 'entities',
    nav: 'entities',
    icon: BadgeCheck,
    title: 'Entidades y E-E-A-T',
    status: 'ready',
    what: 'Un "perfil de entidad" del sitio: la organización, sus autores y de qué trata cada página (con entidades de Wikidata y Wikipedia), convertidos en un solo grafo de Schema.org conectado por @id. Incluye una auditoría de E-E-A-T (experiencia, autoridad y confianza).',
    why: 'Google y los motores de IA confían más en contenido con autoría verificable y una organización identificable. Conectar todo en un grafo amarra el SEO semántico con la visibilidad en IA.',
    steps: [
      'Organización: nombre, tipo, logo, descripción, contacto y perfiles oficiales (sameAs: LinkedIn, Facebook, Google Business, Wikidata…). Solo administradores.',
      'Autores: agrega a quienes escriben o revisan, con biografía de su experiencia, foto, página de autor y perfiles verificables.',
      'Páginas: abre una página, elige su tipo, su autor y su fecha, y pulsa "Sugerir entidades de Wikidata" para marcar de qué trata (about) y qué menciona (mentions). Revisa la descripción de cada entidad: hay homónimos.',
      'Copia el JSON-LD o pulsa "Proponer en WordPress": se crea un cambio en Cambios SEO para aprobar, aplicar, verificar y revertir (necesita la versión 2 del mu-plugin docs/wordpress/glitch-seo-meta.php).',
      'Auditoría E-E-A-T: revisa qué falta y vuelve después de cada cambio.'
    ],
    read: [
      ['@id', 'Un identificador fijo por entidad (por ejemplo https://tusitio.com/#organization). Los artículos apuntan a su autor y a la organización por @id, en lugar de repetir los datos.'],
      ['about y mentions', 'De qué trata la página y qué nombra, enlazado a Wikidata y Wikipedia: así no hay duda de a qué "Python" o a qué "Puebla" te refieres.'],
      ['Puntaje E-E-A-T', 'Suma ponderada de las revisiones: organización, autores, artículos con autor y fecha, y páginas de confianza (nosotros, contacto, privacidad).']
    ],
    limits: ['La búsqueda en Wikidata necesita conexión a internet.', 'Si el tema o el plugin SEO ya imprimen schema de Organization o Article, desactiva el suyo para no duplicar entidades.', 'La auditoría detecta el autor y la fecha por el HTML; si tu tema los muestra de forma poco común, puede no verlos.']
  },
  {
    id: 'programmatic',
    nav: 'programmatic',
    icon: Layers,
    title: 'Contenido programático',
    status: 'ready',
    what: 'Genera páginas a partir de un CSV y una plantilla, revisa la calidad de cada una y exige aprobación humana antes de enviarlas a WordPress.',
    why: 'Permite crear muchas páginas útiles (por ciudad, servicio o producto) sin publicar contenido duplicado o vacío, que es el tipo de páginas que los buscadores penalizan.',
    steps: [
      'Pulsa "Importar CSV". La primera fila deben ser los nombres de columna. Cada columna se convierte en una variable, por ejemplo {{ciudad}}.',
      'Revisa los avisos: filas duplicadas y celdas vacías (las páginas que usen una celda vacía saldrán bloqueadas).',
      'Abre "Nueva plantilla para este dataset" y escribe título, meta description, slug y cuerpo HTML. Usa los botones de variables para insertarlas.',
      'Pulsa "Generar páginas". Verás cuántas quedaron listas, cuántas requieren revisión y cuántas se bloquearon, y por qué.',
      'Escribe tu nombre en "Revisor", revisa las páginas y apruébalas una por una o en lote.',
      'Con WordPress conectado: "Dry run" muestra lo que se enviaría sin enviar nada; "Enviar como borrador" crea el borrador.'
    ],
    read: [
      ['Bloqueada', 'No se puede aprobar: faltan datos, quedó {{ }} sin reemplazar, es casi un duplicado de otra página, o la fila no aporta contenido propio.'],
      ['Requiere revisión', 'Se puede aprobar, pero hay algo que confirmar: títulos o metas fuera de rango, poco contenido propio, afirmaciones como "garantizado" o "#1".'],
      ['Similitud', 'Se mide sobre el texto que aporta cada fila, sin contar el texto fijo de la plantilla. Así las páginas de una misma plantilla no cuentan como duplicadas entre sí.']
    ],
    tips: [
      'Los valores del CSV se escapan al insertarse en HTML: una celda con código no se ejecuta.',
      'Las plantillas no aceptan scripts ni atributos como onclick.',
      'Para contenido de calidad, incluye columnas con información realmente distinta por fila (datos locales, descripciones, precios).'
    ],
    limits: ['Hasta 500 filas por ejecución (vuelve a ejecutar para el resto).']
  },
  {
    id: 'wordpress',
    nav: 'wordpress',
    icon: Send,
    title: 'WordPress',
    status: 'ready',
    what: 'Conecta el sitio con WordPress mediante su API REST y una contraseña de aplicación, para enviar páginas aprobadas como borradores. Aquí también descargas el plugin G.SEO – SEO, que le da al sitio su propio SEO y deja que G.SEO lo controle.',
    why: 'Lleva el contenido aprobado a WordPress sin copiar y pegar, y sin riesgo de publicar algo por accidente.',
    steps: [
      'En WordPress: Usuarios → Perfil → Contraseñas de aplicación. Crea una para un usuario que pueda editar entradas.',
      'Aquí: escribe la URL del sitio (https), el usuario y la contraseña de aplicación, y pulsa "Guardar y probar".',
      'Si dice "Conectado", ya puedes enviar páginas desde "Contenido programático".',
      'Plugin G.SEO – SEO: pulsa "Descargar plugin (.zip)". En WordPress ve a Plugins → Añadir nuevo → Subir plugin, elige el archivo, instala y activa. Revisa Ajustes → G.SEO y aquí pulsa "Comprobar".',
      'Con el plugin activo: Cambios SEO edita sus títulos y metas, Arquitectura y Consolidación crean las 301 en él, Entidades publica su JSON-LD y Listo para IA publica el llms.txt con un clic.',
      'Para probar con una copia local del sitio (http://): agrega su dominio a CRAWL_ALLOW_PRIVATE_HOSTS en el .env de G.SEO local (por ejemplo glitchcreativo.local) y reinicia.'
    ],
    read: [
      ['Solo borradores', 'La herramienta nunca publica ni borra, y no toca entradas que ya no sean borrador.'],
      ['Conflicto', 'Si alguien editó el borrador en WordPress después del último envío, verás qué se perdería y tendrás que confirmar para sobrescribir.'],
      ['Restaurar versión anterior', 'Antes de cada actualización se guarda una copia del borrador remoto; puedes devolverlo a esa versión.'],
      ['Plugin G.SEO – SEO', 'Títulos con plantilla (%title% %sep% %sitename%), meta descripción (automática si falta), canonical, noindex/nofollow por página, Open Graph y X, JSON-LD (Organización y WebSite en la portada, o el grafo de Entidades), sitemap de WordPress sin páginas noindex, robots.txt con bloqueo opcional de bots de entrenamiento de IA, llms.txt, redirecciones 301/302/410 y registro de 404 con botón "Redirigir".'],
      ['En pausa', 'Si el sitio tiene Yoast, Rank Math, All in One SEO, SEOPress o The SEO Framework activos, el plugin no imprime nada en el <head> para no duplicar etiquetas. Redirecciones, llms.txt y 404 sí funcionan.']
    ],
    tips: ['La contraseña se guarda cifrada y nunca se vuelve a mostrar completa.', 'Para probar sin un WordPress propio, ejecuta "pnpm wp:local" en una terminal.'],
    limits: ['El envío de contenido programático crea entradas (posts) en borrador.', 'El plugin todavía no importa los datos de Yoast o Rank Math, ni tiene migas de pan o bloques FAQ (siguientes etapas).', 'Si existe un archivo robots.txt físico en el servidor, WordPress lo sirve tal cual y los ajustes de robots del plugin no se aplican.']
  },
  {
    id: 'users',
    nav: 'users',
    icon: Users,
    title: 'Cuentas, espacios de trabajo y colaboradores',
    status: 'ready',
    what: 'Cada cuenta tiene sus propios espacios de trabajo, y cada espacio tiene sus sitios, sus datos y sus conexiones (Google, WordPress, claves de API). Puedes invitar colaboradores con un rol, y una misma persona puede estar en varios espacios (el tuyo y el de un cliente, por ejemplo).',
    why: 'Separa clientes o equipos sin que sus datos se mezclen, y deja registrado quién hizo cada cosa.',
    steps: [
      'Crear cuenta: solo con un código (ticket) que genera el administrador de la instancia. Con el enlace del ticket el código ya viene escrito; si no, "Crear cuenta" en la pantalla de inicio y pégalo. Recibes tu propio espacio, vacío, con los límites del ticket.',
      'Cambiar de espacio: si trabajas en más de uno, usa "Espacio de trabajo" en la barra lateral. "+ Nuevo espacio…" aparece si el administrador te permite tener más de uno.',
      'Administración (solo la cuenta maestra): genera y retira tickets, activa o desactiva el registro, define cuántos espacios puede tener cada cuenta, ve todas las cuentas y espacios, cambia límites y suspende o desactiva.',
      'Invitar: Usuarios → "Invitar colaboradores", escribe el correo y elige el rol. La persona recibe un enlace válido 7 días; si el servidor no tiene correo configurado, copia el enlace y compártelo tú. Si ya tiene cuenta, entra con ella y el espacio aparece en su selector.',
      'Quitar a alguien: Usuarios → "Quitar del espacio". Su cuenta y sus otros espacios no cambian.',
      'Recuperar la contraseña: "¿Olvidaste tu contraseña?" en el inicio de sesión envía un enlace por correo (válido 1 hora). Puedes entrar con tu usuario o con tu correo.',
      'Mi cuenta: cambia tu nombre, tu correo y tu contraseña, mira tus espacios y sal de uno.'
    ],
    read: [
      ['Owner', 'Todo, incluida la gestión de otros Owners. Cada espacio necesita al menos uno.'],
      ['Admin', 'Sitios, credenciales de WordPress, borrados e invitaciones (excepto Owners).'],
      ['SEO Manager', 'Logs, sitemaps, crawls, issues, alertas, contenido y envíos a WordPress.'],
      ['Editor', 'Datasets, plantillas, generación, revisión y envío de borradores.'],
      ['Viewer', 'Solo lectura.'],
      ['Límites del espacio', 'Las cuentas nuevas tienen un máximo de sitios y de URLs por crawl; lo ves en Usuarios → "Este espacio de trabajo". El administrador de la instancia puede cambiarlos.']
    ],
    tips: [
      'Desactivar una cuenta o restablecer su contraseña solo es posible si la persona trabaja únicamente en tu espacio: si también está en otros, su cuenta es suya y solo puedes quitarla de tu espacio.',
      'Tras 5 intentos fallidos el acceso se bloquea 15 minutos.',
      'La sesión dura 12 horas sin actividad.'
    ],
    limits: ['El envío de correos (invitaciones y recuperación) necesita configurar SMTP_URL y MAIL_FROM en el servidor.']
  },
  {
    id: 'audit',
    nav: 'audit',
    icon: History,
    title: 'Audit log',
    status: 'ready',
    what: 'Registro de todas las acciones: sitios creados, logs importados o borrados, crawls, cambios de estado de issues, aprobaciones y envíos a WordPress.',
    why: 'Permite saber quién hizo qué y cuándo, y reconstruir lo que pasó si algo sale mal.',
    tips: ['Cada evento muestra el usuario que hizo la acción.']
  },
  {
    id: 'automations',
    nav: 'automations',
    icon: Cpu,
    title: 'Jobs y automatizaciones',
    status: 'ready',
    what: 'Las importaciones de logs, los crawls y la limpieza de datos se ejecutan en un proceso aparte (el worker), no en la API. Aquí ves el estado de la cola (Redis) y del worker, y el historial de cada trabajo con su progreso, intentos, resultado y registro.',
    why: 'Los trabajos largos no se pierden si cierras el navegador o se reinicia la API, los errores pasajeros se reintentan solos, y puedes programar crawls para detectar regresiones sin acordarte.',
    steps: [
      'Revisa arriba que Redis diga "Conectado" y el worker "Activo". Si el worker está detenido, los trabajos esperan en cola hasta que arranque.',
      'Abre un trabajo para ver su registro y el error, si lo hubo.',
      'Cancela un trabajo en cola o corriendo; reintenta uno fallido o cancelado.',
      'Para programar crawls: Crawl y auditoría → Crawl programado → elige una frecuencia y guarda.'
    ],
    read: [
      ['En cola', 'Esperando al worker.'],
      ['Reintentando', 'Falló por un error pasajero; se volverá a intentar con una espera creciente.'],
      ['Fallido', 'Agotó sus intentos o tuvo un error que no cambia al reintentar (por ejemplo, un archivo duplicado).'],
      ['Programado / manual', 'Quién lo lanzó: una programación, una persona o el sistema (limpieza diaria).']
    ],
    tips: [
      'Para arrancar todo junto (Redis, API, worker y dashboard) usa: pnpm start:local.',
      'La limpieza diaria (03:30) borra logs de más de 90 días, sesiones expiradas y archivos temporales; cada borrado queda en el audit log.'
    ],
    limits: ['Los crawls programados se ejecutan como máximo una vez por hora por sitio.', 'Una importación de log fallida se reintenta subiendo el archivo otra vez.']
  },
  {
    id: 'ga4',
    nav: 'ga4',
    icon: BarChart3,
    title: 'Google Analytics',
    status: 'ready',
    what: 'Importa de Google Analytics 4 lo que pasa después del clic: sesiones, usuarios, interacción, tiempo, eventos clave e ingresos de cada página de entrada orgánica, las visitas que llegan desde asistentes de IA (ChatGPT, Perplexity, Gemini, Copilot, Claude…) y el reparto por canal.',
    why: 'Search Console dice cuántos clics trae cada página; Analytics dice si esos clics valen: si la gente se queda, convierte o se va. Y muestra si aparecer en las IAs trae visitas reales.',
    steps: [
      'Una sola vez, en Google Cloud (mismo proyecto que Search Console): habilita "Google Analytics Data API" y "Google Analytics Admin API", y en Google Auth Platform → Acceso a datos agrega el permiso analytics.readonly.',
      'En Google Analytics pulsa "Volver a conectar con Google" (o "Conectar con Google") y acepta "Ver tus datos de Google Analytics".',
      'Elige la propiedad de GA4 del sitio activo y pulsa "Guardar".',
      'Elige el periodo y pulsa "Importar ahora".',
      'Revisa las pestañas: Orgánico por página, Desde IAs, Clics sin interacción y Canales. Descarga el CSV si lo necesitas.'
    ],
    read: [
      ['Tasa de interacción', 'Sesiones que duraron más de 10 segundos, vieron 2 o más páginas o tuvieron un evento clave. Debajo de 40 % la página suele no cumplir lo que prometía el resultado.'],
      ['Eventos clave', 'Las conversiones que marcaste en GA4 (formularios, compras, llamadas). La conversión es eventos clave entre sesiones.'],
      ['Desde IAs', 'Sesiones cuyo origen es un asistente de IA. Muchas IAs no pasan el origen, así que es un mínimo: el tráfico real suele ser mayor.'],
      ['Clics sin interacción', 'Páginas que llegan desde Google pero no retienen. Con Search Console conectado se ven también sus clics.']
    ],
    tips: ['Se usa la misma cuenta de Google que en Search Console; no hay que poner claves nuevas en el .env.', 'Las páginas se cruzan con Search Console y con el título del último crawl.'],
    limits: ['GA4 aplica umbrales de privacidad: en páginas con poco tráfico algunos valores pueden faltar o salir en cero.', 'Los datos del día anterior pueden cambiar durante 24 a 48 horas.', 'La importación es manual por ahora; la automática llegará con Monitoreo.']
  },
  {
    id: 'authority',
    nav: 'authority',
    icon: Trophy,
    title: 'Autoridad y SERP',
    status: 'ready',
    what: 'Dos herramientas que miran fuera de tu sitio sin pagar bases de datos de terceros: un inspector de backlinks (subes un CSV y G.SEO revisa cada página que te enlaza) y un seguimiento semanal de la página de resultados de Google de tus keywords (bloques, AI Overviews, posiciones).',
    why: 'Recuperar la autoridad de enlaces que caen en páginas rotas, saber qué enlaces se perdieron, y explicar caídas de clics que no son caídas de ranking ("Google puso un AI Overview y un bloque de Reddit arriba de ti").',
    steps: [
      'Backlinks: exporta tus enlaces (Search Console → Enlaces → Exportar enlaces más recientes, o Ahrefs, Semrush, Moz, Majestic) y súbelos con "Subir CSV de backlinks". La revisión corre en segundo plano, a un ritmo de una página por segundo por sitio.',
      'Revisa "Autoridad para rescatar": son tus URLs rotas que aún reciben enlaces; ya aparecen primero en Arquitectura → Redirecciones 301.',
      'En "Perdidos" ves los enlaces que ya no existen y en "Sospechosos" los que tienen señales de spam; puedes generar un archivo disavow con los dominios que marques.',
      'SERP e IA: guarda la clave de SerpAPI en Configuración, agrega keywords (o "Sugerir desde Temas"), elige país e idioma, activa "Revisar cada semana" y pulsa "Revisar ahora" para la primera foto.',
      'Con Search Console conectado, cada keyword compara sus clics de las últimas 4 semanas con las 4 anteriores y explica la caída si apareció un bloque nuevo. La explicación también aparece en Análisis de contenido → En declive.'
    ],
    read: [
      ['follow / nofollow / sponsored / ugc', 'Cómo marcó el otro sitio el enlace. Los follow transmiten autoridad; los demás son señales más débiles.'],
      ['Sospechosos', 'Reglas simples: extensiones de dominio de spam, temas como casino o farmacia, páginas con cientos de enlaces salientes. Google ignora casi todo el spam por su cuenta; el disavow es solo para casos claros.'],
      ['AI Overview te cita', 'El resumen de IA de Google incluye tu sitio entre sus fuentes.'],
      ['Bloque nuevo', 'Un bloque (AI Overview, foros, videos…) que no estaba hace unas 4 semanas.']
    ],
    limits: ['El inspector solo revisa los enlaces del CSV: no descubre enlaces nuevos por sí mismo.', 'Algunos sitios bloquean bots o piden JavaScript; esos enlaces quedan como "bloqueado" o "la página ya no existe".', 'SerpAPI cobra por búsqueda (100 gratis al mes): cada keyword usa una por semana. La foto es de escritorio, primeros 10 resultados.']
  },
  {
    id: 'geo',
    nav: 'geo',
    icon: Sparkles,
    title: 'Visibilidad en IA',
    status: 'ready',
    what: 'Mide si ChatGPT, Claude, Gemini y la IA de Google mencionan tu marca (Directo) o citan tu sitio (Citación) cuando alguien hace preguntas de cola larga, y cómo cambia semana a semana.',
    why: 'Cada vez más gente pregunta a una IA en lugar de buscar en Google. Saber si te recomiendan, y si subes o bajas, es la nueva posición en buscadores.',
    steps: [
      'En "Preguntas", agrega cada palabra compuesta o pregunta completa con su keyword (grupo), por ejemplo "Políticas Públicas".',
      'Haz la pregunta en cada IA. En "Registrar revisión" elige pregunta, motor y fecha.',
      'Fila Directo: ¿aparece la marca? Si sí, elige la posición (1.er lugar, top 3 o 4+) y pega la respuesta. Fila Citación: ¿cita tu sitio? Igual.',
      'El resultado y la tendencia (Mejoró, Neutral, Empeoró) se calculan solos contra la revisión anterior. Agrega comentarios si hace falta y guarda.',
      'En "Matriz" ves la última revisión de cada pregunta en cada motor, lo que cambió y la evolución semanal. Filtra por keyword o descarga el CSV.',
      'En "Análisis", Claude redacta qué subió, qué bajó, qué competidores aparecen y qué hacer (necesita una clave de Anthropic en Configuración).'
    ],
    read: [
      ['Puntos', 'Directo: 1.er lugar 5, top 3 4, más abajo 3. Citación: 1.er lugar 3, top 3 2, más abajo 1. Máximo 8 por revisión.'],
      ['Evolución', 'Promedio de puntos por revisión en cada semana, para que agregar preguntas no infle el total.']
    ],
    limits: ['Hoy el registro es manual. Las consultas automáticas a cada motor se activarán con las claves de API que agregues en Configuración.', 'Las IAs no responden siempre igual: compara tendencias de varias semanas, no una sola revisión.']
  },
  {
    id: 'contentaudit',
    nav: 'contentaudit',
    icon: FileSearch,
    title: 'Análisis de contenido',
    status: 'ready',
    what: 'Tres análisis de contenido: páginas duplicadas, casi duplicadas o con poco texto (a partir del crawl), páginas que pierden clics mes a mes y tus búsquedas de Search Console agrupadas por tema con la página que debe posicionar cada tema.',
    why: 'El contenido repetido o pobre diluye el sitio, el contenido que envejece pierde tráfico poco a poco, y sin un mapa de temas varias páginas compiten por lo mismo mientras otros temas no tienen página.',
    steps: [
      'Duplicados y poco texto: haz un crawl. Revisa "Duplicados exactos" y "Casi duplicados" (ajusta la similitud mínima). En cada grupo se propone qué página conservar y qué hacer con las demás. En "Poco texto" elige el mínimo de palabras.',
      'En declive: importa Search Console. La primera vez se descargan hasta 16 meses de clics por página; después solo los meses nuevos. Cada página muestra cuánto cayó, su curva mensual y el diagnóstico (perdió posiciones, bajó la demanda o bajó el CTR).',
      'Temas de keywords: con Search Console importado, abre un tema para ver sus búsquedas, la página principal y las páginas que aparecen. Filtra por "Disperso" o "Sin página fuerte" para encontrar trabajo.',
      'Descarga cualquier lista en CSV para el equipo de contenido.',
      'Consolidación: elige un par de páginas que compiten o se repiten, revisa cuál será la ganadora, pide un borrador unificado a Claude (o ármalo a mano con las dos páginas), edítalo, apruébalo y aplícalo: el texto va a la ganadora en WordPress y la otra URL recibe una 301. Se guarda una copia y se puede revertir todo.'
    ],
    read: [
      ['Similitud', 'Se compara solo el texto principal (sin menú, cabecera ni pie) con una huella del texto; 90 % quiere decir que casi todas las frases coinciden.'],
      ['Resuelto', 'La copia ya tiene canonical hacia la principal o ya no es indexable: no compite.'],
      ['De temporada', 'Cayó contra los 3 meses anteriores, pero tiene los mismos clics que hace un año. Requiere 15 meses de historial.'],
      ['Disperso', 'La página principal se lleva menos del 70 % de las impresiones del tema: varias páginas se lo reparten.'],
      ['Sin página fuerte', 'La posición media del tema es peor que 20: conviene crear o ampliar una página dedicada.'],
      ['Consolidación', 'El borrador con IA solo puede usar información de las dos páginas, pero revisa cifras, precios y nombres antes de aprobar. Aplicar necesita WordPress conectado; la 301 se crea con el plugin Redirection o se exporta para .htaccess o Nginx.']
    ],
    limits: ['Los duplicados usan el HTML guardado del crawl (hasta 10,000 páginas) y no detectan textos reescritos con otras palabras.', 'Los temas se arman con reglas de palabras y páginas compartidas, no con IA; revisa los grupos antes de reorganizar el sitio.', 'Search Console solo guarda 16 meses.']
  },
  {
    id: 'aiready',
    nav: 'aiready',
    icon: Bot,
    title: 'Listo para IA',
    status: 'ready',
    what: 'Califica de 0 a 100 qué tan fácil es para ChatGPT, Gemini, Perplexity y los AI Overviews de Google leer cada página, sacar una respuesta y citarla. También revisa qué bots de IA deja entrar tu robots.txt y si tienes llms.txt.',
    why: 'Una página puede posicionar en Google y aun así no aparecer en las respuestas de las IAs. Aquí ves qué le falta a cada una y cómo corregirlo.',
    steps: [
      'Haz un crawl del sitio (si el sitio usa mucho JavaScript, con "Ejecutar JavaScript" para medir qué texto depende de él).',
      'Abre "Listo para IA". Revisa primero "Acceso de los bots de IA": si bloqueas un bot de búsqueda, sus respuestas no te pueden citar.',
      'En "Lo que más falta en el sitio" haz clic en una revisión para ver solo las páginas que fallan en ella.',
      'Ordena por prioridad (con Search Console conectado: páginas con más impresiones y puntaje bajo primero) y abre una página para ver cada revisión con su corrección.',
      'Corrige, vuelve a hacer crawl y compara eligiendo el crawl arriba. Descarga el CSV para pasarlo al equipo de contenido.',
      'En "llms.txt" revisa el archivo que ya tengas publicado (formato y enlaces rotos) o genera uno desde el crawl: escribe un resumen, pulsa "Generar vista previa", descarga llms.txt y llms-full.txt y súbelos a la raíz del sitio.'
    ],
    read: [
      ['Revisiones', 'Respuesta directa al inicio (15), encabezados en forma de pregunta (10), listas o tablas (5), jerarquía de encabezados (5), datos estructurados (15), autor y fecha (10), contenido sin JavaScript (15), profundidad (10), datos concretos (5), fuentes citadas (5) y permitir fragmentos (5).'],
      ['Niveles', 'Excelente 80+, Bien 60–79, Mejorable 40–59, Bajo menos de 40.'],
      ['llms.txt', 'Un mapa en Markdown del sitio para los modelos de lenguaje: H1 con el nombre, un resumen con ">" y secciones H2 con enlaces "- [Título](url): descripción". llms-full.txt incluye el texto completo de las páginas principales. Es opcional y todavía no todos los motores lo leen.'],
      ['Bots de entrenamiento y de búsqueda', 'Bloquear GPTBot, ClaudeBot, CCBot o Google-Extended es decisión de negocio. Bloquear OAI-SearchBot, PerplexityBot, Googlebot o Bingbot te quita de sus respuestas.']
    ],
    limits: ['Son reglas fijas: un puntaje alto ayuda, pero no garantiza que una IA te cite. Mídelo en Visibilidad en IA.', 'Usa el HTML guardado del crawl; los crawls viejos cuyo HTML ya se borró no se pueden calificar.', 'Califica hasta 5,000 páginas por crawl.']
  },
  {
    id: 'agents',
    nav: 'agents',
    icon: MousePointerClick,
    title: 'Agentes de IA',
    status: 'ready',
    what: 'Revisa si un agente de IA (Claude, Operator de OpenAI, Gemini) puede usar tu sitio: encontrar precios, llenar el formulario de contacto y usar el botón principal. Y publica en WordPress un catálogo que los agentes pueden consultar directo: /.well-known/agent.json, un catálogo JSON y un servidor MCP de solo lectura.',
    why: 'Cada vez más gente le pide a un agente "cotízame" o "agenda una cita". El agente no ve el diseño, lee el árbol de accesibilidad: si tus botones son <div>, los campos no tienen etiqueta o un popup tapa la página, se atora y se va con otro.',
    steps: [
      'Abre "Agentes de IA" → "Navegación de agentes". Se sugieren la portada y las páginas de contacto, precios, servicios y tienda del último crawl; ajusta la lista (hasta 15).',
      'Pulsa "Revisar como agente". Chrome abre cada página y revisa controles, etiquetas, ventanas emergentes, captchas, precios y botones de acción.',
      'Mira las 3 tareas (encontrar precios, contactar, actuar) y abre cada página para ver qué falla y cómo arreglarlo.',
      'En "Catálogo para agentes (MCP)" descarga glitch-agents.php y súbelo a wp-content/mu-plugins/ de tu WordPress (una vez).',
      'Llena los datos del negocio y tus servicios o productos con precio ("Agregar los del schema del sitio" toma los que ya tienes en JSON-LD). Guarda.',
      'Pulsa "Publicar en WordPress" y luego "Comprobar en vivo". Con todo en verde, puedes conectar la dirección MCP en Claude o ChatGPT como conector personalizado para probarlo.'
    ],
    read: [
      ['Revisiones', 'Controles semánticos (20), controles con nombre (15), formularios con etiquetas (20), sin ventanas que bloqueen (15), sin captcha (10), oferta legible por máquinas (10) y botón de acción claro (10).'],
      ['Tareas', 'Puede: lo logra sin trabas. Con trabas: lo logra, pero con riesgo de error. No puede: no hay forma clara de hacerlo.'],
      ['MCP', 'Model Context Protocol: un estándar para que los asistentes de IA usen herramientas. El plugin ofrece get_business_info, search_catalog, get_item y how_to_contact. Es de solo lectura y limita 120 consultas por minuto por IP.']
    ],
    limits: ['Todavía no hay un estándar único para agentes; agent.json es un formato propio de G.SEO y MCP es lo más adoptado hoy.', 'La revisión no envía formularios ni compra: revisa que se pueda, no lo hace.', 'Publicar necesita WordPress conectado con un usuario administrador. Si tienes WooCommerce, los productos se agregan solos.']
  },
  {
    id: 'gaps',
    nav: 'gaps',
    icon: Target,
    title: 'Brechas de contenido',
    status: 'ready',
    what: 'Busca tus keywords en Google (SerpAPI) y te dice dónde tus competidores salen en el top 10 y tú no. Agrupa las keywords que Google trata como la misma intención y por cada grupo propone crear una página o mejorar una que ya tienes, con un brief de contenido (con o sin IA).',
    why: 'Es la forma más directa de saber qué contenido te falta para ganarle a tu competencia, con datos reales de Google y no con suposiciones.',
    steps: [
      'Necesitas la clave de SerpAPI en Configuración → Claves de API (cada keyword gasta 1 búsqueda de tu plan).',
      'Escribe los dominios de hasta 5 competidores. Si ya usas el seguimiento de SERP, se sugieren los que más aparecen.',
      'Agrega keywords: escríbelas, o usa los botones para traer las de Search Console donde estás débil (posición > 8) y las que sigues en SERP.',
      'Deja marcado "Agregar búsquedas relacionadas" para descubrir keywords nuevas (usa el presupuesto que sobre). Pulsa "Buscar brechas".',
      'En "Oportunidades de contenido" abre cada grupo: verás las preguntas de Google, las páginas de la competencia que rankean y si ya tienes una página para mejorar.',
      'Pulsa "Brief sin IA" (estructura con preguntas y competidores) o "Brief con IA" (Claude escribe título, meta, estructura H2/H3, qué aportar que la competencia no tenga, schema y enlaces). Copia o descarga el .md para tu redactor.'
    ],
    read: [
      ['No apareces', 'Al menos un competidor está en el top 10 y tú no apareces ni en Search Console (o estás después del 20).'],
      ['Detrás de ellos', 'Apareces, pero por debajo del mejor competidor (o solo en Search Console, entre 10 y 20).'],
      ['Mismo grupo', 'Keywords cuyos top 10 comparten 3 o más resultados: Google las ve como la misma intención, así que van en una sola página.'],
      ['Puntaje', 'Suma de (11 − posición) de cada competidor en el top 10: más competidores y más arriba = más oportunidad.']
    ],
    limits: ['SerpAPI no da la lista de keywords de un competidor (eso requiere herramientas de pago como Ahrefs o Semrush): revisa las keywords que tú le das, más sus búsquedas relacionadas.', 'Los resultados son de escritorio, para el país e idioma configurados en Autoridad y SERP.', 'El brief con IA usa solo lo que hay en los resultados; los datos del negocio aparecen como [DATO DEL CLIENTE].']
  },
  {
    id: 'experiments',
    nav: 'experiments',
    icon: FlaskConical,
    title: 'Experimentos SEO',
    status: 'ready',
    what: 'Anotas "el día X cambié estas páginas" y la herramienta compara los clics, impresiones, CTR y posición de Search Console antes y después, contra un grupo de control. Te dice si funcionó, empeoró o si la diferencia puede ser ruido.',
    why: 'Sin grupo de control no sabes si subiste por tu cambio o porque llegó la temporada alta o una actualización de Google. El control lo descuenta.',
    steps: [
      'Necesitas Search Console conectado con la propiedad del sitio.',
      'Al hacer un cambio (o después, con una fecha pasada) crea un experimento: nombre, fecha, hipótesis y las páginas que cambiaste.',
      'Grupo de control: déjalo vacío para usar el resto del sitio, o pon páginas parecidas que NO cambiaste (es más preciso).',
      'Espera al menos 7 días (mejor 2–4 semanas) y pulsa "Analizar". Puedes actualizar los resultados cuando quieras.',
      'Anota en "Notas" cualquier otra cosa que haya pasado (otro cambio, una campaña) para interpretar bien el resultado.'
    ],
    read: [
      ['Efecto neto', 'Cuánto cambiaron tus páginas descontando lo que cambió el control. +50% = crecieron 50% más que el control.'],
      ['Gráfica', 'Clics promedio de 7 días; el periodo antes del cambio vale 100 para los dos grupos. Si la línea azul se separa hacia arriba después de la línea vertical, el cambio funcionó.'],
      ['Veredicto', 'Funcionó o Empeoró solo si la diferencia es estadísticamente significativa (p < 0.05). Si no, "Sin efecto claro".'],
      ['Posición', 'Negativo es bueno: subiste en Google.']
    ],
    limits: ['Search Console publica con 2–3 días de retraso.', 'Con pocas visitas (menos de ~30 clics en el periodo) no se puede concluir nada: usa páginas con más tráfico o más páginas.', 'Si cambias otras cosas en las mismas páginas durante la ventana, el resultado las mezcla.']
  },
  {
    id: 'reports',
    nav: 'reports',
    icon: FileBarChart,
    title: 'Reportes',
    status: 'ready',
    what: 'Crea un reporte para el cliente con Resumen, Search Console, Evolución, Salud técnica, Core Web Vitals y Visibilidad en IA, para compartir por enlace o descargar en PDF.',
    why: 'Mostrar el avance al cliente sin darle acceso a la herramienta y sin armar el reporte a mano.',
    steps: [
      'Escribe un título, marca las secciones y elige cuándo caduca el enlace.',
      'Pulsa "Crear reporte". Se guarda una foto de los datos de ese momento.',
      'Usa "Copiar enlace" para mandarlo (el cliente no necesita usuario) o "Descargar PDF".',
      '"Retirar" desactiva el enlace al instante. Verás cuántas veces se abrió.'
    ],
    read: [['Foto fija', 'El reporte no cambia aunque cambien los datos después. Para datos nuevos, crea otro reporte.']],
    limits: ['Quien tenga el enlace puede verlo: compártelo solo con el cliente.', 'El PDF necesita Chrome, Chromium o Edge instalado en el servidor.', 'No incluye las respuestas pegadas de IA ni datos internos.']
  },
  {
    id: 'settings',
    nav: 'settings',
    icon: KeyRound,
    title: 'Configuración (claves de API)',
    status: 'ready',
    what: 'Donde un administrador guarda las claves de API de Anthropic, OpenAI, Google AI Studio y SerpAPI.',
    why: 'Anthropic: el análisis de Visibilidad en IA y el borrador con IA de la Consolidación. SerpAPI: el seguimiento de SERP e IA (Autoridad y SERP). OpenAI y Google quedan listas para automatizar las consultas a ChatGPT y Gemini. Se guardan cifradas y solo se muestran sus últimos 4 caracteres.',
    steps: ['Obtén la clave en la página del proveedor, pégala y pulsa "Guardar". Para cambiarla, pega una nueva; para quitarla, pulsa "Quitar".']
  }
];

/** Same order as the side menu. */
const ORDER = ['wizard', 'overview', 'monitor', 'sites', 'logs', 'crawler', 'explorer', 'architecture', 'seochanges', 'issues', 'alerts', 'vitals', 'schema', 'entities', 'programmatic', 'wordpress', 'gsc', 'ga4', 'authority', 'geo', 'contentaudit', 'aiready', 'reports', 'automations', 'audit', 'users', 'settings'];
SECTIONS.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));

const STATUS_BADGE = {
  ready: <Badge tone="good">Disponible</Badge>,
  partial: <Badge tone="warn">Parcial</Badge>,
  pending: <Badge tone="warn">Pendiente</Badge>
};

const PENDING_ICONS = [Sparkles];

export function ManualView({ go }: { go: GoFn }) {
  const jump = (id: string) => document.getElementById(`manual-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-start gap-3">
          <BookOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden />
          <div className="space-y-2 text-sm">
            <h2 className="font-bold text-base">Cómo usar G.SEO</h2>
            <p className="text-slate-600 dark:text-slate-400">
              G.SEO reúne en un solo lugar el SEO técnico (crawl tipo Screaming Frog, logs, velocidad, arquitectura y enlazado interno, redirecciones, schema y entidades),
              los datos reales de Google (Search Console y Google Analytics), backlinks y seguimiento de resultados de Google, el análisis y la consolidación de contenido,
              la preparación y la visibilidad en buscadores con IA (AEO y GEO), la edición en WordPress y los reportes para clientes. Todo se organiza por sitio:
              elige uno en "Sitio activo" y trabaja sección por sección. Si es tu primera vez, empieza por el Inicio guiado.
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              <strong>Flujo recomendado:</strong> Inicio guiado (sitio + primer crawl) → conecta Search Console y Google Analytics → trabaja Issues y el Explorador → revisa Arquitectura (enlazado y 301)
              → Análisis de contenido y Listo para IA → completa Entidades y E-E-A-T → sube tus backlinks y sigue tus keywords en Autoridad y SERP → corrige en WordPress desde Cambios SEO
              → activa Monitoreo con avisos → mide tu Visibilidad en IA cada semana → comparte un Reporte con el cliente.
            </p>
          </div>
        </div>
      </Card>

      <Card title="Contenido">
        <nav aria-label="Índice del manual">
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
            {SECTIONS.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.id}>
                  <button onClick={() => jump(s.id)} className="w-full flex items-center gap-2 p-2 rounded-lg text-left hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                    <span className="text-slate-400 tabular-nums w-5">{i + 1}.</span>
                    <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="font-medium flex-1">{s.title}</span>
                    {s.status !== 'ready' && STATUS_BADGE[s.status]}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </Card>

      {SECTIONS.map((s, i) => {
        const Icon = s.icon;
        return (
          <section key={s.id} id={`manual-${s.id}`} className="scroll-mt-4">
            <Card
              title={
                <span className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  {i + 1}. {s.title} {STATUS_BADGE[s.status]}
                </span>
              }
              actions={
                s.nav && (
                  <Button variant="secondary" onClick={() => go(s.nav!)}>
                    Ir a esta sección <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                  </Button>
                )
              }
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs leading-relaxed">
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-sm mb-1">Qué hace</h3>
                    <p className="text-slate-600 dark:text-slate-300">{s.what}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm mb-1">Para qué sirve</h3>
                    <p className="text-slate-600 dark:text-slate-300">{s.why}</p>
                  </div>
                  {s.id === 'pending' && (
                    <div className="flex gap-3 text-slate-400" aria-hidden>
                      {PENDING_ICONS.map((P, k) => <P key={k} className="w-5 h-5" />)}
                    </div>
                  )}
                  {s.steps && (
                    <div>
                      <h3 className="font-semibold text-sm mb-1">Cómo se usa</h3>
                      <ol className="space-y-1.5">
                        {s.steps.map((step, k) => (
                          <li key={k} className="flex gap-2">
                            <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">{k + 1}</span>
                            <span className="text-slate-600 dark:text-slate-300 pt-0.5">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  {s.read && (
                    <div>
                      <h3 className="font-semibold text-sm mb-1">Cómo leer los resultados</h3>
                      <dl className="space-y-2">
                        {s.read.map(([term, def]) => (
                          <div key={term} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
                            <dt className="font-semibold">{term}</dt>
                            <dd className="text-slate-600 dark:text-slate-400">{def}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                  {s.tips && (
                    <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/20 space-y-1">
                      <h3 className="font-semibold flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" aria-hidden /> Consejos</h3>
                      <ul className="list-disc ml-5 space-y-1 text-slate-600 dark:text-slate-300">{s.tips.map(t => <li key={t}>{t}</li>)}</ul>
                    </div>
                  )}
                  {s.limits && (
                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 space-y-1">
                      <h3 className="font-semibold flex items-center gap-1.5"><TriangleAlert className="w-3.5 h-3.5 text-amber-600" aria-hidden /> Límites actuales</h3>
                      <ul className="list-disc ml-5 space-y-1 text-slate-600 dark:text-slate-300">{s.limits.map(t => <li key={t}>{t}</li>)}</ul>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </section>
        );
      })}

      <Card title="Preguntas frecuentes">
        <dl className="space-y-3 text-xs">
          {[
            ['¿Dónde consigo el log del servidor?', 'En el panel de tu hosting (cPanel, Plesk) suele estar en "Logs" o "Raw Access". En un VPS, en /var/log/nginx/access.log o /var/log/apache2/access.log. Pide al menos una o dos semanas.'],
            ['¿Puedo rastrear cualquier sitio?', 'Sí, sitios públicos. Respeta robots.txt y no supera las solicitudes por segundo que elijas. Rastrea sitios propios o de clientes con permiso.'],
            ['¿Se publica algo en WordPress automáticamente?', 'No. Solo se crean o actualizan borradores, y solo de páginas que una persona aprobó.'],
            ['Dice "No se pudo contactar la API"', 'La API no está corriendo. Desde la carpeta del proyecto ejecuta "pnpm start:local": levanta Redis, la API, el worker y el dashboard juntos.'],
            ['Un crawl o una importación se queda "En cola"', 'El worker no está corriendo. Revisa Jobs y automatizaciones; con "pnpm start:local" arranca solo.'],
            ['Olvidé mi contraseña', 'Usa "¿Olvidaste tu contraseña?" en la pantalla de inicio (necesita correo configurado en el servidor). Si no hay correo, pide a un Owner o Admin que la restablezca desde Usuarios; si eres el único Owner, desde la terminal: GLITCH_USER_PASSWORD=... pnpm cli users:reset-password --username tu-usuario.'],
            ['¿Cómo trabajo con un cliente sin mezclar datos?', 'Crea un espacio de trabajo para él ("+ Nuevo espacio…" en la barra lateral) e invita a su equipo con el rol que corresponda. Sus sitios, conexiones y reportes quedan separados de los tuyos.'],
            ['¿Qué significan los datos marcados DEMO?', 'Son datos sintéticos para probar la herramienta. Pasan por los mismos procesos que los datos reales.'],
            ['¿Cómo le comparto los resultados a un cliente?', 'En Reportes elige las secciones y crea el reporte. Copia el enlace (no necesita usuario) o descarga el PDF. "Retirar" desactiva el enlace al momento.'],
            ['¿Cómo recibo avisos en Slack, Teams o Discord?', 'En Monitoreo, tarjeta "Avisos", pega la URL del webhook de tu canal, guarda y pulsa "Enviar prueba". Después de cada ejecución automática te llega lo importante, una sola vez.'],
            ['"En declive" dice que falta el historial mensual', 'Vuelve a importar Search Console: la importación descarga los clics por mes (hasta 16 meses). Hacen falta al menos 4 meses completos.'],
            ['"Listo para IA" o "Duplicados" no muestran páginas', 'Usan el HTML guardado del crawl. Haz un crawl nuevo: de los crawls viejos solo se guardan los 3 más recientes con HTML.'],
            ['¿Qué diferencia hay entre Listo para IA y Visibilidad en IA?', 'Listo para IA revisa tus páginas (si están preparadas para que una IA las cite). Visibilidad en IA mide el resultado: si de verdad te mencionan o citan.']
          ].map(([q, a]) => (
            <div key={q}>
              <dt className="font-semibold">{q}</dt>
              <dd className="text-slate-600 dark:text-slate-400">{a}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
