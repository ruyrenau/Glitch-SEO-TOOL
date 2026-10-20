import zlib from 'zlib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@glitch/db';
import { startMockWordPress, MockWordPress } from '@glitch/testing';
import { buildAuthedApp, loginAs } from './helpers';

let app: FastifyInstance;
let wp: MockWordPress;
let siteId: string;
let postUrl: string;
let postId: number;

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

/** Reads the entries of a zip (central directory) and inflates one. */
function readZip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries[name] = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + compSize));
    p += 46 + nameLen + extra + comment;
  }
  return entries;
}

beforeAll(async () => {
  process.env.CRAWL_ALLOW_PRIVATE_HOSTS = '127.0.0.1';
  wp = await startMockWordPress();
  ({ app } = await buildAuthedApp());
  siteId = (await post('/api/v1/sites', { name: 'Glitch WP', domain: new URL(wp.url).hostname, canonicalUrl: wp.url })).json().id;
  await app.inject({ method: 'PUT', url: `/api/v1/sites/${siteId}/wordpress`, payload: { endpointUrl: wp.url, username: wp.username, appPassword: wp.appPassword } });
  postId = wp.addPublished({ slug: 'servicios', title: 'Servicios', seoTitle: '', metaDescription: 'Texto viejo' }).id;
  postUrl = `${wp.url}/servicios/`;
});
afterAll(async () => {
  delete process.env.CRAWL_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await wp.close();
  await prisma.$disconnect();
});

describe('Plugin G.SEO – SEO', () => {
  it('downloads as a zip WordPress can install (gseo-seo/ folder with the plugin header)', async () => {
    const r = await app.inject('/api/v1/downloads/plugin/gseo-seo.zip');
    expect(r.headers['content-type']).toBe('application/zip');
    const files = readZip(r.rawPayload);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['gseo-seo/gseo-seo.php', 'gseo-seo/includes/head.php', 'gseo-seo/includes/redirects.php', 'gseo-seo/uninstall.php']));
    expect(files['gseo-seo/gseo-seo.php'].toString()).toMatch(/Plugin Name:\s+G\.SEO – SEO/);
  });

  it('reports what the connected WordPress has, before and after installing the plugin', async () => {
    expect((await app.inject(`/api/v1/sites/${siteId}/wordpress/seo-plugin`)).json()).toMatchObject({ connected: true, plugin: null, seoFields: 'yoast', redirects: null });
    expect((await post(`/api/v1/sites/${siteId}/wordpress/llms`, { llms: '# Sitio' })).json().error.code).toBe('GSEO_PLUGIN_MISSING');
    wp.enableGseoPlugin();
    expect((await app.inject(`/api/v1/sites/${siteId}/wordpress/seo-plugin`)).json()).toMatchObject({ connected: true, plugin: { version: '1.0.0', active: true }, seoFields: 'gseo', redirects: 'gseo' });
  });

  it('Cambios SEO edits the plugin fields (meta description, SEO title)', async () => {
    const id = (await post(`/api/v1/sites/${siteId}/seo-edits`, { url: postUrl, field: 'metaDescription', newValue: 'Auditorías SEO técnicas en Puebla.' })).json().id;
    await post(`/api/v1/seo-edits/${id}/review`, { decision: 'approved' });
    expect((await post(`/api/v1/seo-edits/${id}/apply`, { confirm: true })).json().status).toBe('applied');
    expect([...wp.posts.values()].find(p => p.id === postId)?.meta).toMatchObject({ _gseo_description: 'Auditorías SEO técnicas en Puebla.' });
    expect((await post(`/api/v1/seo-edits/${id}/verify`, {})).json().verifyStatus).toBe('verified');
  });

  it('Arquitectura sends 301s to the plugin', async () => {
    const r = (await post(`/api/v1/sites/${siteId}/architecture/redirects/wordpress`, { rules: [{ from: '/vieja/', to: postUrl }] })).json();
    expect(r).toMatchObject({ created: 1, failed: 0 });
    expect([...wp.gseoRedirects.values()]).toEqual([{ source: '/vieja/', target: postUrl, code: 301 }]);
  });

  it('publishes llms.txt through the plugin; viewers cannot', async () => {
    const r = (await post(`/api/v1/sites/${siteId}/wordpress/llms`, { llms: '# Glitch\n\n> Diseño y SEO.\n', full: null })).json();
    expect(r.url).toBe(`${new URL(wp.url).origin}/llms.txt`);
    expect(wp.gseoSettings).toMatchObject({ llms_txt: '# Glitch\n\n> Diseño y SEO.\n', llms_full_txt: '' });
    const viewer = await loginAs(app, 'VIEWER');
    expect((await app.inject({ method: 'POST', url: `/api/v1/sites/${siteId}/wordpress/llms`, headers: { cookie: viewer.cookie }, payload: { llms: '# x' } })).statusCode).toBe(403);
  });
});
