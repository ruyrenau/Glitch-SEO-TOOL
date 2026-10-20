# Probar el plugin G.SEO – SEO en un WordPress real

WordPress Playground corre WordPress completo (PHP en WebAssembly) sin instalar nada.

```bash
cd docs/wordpress/testing
npx @wp-playground/cli@3.1.50 server --port 9400 --blueprint blueprint.json \
  --mount-dir "../gseo-seo" "/wordpress/wp-content/plugins/gseo-seo"
```

En Git Bash (Windows) antepón `MSYS_NO_PATHCONV=1` para que no cambie la ruta `/wordpress/...`.

El blueprint activa el plugin, crea páginas de prueba (una con noindex) y una contraseña de aplicación
(queda en http://127.0.0.1:9400/test-info.json, solo para esta copia desechable). Usuario: admin / password.

- `node check.mjs` – 22 verificaciones del sitio público, la API REST, redirecciones y 404.
- `npx playwright test e2e/wp-connect-real.spec.ts` (desde la raíz, con `pnpm build` hecho) – conexión de un
  clic completa: botón del plugin → G.SEO → aprobación en WordPress → conectado. Se omite si :9400 no responde.
