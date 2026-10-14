/**
 * Catalog of schema.org types for the generator: Spanish labels and help, the fields of each type,
 * and what Google needs for rich results (required) or suggests (recommended).
 * Pure data: shared by the API and the web app.
 */

export type FieldKind = 'text' | 'textarea' | 'url' | 'image' | 'date' | 'datetime' | 'time' | 'number' | 'integer' | 'boolean' | 'enum' | 'email' | 'tel' | 'currency' | 'duration' | 'object';

export interface FieldDef {
  key: string;
  label: string;
  help?: string;
  kind: FieldKind;
  /** Several values (strings, or objects when kind is 'object'). */
  multiple?: boolean;
  /** For enums: [value, label]. Schema.org enumerations are written as full URLs on output. */
  options?: Array<[string, string]>;
  /** For objects: nested fields and the @type written on output. */
  fields?: FieldDef[];
  itemType?: string;
  /** Choice of @type for the nested object (e.g. author: Person or Organization). */
  itemTypes?: string[];
  placeholder?: string;
  required?: boolean;
  recommended?: boolean;
}

export interface TypeDef {
  id: string;
  label: string;
  description: string;
  /** Rubros / examples, shown in the type picker. */
  examples: string;
  /** The @type values offered (first = default). */
  subtypes: Array<[string, string]>;
  fields: FieldDef[];
  /** Google rich-result checks, as JSON-LD paths ("offers.price"; "a|b" = at least one). */
  google: { required: string[]; recommended: string[]; richResult?: string };
}

// ---------------------------------------------------------------- reusable pieces

const address = (required = false): FieldDef => ({
  key: 'address',
  label: 'Dirección',
  kind: 'object',
  itemType: 'PostalAddress',
  required,
  recommended: !required,
  fields: [
    { key: 'streetAddress', label: 'Calle y número', kind: 'text', placeholder: 'Av. Juárez 123, Col. Centro' },
    { key: 'addressLocality', label: 'Ciudad', kind: 'text', placeholder: 'Puebla' },
    { key: 'addressRegion', label: 'Estado o región', kind: 'text', placeholder: 'Puebla' },
    { key: 'postalCode', label: 'Código postal', kind: 'text', placeholder: '72000' },
    { key: 'addressCountry', label: 'País (código ISO)', kind: 'text', placeholder: 'MX', help: 'Código de 2 letras: MX, US, ES, CO…' }
  ]
});

const geo: FieldDef = {
  key: 'geo',
  label: 'Coordenadas',
  kind: 'object',
  itemType: 'GeoCoordinates',
  recommended: true,
  help: 'En Google Maps: clic derecho sobre el lugar → copia las coordenadas.',
  fields: [
    { key: 'latitude', label: 'Latitud', kind: 'number', placeholder: '19.0414' },
    { key: 'longitude', label: 'Longitud', kind: 'number', placeholder: '-98.2063' }
  ]
};

const sameAs: FieldDef = { key: 'sameAs', label: 'Perfiles y redes sociales', kind: 'url', multiple: true, help: 'Facebook, Instagram, LinkedIn, YouTube, Wikipedia… Ayuda a Google y a las IAs a identificar la entidad.' };

const AVAILABILITY: Array<[string, string]> = [
  ['InStock', 'Disponible'],
  ['OutOfStock', 'Agotado'],
  ['PreOrder', 'Preventa'],
  ['BackOrder', 'Sobre pedido'],
  ['LimitedAvailability', 'Disponibilidad limitada'],
  ['OnlineOnly', 'Solo en línea'],
  ['InStoreOnly', 'Solo en tienda'],
  ['SoldOut', 'Vendido'],
  ['Discontinued', 'Descontinuado']
];

const offer = (opts: { required?: boolean; multiple?: boolean; key?: string } = {}): FieldDef => ({
  key: opts.key ?? 'offers',
  label: 'Precio / oferta',
  kind: 'object',
  itemType: 'Offer',
  required: opts.required,
  recommended: !opts.required,
  multiple: opts.multiple,
  fields: [
    { key: 'price', label: 'Precio', kind: 'number', placeholder: '1499.00', help: 'Solo el número, con punto decimal. 0 si es gratis.' },
    { key: 'priceCurrency', label: 'Moneda', kind: 'currency', placeholder: 'MXN' },
    { key: 'availability', label: 'Disponibilidad', kind: 'enum', options: AVAILABILITY },
    { key: 'url', label: 'URL de compra', kind: 'url' },
    { key: 'priceValidUntil', label: 'Precio válido hasta', kind: 'date' },
    { key: 'validFrom', label: 'Disponible desde', kind: 'datetime' },
    {
      key: 'itemCondition',
      label: 'Condición',
      kind: 'enum',
      options: [
        ['NewCondition', 'Nuevo'],
        ['UsedCondition', 'Usado'],
        ['RefurbishedCondition', 'Reacondicionado'],
        ['DamagedCondition', 'Dañado']
      ]
    }
  ]
});

const rating: FieldDef = {
  key: 'aggregateRating',
  label: 'Calificación promedio',
  kind: 'object',
  itemType: 'AggregateRating',
  recommended: true,
  help: 'Solo si las reseñas son reales y visibles en la página; Google penaliza calificaciones inventadas.',
  fields: [
    { key: 'ratingValue', label: 'Calificación', kind: 'number', placeholder: '4.7' },
    { key: 'bestRating', label: 'Máxima posible', kind: 'number', placeholder: '5' },
    { key: 'ratingCount', label: 'Número de calificaciones', kind: 'integer', placeholder: '128' },
    { key: 'reviewCount', label: 'Número de reseñas', kind: 'integer' }
  ]
};

const review: FieldDef = {
  key: 'review',
  label: 'Reseñas',
  kind: 'object',
  itemType: 'Review',
  multiple: true,
  fields: [
    { key: 'author', label: 'Autor', kind: 'object', itemType: 'Person', fields: [{ key: 'name', label: 'Nombre', kind: 'text' }] },
    { key: 'reviewRating', label: 'Calificación', kind: 'object', itemType: 'Rating', fields: [{ key: 'ratingValue', label: 'Calificación', kind: 'number' }, { key: 'bestRating', label: 'Máxima', kind: 'number' }] },
    { key: 'reviewBody', label: 'Texto de la reseña', kind: 'textarea' },
    { key: 'datePublished', label: 'Fecha', kind: 'date' }
  ]
};

const personOrOrg = (key: string, label: string, flags: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  kind: 'object',
  itemTypes: ['Person', 'Organization'],
  ...flags,
  fields: [
    { key: 'name', label: 'Nombre', kind: 'text' },
    { key: 'url', label: 'URL (perfil o sitio)', kind: 'url' }
  ]
});

const orgRef = (key: string, label: string, flags: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  kind: 'object',
  itemType: 'Organization',
  ...flags,
  fields: [
    { key: 'name', label: 'Nombre', kind: 'text' },
    { key: 'url', label: 'Sitio web', kind: 'url' },
    { key: 'logo', label: 'Logo', kind: 'image' }
  ]
});

const DAYS: Array<[string, string]> = [
  ['Monday', 'Lunes'],
  ['Tuesday', 'Martes'],
  ['Wednesday', 'Miércoles'],
  ['Thursday', 'Jueves'],
  ['Friday', 'Viernes'],
  ['Saturday', 'Sábado'],
  ['Sunday', 'Domingo']
];

const openingHours: FieldDef = {
  key: 'openingHoursSpecification',
  label: 'Horarios',
  kind: 'object',
  itemType: 'OpeningHoursSpecification',
  multiple: true,
  recommended: true,
  help: 'Una fila por horario. Elige varios días si comparten horario.',
  fields: [
    { key: 'dayOfWeek', label: 'Días', kind: 'enum', multiple: true, options: DAYS },
    { key: 'opens', label: 'Abre', kind: 'time', placeholder: '09:00' },
    { key: 'closes', label: 'Cierra', kind: 'time', placeholder: '18:00' }
  ]
};

const common = {
  name: (required = true): FieldDef => ({ key: 'name', label: 'Nombre', kind: 'text', required, recommended: !required }),
  description: (flags: Partial<FieldDef> = {}): FieldDef => ({ key: 'description', label: 'Descripción', kind: 'textarea', ...flags }),
  url: (flags: Partial<FieldDef> = {}): FieldDef => ({ key: 'url', label: 'URL de la página', kind: 'url', ...flags }),
  image: (flags: Partial<FieldDef> = {}): FieldDef => ({ key: 'image', label: 'Imágenes', kind: 'image', multiple: true, help: 'URLs absolutas. Google prefiere varias proporciones (16:9, 4:3, 1:1) de al menos 1200 px de ancho.', ...flags }),
  telephone: (flags: Partial<FieldDef> = {}): FieldDef => ({ key: 'telephone', label: 'Teléfono', kind: 'tel', placeholder: '+52 222 123 4567', ...flags }),
  email: { key: 'email', label: 'Correo', kind: 'email' } as FieldDef,
  inLanguage: { key: 'inLanguage', label: 'Idioma', kind: 'text', placeholder: 'es-MX' } as FieldDef
};

// ---------------------------------------------------------------- the catalog

export const LOCAL_BUSINESS_SUBTYPES: Array<[string, string]> = [
  ['LocalBusiness', 'Negocio local (genérico)'],
  ['Restaurant', 'Restaurante'],
  ['CafeOrCoffeeShop', 'Cafetería'],
  ['BarOrPub', 'Bar'],
  ['Bakery', 'Panadería'],
  ['FastFoodRestaurant', 'Comida rápida'],
  ['Store', 'Tienda'],
  ['ClothingStore', 'Tienda de ropa'],
  ['ElectronicsStore', 'Tienda de electrónica'],
  ['GroceryStore', 'Supermercado / abarrotes'],
  ['Pharmacy', 'Farmacia'],
  ['HardwareStore', 'Ferretería'],
  ['FurnitureStore', 'Mueblería'],
  ['JewelryStore', 'Joyería'],
  ['Florist', 'Florería'],
  ['PetStore', 'Tienda de mascotas'],
  ['BookStore', 'Librería'],
  ['AutoDealer', 'Agencia de autos'],
  ['AutoRepair', 'Taller mecánico'],
  ['GasStation', 'Gasolinera'],
  ['Dentist', 'Dentista'],
  ['Physician', 'Médico / consultorio'],
  ['MedicalClinic', 'Clínica'],
  ['Hospital', 'Hospital'],
  ['Optician', 'Óptica'],
  ['VeterinaryCare', 'Veterinaria'],
  ['BeautySalon', 'Salón de belleza'],
  ['HairSalon', 'Estética / peluquería'],
  ['NailSalon', 'Uñas'],
  ['DaySpa', 'Spa'],
  ['HealthClub', 'Gimnasio'],
  ['LegalService', 'Servicios legales'],
  ['Attorney', 'Abogado'],
  ['AccountingService', 'Contabilidad'],
  ['FinancialService', 'Servicios financieros'],
  ['InsuranceAgency', 'Aseguradora / agente de seguros'],
  ['RealEstateAgent', 'Inmobiliaria'],
  ['Hotel', 'Hotel'],
  ['Motel', 'Motel'],
  ['BedAndBreakfast', 'Hostal / B&B'],
  ['TravelAgency', 'Agencia de viajes'],
  ['Plumber', 'Plomería'],
  ['Electrician', 'Electricista'],
  ['HVACBusiness', 'Aire acondicionado / calefacción'],
  ['Locksmith', 'Cerrajería'],
  ['MovingCompany', 'Mudanzas'],
  ['GeneralContractor', 'Construcción / contratista'],
  ['RoofingContractor', 'Techos e impermeabilización'],
  ['HousePainter', 'Pintura'],
  ['ChildCare', 'Guardería'],
  ['EntertainmentBusiness', 'Entretenimiento'],
  ['NightClub', 'Antro / club nocturno'],
  ['MovieTheater', 'Cine'],
  ['ProfessionalService', 'Servicio profesional']
];

export const CATALOG: TypeDef[] = [
  {
    id: 'Organization',
    label: 'Organización / empresa',
    description: 'Quién es la marca: nombre, logo, contacto y redes. Va normalmente en la página de inicio o en "Nosotros".',
    examples: 'Cualquier empresa, marca, ONG, universidad, escuela, gobierno, medio de comunicación',
    subtypes: [
      ['Organization', 'Organización (genérica)'],
      ['Corporation', 'Empresa / corporativo'],
      ['OnlineStore', 'Tienda en línea'],
      ['NGO', 'ONG / asociación'],
      ['EducationalOrganization', 'Institución educativa'],
      ['CollegeOrUniversity', 'Universidad'],
      ['School', 'Escuela'],
      ['MedicalOrganization', 'Organización de salud'],
      ['GovernmentOrganization', 'Gobierno'],
      ['NewsMediaOrganization', 'Medio de comunicación'],
      ['SportsOrganization', 'Organización deportiva']
    ],
    fields: [
      common.name(),
      { key: 'legalName', label: 'Razón social', kind: 'text' },
      common.url({ label: 'Sitio web', recommended: true }),
      { key: 'logo', label: 'Logo', kind: 'image', recommended: true, help: 'Imagen cuadrada o rectangular, mínimo 112×112 px.' },
      common.description(),
      sameAs,
      common.email,
      common.telephone(),
      address(),
      {
        key: 'contactPoint',
        label: 'Contacto (atención, ventas…)',
        kind: 'object',
        itemType: 'ContactPoint',
        multiple: true,
        fields: [
          common.telephone(),
          { key: 'contactType', label: 'Tipo', kind: 'text', placeholder: 'atención al cliente' },
          common.email,
          { key: 'areaServed', label: 'Zona atendida', kind: 'text', placeholder: 'MX' },
          { key: 'availableLanguage', label: 'Idiomas', kind: 'text', multiple: true, placeholder: 'Spanish' }
        ]
      },
      { key: 'foundingDate', label: 'Fecha de fundación', kind: 'date' },
      { key: 'taxID', label: 'RFC / ID fiscal', kind: 'text' }
    ],
    google: { required: ['name'], recommended: ['url', 'logo', 'sameAs'], richResult: 'Panel de conocimiento y logo en resultados' }
  },
  {
    id: 'LocalBusiness',
    label: 'Negocio local',
    description: 'Negocio con ubicación física o zona de servicio: dirección, horarios, teléfono y mapa.',
    examples: 'Restaurantes, tiendas, consultorios, talleres, hoteles, salones, despachos, gimnasios',
    subtypes: LOCAL_BUSINESS_SUBTYPES,
    fields: [
      common.name(),
      address(true),
      common.url({ recommended: true }),
      common.telephone({ recommended: true }),
      common.image({ recommended: true }),
      { key: 'priceRange', label: 'Rango de precios', kind: 'text', placeholder: '$$', recommended: true, help: '$, $$, $$$ o un rango: "$200 - $500".' },
      geo,
      openingHours,
      common.description(),
      sameAs,
      { key: 'servesCuisine', label: 'Tipo de cocina (restaurantes)', kind: 'text', multiple: true, placeholder: 'Mexicana' },
      { key: 'menu', label: 'URL del menú (restaurantes)', kind: 'url' },
      { key: 'acceptsReservations', label: 'Acepta reservaciones', kind: 'boolean' },
      { key: 'areaServed', label: 'Zona que atiende', kind: 'text', multiple: true, placeholder: 'Puebla' },
      { key: 'paymentAccepted', label: 'Formas de pago', kind: 'text', placeholder: 'Efectivo, tarjeta, transferencia' },
      rating
    ],
    google: { required: ['name', 'address'], recommended: ['url', 'telephone', 'image', 'priceRange', 'geo', 'openingHoursSpecification', 'aggregateRating'], richResult: 'Ficha del negocio en Google y Maps' }
  },
  {
    id: 'WebSite',
    label: 'Sitio web',
    description: 'Identifica el sitio y su nombre en los resultados. Va solo en la página de inicio.',
    examples: 'Cualquier sitio',
    subtypes: [['WebSite', 'Sitio web']],
    fields: [
      common.name(),
      { key: 'alternateName', label: 'Nombre alternativo', kind: 'text', help: 'Siglas o nombre corto.' },
      common.url({ label: 'URL de inicio', required: true }),
      common.inLanguage,
      { key: 'searchUrl', label: 'URL de búsqueda interna', kind: 'url', placeholder: 'https://misitio.com/?s={search_term_string}', help: 'Si el sitio tiene buscador, la URL con {search_term_string} donde va el término.' },
      orgRef('publisher', 'Publicado por')
    ],
    google: { required: ['name', 'url'], recommended: ['alternateName'], richResult: 'Nombre del sitio en los resultados' }
  },
  {
    id: 'WebPage',
    label: 'Página web',
    description: 'Describe una página concreta. Útil para páginas sin un tipo más específico.',
    examples: 'Páginas de contacto, nosotros, landing pages',
    subtypes: [
      ['WebPage', 'Página'],
      ['AboutPage', 'Nosotros'],
      ['ContactPage', 'Contacto'],
      ['CollectionPage', 'Listado / categoría'],
      ['ItemPage', 'Ficha de un elemento'],
      ['SearchResultsPage', 'Resultados de búsqueda']
    ],
    fields: [common.name(), common.description(), common.url({ required: true }), common.inLanguage, { key: 'primaryImageOfPage', label: 'Imagen principal', kind: 'image' }, { key: 'datePublished', label: 'Publicada', kind: 'date' }, { key: 'dateModified', label: 'Actualizada', kind: 'date' }],
    google: { required: ['name', 'url'], recommended: ['description'] }
  },
  {
    id: 'Article',
    label: 'Artículo / blog / noticia',
    description: 'Contenido editorial: muestra título, imagen, fecha y autor en Google.',
    examples: 'Blogs, noticias, guías, reportes',
    subtypes: [
      ['Article', 'Artículo'],
      ['BlogPosting', 'Entrada de blog'],
      ['NewsArticle', 'Noticia'],
      ['TechArticle', 'Artículo técnico'],
      ['Report', 'Reporte']
    ],
    fields: [
      { key: 'headline', label: 'Título', kind: 'text', required: true, help: 'Máximo 110 caracteres.' },
      common.description(),
      common.image({ recommended: true }),
      { key: 'datePublished', label: 'Fecha de publicación', kind: 'datetime', recommended: true },
      { key: 'dateModified', label: 'Última actualización', kind: 'datetime', recommended: true },
      personOrOrg('author', 'Autores', { multiple: true, recommended: true }),
      orgRef('publisher', 'Publicado por'),
      { key: 'mainEntityOfPage', label: 'URL del artículo', kind: 'url' },
      { key: 'articleSection', label: 'Sección', kind: 'text' },
      { key: 'keywords', label: 'Palabras clave', kind: 'text', placeholder: 'seo técnico, auditoría' },
      common.inLanguage
    ],
    google: { required: ['headline'], recommended: ['image', 'datePublished', 'dateModified', 'author', 'author.name'], richResult: 'Artículo con imagen y fecha; Top Stories' }
  },
  {
    id: 'Product',
    label: 'Producto',
    description: 'Ficha de un producto: precio, disponibilidad y calificaciones en Google.',
    examples: 'E-commerce, catálogos, cualquier cosa que se venda',
    subtypes: [
      ['Product', 'Producto'],
      ['Vehicle', 'Vehículo'],
      ['Car', 'Auto']
    ],
    fields: [
      common.name(),
      common.image({ recommended: true }),
      common.description({ recommended: true }),
      { key: 'brand', label: 'Marca', kind: 'object', itemType: 'Brand', recommended: true, fields: [{ key: 'name', label: 'Nombre', kind: 'text' }] },
      { key: 'sku', label: 'SKU', kind: 'text', recommended: true },
      { key: 'gtin', label: 'GTIN / código de barras', kind: 'text' },
      { key: 'mpn', label: 'Número de parte (MPN)', kind: 'text' },
      { key: 'color', label: 'Color', kind: 'text' },
      { key: 'material', label: 'Material', kind: 'text' },
      offer({ multiple: true }),
      rating,
      review
    ],
    google: { required: ['name', 'offers|review|aggregateRating'], recommended: ['image', 'description', 'brand', 'sku', 'offers.price', 'offers.priceCurrency', 'offers.availability'], richResult: 'Precio, disponibilidad y estrellas' }
  },
  {
    id: 'Service',
    label: 'Servicio',
    description: 'Un servicio que ofreces: qué es, quién lo da, dónde y a qué precio.',
    examples: 'Consultoría, agencias, despachos, cursos a medida, mantenimiento, cualquier servicio',
    subtypes: [
      ['Service', 'Servicio'],
      ['FinancialProduct', 'Producto financiero'],
      ['BroadcastService', 'Transmisión'],
      ['TaxiService', 'Taxi / transporte']
    ],
    fields: [
      common.name(),
      common.description({ recommended: true }),
      { key: 'serviceType', label: 'Tipo de servicio', kind: 'text', placeholder: 'Auditoría SEO técnica' },
      orgRef('provider', 'Lo ofrece', { recommended: true }),
      { key: 'areaServed', label: 'Zona que atiende', kind: 'text', multiple: true },
      common.url(),
      common.image(),
      offer(),
      rating
    ],
    google: { required: ['name'], recommended: ['description', 'provider', 'areaServed'] }
  },
  {
    id: 'FAQPage',
    label: 'Preguntas frecuentes',
    description: 'Preguntas y respuestas visibles en la página.',
    examples: 'Páginas de ayuda, soporte, servicios, productos',
    subtypes: [['FAQPage', 'Preguntas frecuentes']],
    fields: [
      {
        key: 'mainEntity',
        label: 'Preguntas',
        kind: 'object',
        itemType: 'Question',
        multiple: true,
        required: true,
        help: 'Deben estar escritas igual en la página.',
        fields: [
          { key: 'name', label: 'Pregunta', kind: 'text' },
          { key: 'acceptedAnswer', label: 'Respuesta', kind: 'textarea' }
        ]
      }
    ],
    google: { required: ['mainEntity', 'mainEntity.name', 'mainEntity.acceptedAnswer.text'], recommended: [], richResult: 'Preguntas desplegables (Google solo las muestra en sitios de gobierno y salud, pero las IAs y otros buscadores sí las leen)' }
  },
  {
    id: 'HowTo',
    label: 'Cómo hacer (paso a paso)',
    description: 'Instrucciones con pasos, materiales y herramientas.',
    examples: 'Tutoriales, guías de instalación, recetas no culinarias, manuales',
    subtypes: [['HowTo', 'Cómo hacer']],
    fields: [
      common.name(),
      common.description(),
      common.image(),
      { key: 'totalTime', label: 'Tiempo total', kind: 'duration', placeholder: '30 min' },
      { key: 'estimatedCost', label: 'Costo estimado', kind: 'object', itemType: 'MonetaryAmount', fields: [{ key: 'value', label: 'Monto', kind: 'number' }, { key: 'currency', label: 'Moneda', kind: 'currency' }] },
      { key: 'supply', label: 'Materiales', kind: 'text', multiple: true },
      { key: 'tool', label: 'Herramientas', kind: 'text', multiple: true },
      {
        key: 'step',
        label: 'Pasos',
        kind: 'object',
        itemType: 'HowToStep',
        multiple: true,
        required: true,
        fields: [
          { key: 'name', label: 'Título del paso', kind: 'text' },
          { key: 'text', label: 'Instrucción', kind: 'textarea' },
          { key: 'image', label: 'Imagen', kind: 'image' },
          { key: 'url', label: 'Enlace al paso', kind: 'url' }
        ]
      }
    ],
    google: { required: ['name', 'step', 'step.text'], recommended: ['image', 'totalTime', 'supply', 'tool'] }
  },
  {
    id: 'BreadcrumbList',
    label: 'Migas de pan',
    description: 'La ruta de la página dentro del sitio (Inicio › Categoría › Página).',
    examples: 'Cualquier página interna',
    subtypes: [['BreadcrumbList', 'Migas de pan']],
    fields: [
      {
        key: 'itemListElement',
        label: 'Niveles (en orden)',
        kind: 'object',
        itemType: 'ListItem',
        multiple: true,
        required: true,
        fields: [
          { key: 'name', label: 'Nombre', kind: 'text' },
          { key: 'item', label: 'URL', kind: 'url' }
        ]
      }
    ],
    google: { required: ['itemListElement', 'itemListElement.name'], recommended: ['itemListElement.item'], richResult: 'Ruta en lugar de la URL en los resultados' }
  },
  {
    id: 'Event',
    label: 'Evento',
    description: 'Algo que ocurre en una fecha: presencial o en línea.',
    examples: 'Conciertos, webinars, cursos con fecha, conferencias, ferias, partidos, obras',
    subtypes: [
      ['Event', 'Evento'],
      ['BusinessEvent', 'Evento de negocios'],
      ['EducationEvent', 'Evento educativo / webinar'],
      ['MusicEvent', 'Concierto'],
      ['SportsEvent', 'Deportivo'],
      ['Festival', 'Festival'],
      ['TheaterEvent', 'Teatro'],
      ['ExhibitionEvent', 'Exposición'],
      ['FoodEvent', 'Gastronómico']
    ],
    fields: [
      common.name(),
      { key: 'startDate', label: 'Inicio', kind: 'datetime', required: true },
      { key: 'endDate', label: 'Fin', kind: 'datetime', recommended: true },
      {
        key: 'eventAttendanceMode',
        label: 'Modalidad',
        kind: 'enum',
        options: [
          ['OfflineEventAttendanceMode', 'Presencial'],
          ['OnlineEventAttendanceMode', 'En línea'],
          ['MixedEventAttendanceMode', 'Mixto']
        ]
      },
      {
        key: 'eventStatus',
        label: 'Estado',
        kind: 'enum',
        options: [
          ['EventScheduled', 'Programado'],
          ['EventCancelled', 'Cancelado'],
          ['EventPostponed', 'Pospuesto'],
          ['EventRescheduled', 'Reprogramado'],
          ['EventMovedOnline', 'Pasó a en línea']
        ]
      },
      { key: 'location', label: 'Lugar (presencial)', kind: 'object', itemType: 'Place', required: true, help: 'Para eventos en línea, llena "URL del evento en línea".', fields: [{ key: 'name', label: 'Nombre del lugar', kind: 'text' }, address()] },
      { key: 'onlineUrl', label: 'URL del evento en línea', kind: 'url' },
      common.description({ recommended: true }),
      common.image({ recommended: true }),
      offer(),
      orgRef('organizer', 'Organiza', { recommended: true }),
      personOrOrg('performer', 'Participa / presenta', { multiple: true })
    ],
    google: { required: ['name', 'startDate', 'location'], recommended: ['endDate', 'description', 'image', 'offers', 'organizer', 'eventStatus'], richResult: 'Eventos en Google' }
  },
  {
    id: 'Course',
    label: 'Curso / programa académico',
    description: 'Un curso, diplomado, carrera o posgrado.',
    examples: 'Universidades, academias, cursos en línea, capacitaciones',
    subtypes: [['Course', 'Curso o programa']],
    fields: [
      common.name(),
      common.description({ required: true }),
      orgRef('provider', 'Institución que lo imparte', { recommended: true }),
      { key: 'courseCode', label: 'Clave', kind: 'text' },
      { key: 'educationalCredentialAwarded', label: 'Grado o constancia que otorga', kind: 'text', placeholder: 'Maestría en Políticas Públicas' },
      common.inLanguage,
      {
        key: 'hasCourseInstance',
        label: 'Ediciones / modalidad',
        kind: 'object',
        itemType: 'CourseInstance',
        multiple: true,
        recommended: true,
        fields: [
          {
            key: 'courseMode',
            label: 'Modalidad',
            kind: 'enum',
            options: [
              ['Online', 'En línea'],
              ['Onsite', 'Presencial'],
              ['Blended', 'Mixta']
            ]
          },
          { key: 'courseWorkload', label: 'Carga de trabajo', kind: 'duration', placeholder: '6 h por semana' },
          { key: 'startDate', label: 'Inicio', kind: 'date' },
          { key: 'endDate', label: 'Fin', kind: 'date' }
        ]
      },
      offer({ multiple: true }),
      rating
    ],
    google: { required: ['name', 'description'], recommended: ['provider', 'provider.name', 'offers', 'hasCourseInstance'], richResult: 'Carrusel de cursos' }
  },
  {
    id: 'JobPosting',
    label: 'Vacante de empleo',
    description: 'Una oferta de trabajo para Google Empleos.',
    examples: 'Bolsas de trabajo, páginas de "Trabaja con nosotros"',
    subtypes: [['JobPosting', 'Vacante']],
    fields: [
      { key: 'title', label: 'Puesto', kind: 'text', required: true },
      common.description({ required: true, help: 'Descripción completa del puesto (puede llevar HTML básico).' }),
      { key: 'datePosted', label: 'Publicada', kind: 'date', required: true },
      { key: 'validThrough', label: 'Vigente hasta', kind: 'datetime', recommended: true },
      orgRef('hiringOrganization', 'Empresa que contrata', { required: true }),
      {
        key: 'employmentType',
        label: 'Tipo de empleo',
        kind: 'enum',
        multiple: true,
        recommended: true,
        options: [
          ['FULL_TIME', 'Tiempo completo'],
          ['PART_TIME', 'Medio tiempo'],
          ['CONTRACTOR', 'Por proyecto'],
          ['TEMPORARY', 'Temporal'],
          ['INTERN', 'Prácticas'],
          ['VOLUNTEER', 'Voluntariado'],
          ['PER_DIEM', 'Por día'],
          ['OTHER', 'Otro']
        ]
      },
      { key: 'jobLocation', label: 'Lugar de trabajo', kind: 'object', itemType: 'Place', required: true, help: 'Si es 100 % remoto, marca "Trabajo remoto" y deja esto vacío.', fields: [address()] },
      { key: 'remote', label: 'Trabajo remoto', kind: 'boolean' },
      { key: 'applicantCountry', label: 'País de los candidatos (remoto)', kind: 'text', placeholder: 'MX' },
      {
        key: 'baseSalary',
        label: 'Salario',
        kind: 'object',
        itemType: 'MonetaryAmount',
        recommended: true,
        fields: [
          { key: 'currency', label: 'Moneda', kind: 'currency' },
          { key: 'minValue', label: 'Mínimo', kind: 'number' },
          { key: 'maxValue', label: 'Máximo', kind: 'number' },
          {
            key: 'unitText',
            label: 'Por',
            kind: 'enum',
            options: [
              ['MONTH', 'Mes'],
              ['YEAR', 'Año'],
              ['WEEK', 'Semana'],
              ['DAY', 'Día'],
              ['HOUR', 'Hora']
            ]
          }
        ]
      },
      { key: 'directApply', label: 'Se puede postular directo en la página', kind: 'boolean' }
    ],
    google: { required: ['title', 'description', 'datePosted', 'hiringOrganization', 'hiringOrganization.name', 'jobLocation|jobLocationType'], recommended: ['validThrough', 'employmentType', 'baseSalary'], richResult: 'Google Empleos' }
  },
  {
    id: 'Recipe',
    label: 'Receta',
    description: 'Receta de cocina con ingredientes, tiempos y pasos.',
    examples: 'Blogs de cocina, marcas de alimentos, restaurantes',
    subtypes: [['Recipe', 'Receta']],
    fields: [
      common.name(),
      common.image({ required: true }),
      common.description({ recommended: true }),
      personOrOrg('author', 'Autor', { recommended: true }),
      { key: 'datePublished', label: 'Publicada', kind: 'date', recommended: true },
      { key: 'prepTime', label: 'Preparación', kind: 'duration', placeholder: '15 min' },
      { key: 'cookTime', label: 'Cocción', kind: 'duration', placeholder: '30 min' },
      { key: 'totalTime', label: 'Tiempo total', kind: 'duration', placeholder: '45 min', recommended: true },
      { key: 'recipeYield', label: 'Porciones', kind: 'text', placeholder: '4 porciones' },
      { key: 'recipeCategory', label: 'Categoría', kind: 'text', placeholder: 'Plato fuerte' },
      { key: 'recipeCuisine', label: 'Cocina', kind: 'text', placeholder: 'Mexicana' },
      { key: 'keywords', label: 'Palabras clave', kind: 'text' },
      { key: 'recipeIngredient', label: 'Ingredientes', kind: 'text', multiple: true, recommended: true },
      { key: 'recipeInstructions', label: 'Pasos', kind: 'textarea', multiple: true, recommended: true },
      { key: 'nutrition', label: 'Calorías', kind: 'object', itemType: 'NutritionInformation', fields: [{ key: 'calories', label: 'Calorías', kind: 'text', placeholder: '320 calorías' }] },
      rating
    ],
    google: { required: ['name', 'image'], recommended: ['author', 'datePublished', 'description', 'totalTime', 'recipeIngredient', 'recipeInstructions', 'aggregateRating'], richResult: 'Recetas con foto, tiempo y estrellas' }
  },
  {
    id: 'Person',
    label: 'Persona',
    description: 'Una persona: autor, especialista, docente, médico, deportista, artista.',
    examples: 'Páginas de autor, equipo, perfiles profesionales',
    subtypes: [['Person', 'Persona']],
    fields: [
      common.name(),
      { key: 'jobTitle', label: 'Cargo o profesión', kind: 'text' },
      orgRef('worksFor', 'Trabaja en'),
      common.url({ label: 'Página o perfil' }),
      { key: 'image', label: 'Foto', kind: 'image' },
      common.description(),
      sameAs,
      common.email,
      common.telephone(),
      { key: 'alumniOf', label: 'Estudió en', kind: 'text', multiple: true },
      { key: 'knowsAbout', label: 'Temas que domina', kind: 'text', multiple: true, help: 'Ayuda a mostrar experiencia (E-E-A-T).' }
    ],
    google: { required: ['name'], recommended: ['url', 'sameAs', 'jobTitle'] }
  },
  {
    id: 'VideoObject',
    label: 'Video',
    description: 'Un video incrustado o propio.',
    examples: 'Tutoriales, demos, entrevistas, cualquier página con video',
    subtypes: [['VideoObject', 'Video']],
    fields: [
      common.name(),
      common.description({ required: true }),
      { key: 'thumbnailUrl', label: 'Miniatura', kind: 'image', multiple: true, required: true },
      { key: 'uploadDate', label: 'Fecha de publicación', kind: 'datetime', required: true },
      { key: 'duration', label: 'Duración', kind: 'duration', placeholder: '5 min 30 s', recommended: true },
      { key: 'contentUrl', label: 'URL del archivo de video', kind: 'url', recommended: true },
      { key: 'embedUrl', label: 'URL para incrustar (YouTube, Vimeo…)', kind: 'url', recommended: true }
    ],
    google: { required: ['name', 'description', 'thumbnailUrl', 'uploadDate'], recommended: ['duration', 'contentUrl|embedUrl'], richResult: 'Video con miniatura y duración' }
  },
  {
    id: 'SoftwareApplication',
    label: 'Aplicación / software',
    description: 'Una app móvil, web o de escritorio.',
    examples: 'Apps, SaaS, juegos, plugins',
    subtypes: [
      ['SoftwareApplication', 'Software'],
      ['MobileApplication', 'App móvil'],
      ['WebApplication', 'App web'],
      ['VideoGame', 'Videojuego']
    ],
    fields: [
      common.name(),
      { key: 'operatingSystem', label: 'Sistema operativo', kind: 'text', placeholder: 'Android, iOS, Windows, Web' },
      {
        key: 'applicationCategory',
        label: 'Categoría',
        kind: 'enum',
        recommended: true,
        options: [
          ['BusinessApplication', 'Negocios'],
          ['EducationalApplication', 'Educación'],
          ['FinanceApplication', 'Finanzas'],
          ['GameApplication', 'Juegos'],
          ['HealthApplication', 'Salud'],
          ['LifestyleApplication', 'Estilo de vida'],
          ['MultimediaApplication', 'Multimedia'],
          ['ShoppingApplication', 'Compras'],
          ['SocialNetworkingApplication', 'Redes sociales'],
          ['TravelApplication', 'Viajes'],
          ['UtilitiesApplication', 'Utilidades'],
          ['DeveloperApplication', 'Desarrollo']
        ]
      },
      common.description(),
      common.url(),
      offer({ required: true }),
      rating
    ],
    google: { required: ['name', 'offers', 'offers.price', 'aggregateRating|review'], recommended: ['operatingSystem', 'applicationCategory'], richResult: 'App con precio y estrellas' }
  }
];

export const CUSTOM_TYPE_ID = 'Custom';

export function findTypeDef(idOrType: string): TypeDef | undefined {
  return CATALOG.find(t => t.id === idOrType || t.subtypes.some(([s]) => s === idOrType));
}

/** Schema.org enumerations written as full URLs on output (Google accepts both, this is the canonical form). */
export const ENUM_URL_KEYS = new Set(['availability', 'itemCondition', 'eventAttendanceMode', 'eventStatus']);
