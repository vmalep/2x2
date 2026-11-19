/**
 * Test de bout en bout du circuit à quatre yeux, sur le fichier compilé ouvert en file://.
 * Pilote le Chrome du poste (playwright-core, aucun navigateur téléchargé).
 * Usage : npm run build && npm run e2e
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { lireCsv } from '../src/io/csv.ts';
import { chiffrerListe, dechiffrerListe } from '../src/model/fichier-liste.ts';

const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const URL_APP = 'file://' + resolve('dist/index.html');
const dossier = mkdtempSync(join(tmpdir(), '2x2-e2e-'));
const MDP_CLE = 'cle-de-test-123';
const MDP_LISTE = 'liste-de-test-456';

let echecs = 0;
function verifier(condition: boolean, message: string) {
  console.log(`${condition ? '  ✓' : '  ✗'} ${message}`);
  if (!condition) echecs++;
}

/** Attend qu'un élément soit visible (5 s au plus). */
async function visible(l: import('playwright-core').Locator): Promise<boolean> {
  try {
    await l.first().waitFor({ state: 'visible', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function telechargements(page: Page, nombre: number, action: () => Promise<void>): Promise<string[]> {
  const chemins: string[] = [];
  const attente = new Promise<void>((ok) => {
    page.on('download', async (d) => {
      const chemin = join(dossier, d.suggestedFilename());
      await d.saveAs(chemin);
      chemins.push(chemin);
      if (chemins.length === nombre) ok();
    });
  });
  await action();
  await attente;
  page.removeAllListeners('download');
  return chemins;
}

async function choisir(page: Page, chemin: string, action: () => Promise<void>) {
  const [selecteur] = await Promise.all([page.waitForEvent('filechooser'), action()]);
  await selecteur.setFiles(chemin);
}

/** Capture d'écran facultative (CAPTURES=1) pour relire le rendu des écrans. */
async function capture(page: Page, nom: string) {
  if (process.env.CAPTURES) await page.screenshot({ path: join(dossier, `capture_${nom}.png`), fullPage: false });
}

async function attendreFinTraitement(page: Page) {
  await page.locator('#voile').waitFor({ state: 'hidden', timeout: 30_000 });
}

async function creerCle(page: Page, nom: string) {
  await page.goto(URL_APP);
  await page.getByLabel('Votre nom').fill(nom);
  await page.getByLabel('Mot de passe de la clé').nth(1).fill(MDP_CLE);
  await page.getByLabel('Confirmer le mot de passe').fill(MDP_CLE);
  const fichiers = await telechargements(page, 2, () => page.getByRole('button', { name: 'Créer ma clé' }).click());
  await attendreFinTraitement(page);
  return { privee: fichiers.find((f) => f.endsWith('.2x2cle'))!, publique: fichiers.find((f) => f.endsWith('.json'))! };
}

async function deverrouiller(page: Page, cle: string) {
  await page.goto(URL_APP);
  await choisir(page, cle, () => page.getByRole('button', { name: 'Choisir…' }).click());
  await page.getByLabel('Mot de passe de la clé').first().fill(MDP_CLE);
  await page.getByRole('button', { name: 'Déverrouiller' }).click();
  await attendreFinTraitement(page);
}

async function ouvrirListe(page: Page, fichier: string) {
  await choisir(page, fichier, () => page.getByRole('button', { name: 'Choisir…' }).click());
  await page.getByLabel('Mot de passe de la liste').fill(MDP_LISTE);
  await page.getByRole('button', { name: 'Ouvrir et vérifier' }).click();
  await attendreFinTraitement(page);
}

async function enregistrer(page: Page): Promise<string> {
  const [f] = await telechargements(page, 1, () => page.getByRole('button', { name: /^Enregistrer/ }).click());
  await attendreFinTraitement(page);
  return f;
}

const navigateur = await chromium.launch({ executablePath: CHROME, headless: true });
const contexte = await navigateur.newContext({ acceptDownloads: true });
// Force le repli « téléchargement » (comportement de Firefox) : pas de boîte de dialogue en mode automatique.
await contexte.addInitScript(() => delete (window as any).showSaveFilePicker);
const page = await contexte.newPage();
const erreursConsole: string[] = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  erreursConsole.push(m.text());
  if (process.env.DEBUG) console.log('    [console] ' + m.text().slice(0, 60) + ' @ ' + page.url().slice(-20));
});
page.on('pageerror', (e) => erreursConsole.push(e.message));
const requetes: string[] = [];
page.on('request', (r) => !r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:') && requetes.push(r.url()));

try {
  console.log('Préparation : chacun crée sa clé');
  const alice = await creerCle(page, 'Alice Responsable');
  const bob = await creerCle(page, 'Bob Validateur');
  verifier(JSON.parse(readFileSync(bob.publique, 'utf8')).format === '2x2-cle-publique', 'clés publiques téléchargées');
  verifier(!readFileSync(alice.privee, 'utf8').includes('"d":'), 'la clé privée n’apparaît pas en clair dans le fichier de clé');

  console.log('Données fictives');
  await page.goto(URL_APP);
  await page.getByText('Données fictives pour la démonstration').click();
  const [xlsx] = await telechargements(page, 1, () => page.getByRole('button', { name: 'Télécharger (XLSX)' }).click());

  console.log('Import par Alice (responsable)');
  await deverrouiller(page, alice.privee);
  await page.getByRole('button', { name: 'Importer un export…' }).click();
  await choisir(page, xlsx, () => page.locator('.depot').click());
  await attendreFinTraitement(page);
  verifier(await visible(page.getByText('300 lignes, 22 colonnes')), 'export lu : 300 lignes, 22 colonnes');
  verifier((await page.locator('select').inputValue()) === 'id_menage', 'colonne d’identifiant proposée : id_menage');
  await choisir(page, bob.publique, () => page.getByRole('button', { name: 'Ajouter une clé publique…' }).click());
  await page.getByLabel('Alice Responsable : Correction').check();
  // Alice a aussi le rôle Validation : elle doit malgré tout être bloquée sur ses propres corrections.
  await page.getByLabel('Alice Responsable : Validation').check();
  await page.getByLabel('Bob Validateur : Correction').uncheck();
  await page.getByLabel('Bob Validateur : Validation').check();
  await page.getByLabel('Mot de passe', { exact: true }).fill(MDP_LISTE);
  await page.getByLabel('Confirmer', { exact: true }).fill(MDP_LISTE);
  const [liste1] = await telechargements(page, 1, () => page.getByRole('button', { name: 'Créer la liste chiffrée' }).click());
  await attendreFinTraitement(page);
  verifier(!readFileSync(liste1, 'utf8').includes('MN-0001'), 'le fichier de liste ne contient aucune donnée en clair');

  console.log('Correction par Alice');
  await page.getByRole('button', { name: /Correction/ }).first().click();
  await page.getByRole('cell', { name: 'MN-0002', exact: true }).click();
  const ligne = page.locator('.champ-menage', { has: page.locator('dt', { hasText: /^taille_menage$/ }) });
  const ancienne = (await ligne.locator('.valeur').textContent())!;
  await ligne.getByRole('button', { name: 'Corriger' }).click();
  await page.getByLabel('Nouvelle valeur').fill('3');
  await page.getByLabel('Motif').selectOption('Vérification terrain');
  await page.getByLabel('Commentaire', { exact: true }).fill('Visite du 15/09');
  await page.getByRole('button', { name: 'Signer la correction' }).click();
  await attendreFinTraitement(page);
  verifier(await visible(ligne.getByText('en attente')), `correction signée (${ancienne} → 3), en attente`);

  await page.getByRole('button', { name: /Validation/ }).click();
  verifier(await visible(page.getByText('Vous êtes l’auteur de cette correction')), 'Alice ne peut pas valider sa propre correction');
  verifier((await page.getByRole('button', { name: 'Accepter' }).count()) === 0, 'aucun bouton Accepter pour Alice');
  await page.getByRole('button', { name: /Export/ }).click();
  verifier(await visible(page.getByText('1 correction(s) en attente de validation')), 'export verrouillé tant qu’une correction attend');
  verifier(await page.getByRole('button', { name: 'CSV (paiement)' }).isDisabled(), 'bouton d’export de la liste finale désactivé');
  const liste2 = await enregistrer(page);

  console.log('Validation par Bob');
  await deverrouiller(page, bob.privee);
  await ouvrirListe(page, liste2);
  verifier(await visible(page.getByText('Journal intègre')), 'journal vérifié à l’ouverture');
  await page.getByRole('button', { name: /Validation/ }).click();
  await page.getByRole('button', { name: 'Accepter' }).click();
  await attendreFinTraitement(page);
  verifier((await page.locator('.compteur.ok .nombre').textContent()) === '1', 'correction acceptée par Bob');
  await page.getByRole('button', { name: /Correction/ }).first().click();
  await page.getByRole('cell', { name: 'MN-0002', exact: true }).click();
  verifier((await ligne.locator('.valeur').textContent()) === '3', 'la valeur corrigée est appliquée');

  console.log('Étape 2 : exclusion proposée par Bob ? Non : Bob n’a pas le rôle Correction');
  verifier((await page.getByRole('button', { name: 'Proposer l’exclusion' }).count()) === 0, 'pas de proposition d’exclusion sans rôle Correction');

  console.log('Étape 2 : décisions d’alerte par Bob');
  await page.getByRole('button', { name: /Alertes/ }).click();
  await page.locator('details.parametres summary').click();
  await capture(page, '1_alertes');
  await page.locator('details.parametres summary').click();
  const avant = Number(await page.locator('.compteur.attente .nombre').textContent());
  verifier(avant > 40, `${avant} alertes à décider sur les données fictives`);
  for (let i = 0; i < 200; i++) {
    const carte = page.locator('.carte-alerte').first();
    if (!(await carte.count())) break;
    const protection = (await carte.getAttribute('class'))!.includes('protection');
    await carte.getByLabel('Décision').selectOption(protection ? 'orientee' : 'verification_terrain');
    await carte.getByRole('button', { name: 'Signer la décision' }).click();
    await attendreFinTraitement(page);
  }
  verifier((await page.locator('.compteur.attente .nombre').textContent()) === '0', 'toutes les alertes ont une décision signée');

  console.log('Étape 2 : reçu de validation de Bob');
  await page.getByRole('button', { name: /Validation/ }).click();
  verifier(await visible(page.getByText(/décision\(s\) depuis votre dernier reçu/)), 'rappel de produire un reçu');
  await page.getByRole('button', { name: 'Produire mon reçu' }).click();
  await attendreFinTraitement(page);
  const recu = (await page.locator('pre.recu').textContent())!;
  await capture(page, '3_recu');
  verifier(recu.includes('2X2-RECU-1.'), 'reçu produit');
  const liste3 = await enregistrer(page);

  console.log('Étape 2 : exclusion proposée par Alice, validée par Bob');
  await deverrouiller(page, alice.privee);
  await ouvrirListe(page, liste3);
  await page.getByRole('button', { name: /Journal/ }).click();
  await page.getByLabel('Texte du reçu').fill(recu);
  await page.getByRole('button', { name: 'Vérifier le texte collé' }).click();
  await attendreFinTraitement(page);
  verifier(await visible(page.getByText('Reçu conforme.')), 'Alice confronte le fichier au reçu de Bob : conforme');
  await page.getByRole('button', { name: /Correction/ }).first().click();
  await page.getByRole('cell', { name: 'MN-0005', exact: true }).click();
  await capture(page, '2_fiche');
  await page.getByRole('button', { name: 'Proposer l’exclusion' }).click();
  await page.getByLabel('Motif').selectOption('Doublon');
  await page.getByLabel('Commentaire', { exact: true }).fill('Même ménage que MN-0004');
  const engagement = page.getByText('L’exclusion repose sur un autre motif');
  if (await engagement.count()) await engagement.click();
  await page.getByRole('button', { name: 'Signer la correction' }).click();
  await attendreFinTraitement(page);
  const liste4 = await enregistrer(page);
  await deverrouiller(page, bob.privee);
  await ouvrirListe(page, liste4);
  await page.getByRole('button', { name: /Validation/ }).click();
  await page.getByRole('button', { name: 'Accepter' }).click();
  await attendreFinTraitement(page);
  const liste5 = await enregistrer(page);

  console.log('Étape 2 : export par Alice');
  await deverrouiller(page, alice.privee);
  await ouvrirListe(page, liste5);
  await page.getByRole('button', { name: /Export/ }).click();
  verifier(await visible(page.getByText('299 inclus, 1 exclu(s)')), '299 ménages inclus, 1 exclu');
  const [csv] = await telechargements(page, 1, () => page.getByRole('button', { name: 'CSV (paiement)' }).click());
  await attendreFinTraitement(page);
  const finale = lireCsv(readFileSync(csv, 'utf8'));
  const iId = finale.colonnes.indexOf('id_menage');
  verifier(finale.lignes.length === 299 && !finale.lignes.some((l) => l[iId] === 'MN-0005'), 'liste finale CSV : 299 ménages, MN-0005 exclu');
  verifier(finale.lignes.find((l) => l[iId] === 'MN-0002')![finale.colonnes.indexOf('taille_menage')] === '3', 'liste finale : valeur corrigée');
  const [ods] = await telechargements(page, 1, () => page.getByRole('button', { name: 'ODS (LibreOffice)' }).nth(1).click());
  await attendreFinTraitement(page);
  verifier(ods.endsWith('.ods'), 'rapport des alertes en ODS');
  await choisir(page, csv, () => page.getByRole('button', { name: 'Choisir un fichier exporté…' }).click());
  await attendreFinTraitement(page);
  verifier(await visible(page.getByText('Export authentique.')), 'l’export CSV est reconnu par le journal');
  const retouche = join(dossier, 'liste_retouchee.csv');
  writeFileSync(retouche, readFileSync(csv, 'utf8').replace('MN-0001', 'MN-9999'));
  await choisir(page, retouche, () => page.getByRole('button', { name: 'Choisir un fichier exporté…' }).click());
  await attendreFinTraitement(page);
  verifier(await visible(page.getByText('Fichier inconnu du journal.')), 'un export retouché est rejeté');
  await capture(page, '4_export');
  const liste6 = await enregistrer(page);

  console.log('Étape 2 : suppression des dernières lignes, détectée par le reçu');
  const complete = await dechiffrerListe(readFileSync(liste6, 'utf8'), MDP_LISTE);
  const recuParse = /Journal : (\d+) lignes/.exec(recu)!;
  complete.journal.splice(Number(recuParse[1]) - 2);
  const tronquee = join(dossier, 'liste_tronquee.2x2');
  writeFileSync(tronquee, await chiffrerListe(complete, MDP_LISTE));
  await deverrouiller(page, alice.privee);
  await ouvrirListe(page, tronquee);
  verifier(await visible(page.getByText('Journal intègre')), 'la chaîne seule ne voit pas la troncature');
  await page.getByRole('button', { name: /Journal/ }).click();
  await page.getByLabel('Texte du reçu').fill(recu);
  await page.getByRole('button', { name: 'Vérifier le texte collé' }).click();
  await attendreFinTraitement(page);
  verifier(await visible(page.getByText(/Journal plus court que prévu/)), 'le reçu de Bob révèle les lignes supprimées');

  console.log('Altération du fichier (avec le mot de passe, hors de l’outil)');
  const contenu = await dechiffrerListe(readFileSync(liste3, 'utf8'), MDP_LISTE);
  const c = contenu.journal.find((e) => e.type === 'correction')!;
  (c.contenu as { nouvelle: string }).nouvelle = '9';
  const altere = join(dossier, 'liste_alteree.2x2');
  writeFileSync(altere, await chiffrerListe(contenu, MDP_LISTE));
  await deverrouiller(page, alice.privee);
  await ouvrirListe(page, altere);
  verifier(await visible(page.getByText('Journal altéré')), 'altération détectée à l’ouverture');
  verifier(await visible(page.getByText(/Altérations détectées/)), 'lecture seule et détail des erreurs affichés');

  verifier(erreursConsole.length === 0, `aucune erreur dans la console${erreursConsole.length ? ' : ' + erreursConsole.join(' | ') : ''}`);
  verifier(requetes.length === 0, `aucune requête réseau${requetes.length ? ' : ' + requetes.join(', ') : ''}`);
} finally {
  await page.screenshot({ path: join(dossier, 'derniere_page.png'), fullPage: true });
  await navigateur.close();
  console.log(`Fichiers du test : ${dossier}`);
}
if (echecs) {
  console.error(`${echecs} vérification(s) en échec.`);
  process.exit(1);
}
console.log('Parcours complet réussi.');
