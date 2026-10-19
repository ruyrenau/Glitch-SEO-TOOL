/**
 * "Perfil de entidad del sitio": one connected JSON-LD graph instead of isolated blocks.
 * Organization, WebSite, Person (authors) and each page's WebPage / Article reference each other by stable
 * @id values, and articles point to Wikidata / Wikipedia entities with `about` and `mentions`.
 */

export interface OrgProfile {
  name: string;
  legalName?: string;
  type?: string; // Organization or a subtype (LocalBusiness, Corporation, EducationalOrganization…)
  url: string;
  logo?: string;
  description?: string;
  email?: string;
  telephone?: string;
  address?: { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string; addressCountry?: string };
  foundingDate?: string;
  sameAs?: string[];
}
export interface AuthorProfile {
  id: string;
  name: string;
  slug: string;
  url?: string; // author page on the site
  jobTitle?: string;
  description?: string;
  image?: string;
  sameAs?: string[];
  knowsAbout?: string[];
}
export interface EntityRef {
  label: string;
  qid?: string; // Wikidata id (Q…)
  wikipedia?: string;
}
export interface PageEntityInput {
  url: string;
  type: 'Article' | 'BlogPosting' | 'NewsArticle' | 'WebPage' | 'AboutPage' | 'ContactPage' | 'ProfilePage' | 'CollectionPage' | 'FAQPage';
  title?: string | null;
  description?: string | null;
  image?: string | null;
  datePublished?: string | null;
  dateModified?: string | null;
  author?: AuthorProfile | null;
  about?: EntityRef[];
  mentions?: EntityRef[];
  inLanguage?: string;
}

const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))) as T;
export const originOf = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return u.replace(/\/+$/, '');
  }
};
export const ids = (origin: string) => ({
  organization: `${origin}/#organization`,
  website: `${origin}/#website`,
  logo: `${origin}/#logo`,
  person: (slug: string) => `${origin}/#/schema/person/${slug}`
});
const thing = (e: EntityRef) => clean({ '@type': 'Thing', name: e.label, sameAs: [e.qid ? `https://www.wikidata.org/wiki/${e.qid}` : undefined, e.wikipedia].filter(Boolean) as string[] });
const ARTICLE = new Set(['Article', 'BlogPosting', 'NewsArticle']);

export function organizationNode(org: OrgProfile) {
  const id = ids(originOf(org.url));
  return clean({
    '@type': org.type || 'Organization',
    '@id': id.organization,
    name: org.name,
    legalName: org.legalName,
    url: org.url,
    logo: org.logo ? { '@type': 'ImageObject', '@id': id.logo, url: org.logo } : undefined,
    image: org.logo ? { '@id': id.logo } : undefined,
    description: org.description,
    email: org.email,
    telephone: org.telephone,
    address: org.address && Object.values(org.address).some(Boolean) ? clean({ '@type': 'PostalAddress', ...org.address }) : undefined,
    foundingDate: org.foundingDate,
    sameAs: org.sameAs?.filter(Boolean)
  });
}
export function personNode(a: AuthorProfile, org: OrgProfile) {
  const id = ids(originOf(org.url));
  return clean({
    '@type': 'Person',
    '@id': id.person(a.slug),
    name: a.name,
    url: a.url,
    jobTitle: a.jobTitle,
    description: a.description,
    image: a.image,
    sameAs: a.sameAs?.filter(Boolean),
    knowsAbout: a.knowsAbout?.filter(Boolean),
    worksFor: { '@id': id.organization }
  });
}

/** The full graph for one page (paste it in <script type="application/ld+json">). */
export function buildEntityGraph(org: OrgProfile, page: PageEntityInput, opts: { authors?: AuthorProfile[]; siteName?: string } = {}) {
  const origin = originOf(org.url);
  const id = ids(origin);
  const graph: Record<string, unknown>[] = [
    organizationNode(org),
    clean({ '@type': 'WebSite', '@id': id.website, url: `${origin}/`, name: opts.siteName || org.name, publisher: { '@id': id.organization }, inLanguage: page.inLanguage })
  ];
  const isArticle = ARTICLE.has(page.type);
  const webpageType = isArticle ? 'WebPage' : page.type;
  const about = page.about?.map(thing);
  const mentions = page.mentions?.map(thing);
  graph.push(
    clean({
      '@type': webpageType,
      '@id': `${page.url}#webpage`,
      url: page.url,
      name: page.title,
      description: page.description,
      isPartOf: { '@id': id.website },
      primaryImageOfPage: page.image ? { '@type': 'ImageObject', url: page.image } : undefined,
      datePublished: isArticle ? undefined : page.datePublished,
      dateModified: isArticle ? undefined : page.dateModified,
      about: isArticle ? undefined : about,
      mentions: isArticle ? undefined : mentions,
      mainEntity: page.type === 'AboutPage' || page.type === 'ContactPage' ? { '@id': id.organization } : page.type === 'ProfilePage' && page.author ? { '@id': id.person(page.author.slug) } : undefined,
      inLanguage: page.inLanguage
    })
  );
  if (isArticle) {
    graph.push(
      clean({
        '@type': page.type,
        '@id': `${page.url}#article`,
        headline: page.title ? page.title.slice(0, 110) : undefined,
        description: page.description,
        image: page.image,
        datePublished: page.datePublished,
        dateModified: page.dateModified || page.datePublished,
        author: page.author ? { '@id': id.person(page.author.slug) } : undefined,
        publisher: { '@id': id.organization },
        mainEntityOfPage: { '@id': `${page.url}#webpage` },
        isPartOf: { '@id': id.website },
        about,
        mentions,
        inLanguage: page.inLanguage
      })
    );
  }
  const people = new Map<string, AuthorProfile>();
  if (page.author) people.set(page.author.slug, page.author);
  for (const a of opts.authors ?? []) if (page.type === 'AboutPage') people.set(a.slug, a);
  for (const a of people.values()) graph.push(personNode(a, org));
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Problems that make the graph weaker for E-E-A-T (shown next to the preview). */
export function graphWarnings(org: OrgProfile, page: PageEntityInput) {
  const w: string[] = [];
  if (!org.logo) w.push('La organización no tiene logo.');
  if ((org.sameAs?.length ?? 0) < 2) w.push('La organización tiene menos de 2 perfiles en sameAs (redes, Wikipedia, Google Business, directorios).');
  if (ARTICLE.has(page.type)) {
    if (!page.author) w.push('El artículo no tiene autor.');
    else {
      if (!page.author.description || page.author.description.length < 80) w.push(`La biografía de ${page.author.name} es muy corta (mínimo 80 caracteres).`);
      if (!page.author.sameAs?.length) w.push(`${page.author.name} no tiene perfiles verificables en sameAs (LinkedIn, X, ORCID…).`);
      if (!page.author.url) w.push(`${page.author.name} no tiene página de autor en el sitio.`);
    }
    if (!page.datePublished) w.push('Falta la fecha de publicación.');
    if (!page.about?.length) w.push('No indica de qué trata (about) con una entidad de Wikidata.');
  }
  return w;
}
