import { describe, it, expect } from 'vitest';
import { buildJsonLd, buildNode, toScriptTag, toIsoDuration, fillTemplate, templatePlaceholders, validateSchema, validateJsonLd, parseCsv, CATALOG, findTypeDef, LOCAL_BUSINESS_SUBTYPES } from '@glitch/schema-engine';

describe('catalog', () => {
  it('covers many industries and every type has Google checks', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(17);
    expect(LOCAL_BUSINESS_SUBTYPES.length).toBeGreaterThanOrEqual(50);
    for (const t of CATALOG) expect(t.google.required.length).toBeGreaterThan(0);
    expect(findTypeDef('Dentist')?.id).toBe('LocalBusiness');
    expect(findTypeDef('BlogPosting')?.id).toBe('Article');
  });
});

describe('builder', () => {
  it('writes a local business with address, geo, hours and enum URLs, dropping empty fields', () => {
    const j = buildJsonLd([
      {
        typeId: 'LocalBusiness',
        type: 'Dentist',
        values: {
          name: 'Clínica Dental Sonrisa',
          address: { streetAddress: 'Av. Juárez 123', addressLocality: 'Puebla', addressCountry: 'MX', postalCode: '' },
          telephone: '+52 222 123 4567',
          geo: { latitude: '19.04', longitude: '-98.20' },
          openingHoursSpecification: [{ dayOfWeek: ['Monday', 'Friday'], opens: '09:00', closes: '18:00' }, { dayOfWeek: [], opens: '', closes: '' }],
          priceRange: '',
          acceptsReservations: true,
          sameAs: ['https://facebook.com/sonrisa', '']
        }
      }
    ], { pageUrl: 'https://sonrisa.mx/' });
    expect(j).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Dentist',
      '@id': 'https://sonrisa.mx/#dentist',
      name: 'Clínica Dental Sonrisa',
      address: { '@type': 'PostalAddress', streetAddress: 'Av. Juárez 123', addressLocality: 'Puebla', addressCountry: 'MX' },
      telephone: '+52 222 123 4567',
      geo: { '@type': 'GeoCoordinates', latitude: 19.04, longitude: -98.2 },
      openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Friday'], opens: '09:00', closes: '18:00' }],
      sameAs: ['https://facebook.com/sonrisa'],
      acceptsReservations: true
    });
  });

  it('produces the shapes Google expects (FAQ answers, breadcrumb positions, search box, remote jobs, salary, recipe steps, offers)', () => {
    const faq = buildNode({ typeId: 'FAQPage', type: 'FAQPage', values: { mainEntity: [{ name: '¿Hacen envíos?', acceptedAnswer: 'Sí, a todo México.' }] } });
    expect(faq.mainEntity).toEqual([{ '@type': 'Question', name: '¿Hacen envíos?', acceptedAnswer: { '@type': 'Answer', text: 'Sí, a todo México.' } }]);
    const bc = buildNode({ typeId: 'BreadcrumbList', type: 'BreadcrumbList', values: { itemListElement: [{ name: 'Inicio', item: 'https://a.mx/' }, { name: 'Blog', item: 'https://a.mx/blog/' }] } });
    expect((bc.itemListElement as Array<{ position: number }>).map(i => i.position)).toEqual([1, 2]);
    const site = buildNode({ typeId: 'WebSite', type: 'WebSite', values: { name: 'A', url: 'https://a.mx/', searchUrl: 'https://a.mx/?s={search_term_string}' } });
    expect(site.potentialAction).toMatchObject({ '@type': 'SearchAction', 'query-input': 'required name=search_term_string', target: { urlTemplate: 'https://a.mx/?s={search_term_string}' } });
    expect(site.searchUrl).toBeUndefined();
    const job = buildNode({ typeId: 'JobPosting', type: 'JobPosting', values: { title: 'Dev', remote: true, applicantCountry: 'MX', baseSalary: { currency: 'MXN', minValue: '30,000', maxValue: '45000', unitText: 'MONTH' } } });
    expect(job).toMatchObject({ jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'MX' }, baseSalary: { '@type': 'MonetaryAmount', currency: 'MXN', value: { '@type': 'QuantitativeValue', minValue: 30000, maxValue: 45000, unitText: 'MONTH' } } });
    const recipe = buildNode({ typeId: 'Recipe', type: 'Recipe', values: { name: 'Mole', recipeInstructions: ['Tostar chiles', 'Moler'], totalTime: '1 h 30 min' } });
    expect(recipe.recipeInstructions).toEqual([{ '@type': 'HowToStep', text: 'Tostar chiles' }, { '@type': 'HowToStep', text: 'Moler' }]);
    expect(recipe.totalTime).toBe('PT1H30M');
    const product = buildNode({ typeId: 'Product', type: 'Product', values: { name: 'Silla', offers: [{ price: '1,499.50', priceCurrency: 'mxn', availability: 'InStock' }] } });
    expect(product.offers).toEqual([{ '@type': 'Offer', price: 1499.5, priceCurrency: 'MXN', availability: 'https://schema.org/InStock' }]);
    const ev = buildNode({ typeId: 'Event', type: 'EducationEvent', values: { name: 'Webinar', startDate: '2026-11-03T18:00', onlineUrl: 'https://zoom.us/j/1' } }, { tzOffset: '-06:00' });
    expect(ev).toMatchObject({ startDate: '2026-11-03T18:00:00-06:00', location: { '@type': 'VirtualLocation', url: 'https://zoom.us/j/1' } });
  });

  it('accepts any schema.org type and extra properties (any industry)', () => {
    const j = buildNode({ typeId: 'Custom', type: 'Mosque', values: {}, extra: [{ key: 'name', value: 'Mezquita' }, { key: 'geo', value: '{"@type":"GeoCoordinates","latitude":1,"longitude":2}' }, { key: '@id', value: 'x' }] });
    expect(j).toEqual({ '@type': 'Mosque', name: 'Mezquita', geo: { '@type': 'GeoCoordinates', latitude: 1, longitude: 2 } });
  });

  it('combines several schemas in one @graph and escapes the script tag', () => {
    const j = buildJsonLd([{ typeId: 'WebSite', type: 'WebSite', values: { name: 'A', url: 'https://a.mx/' } }, { typeId: 'Organization', type: 'Organization', values: { name: 'A </script><b>' } }]);
    expect((j['@graph'] as unknown[]).length).toBe(2);
    const tag = toScriptTag(j);
    expect(tag.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(tag.match(/<\/script>/g)).toHaveLength(1);
    expect(tag).toContain('\\u003c/script>');
  });

  it('turns human durations into ISO 8601', () => {
    expect(['45 min', '1 h 30 min', '2 horas', '1:30', '90', 'PT20M', '5 min 30 s', '1 día', 'abc'].map(toIsoDuration)).toEqual(['PT45M', 'PT1H30M', 'PT2H', 'PT1H30M', 'PT90M', 'PT20M', 'PT5M30S', 'P1D', null]);
  });

  it('fills templates from CSV rows', () => {
    const tpl = { typeId: 'Product', type: 'Product', values: { name: '{{ nombre }}', offers: [{ price: '{{precio}}', priceCurrency: 'MXN' }], image: ['https://a.mx/img/{{sku}}.jpg'] } };
    expect(templatePlaceholders(tpl).sort()).toEqual(['nombre', 'precio', 'sku']);
    const { headers, rows } = parseCsv('\uFEFFnombre;precio;sku\n"Silla ""Eames""";1499;S-1\nMesa;899;M-2\n');
    expect(headers).toEqual(['nombre', 'precio', 'sku']);
    const j = buildNode(fillTemplate(tpl, rows[0]));
    expect(j).toMatchObject({ name: 'Silla "Eames"', offers: [{ price: 1499 }], image: ['https://a.mx/img/S-1.jpg'] });
  });
});

describe('validator', () => {
  it('reports what Google requires and recommends, by field label, in Spanish', () => {
    const r = validateSchema({ '@context': 'https://schema.org', '@type': 'Product', name: 'Silla' });
    expect(r.ok).toBe(false);
    expect(r.nodes[0].errors.join(' ')).toMatch(/al menos uno de: "Precio \/ oferta", "Reseñas", "Calificación promedio"/);
    expect(r.nodes[0].warnings.join(' ')).toMatch(/Recomendado: "Imágenes"/);
    expect(r.nodes[0].richResult).toMatch(/Precio/);
  });

  it('checks formats: absolute URLs, ISO dates with time zone, durations, numbers and currencies', () => {
    const r = validateSchema({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Mole', image: '/img/mole.jpg', datePublished: '14/10/2026', totalTime: '1 hora', aggregateRating: { ratingValue: 'cuatro' }, offers: { price: '$10', priceCurrency: 'pesos' } });
    const e = r.nodes[0].errors.join(' | ');
    expect(e).toMatch(/"image" debe ser una URL completa/);
    expect(e).toMatch(/"datePublished" debe ser una fecha ISO 8601/);
    expect(e).toMatch(/"totalTime" debe ser una duración ISO 8601/);
    expect(e).toMatch(/"aggregateRating.ratingValue" debe ser un número/);
    expect(e).toMatch(/"offers.priceCurrency" debe ser un código de moneda/);
    const tz = validateSchema({ '@context': 'https://schema.org', '@type': 'Event', name: 'X', startDate: '2026-11-03T18:00:00', location: { '@type': 'Place', address: 'Puebla' } });
    expect(tz.nodes[0].warnings.join(' ')).toMatch(/zona horaria/);
  });

  it('validates @graph, script tags, unknown types and broken JSON', () => {
    const graph = toScriptTag(buildJsonLd([{ typeId: 'WebSite', type: 'WebSite', values: { name: 'A', url: 'https://a.mx/' } }, { typeId: 'Organization', type: 'Corporation', values: { name: 'A', url: 'https://a.mx/', logo: 'https://a.mx/l.png', sameAs: ['https://x.com/a'] } }]));
    const r = validateSchema(graph);
    expect(r.ok).toBe(true);
    expect(r.nodes.map(n => n.label)).toEqual(['Sitio web', 'Empresa / corporativo']);
    expect(validateSchema({ '@context': 'https://schema.org', '@type': 'Mosque', name: 'X' }).nodes[0].warnings[0]).toMatch(/no está en el catálogo/);
    expect(validateSchema('{ nope').errors[0]).toMatch(/JSON no es válido/);
    expect(validateJsonLd('{"@type":"Article","headline":"x"}')).toMatchObject({ isValid: false, type: 'Article', errors: [expect.stringMatching(/@context/)] });
  });
});
