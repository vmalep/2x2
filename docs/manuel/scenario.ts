/**
 * Scénario de démonstration pour le manuel : trois personnes (Responsable, Correction, Validation)
 * traitent une liste FICTIVE de bout en bout, et des copies d'écran sont prises à chaque étape.
 *
 * Usage : npm run build && npx tsx docs/manuel/scenario.ts
 * Sortie : docs/manuel/sortie/captures/*.png (dossier ignoré par git).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { clePubliqueEnTexte } from '../../src/crypto/cles.ts';
import { CENTRES } from '../../src/gen/fictif.ts';
import { lireCsv } from '../../src/io/csv.ts';
import { ecrireXlsx, lireXlsx } from '../../src/io/xlsx.ts';

const VERSION: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
const URL_APP = 'file://' + resolve(`dist/2x2-v${VERSION}.html`);
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const SORTIE = resolve('docs/manuel/sortie');
const CAPTURES = join(SORTIE, 'captures');
const FICHIERS = join(SORTIE, 'fichiers');
const MDP_CLE = 'cle-de-demonstration-123';
const MDP_LISTE = 'liste-de-demonstration-456';
const RACHEL = 'Rachel Responsable';
const PAUL = 'Paul Correction';
const VICTOR = 'Victor Validation';

rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(CAPTURES, { recursive: true });
mkdirSync(FICHIERS, { recursive: true });

const navigateur = await chromium.launch({ executablePath: CHROME, headless: true });
const contexte = await navigateur.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2, locale: 'fr-FR' });
// Comme sous Firefox : enregistrement par téléchargement (pas de boîte de dialogue en mode automatique).
await contexte.addInitScript(() => delete (window as any).showSaveFilePicker);
const page = await contexte.newPage();
page.on('pageerror', (e) => console.error('  [erreur page]', e.message));

async function attendre(p: Page) {
  await p.locator('#voile').waitFor({ state: 'hidden', timeout: 60_000 });
}

async function telecharger(action: () => Promise<void>): Promise<string> {
  const [d] = await Promise.all([page.waitForEvent('download'), action()]);
  const chemin = join(FICHIERS, d.suggestedFilename());
  await d.saveAs(chemin);
  return chemin;
}

async function choisir(chemin: string, action: () => Promise<void>) {
  const [s] = await Promise.all([page.waitForEvent('filechooser'), action()]);
  await s.setFiles(chemin);
}

/** Copie d'écran (sans les notifications, qui masqueraient l'écran). */
async function capture(nom: string, cible?: import('playwright-core').Locator) {
  await page.evaluate(() => document.querySelectorAll('#notifications .notification').forEach((n) => n.remove()));
  await page.waitForTimeout(250);
  const chemin = join(CAPTURES, `${nom}.png`);
  if (cible) {
    // L'en-tête collant de la page recouvrirait le haut de la zone capturée : on le libère le temps de la capture.
    await page.evaluate(() => document.querySelector<HTMLElement>('.entete')?.style.setProperty('position', 'static'));
    await cible.scrollIntoViewIfNeeded();
    await cible.screenshot({ path: chemin });
    await page.evaluate(() => document.querySelector<HTMLElement>('.entete')?.style.removeProperty('position'));
  } else await page.screenshot({ path: chemin });
  console.log('  📷', nom);
}

async function creerCle(nom: string, captures = false) {
  await page.goto(URL_APP);
  await page.getByLabel('Votre nom').fill(nom);
  await page.getByLabel('Mot de passe de la clé').nth(1).fill(MDP_CLE);
  await page.getByLabel('Confirmer le mot de passe').fill(MDP_CLE);
  if (captures) await capture('02_creer_cle');
  const privee = await telecharger(() => page.getByRole('button', { name: 'Créer ma clé' }).click());
  await attendre(page);
  if (captures) await capture('03_cle_creee');
  const publique = await telecharger(() => page.getByRole('button', { name: 'Télécharger ma clé publique (.json)' }).click());
  return { privee, publique };
}

async function deverrouiller(cle: string) {
  await page.goto(URL_APP);
  await choisir(cle, () => page.getByRole('button', { name: 'Choisir…' }).click());
  await page.getByLabel('Mot de passe de la clé').first().fill(MDP_CLE);
  await page.getByRole('button', { name: 'Déverrouiller' }).click();
  await attendre(page);
}

async function ouvrirListe(fichier: string) {
  await choisir(fichier, () => page.getByRole('button', { name: 'Choisir…' }).click());
  await page.getByLabel('Mot de passe de la liste').fill(MDP_LISTE);
  await page.getByRole('button', { name: 'Ouvrir et vérifier' }).click();
  await attendre(page);
}

async function enregistrer(): Promise<string> {
  const f = await telecharger(() => page.getByRole('button', { name: /^Enregistrer/ }).click());
  await attendre(page);
  return f;
}

const nav = (nom: RegExp) => page.locator('nav.navigation').getByRole('button', { name: nom });

/** Valeur d'une option de liste déroulante d'après le début de son texte. */
async function optionDont(select: string, debut: string): Promise<string> {
  return page.getByLabel(select, { exact: true }).locator('option').evaluateAll((opts, d) => {
    const o = (opts as HTMLOptionElement[]).find((x) => x.textContent?.startsWith(d));
    if (!o) throw new Error(`Option introuvable : ${d}`);
    return o.value;
  }, debut);
}

async function filtrer(select: string, debut: string) {
  await page.getByLabel(select, { exact: true }).selectOption(await optionDont(select, debut));
}

/** Fond de carte FICTIF (routes, pistes, rivière, villages inventés) pour illustrer le plan. */
function fondFictif(): string {
  const v = Object.entries(CENTRES).map(([nom, [lat, lon]]) => ({ nom, lat, lon }));
  const p = (x: { lat: number; lon: number }) => [x.lon, x.lat];
  const ligne = (props: object, coords: number[][]) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
  const nord = v.filter((x) => x.nom.includes(' N-'));
  const sud = v.filter((x) => x.nom.includes(' S-'));
  const features = [
    ligne({ highway: 'secondary' }, [[18.22, -4.05], ...[...nord].sort((a, b) => a.lon - b.lon).map(p), [18.5, -4.1]]),
    ligne({ highway: 'secondary' }, [p(nord[3]), [18.37, -4.25], p(sud[1])]),
    ligne({ highway: 'unclassified' }, [...sud].sort((a, b) => a.lon - b.lon).map(p)),
    ...v.map((x, i) => ligne({ highway: 'track' }, [p(x), [x.lon + (i % 2 ? 0.03 : -0.025), x.lat + (i % 3 ? 0.02 : -0.03)]])),
    ligne({ waterway: 'river', name: 'Rivière fictive' }, [[18.2, -3.98], [18.27, -4.08], [18.33, -4.22], [18.31, -4.3], [18.36, -4.42], [18.45, -4.5]]),
    { type: 'Feature', properties: { natural: 'water' }, geometry: { type: 'Polygon', coordinates: [[[18.43, -4.24], [18.46, -4.235], [18.47, -4.255], [18.44, -4.265], [18.43, -4.24]]] } },
    ...v.map((x) => ({ type: 'Feature', properties: { place: 'village', name: x.nom }, geometry: { type: 'Point', coordinates: p(x) } })),
  ];
  return JSON.stringify({ type: 'FeatureCollection', features });
}

try {
  console.log('1. Accueil et clés');
  await page.goto(URL_APP);
  await capture('01_accueil');
  const rachel = await creerCle(RACHEL, true);
  const paul = await creerCle(PAUL);
  const victor = await creerCle(VICTOR);

  console.log('2. Données fictives');
  await page.goto(URL_APP);
  await page.getByText('Données fictives pour la démonstration').click();
  const xlsx = await telecharger(() => page.getByRole('button', { name: 'Télécharger (XLSX)' }).click());
  const donnees = await lireXlsx(new Uint8Array(readFileSync(xlsx)));
  const gpsDe = new Map(donnees.lignes.map((l) => [l[donnees.colonnes.indexOf('id_menage')], l[donnees.colonnes.indexOf('gps')]]));

  console.log('3. Rachel crée la liste');
  await deverrouiller(rachel.privee);
  await capture('04_bonjour');
  await page.getByRole('button', { name: 'Importer un export…' }).click();
  await choisir(xlsx, () => page.locator('.depot').click());
  await attendre(page);
  await capture('05_import_apercu');
  // Victor envoie son fichier de clé publique ; Paul colle la sienne dans un message.
  await choisir(victor.publique, () => page.getByRole('button', { name: 'Ajouter une clé publique (fichier)…' }).click());
  await page.getByText('Coller une clé publique reçue par message').click();
  await page.getByLabel('Clé publique collée').fill(clePubliqueEnTexte(JSON.parse(readFileSync(paul.publique, 'utf8'))));
  await page.getByRole('button', { name: 'Ajouter cette clé' }).click();
  // Rôles : Rachel responsable seulement, Paul correction, Victor validation.
  const role = async (nom: string, r: string, oui: boolean) => {
    const c = page.getByLabel(`${nom} : ${r}`);
    if ((await c.isChecked()) !== oui) await c.click();
  };
  await role(RACHEL, 'Correction', false);
  await role(RACHEL, 'Validation', false);
  await role(PAUL, 'Correction', true);
  await role(PAUL, 'Validation', false);
  await role(VICTOR, 'Correction', false);
  await role(VICTOR, 'Validation', true);
  await page.getByLabel('Mot de passe', { exact: true }).fill(MDP_LISTE);
  await page.getByLabel('Confirmer', { exact: true }).fill(MDP_LISTE);
  await page.locator('table').filter({ hasText: VICTOR }).first().scrollIntoViewIfNeeded();
  await capture('06_import_roles');
  await telecharger(() => page.getByRole('button', { name: 'Créer la liste chiffrée' }).click());
  await attendre(page);
  await capture('07_liste_creee');

  console.log('4. Rachel : règles, alertes, plan, liste de visite');
  await nav(/Validation/).click();
  await page.locator('details.regles-controle summary').click();
  await capture('08_regles', page.locator('details.regles-controle'));
  await page.locator('details.regles-controle summary').click();
  await filtrer('Filtrer Contrôle / champ', 'Entretien anormalement court');
  await page.getByLabel('Cocher toutes les lignes à décider affichées').check();
  await page.getByLabel('Décision pour la sélection').selectOption('verification_terrain');
  await page.getByLabel('Commentaire', { exact: true }).fill('Entretiens trop courts : visite de contrôle');
  await page.locator('.barre-groupe').scrollIntoViewIfNeeded();
  await capture('09_validation_lot');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /^Signer pour \d+ ligne/ }).click();
  await attendre(page);

  await nav(/Correction/).first().click();
  await page.getByRole('button', { name: 'Plan GPS' }).click();
  const fond = join(FICHIERS, 'fond_de_carte_fictif.geojson');
  writeFileSync(fond, fondFictif());
  await choisir(fond, () => page.getByRole('button', { name: 'Charger un fond de carte…' }).click());
  await attendre(page);
  await page.locator('.zone-plan').scrollIntoViewIfNeeded();
  await capture('10_plan');
  await filtrer('Filtrer Alertes', 'Entretiens groupés au même endroit');
  await page.waitForTimeout(300);
  await capture('11_plan_groupes', page.locator('.zone-plan'));
  await page.getByRole('button', { name: 'Afficher la liste' }).click();
  await page.getByRole('button', { name: 'Réinitialiser filtres et tri' }).click();

  await filtrer('Filtrer Alertes', 'À vérifier sur le terrain');
  await page.getByLabel('Cocher tous les ménages filtrés').check();
  await page.getByRole('button', { name: /^Liste de visite \(/ }).click();
  await page.getByLabel('Étiquette Kobo, colonne 1').selectOption('village');
  await page.getByLabel('Étiquette Kobo, colonne 2').selectOption('nom_chef_menage');
  await page.locator('.panneau-visite').scrollIntoViewIfNeeded();
  await capture('12_liste_visite', page.locator('.panneau-visite'));
  page.once('dialog', (d) => d.accept());
  const prechargement = await telecharger(() => page.getByRole('button', { name: /^Exporter \d+ ménage/ }).click());
  await attendre(page);
  await page.getByRole('button', { name: 'Tout décocher' }).click();
  await page.getByRole('button', { name: 'Réinitialiser filtres et tri' }).click();
  const liste2 = await enregistrer();

  console.log('5. Paul corrige');
  await deverrouiller(paul.privee);
  await ouvrirListe(liste2);
  await capture('13_correction_tableau');
  await filtrer('Filtrer Alertes', 'Lien vers le ménage hôte invalide');
  await page.locator('.tableau.menages tbody tr').first().locator('td').nth(1).click();
  await page.locator('.fiche').scrollIntoViewIfNeeded();
  await capture('14_fiche_menage');
  await page.getByRole('button', { name: 'Réinitialiser filtres et tri' }).click();

  await filtrer('Filtrer Alertes', 'Téléphone en double');
  await page.locator('.tableau.menages tbody tr').first().locator('td').nth(1).click();
  const ligneTel = page.locator('.champ-menage', { has: page.locator('dt', { hasText: /^telephone$/ }) });
  await ligneTel.getByRole('button', { name: 'Corriger' }).click();
  await page.getByLabel('Nouvelle valeur').fill('+243810000001');
  await page.getByLabel('Motif', { exact: true }).selectOption('Erreur de saisie');
  await page.getByLabel('Commentaire', { exact: true }).fill('Numéro confirmé par appel au ménage');
  await page.locator('.form-correction').scrollIntoViewIfNeeded();
  await capture('15_correction_saisie');
  await page.getByRole('button', { name: 'Signer la correction' }).click();
  await attendre(page);
  await page.getByRole('button', { name: 'Réinitialiser filtres et tri' }).click();

  await filtrer('Filtrer Alertes', 'Pièce d’identité en double');
  await page.locator('.tableau.menages tbody tr').first().locator('td').nth(1).click();
  await page.locator('.alertes-menage').getByRole('button', { name: /Comparer les 2 ménages/ }).first().click();
  const choixMenages = page.locator('select.decision-menage');
  await choixMenages.nth(0).selectOption('conserver');
  await choixMenages.nth(1).selectOption('exclure:Doublon');
  await page.getByLabel('Commentaire de la décision du groupe').fill('Même personne, même pièce saisie deux fois');
  await page.locator('.decision-groupe').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -260);
  await capture('16_comparaison');
  await page.getByRole('button', { name: /^Signer/ }).click();
  await attendre(page);
  await page.getByRole('button', { name: '← Retour à la liste' }).click();
  await page.getByRole('button', { name: 'Réinitialiser filtres et tri' }).click();
  const liste3 = await enregistrer();

  console.log('6. Victor valide');
  await deverrouiller(victor.privee);
  await ouvrirListe(liste3);
  await nav(/Validation/).click();
  await page.getByLabel('Filtrer Type', { exact: true }).selectOption('Correction');
  await page.getByLabel('Cocher toutes les lignes à décider affichées').check();
  await page.getByLabel('Décision pour la sélection').selectOption('acceptee');
  await capture('17_validation_corrections');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /^Signer pour \d+ ligne/ }).click();
  await attendre(page);
  await page.getByRole('button', { name: 'Produire mon reçu' }).click();
  await attendre(page);
  await page.locator('pre.recu').scrollIntoViewIfNeeded();
  await capture('18_recu', page.locator('.carte', { has: page.locator('pre.recu') }));
  const liste4 = await enregistrer();

  console.log('7. Rachel : retours du terrain, dernières décisions, export');
  // Réponses simulées au formulaire Kobo de revisite, pour une partie des ménages visités.
  const pre = lireCsv(readFileSync(prechargement, 'utf8'));
  const resultats: string[][] = ['conforme', 'non', 'conforme', 'donnee_fausse', 'conforme', 'a_exclure'].map((r, i) => {
    const id = pre.lignes[i][0];
    const gps = gpsDe.get(id) || '';
    return [
      '2026-12-02', id, r === 'non' ? 'non' : 'oui', r === 'non' ? '' : r,
      r === 'donnee_fausse' ? 'taille_menage' : '', r === 'donnee_fausse' ? '6' : '',
      r === 'a_exclure' ? 'menage_parti_ou_dissous' : '',
      { conforme: 'Ménage rencontré, données confirmées', non: 'Personne ne connaît ce ménage', donnee_fausse: 'Six personnes comptées', a_exclure: 'Ménage parti en novembre' }[r]!,
      gps, 'Équipe terrain A',
    ];
  });
  const reponses = join(FICHIERS, 'reponses_revisite_simulees.xlsx');
  writeFileSync(
    reponses,
    await ecrireXlsx([
      {
        nom: 'Réponses',
        tableau: { colonnes: ['today', 'menage', 'trouve', 'resultat', 'champ', 'valeur', 'motif_exclusion', 'constat', 'gps_visite', 'visiteur'], lignes: resultats },
      },
    ]),
  );
  await deverrouiller(rachel.privee);
  await ouvrirListe(liste4);
  await choisir(reponses, () => page.getByRole('button', { name: 'Retours du terrain…' }).click());
  await page.locator('.tableau.retours').waitFor();
  await page.locator('.panneau-retours').scrollIntoViewIfNeeded();
  await capture('19_retours_terrain', page.locator('.panneau-retours'));
  const signer = page.getByRole('button', { name: /^Signer \d+ action/ });
  if (await signer.isEnabled()) {
    page.once('dialog', (d) => d.accept());
    await signer.click();
    await attendre(page);
  } else {
    await page.getByRole('button', { name: 'Abandonner ces retours' }).click();
  }

  // Dernières alertes : décidées en lot (pour la démonstration).
  await nav(/Validation/).click();
  for (let i = 0; i < 3; i++) {
    const reste = Number(await page.locator('.compteur.attente .nombre').nth(1).textContent());
    if (!reste) break;
    await page.getByRole('button', { name: 'Réinitialiser filtres et tri' }).click();
    await page.getByLabel('Filtrer Type', { exact: true }).selectOption('Alerte');
    await page.getByLabel('Cocher toutes les lignes à décider affichées').check();
    await page.getByLabel('Décision pour la sélection').selectOption('faux_positif');
    await page.getByLabel('Commentaire', { exact: true }).fill('Revu avec l’équipe : pas de problème');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /^Signer pour \d+ ligne/ }).click();
    await attendre(page);
  }
  await nav(/Export/).click();
  await capture('20_export');
  await telecharger(() => page.getByRole('button', { name: 'CSV (paiement)' }).click());
  await attendre(page);
  await page.getByRole('button', { name: /Journal/ }).first().click();
  await capture('21_journal');
  await page.locator('nav.navigation').getByRole('button', { name: /Aide/ }).click();
  await capture('22_aide');
  console.log(`Captures : ${CAPTURES}`);
} finally {
  await navigateur.close();
}
