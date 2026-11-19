import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Ajoute une Content-Security-Policy stricte au fichier HTML final.
 * Chaque script et chaque style inline est autorisé par son empreinte SHA-256,
 * et toute requête réseau est interdite (connect-src 'none', default-src 'none').
 */
function cspStricte(): Plugin {
  const empreinte = (contenu: string) =>
    `'sha256-${createHash('sha256').update(contenu, 'utf8').digest('base64')}'`;
  return {
    name: '2x2-csp',
    enforce: 'post',
    apply: 'build',
    // Après l'écriture sur disque, une fois le code et les styles intégrés au HTML.
    writeBundle(options, bundle) {
      for (const fichier of Object.values(bundle)) {
        if (!fichier.fileName.endsWith('.html')) continue;
        const chemin = join(options.dir ?? 'dist', fichier.fileName);
        let html = readFileSync(chemin, 'utf8');
        const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => empreinte(m[1]));
        // Les styles sont cherchés hors des scripts : le code peut contenir du texte « <style… » (ODS).
        const horsScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
        const styles = [...horsScripts.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map((m) => empreinte(m[1]));
        if (scripts.length !== 1 || styles.length !== 1) {
          this.error(`HTML final inattendu : ${scripts.length} script(s) et ${styles.length} style(s) au lieu d'un seul de chaque.`);
        }
        if (/<(script|link)\b[^>]*\b(src|href)=/i.test(html)) {
          this.error('Ressource non intégrée détectée dans le HTML final : interdit.');
        }
        const politique = [
          "default-src 'none'",
          `script-src ${scripts.join(' ')}`,
          `style-src ${styles.join(' ')}`,
          'img-src data: blob:',
          "connect-src 'none'",
          "font-src 'none'",
          "object-src 'none'",
          "worker-src 'none'",
          "frame-src 'none'",
          "form-action 'none'",
          "base-uri 'none'",
        ].join('; ');
        html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${politique}">`);
        writeFileSync(chemin, html);
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true }), cspStricte()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 100_000_000,
    modulePreload: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
