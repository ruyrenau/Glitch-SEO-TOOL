import { describe, it, expect } from 'vitest';
import { parseSitemapXml, isPrivateAddress, assertSafeUrl } from '@glitch/crawler';

describe('parseSitemapXml', () => {
  it('parses a urlset with lastmod and entities', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/a/</loc><lastmod>2026-09-01</lastmod></url>
      <url><loc>https://example.com/b?x=1&amp;y=2</loc></url>
      <url><loc>not a url</loc></url></urlset>`;
    const r = parseSitemapXml(xml);
    expect(r.kind).toBe('urlset');
    expect(r.urls.map(u => u.path)).toEqual(['/a/', '/b?x=1&y=2']);
    expect(r.urls[0].lastmod?.toISOString().slice(0, 10)).toBe('2026-09-01');
  });
  it('parses a sitemap index', () => {
    const xml = `<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap><sitemap><loc>https://example.com/s2.xml</loc></sitemap></sitemapindex>`;
    const r = parseSitemapXml(xml);
    expect(r.kind).toBe('sitemapindex');
    expect(r.childSitemaps).toHaveLength(2);
  });
  it('does not expand DTD entities (XXE)', () => {
    const xml = `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><urlset><url><loc>https://example.com/&e;</loc></url></urlset>`;
    expect(parseSitemapXml(xml).urls[0].url).toBe('https://example.com/&e;');
  });
});

describe('SSRF guard', () => {
  it.each(['127.0.0.1', '10.0.0.5', '172.16.3.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1'])(
    '%s is private',
    ip => {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  );
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700::1111'])('%s is public', ip => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it('rejects non-http schemes, credentials and private hosts', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(/scheme/);
    await expect(assertSafeUrl('http://user:pw@example.com/')).rejects.toThrow(/credentials/);
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/private/);
    await expect(assertSafeUrl('http://localhost:4000/')).rejects.toThrow(/private/);
  });
  it('honors the development allowlist', async () => {
    await expect(assertSafeUrl('http://localhost:4000/sitemap.xml', { allowHosts: ['localhost'] })).resolves.toBeInstanceOf(URL);
  });
});
