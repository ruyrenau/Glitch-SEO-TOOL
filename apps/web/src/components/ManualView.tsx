'use client';

import React from 'react';
import {
  BookOpen, Users, LayoutDashboard, Globe, FileText, ShieldAlert, AlertTriangle, Bell, Code2, Layers, Send, Gauge, Search, Sparkles, Cpu, History, ArrowRight, Lightbulb, TriangleAlert
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
    id: 'overview',
    nav: 'overview',
    icon: LayoutDashboard,
    title: 'Overview',
    status: 'ready',
    what: 'Resumen del sitio activo: tráfico del último log, actividad de Googlebot y de bots de IA, URLs del sitemap, alertas abiertas, issues abiertos y actividad reciente.',
    why: 'Es el punto de partida del día: te dice en un vistazo si algo se rompió y qué falta configurar.',
    steps: [
      'Elige el sitio en "Sitio activo" (barra lateral).',
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
    what: 'Rastrea el sitio como lo haría un buscador (sin ejecutar JavaScript), guarda los datos SEO de cada página y compara cada crawl con el anterior.',
    why: 'Detecta problemas técnicos antes de que afecten la indexación, y después de cada deploy te dice exactamente qué cambió.',
    steps: [
      'Ajusta los límites: máximo de URLs, profundidad, concurrencia y solicitudes por segundo. Para sitios en producción, empieza con 1 o 2 solicitudes por segundo.',
      'Deja marcado "Respetar robots.txt" y "Usar URLs del sitemap como semillas".',
      'Si quieres excluir secciones, escribe una expresión regular por línea (por ejemplo ^/tag/).',
      'Pulsa "Iniciar crawl". Lo ejecuta el worker: puedes cerrar la página y volver. Puedes cancelarlo; lo rastreado se guarda.',
      'En el historial, pulsa "Ver detalle" para ver los cambios respecto al crawl anterior y la tabla de páginas.'
    ],
    read: [
      ['Indexable', '"sí" si responde 200, no tiene noindex, no está bloqueada y su canonical apunta a sí misma. Si no, se indica el motivo.'],
      ['Enlaces entrantes', 'Cuántas páginas rastreadas enlazan a esta. 0 en una página del sitemap = posible huérfana.'],
      ['Cambios respecto al crawl anterior', 'Los filtros en rojo son regresiones: páginas rotas, noindex añadido, canonical cambiado, contenido reducido, schema eliminado.']
    ],
    tips: [
      'Logout, carrito, checkout, wp-admin y búsquedas internas nunca se solicitan.',
      'Solo se rastrea el mismo dominio. Las direcciones privadas están bloqueadas por seguridad.'
    ],
    limits: ['No ve contenido que se genera con JavaScript en el navegador.', 'Un solo crawl a la vez por sitio.']
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
      'Revisa cada URL: primero los datos de usuarios reales, luego el laboratorio y la lista "Qué mejorar".'
    ],
    read: [
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
    title: 'Datos estructurados',
    status: 'partial',
    what: 'Validador de JSON-LD: revisa la sintaxis y las propiedades recomendadas del tipo.',
    why: 'Un bloque JSON-LD con un error de sintaxis se ignora por completo. Validarlo antes de publicar evita perder el marcado.',
    steps: ['Pega el JSON-LD en el editor.', 'Pulsa "Validar".', 'Corrige los errores (en rojo) y revisa las advertencias (en amarillo).'],
    limits: ['Validar la estructura no garantiza resultados enriquecidos en Google.', 'La generación de schema por página y su envío a WordPress aún no existen.']
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
    what: 'Conecta el sitio con WordPress mediante su API REST y una contraseña de aplicación, para enviar páginas aprobadas como borradores.',
    why: 'Lleva el contenido aprobado a WordPress sin copiar y pegar, y sin riesgo de publicar algo por accidente.',
    steps: [
      'En WordPress: Usuarios → Perfil → Contraseñas de aplicación. Crea una para un usuario que pueda editar entradas.',
      'Aquí: escribe la URL del sitio (https), el usuario y la contraseña de aplicación, y pulsa "Guardar y probar".',
      'Si dice "Conectado", ya puedes enviar páginas desde "Contenido programático".'
    ],
    read: [
      ['Solo borradores', 'La herramienta nunca publica ni borra, y no toca entradas que ya no sean borrador.'],
      ['Conflicto', 'Si alguien editó el borrador en WordPress después del último envío, verás qué se perdería y tendrás que confirmar para sobrescribir.'],
      ['Restaurar versión anterior', 'Antes de cada actualización se guarda una copia del borrador remoto; puedes devolverlo a esa versión.']
    ],
    tips: ['La contraseña se guarda cifrada y nunca se vuelve a mostrar completa.', 'Para probar sin un WordPress propio, ejecuta "pnpm wp:local" en una terminal.'],
    limits: ['Solo entradas (posts). Aún no maneja páginas de WordPress, imágenes, imagen destacada ni campos de Yoast o Rank Math.']
  },
  {
    id: 'users',
    nav: 'users',
    icon: Users,
    title: 'Acceso, usuarios y roles',
    status: 'ready',
    what: 'Cada persona entra con su usuario y contraseña. Lo que puede hacer depende de su rol. Owner y Admin ven la sección "Usuarios" para invitar personas, cambiar roles, desactivar cuentas y restablecer contraseñas.',
    why: 'Evita que cualquiera con la URL cambie datos, y deja registrado quién hizo cada cosa (aprobaciones, crawls, envíos a WordPress).',
    steps: [
      'Para cambiar tu contraseña, pulsa tu nombre abajo a la izquierda (Mi cuenta).',
      'Para invitar a alguien: Usuarios → Invitar usuario. Elige un rol y una contraseña temporal; la persona deberá cambiarla al entrar por primera vez.',
      'Comparte la contraseña temporal por un canal seguro, nunca en un documento público.',
      'Si alguien deja el equipo, desactívalo: sus sesiones se cierran en ese momento.'
    ],
    read: [
      ['Owner', 'Todo, incluida la gestión de otros Owners. Siempre debe quedar al menos uno activo.'],
      ['Admin', 'Sitios, credenciales de WordPress, borrados y usuarios (excepto Owners).'],
      ['SEO Manager', 'Logs, sitemaps, crawls, issues, alertas, contenido y envíos a WordPress.'],
      ['Editor', 'Datasets, plantillas, generación, revisión y envío de borradores.'],
      ['Viewer', 'Solo lectura.']
    ],
    tips: [
      'Las aprobaciones de contenido se registran con tu nombre de usuario; ya no hace falta escribirlo.',
      'Tras 5 intentos fallidos el acceso se bloquea 15 minutos para ese usuario.',
      'La sesión dura 12 horas sin actividad.'
    ],
    limits: ['No hay recuperación de contraseña por email todavía: un Admin debe restablecerla.']
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
    id: 'pending',
    icon: Gauge,
    title: 'Secciones marcadas "PRONTO"',
    status: 'pending',
    what: 'Search Console y GEO / motores de IA todavía no están construidas. Al abrirlas verás qué falta; no muestran números inventados.',
    why: 'Están en el roadmap del proyecto.'
  }
];

const STATUS_BADGE = {
  ready: <Badge tone="good">Disponible</Badge>,
  partial: <Badge tone="warn">Parcial</Badge>,
  pending: <Badge tone="warn">Pendiente</Badge>
};

const PENDING_ICONS = [Search, Sparkles];

export function ManualView({ go }: { go: (nav: string) => void }) {
  const jump = (id: string) => document.getElementById(`manual-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-start gap-3">
          <BookOpen className="w-6 h-6 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden />
          <div className="space-y-2 text-sm">
            <h2 className="font-bold text-base">Cómo usar Glitch SEO Ops</h2>
            <p className="text-slate-600 dark:text-slate-400">
              Glitch SEO Ops reúne en un solo lugar lo que los buscadores y los bots de IA hacen en tu sitio (logs), lo que encuentra un rastreo técnico (crawl) y la creación de páginas
              programáticas con control de calidad. Todo se organiza por sitio: elige uno en "Sitio activo" y trabaja sección por sección.
            </p>
            <p className="text-slate-600 dark:text-slate-400">
              <strong>Flujo recomendado:</strong> inicia sesión → registra el sitio → importa un log y carga el sitemap → ejecuta un crawl → trabaja los issues → vuelve a rastrear después de cada deploy para
              recibir alertas → genera contenido desde un CSV, apruébalo y envíalo a WordPress como borrador.
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
            ['Olvidé mi contraseña', 'Pide a un Owner o Admin que la restablezca desde Usuarios. Si eres el único Owner, desde la terminal: GLITCH_USER_PASSWORD=... pnpm cli users:reset-password --username tu-usuario.'],
            ['¿Qué significan los datos marcados DEMO?', 'Son datos sintéticos para probar la herramienta. Pasan por los mismos procesos que los datos reales.']
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
