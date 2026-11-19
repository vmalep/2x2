/**
 * Écrit un jeu de données fictives dans le dossier fictif/ :
 * export Kobo simulé (CSV et XLSX) et vérité des anomalies plantées (JSON).
 * Usage : npm run fictif -- [graine] [nombre de ménages]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { genererDonneesFictives } from '../src/gen/fictif.ts';
import { ecrireCsv } from '../src/io/csv.ts';
import { ecrireXlsx } from '../src/io/xlsx.ts';

const graine = Number(process.argv[2] ?? 2026);
const menages = Number(process.argv[3] ?? 300);
const { tableau, verite, enqueteursSuspects } = genererDonneesFictives({ graine, menages });
mkdirSync('fictif', { recursive: true });
const base = `fictif/kobo_fictif_${graine}`;
writeFileSync(`${base}.csv`, ecrireCsv(tableau, ','));
writeFileSync(`${base}.xlsx`, await ecrireXlsx([{ nom: 'donnees_fictives', tableau }]));
writeFileSync(`${base}_verite.json`, JSON.stringify({ graine, menages, enqueteursSuspects, verite }, null, 2));
console.log(`Écrit : ${base}.csv, ${base}.xlsx, ${base}_verite.json`);
for (const [a, ids] of Object.entries(verite)) console.log(`  ${a} : ${ids.length}`);
