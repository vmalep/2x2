/**
 * Test de bout en bout du circuit à quatre yeux, sur le fichier compilé ouvert en file://.
 * Pilote le Chrome du poste (playwright-core, aucun navigateur téléchargé).
 * Usage : npm run build && npm run e2e
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { clePubliqueEnTexte } from '../src/crypto/cles.ts';
import { lireCsv } from '../src/io/csv.ts';
import { lireXlsx, ecrireXlsx } from '../src/io/xlsx.ts';
import { ecrireZip } from '../src/io/zip.ts';
import { chiffrerListe, dechiffrerListe } from '../src/model/fichier-liste.ts';
import { DICTIONNAIRES, sansMiseEnForme, tl, type Cle, type Langue, type Params } from '../src/i18n/index.ts';

const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const VERSION: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
const URL_APP = 'file://' + resolve(`dist/2x2-v${VERSION}.html`);
/** Le parcours est joué dans chaque langue (LANGUES=fr,en par défaut) ; les textes viennent des dictionnaires. */
const LANGUES = (process.env.LANGUES ?? 'fr,en').split(',').map((l) => l.trim()) as Langue[];
let L: Langue = 'fr';
let dossier = '';
const T = (cle: Cle, p?: Params) => tl(L, cle, p);
const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Expression régulière : le texte traduit, au début du nom. */
const debut = (cle: Cle, p?: Params) => new RegExp('^' + echapper(T(cle, p)));
/** Texte d'un modèle avant son premier paramètre (pour un nombre inconnu à l'avance). */
const prefixe = (cle: Cle) => sansMiseEnForme(DICTIONNAIRES[L][cle].split('{')[0]);
/** Première phrase d'un texte traduit (le reste dépend des données). */
const phrase = (cle: Cle, p?: Params) => T(cle, p).split(/[.:]/)[0].trim();
/** Nom accessible d'un filtre de colonne. */
const filtre = (titre: string) => T('commun.filtrer_col', { titre });
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

/** Nombre affiché entre parenthèses dans une option de filtre de l'écran Validation. */
async function compteFiltre(page: Page, filtre: string, valeur: string): Promise<number> {
  const t = await page.getByLabel(filtre, { exact: true }).locator(`option[value="${valeur}"]`).textContent();
  return Number(t?.match(/\((\d+)\)$/)?.[1] ?? 0);
}

/** Écran Validation : coche les lignes affichées, choisit la décision et signe. */
async function deciderSelection(page: Page, decision: string, attendu: number, commentaire = '') {
  await page.getByLabel(T('validation.cocher_tout')).check();
  await page.getByLabel(T('validation.decision_selection')).selectOption(decision);
  if (commentaire) await page.getByLabel(T('commun.commentaire'), { exact: true }).fill(commentaire);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: debut('validation.signer_pour', { n: attendu }) }).click();
  await attendreFinTraitement(page);
}

/** Capture d'écran facultative (CAPTURES=1) pour relire le rendu des écrans. */
async function capture(page: Page, nom: string) {
  if (process.env.CAPTURES) await page.screenshot({ path: join(dossier, `capture_${nom}.png`), fullPage: process.env.CAPTURES === 'complet' });
}

async function attendreFinTraitement(page: Page) {
  await page.locator('#voile').waitFor({ state: 'hidden', timeout: 30_000 });
}

async function creerCle(page: Page, nom: string) {
  await page.goto(URL_APP);
  await page.getByLabel(T('accueil.votre_nom')).fill(nom);
  await page.getByLabel(T('accueil.mdp_cle')).nth(1).fill(MDP_CLE);
  await page.getByLabel(T('accueil.confirmer_mdp')).fill(MDP_CLE);
  // Un seul enregistrement à la création (la clé privée), puis la clé publique depuis l'encadré de partage.
  const [privee] = await telechargements(page, 1, () => page.getByRole('button', { name: T('accueil.creer_cle') }).click());
  await attendreFinTraitement(page);
  const [publique] = await telechargements(page, 1, () => page.getByRole('button', { name: T('accueil.telecharger_cle') }).click());
  return { privee, publique };
}

async function deverrouiller(page: Page, cle: string) {
  await page.goto(URL_APP);
  await choisir(page, cle, () => page.getByRole('button', { name: T('commun.choisir') }).click());
  await page.getByLabel(T('accueil.mdp_cle')).first().fill(MDP_CLE);
  await page.getByRole('button', { name: T('accueil.deverrouiller') }).click();
  await attendreFinTraitement(page);
}

async function ouvrirListe(page: Page, fichier: string) {
  await choisir(page, fichier, () => page.getByRole('button', { name: T('commun.choisir') }).click());
  await page.getByLabel(T('accueil.mdp_liste')).fill(MDP_LISTE);
  await page.getByRole('button', { name: T('accueil.ouvrir_verifier') }).click();
  await attendreFinTraitement(page);
}

async function enregistrer(page: Page): Promise<string> {
  const [f] = await telechargements(page, 1, () => page.getByRole('button', { name: debut('entete.enregistrer_telecharger') }).click());
  await attendreFinTraitement(page);
  return f;
}

const navigateur = await chromium.launch({ executablePath: CHROME, headless: true });
let echecsAvant = 0;
for (const langue of LANGUES) {
  L = langue;
  dossier = mkdtempSync(join(tmpdir(), `2x2-e2e-${langue}-`));
  console.log(`\n=== Parcours complet en ${langue.toUpperCase()} (langue du navigateur : ${langue}) ===`);
  await parcours();
  if (echecs > echecsAvant) console.error(`${echecs - echecsAvant} vérification(s) en échec en ${langue}.`);
  echecsAvant = echecs;
}
await navigateur.close();
if (echecs) {
  console.error(`${echecs} vérification(s) en échec.`);
  process.exit(1);
}
console.log(`Parcours complet réussi (${LANGUES.join(', ')}).`);

async function parcours() {
  // La langue de départ suit celle du navigateur.
  const contexte = await navigateur.newContext({ acceptDownloads: true, locale: L === 'fr' ? 'fr-FR' : 'en-US' });
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
    console.log('Langue de l’interface');
    await page.goto(URL_APP);
    verifier((await page.evaluate(() => document.documentElement.lang)) === L, `langue de départ : celle du navigateur (${L})`);
    const autre: Langue = L === 'fr' ? 'en' : 'fr';
    await page.getByLabel(T('langue.choix')).selectOption(autre);
    verifier(await visible(page.getByRole('heading', { name: tl(autre, 'accueil.titre_cle') })), `sélecteur FR/EN : interface passée en ${autre}`);
    await page.reload();
    verifier((await page.evaluate(() => document.documentElement.lang)) === autre, 'choix de langue mémorisé dans le navigateur');
    await page.getByLabel(tl(autre, 'langue.choix')).selectOption(L);
    verifier(await visible(page.getByRole('heading', { name: T('accueil.titre_cle') })), `retour en ${L}`);

    console.log('Aide accessible avant toute clé');
    await page.goto(URL_APP);
    await page.locator('.entete').getByRole('button', { name: T('nav.aide') }).click();
    verifier(await visible(page.getByRole('heading', { name: T('aide.titre') })), 'écran d’aide affiché');
    verifier((await page.locator('.aide-section').count()) >= 10, 'mode d’emploi complet (sections)');
    await capture(page, '8_aide');

    console.log('Préparation : chacun crée sa clé');
    const alice = await creerCle(page, 'Alice Responsable');
    const bob = await creerCle(page, 'Bob Validateur');
    verifier(JSON.parse(readFileSync(bob.publique, 'utf8')).format === '2x2-cle-publique', 'clés publiques téléchargées');
    verifier(alice.privee.endsWith('.2x2cle') && bob.publique.endsWith('.json'), 'une clé privée à la création, la clé publique ensuite');
    verifier(!readFileSync(alice.privee, 'utf8').includes('"d":'), 'la clé privée n’apparaît pas en clair dans le fichier de clé');

    console.log('Données fictives');
    await page.goto(URL_APP);
    await page.getByText(T('accueil.fictif')).click();
    const [xlsx] = await telechargements(page, 1, () => page.getByRole('button', { name: T('accueil.telecharger_xlsx') }).click());

    console.log('Import par Alice (responsable)');
    await deverrouiller(page, alice.privee);
    await page.getByRole('button', { name: T('accueil.importer') }).click();
    await choisir(page, xlsx, () => page.locator('.depot').click());
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(T('import.dimensions', { lignes: 300, colonnes: 28 }))), 'export lu : 300 lignes, 28 colonnes (dont GPS et liens hôte ↔ hébergés)');
    verifier((await page.locator('main select').inputValue()) === 'id_menage', 'colonne d’identifiant proposée : id_menage');
    // La clé de Bob arrive « par message » : on colle le texte au lieu de choisir un fichier.
    await page.getByText(T('import.coller')).click();
    await page.getByLabel(T('import.cle_collee')).fill(clePubliqueEnTexte(JSON.parse(readFileSync(bob.publique, 'utf8'))));
    await page.getByRole('button', { name: T('import.ajouter_cle') }).click();
    verifier(await visible(page.getByText(phrase('import.cle_ajoutee', { nom: 'Bob Validateur' }))), 'clé publique de Bob ajoutée par texte collé');
    await page.getByLabel(`Alice Responsable : ${T('role.correction')}`).check();
    // Alice a aussi le rôle Validation : elle doit malgré tout être bloquée sur ses propres corrections.
    await page.getByLabel(`Alice Responsable : ${T('role.validation')}`).check();
    await page.getByLabel(`Bob Validateur : ${T('role.correction')}`).uncheck();
    await page.getByLabel(`Bob Validateur : ${T('role.validation')}`).check();
    await page.getByLabel(T('import.mdp'), { exact: true }).fill(MDP_LISTE);
    await page.getByLabel(T('import.confirmer'), { exact: true }).fill(MDP_LISTE);
    const [liste1] = await telechargements(page, 1, () => page.getByRole('button', { name: T('import.creer') }).click());
    await attendreFinTraitement(page);
    verifier(!readFileSync(liste1, 'utf8').includes('MN-0001'), 'le fichier de liste ne contient aucune donnée en clair');

    console.log('Correction par Alice');
    await page.getByRole('button', { name: new RegExp(T('nav.correction')) }).first().click();
    await page.getByRole('cell', { name: 'MN-0002', exact: true }).click();
    const ligne = page.locator('.champ-menage', { has: page.locator('dt', { hasText: /^taille_menage$/ }) });
    const ancienne = (await ligne.locator('.valeur').textContent())!;
    await ligne.getByRole('button', { name: T('commun.corriger') }).click();
    await page.getByLabel(T('commun.nouvelle_valeur')).fill('3');
    await page.getByLabel(T('correction.motif'), { exact: true }).selectOption('Vérification terrain');
    await page.getByLabel(T('commun.commentaire'), { exact: true }).fill('Visite du 15/09');
    await page.getByRole('button', { name: T('correction.signer') }).click();
    await attendreFinTraitement(page);
    verifier(await visible(ligne.getByText(T('correction.en_attente'))), `correction signée (${ancienne} → 3), en attente`);

    console.log('Tableau des ménages : colonnes Enquêteur et Alertes, filtres, tri, sélection');
    const lignesMenages = page.locator('.tableau.menages tbody tr');
    const filtreEnq = page.getByLabel(filtre(T('commun.enqueteur')), { exact: true });
    const enq = (await filtreEnq.locator('option').nth(1).getAttribute('value'))!;
    await filtreEnq.selectOption(enq);
    const colEnq = await page.locator('.tableau.menages tbody tr td:nth-child(3)').allTextContents();
    verifier(colEnq.length > 0 && colEnq.every((c) => c === enq), `filtre Enquêteur = ${enq} (${colEnq.length} ménages)`);
    await filtreEnq.selectOption('');
    const filtreDate = page.getByLabel(filtre(T('commun.date')), { exact: true });
    const jour = (await filtreDate.locator('option').nth(1).getAttribute('value'))!;
    await filtreDate.selectOption(jour);
    const colDate = await page.locator('.tableau.menages tbody tr td.date').allTextContents();
    verifier(/^\d{4}-\d{2}-\d{2}$/.test(jour) && colDate.length > 0 && colDate.every((c) => c === jour), `filtre par journée d’entretien ${jour} (${colDate.length} ménages)`);
    await filtreDate.selectOption('');
    await filtreEnq.selectOption(enq);
    await page.getByLabel(filtre(T('regles.col_alertes')), { exact: true }).selectOption(T('regle.doublon_identifiant'));
    const nDoublons = await lignesMenages.count();
    await filtreEnq.selectOption('');
    verifier((await lignesMenages.count()) >= 2 && (await lignesMenages.first().locator('td.alertes').textContent())!.includes(T('regle.doublon_identifiant')), 'filtre sur le type d’alerte, visible dans la colonne Alertes');
    void nDoublons;
    await page.getByLabel(T('correction.cocher_tout')).check();
    verifier(await visible(page.getByRole('button', { name: debut('correction.exclure_n', { n: await lignesMenages.count() }) })), 'tous les ménages filtrés cochés pour une exclusion en lot');
    console.log('Choix des colonnes affichées');
    await page.getByRole('button', { name: T('colonnes.ouvrir') }).click();
    await page.getByLabel(T('colonnes.afficher', { nom: 'telephone' })).check();
    await page.getByLabel(T('colonnes.afficher', { nom: 'sexe_chef_menage' })).uncheck();
    const titres = await page.locator('.tableau.menages thead tr').first().locator('th').allTextContents();
    verifier(titres.some((t) => t.startsWith('telephone')) && !titres.some((t) => t.startsWith('sexe_chef_menage')), 'colonnes choisies : téléphone ajouté, sexe retiré');
    const position = async (nom: string) => (await page.locator('.tableau.menages thead tr').first().locator('th').allTextContents()).findIndex((t) => t.startsWith(nom));
    const avantMonter = await position('telephone');
    await page.getByLabel(T('colonnes.monter', { nom: 'telephone' })).click();
    await page.getByLabel(T('colonnes.monter', { nom: 'telephone' })).click();
    verifier((await position('telephone')) === avantMonter - 2, `colonne déplacée de deux rangs vers la gauche (${avantMonter} → ${await position('telephone')})`);
    await page.getByRole('button', { name: T('colonnes.defaut') }).click();
    verifier((await page.locator('.tableau.menages thead tr').first().locator('th').allTextContents()).some((t) => t.startsWith('sexe_chef_menage')), 'retour aux colonnes par défaut');

    console.log('Liste de visite terrain et préchargement Kobo (responsable)');
    const nVisite = await lignesMenages.count();
    await page.getByRole('button', { name: new RegExp('^' + echapper(prefixe('visite.ouvrir_n'))) }).click();
    verifier((await page.getByLabel(T('visite.format')).inputValue()) === 'kobo', 'préchargement Kobo proposé par défaut');
    await page.getByLabel(T('visite.format')).selectOption('xlsx');
    page.once('dialog', (d) => d.accept());
    const [fichierVisite] = await telechargements(page, 1, () => page.getByRole('button', { name: new RegExp('^' + echapper(prefixe('visite.exporter_n')) + '\\d+') }).click());
    await attendreFinTraitement(page);
    const tv = await lireXlsx(new Uint8Array(readFileSync(fichierVisite)));
    verifier(
      tv.lignes.length === nVisite && tv.colonnes.includes('À vérifier') && tv.colonnes.includes('Ménage trouvé (oui/non)') && tv.colonnes.includes('nom_chef_menage') && !tv.colonnes.includes('age_chef_menage'),
      `liste de visite : ${tv.lignes.length} ménages, colonnes utiles seulement, alertes et colonnes de retour`,
    );
    await page.getByRole('button', { name: new RegExp('^' + echapper(prefixe('visite.ouvrir_n'))) }).click();
    await page.getByLabel(T('visite.format')).selectOption('kobo');
    verifier((await page.getByLabel(T('visite.etiquette', { n: 1 })).inputValue()) === 'nom_chef_menage' && (await page.getByLabel(T('visite.etiquette', { n: 2 })).inputValue()) === 'village', 'étiquette Kobo pré-remplie : nom et village');
    await page.getByLabel(T('visite.etiquette', { n: 3 })).selectOption('telephone');
    page.once('dialog', (d) => d.accept());
    const [fichierKobo] = await telechargements(page, 1, () => page.getByRole('button', { name: new RegExp('^' + echapper(prefixe('visite.exporter_n')) + '\\d+') }).click());
    await attendreFinTraitement(page);
    const tk = lireCsv(readFileSync(fichierKobo, 'utf8'));
    verifier(fichierKobo.endsWith('menages_a_revoir.csv') && tk.colonnes[0] === 'name' && tk.colonnes[1] === 'label' && tk.lignes.length === nVisite, 'préchargement Kobo (name, label, colonnes choisies)');
    verifier(readFileSync(fichierKobo, 'utf8').startsWith('name,label,infos,'), 'préchargement Kobo sans marqueur BOM (colonne « name » lisible par Kobo)');
    verifier(tk.lignes.every((l) => l[1].split(' – ').length === 4), `étiquettes lisibles et choisies : « ${tk.lignes[0][1]} »`);
    await page.getByRole('button', { name: new RegExp(T('nav.journal')) }).first().click();
    verifier(await visible(page.getByText(new RegExp(echapper(T('nature.visite').toLowerCase()) + '.*' + echapper(prefixe('journal.r_export_colonnes').trim())))), 'sortie de données inscrite au journal, avec les colonnes');
    await page.getByRole('button', { name: new RegExp(T('nav.correction')) }).first().click();

    console.log('Retours du terrain (export des réponses Kobo) : propositions à signer');
    const visites = tk.lignes.slice(0, 2).map((l) => l[0]);
    const reponses = join(dossier, 'reponses_revisite.xlsx');
    writeFileSync(
      reponses,
      await ecrireXlsx([
        {
          nom: 'Réponses',
          tableau: {
            colonnes: ['today', 'menage', 'trouve', 'resultat', 'constat', 'gps_visite', 'visiteur'],
            lignes: visites.map((id) => ['2026-10-02', id, 'oui', 'conforme', 'Deux ménages distincts, voisins', '', 'Agent A']),
          },
        },
      ]),
    );
    await choisir(page, reponses, () => page.getByRole('button', { name: T('retours.ouvrir') }).click());
    await attendreFinTraitement(page);
    await visible(page.locator('.tableau.retours'));
    const casesRetours = page.locator('.tableau.retours tbody input[type=checkbox]');
    const nRetours = await casesRetours.count();
    verifier(nRetours >= 2 && (await page.getByText(T('retours.sans_gps')).count()) > 0, `${nRetours} décision(s) proposée(s), visites sans GPS signalées`);
    verifier((await page.locator('.tableau.retours tbody input[type=checkbox]:checked').count()) === 0, 'actions à vérifier non cochées par défaut');
    for (let k = 0; k < nRetours; k++) await casesRetours.nth(k).check();
    page.once('dialog', (dlg) => dlg.accept());
    await page.getByRole('button', { name: debut('retours.signer_n', { n: nRetours }) }).click();
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(T('retours.signees', { n: nRetours }))), 'décisions signées depuis les retours du terrain');
    await page.getByRole('button', { name: T('commun.tout_decocher') }).click();

    console.log('Plan GPS et fond de carte hors ligne');
    await page.getByRole('button', { name: T('correction.plan') }).click();
    verifier(!(await page.locator('.tableau.menages tbody').isVisible()) && (await page.getByLabel(filtre(T('regles.col_alertes')), { exact: true }).isVisible()), 'le plan prend la place des lignes du tableau, les filtres restent visibles');
    const cadrePlan = (await page.locator('.zone-plan .plan').boundingBox())!;
    const vb = (await page.locator('.zone-plan .plan-svg').getAttribute('viewBox'))!.split(' ').map(Number);
    verifier(Math.abs(vb[2] - cadrePlan.width) < 3 && Math.abs(vb[3] - cadrePlan.height) < 3, `plan à la taille de son cadre, sans étirement (${Math.round(cadrePlan.width)}×${Math.round(cadrePlan.height)})`);
    const nPoints = await page.locator('.zone-plan .plan-svg .point').count();
    verifier(nPoints > 0 && nPoints <= (await lignesMenages.count()), `plan GPS des ménages filtrés (${nPoints} points)`);
    // Petit paquet de tuiles : une tuile au zoom 10 qui couvre la zone fictive.
    const n10 = 2 ** 10;
    const tx = Math.floor(((18.38 + 180) / 360) * n10);
    const rlat = (-4.25 * Math.PI) / 180;
    const ty = Math.floor(((1 - Math.log(Math.tan(rlat) + 1 / Math.cos(rlat)) / Math.PI) / 2) * n10);
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const paquet = join(dossier, 'tuiles.zip');
    writeFileSync(paquet, await ecrireZip([{ nom: `tuiles/10/${tx}/${ty}.png`, donnees: png }]));
    await choisir(page, paquet, () => page.getByRole('button', { name: T('correction.charger_fond') }).click());
    await attendreFinTraitement(page);
    verifier(await visible(page.locator('.zone-plan .plan-svg image')), 'fond de carte hors ligne affiché sous les points');
    await capture(page, '10_plan');
    await page.locator('.zone-plan .point.cliquable').first().click();
    verifier(await visible(page.locator('.fiche h2', { hasText: new RegExp('^' + echapper(prefixe('correction.menage')) + 'MN-') })), 'clic sur un point : fiche du ménage ouverte');
    verifier(await page.locator('.fiche').isVisible(), 'la fiche s’affiche sous le plan');
    await page.getByRole('button', { name: T('correction.retirer_fond') }).click();
    // Zone pour préparer un fond de carte (HOT Export Tool), puis fond vectoriel GeoJSON au format d'un export HOT.
    const [fichierZone] = await telechargements(page, 1, () => page.getByRole('button', { name: T('correction.zone_fond') }).click());
    const zoneJson = JSON.parse(readFileSync(fichierZone, 'utf8'));
    const anneau: number[][] = zoneJson.features[0].geometry.coordinates[0];
    verifier(anneau.length === 5 && anneau.every(([x, y]) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-6 && Math.abs(y * 10 - Math.round(y * 10)) < 1e-6), `zone pour fond de carte, arrondie au 0,1° (${anneau[0].join(', ')} → ${anneau[2].join(', ')})`);
    const hotGeojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[18.2, -4.1], [18.5, -4.35]] }, properties: { osm_id: 1, highway: 'secondary' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[18.25, -4.05], [18.45, -4.4]] }, properties: { osm_id: 2, waterway: 'river' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [18.36, -4.16] }, properties: { osm_id: 3, place: 'village', name: 'Lieu de test' } },
      ],
    };
    const paquetHot = join(dossier, 'export_hot.zip');
    writeFileSync(
      paquetHot,
      await ecrireZip([
        { nom: 'Readme.txt', donnees: new TextEncoder().encode('Exported through Raw-data-api using OpenStreetMap data.') },
        { nom: 'zone_test.geojson', donnees: new TextEncoder().encode(JSON.stringify(hotGeojson)) },
      ]),
    );
    await choisir(page, paquetHot, () => page.getByRole('button', { name: T('correction.charger_fond') }).click());
    await attendreFinTraitement(page);
    verifier(
      (await visible(page.locator('.zone-plan .plan-svg path.fond-route-principale'))) && (await page.locator('.zone-plan .plan-svg path.fond-riviere').count()) === 1,
      'fond vectoriel HOT : routes et rivières dessinées',
    );
    verifier(await visible(page.locator('.zone-plan .plan-svg text.attribution', { hasText: 'OpenStreetMap' })), 'mention de la source OpenStreetMap sur le plan');
    await capture(page, '11_fond_vectoriel');
    await page.getByRole('button', { name: T('correction.retirer_fond') }).click();
    await page.getByRole('button', { name: T('correction.afficher_liste') }).click();
    await page.getByRole('button', { name: /^id_menage/ }).click();
    await page.getByRole('button', { name: /^id_menage/ }).click();
    verifier(await visible(page.getByRole('button', { name: 'id_menage ▼' })), 'tri décroissant par identifiant');
    await page.getByRole('button', { name: T('commun.reinitialiser') }).click();

    console.log('Lien ménage hébergé → ménage hôte');
    await page.getByLabel(filtre(T('regles.col_alertes')), { exact: true }).selectOption(T('regle.lien_hote'));
    const nLiens = await page.locator('.tableau.menages tbody tr').count();
    await page.locator('.tableau.menages tbody tr').first().locator('td').nth(1).click();
    verifier(nLiens > 0 && (await visible(page.locator('.liens-menage'))), `liens invalides signalés (${nLiens}) et lien visible dans la fiche`);
    await page.getByLabel(filtre(T('regles.col_alertes')), { exact: true }).selectOption(T('regle.hote_sans_heberge'));
    verifier((await page.locator('.tableau.menages tbody tr').count()) > 0, 'familles d’accueil sans ménage hébergé signalées');
    await page.getByRole('button', { name: T('commun.reinitialiser') }).click();


    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    const caseAlice = page.locator('.tableau.validation tbody tr', { hasText: prefixe('validation.champ').trim() }).first().locator('input[type=checkbox]');
    verifier(await caseAlice.isDisabled(), 'Alice ne peut pas cocher sa propre correction');
    verifier((await caseAlice.getAttribute('title'))?.includes(T('validation.propre_correction')) ?? false, 'la raison est indiquée (quatre yeux)');
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.export')) }).click();
    verifier(await visible(page.getByText(T('export.corrections_attente', { n: 1 }))), 'export verrouillé tant qu’une correction attend');
    verifier(await page.getByRole('button', { name: T('export.csv') }).isDisabled(), 'bouton d’export de la liste finale désactivé');

    console.log('Règles : export, édition dans un « tableur », import et signature par Alice (responsable)');
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    const courtsAvant = await compteFiltre(page, filtre(T('validation.col_objet')), T('regle.duree_courte'));
    await page.locator('details.regles-controle summary').click();
    const [fichierRegles] = await telechargements(page, 1, () => page.getByRole('button', { name: T('regles.exporter_xlsx') }).click());
    await attendreFinTraitement(page);
    const tr = await lireXlsx(new Uint8Array(readFileSync(fichierRegles)));
    const iNom = tr.colonnes.indexOf('nom');
    tr.lignes.find((l) => l[iNom] === 'duree_courte')![tr.colonnes.indexOf('min')] = '13';
    const modifie = join(dossier, 'regles_modifiees.xlsx');
    writeFileSync(modifie, await ecrireXlsx([{ nom: 'Règles', tableau: tr }]));
    await choisir(page, modifie, () => page.getByRole('button', { name: T('regles.importer') }).click());
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(T('regles.apercu', { fichier: 'regles_modifiees.xlsx' }))), 'aperçu du fichier de règles importé');
    await page.getByRole('button', { name: T('regles.signer') }).click();
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(T('regles.signees'))), 'règles signées au journal');
    await page.locator('details.regles-controle').evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await page.locator('details.regles-controle').scrollIntoViewIfNeeded();
    await capture(page, '6_regles');
    const courtsApres = await compteFiltre(page, filtre(T('validation.col_objet')), T('regle.duree_courte'));
    verifier(courtsApres > courtsAvant, `seuil relevé à 13 min : ${courtsAvant} → ${courtsApres} entretiens courts signalés`);
    const fauxFichier = join(dossier, 'regles_fausses.csv');
    writeFileSync(fauxFichier, 'nom,type,colonne\nduree,duree,start\n');
    await choisir(page, fauxFichier, () => page.getByRole('button', { name: T('regles.importer') }).click());
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(phrase('regles.refuse', { n: 1 }))), 'un fichier de règles invalide est refusé avec ses erreurs');
    await page.getByRole('button', { name: T('commun.annuler') }).click();
    const liste2 = await enregistrer(page);
    verifier(/_v\d{3}-[0-9a-f]{4}_\d{4}-\d{2}-\d{2}\.2x2$/.test(liste2), `nom de fichier versionné : ${liste2.split('/').pop()}`);

    console.log('Validation par Bob');
    await deverrouiller(page, bob.privee);
    await ouvrirListe(page, liste2);
    verifier(await visible(page.getByText(T('entete.journal_integre'))), 'journal vérifié à l’ouverture');
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    const decideesAvant = Number(await page.locator('.compteur.ok .nombre').textContent());
    await page.getByLabel(filtre(T('journal.type')), { exact: true }).selectOption(T('journal.t_correction'));
    await deciderSelection(page, 'acceptee', 1);
    verifier(Number(await page.locator('.compteur.ok .nombre').textContent()) === decideesAvant + 1, 'correction acceptée par Bob');

    console.log('Rafraîchissement accidentel avant d’enregistrer : reprise depuis la copie de secours');
    await page.waitForFunction(() => !!localStorage.getItem('2x2-secours'), null, { timeout: 15000 });
    await page.goto(URL_APP);
    verifier(await visible(page.getByText(phrase('accueil.secours_trouve'))), 'copie de secours signalée avant même de déverrouiller la clé');
    await deverrouiller(page, bob.privee);
    verifier(await visible(page.getByText(T('accueil.reprise_titre'))), 'proposition de reprise après déverrouillage');
    await page.getByLabel(T('accueil.mdp_cette_liste')).fill(MDP_LISTE);
    await page.getByRole('button', { name: T('accueil.reprendre') }).click();
    await attendreFinTraitement(page);
    verifier(await visible(page.locator('.entete').getByText(T('entete.non_enregistre'))), 'liste reprise, marquée non enregistrée');
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    verifier(Number(await page.locator('.compteur.ok .nombre').textContent()) === decideesAvant + 1, 'la décision signée avant le rafraîchissement est conservée');
    await page.getByRole('button', { name: new RegExp(T('nav.correction')) }).first().click();
    await page.getByRole('cell', { name: 'MN-0002', exact: true }).click();
    verifier((await ligne.locator('.valeur').textContent()) === '3', 'la valeur corrigée est appliquée');

    console.log('Étape 2 : exclusion proposée par Bob ? Non : Bob n’a pas le rôle Correction');
    verifier((await page.getByRole('button', { name: T('correction.proposer_exclusion') }).count()) === 0, 'pas de proposition d’exclusion sans rôle Correction');

    console.log('Étape 2 : décisions d’alerte par Bob');
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    await page.getByRole('button', { name: T('commun.reinitialiser') }).click();
    await capture(page, '1_alertes');
    if (process.env.CAPTURES) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(300);
      await capture(page, '7_defilement');
      await page.mouse.wheel(0, -3000);
    }
    let avant = Number(await page.locator('.compteur.attente .nombre').nth(1).textContent());
    verifier(avant > 30, `${avant} alertes à décider sur les données fictives`);

    console.log('Comparaison côte à côte d’un doublon de pièce d’identité');
    await page.getByLabel(filtre(T('validation.col_objet')), { exact: true }).selectOption(T('regle.doublon_identifiant'));
    await page.locator('.tableau.validation tbody tr').first().getByRole('button', { name: T('validation.comparer') }).click();
    verifier(await visible(page.getByRole('heading', { name: T('comparaison.titre', { n: 2 }) })), 'vue de comparaison ouverte');
    const ligneId = page.locator('tr', { has: page.locator('th', { hasText: /^numero_piece_identite$/ }) });
    verifier((await ligneId.getAttribute('class'))?.includes('difference') ?? false, 'la saisie différente du même numéro est surlignée');
    verifier((await page.locator('.comparaison thead th').count()) === 3, 'deux ménages en colonnes');
    await capture(page, '5_comparaison');
    verifier(await visible(page.locator('.carte-gps .plan-svg .point')), 'plan GPS des ménages comparés');
    verifier((await page.locator('.tableau.distances tbody tr').count()) === 1, 'distance GPS entre les deux ménages');
    // Décision du groupe : une décision par ménage, puis une seule signature (Bob n'a pas le rôle Correction).
    const choixMenages = page.locator('select.decision-menage');
    verifier((await choixMenages.count()) === 2, 'une liste de décision par ménage comparé');
    verifier(await choixMenages.first().locator('option[value="exclure:Doublon"]').isDisabled(), 'exclure demande le rôle Correction (option grisée pour Bob)');
    await choixMenages.nth(0).selectOption('conserver');
    await choixMenages.nth(1).selectOption('conserver');
    verifier((await page.getByLabel(T('comparaison.decision_alerte')).inputValue()) === 'faux_positif', 'deux ménages conservés : « Vérifiée : pas de problème » proposée');
    await page.getByLabel(T('comparaison.commentaire_label')).fill('Deux ménages distincts, pièces vues sur place');
    await page.getByRole('button', { name: T('alertes.signer_decision') }).click();
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(phrase('comparaison.signe_alerte'))), 'décision du groupe signée depuis la comparaison');
    await page.getByRole('button', { name: T('comparaison.retour') }).click();
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    await page.getByRole('button', { name: T('commun.reinitialiser') }).click();
    verifier(Number(await page.locator('.compteur.attente .nombre').nth(1).textContent()) === avant - 1, 'l’alerte comparée n’attend plus de décision');
    avant -= 1;
    await page.getByRole('button', { name: T('colonnes.ouvrir') }).click();
    await page.getByLabel(T('colonnes.afficher', { nom: 'village' })).check();
    verifier((await page.locator('.tableau.validation thead tr').first().locator('th').allTextContents()).some((x) => x.startsWith('village')), 'Validation : colonne de données « village » ajoutée');
    await page.getByRole('button', { name: T('colonnes.defaut') }).click();
    // Tri et filtre par enquêteur.
    await page.getByRole('button', { name: debut('commun.enqueteur') }).click();
    verifier(await visible(page.getByRole('button', { name: `${T('commun.enqueteur')} ▲` })), 'tri par enquêteur');
    const enquêteur = (await page.getByLabel(filtre(T('commun.enqueteur')), { exact: true }).locator('option').nth(1).getAttribute('value'))!;
    await page.getByLabel(filtre(T('commun.enqueteur')), { exact: true }).selectOption(enquêteur);
    const cellules = await page.locator('.tableau.validation tbody tr td:nth-child(5)').allTextContents();
    verifier(cellules.length > 0 && cellules.every((c) => c.includes(enquêteur)), `filtre sur l’enquêteur ${enquêteur} (${cellules.length} ligne(s))`);
    await page.getByRole('button', { name: T('commun.reinitialiser') }).click();
    // Une décision sur une seule ligne cochée…
    await page.locator('.tableau.validation tbody tr').first().locator('input[type=checkbox]').check();
    await page.getByLabel(T('validation.decision_selection')).selectOption('verification_terrain');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: debut('validation.signer_pour', { n: 1 }) }).click();
    await attendreFinTraitement(page);
    verifier(Number(await page.locator('.compteur.attente .nombre').nth(1).textContent()) === avant - 1, 'décision sur une ligne signée');
    // …puis toutes les autres en une décision groupée.
    await deciderSelection(page, 'verification_terrain', avant - 1);
    verifier((await page.locator('.compteur.attente .nombre').nth(1).textContent()) === '0', 'toutes les alertes ont une décision signée');

    console.log('Étape 2 : reçu de validation de Bob');
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    verifier(await visible(page.getByText(T('recus.rappel', { n: 2 }).replace(/^2 /, '').split('.')[0])), 'rappel de produire un reçu');
    await page.getByRole('button', { name: T('recus.produire') }).click();
    await attendreFinTraitement(page);
    const recu = (await page.locator('pre.recu').textContent())!;
    await capture(page, '3_recu');
    verifier(recu.includes('2X2-RECU-1.'), 'reçu produit');
    const liste3 = await enregistrer(page);

    console.log('Étape 2 : exclusion proposée par Alice, validée par Bob');
    await deverrouiller(page, alice.privee);
    await ouvrirListe(page, liste3);
    await page.getByRole('button', { name: new RegExp(T('nav.journal')) }).click();
    await page.getByLabel(T('recus.texte_recu')).fill(recu);
    await page.getByRole('button', { name: T('recus.verifier_colle') }).click();
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(phrase('recus.conforme', { lignes: 0, qui: '' }) + '.')), 'Alice confronte le fichier au reçu de Bob : conforme');
    await page.getByRole('button', { name: new RegExp(T('nav.correction')) }).first().click();
    await page.getByRole('cell', { name: 'MN-0005', exact: true }).click();
    await page.getByRole('cell', { name: 'MN-0003', exact: true }).click();
    await capture(page, '2_fiche');
    const cadre = page.locator('.tableau-menages');
    verifier(await cadre.evaluate((el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight), 'le tableau des ménages défile dans son cadre');
    await cadre.evaluate((el) => (el.scrollTop = 600));
    const enTete = await page.locator('.tableau-menages thead th').first().boundingBox();
    const cadreBox = await cadre.boundingBox();
    verifier(!!enTete && !!cadreBox && Math.abs(enTete.y - cadreBox.y) < 3, 'en-tête du tableau toujours visible après défilement');
    await capture(page, '9_defilement_menages');
    await cadre.evaluate((el) => (el.scrollTop = 0));
    // Barre de séparation : agrandir le tableau au détriment de la fiche.
    const hAvant = (await cadre.boundingBox())!.height;
    await page.locator('.separateur').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const sep = (await page.locator('.separateur').boundingBox())!;
    await page.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2);
    await page.mouse.down();
    await page.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2 + 120, { steps: 5 });
    await page.mouse.up();
    const hApres = (await cadre.boundingBox())!.height;
    verifier(hApres > hAvant + 80, `barre de séparation glissée : tableau ${Math.round(hAvant)} → ${Math.round(hApres)} px`);
    // Exclusion en lot (ici d'un seul ménage, filtré par son identifiant).
    await page.getByLabel(filtre('id_menage'), { exact: true }).fill('MN-0005');
    await page.getByLabel(T('correction.cocher_tout')).check();
    verifier(!(await page.getByLabel(T('correction.motif_groupe')).isVisible()), 'formulaire d’exclusion replié tant qu’on ne le demande pas');
    await page.getByRole('button', { name: debut('correction.exclure_n', { n: 1 }) }).click();
    await page.getByLabel(T('correction.motif_groupe')).selectOption('Doublon');
    await page.getByLabel(T('correction.commentaire_groupe_label')).fill('Même ménage que MN-0004');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: debut('correction.proposer_exclusion_n', { n: 1 }) }).click();
    await attendreFinTraitement(page);
    verifier(await visible(page.locator('.tableau.menages tbody tr').first().getByText(T('correction.en_attente'))), 'exclusion proposée en lot, en attente de validation');
    await page.getByRole('button', { name: T('commun.reinitialiser') }).click();
    const liste4 = await enregistrer(page);
    await deverrouiller(page, bob.privee);
    await ouvrirListe(page, liste4);
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    await page.getByLabel(filtre(T('journal.type')), { exact: true }).selectOption(T('journal.t_correction'));
    await deciderSelection(page, 'acceptee', 1);
    // MN-0005 était famille d'accueil : son exclusion rend invalide le lien des ménages qu'elle héberge.
    await page.getByLabel(filtre(T('journal.type')), { exact: true }).selectOption(T('journal.t_decision_alerte'));
    const nouvelles = await page.locator('.tableau.validation tbody tr').allTextContents();
    verifier(nouvelles.length >= 1 && nouvelles.every((x) => (x.includes(T('regle.lien_hote')) || x.includes(T('regle.heberge_sans_hote'))) && x.includes('MN-0005')), `exclusion d’une famille d’accueil : ${nouvelles.length} nouvelle(s) alerte(s) de lien, qui bloquent l’export`);
    await deciderSelection(page, 'verification_terrain', nouvelles.length);
    const liste5 = await enregistrer(page);

    console.log('Étape 2 : export par Alice');
    await deverrouiller(page, alice.privee);
    await ouvrirListe(page, liste5);
    await page.getByLabel(filtre('id_menage'), { exact: true }).fill('MN-0005');
    const etatExclu = (await page.locator('.tableau.menages tbody tr').first().locator('td.badges').textContent()) ?? '';
    verifier(etatExclu.includes(T('statut.exclu')) && !etatExclu.includes(T('correction.corrige_badge')), `ménage exclu affiché « exclu » sans « corrigé » (${etatExclu.trim()})`);
    await page.getByRole('button', { name: T('commun.reinitialiser') }).click();
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.export')) }).click();
    verifier(await visible(page.getByText(T('export.bilan', { total: 300, inclus: 299, n: 1 }))), '299 ménages inclus, 1 exclu');
    const [csv] = await telechargements(page, 1, () => page.getByRole('button', { name: T('export.csv') }).click());
    await attendreFinTraitement(page);
    const finale = lireCsv(readFileSync(csv, 'utf8'));
    const iId = finale.colonnes.indexOf('id_menage');
    verifier(finale.lignes.length === 299 && !finale.lignes.some((l) => l[iId] === 'MN-0005'), 'liste finale CSV : 299 ménages, MN-0005 exclu');
    verifier(finale.lignes.find((l) => l[iId] === 'MN-0002')![finale.colonnes.indexOf('taille_menage')] === '3', 'liste finale : valeur corrigée');
    const [ods] = await telechargements(page, 1, () => page.getByRole('button', { name: T('export.ods') }).nth(1).click());
    await attendreFinTraitement(page);
    verifier(ods.endsWith('.ods'), 'rapport des alertes en ODS');
    await choisir(page, csv, () => page.getByRole('button', { name: T('export.choisir') }).click());
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(phrase('export.authentique', { fichier: '', n: 0, nom: '', date: '', lignes: 0 }) + '.')), 'l’export CSV est reconnu par le journal');
    const retouche = join(dossier, 'liste_retouchee.csv');
    writeFileSync(retouche, readFileSync(csv, 'utf8').replace('MN-0001', 'MN-9999'));
    await choisir(page, retouche, () => page.getByRole('button', { name: T('export.choisir') }).click());
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(phrase('export.inconnu') + '.')), 'un export retouché est rejeté');
    await capture(page, '4_export');
    const liste6 = await enregistrer(page);

    console.log('Fiche ménage : décision d’alerte et correction en une seule signature');
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.correction')) }).click();
    await page.getByLabel(filtre(T('regles.col_alertes')), { exact: true }).selectOption({ index: 1 });
    await page.locator('.tableau.menages tbody tr').first().locator('td').nth(1).click();
    const blocAlerte = page.locator('.alertes-menage li').first();
    await blocAlerte.getByLabel(T('alertes.decision'), { exact: true }).selectOption('corriger');
    await blocAlerte.getByLabel(T('alertes.champ_a_corriger')).selectOption('telephone');
    await blocAlerte.getByLabel(T('commun.nouvelle_valeur')).fill('+243810000000');
    await blocAlerte.getByLabel(T('commun.commentaire'), { exact: true }).fill('Numéro vérifié par appel');
    await blocAlerte.getByRole('button', { name: new RegExp(`^(${echapper(T('alertes.signer_decision'))}|${echapper(T('alertes.reviser'))})$`) }).click();
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(phrase('alertes.signee_correction'))), 'décision d’alerte et correction signées ensemble');
    await page.locator('nav.navigation').getByRole('button', { name: new RegExp(T('nav.validation')) }).click();
    verifier((await page.locator('.compteur.attente .nombre').first().textContent()) === '1', 'la correction attend la validation d’une autre personne');

    console.log('Étape 2 : suppression des dernières lignes, détectée par le reçu');
    const complete = await dechiffrerListe(readFileSync(liste6, 'utf8'), MDP_LISTE);
    const recuParse = /Journal : (\d+) lignes/.exec(recu)!;
    complete.journal.splice(Number(recuParse[1]) - 2);
    const tronquee = join(dossier, 'liste_tronquee.2x2');
    writeFileSync(tronquee, await chiffrerListe(complete, MDP_LISTE));
    await deverrouiller(page, alice.privee);
    await ouvrirListe(page, tronquee);
    verifier(await visible(page.getByText(T('entete.journal_integre'))), 'la chaîne seule ne voit pas la troncature');
    await page.getByRole('button', { name: new RegExp(T('nav.journal')) }).click();
    await page.getByLabel(T('recus.texte_recu')).fill(recu);
    await page.getByRole('button', { name: T('recus.verifier_colle') }).click();
    await attendreFinTraitement(page);
    verifier(await visible(page.getByText(phrase('recus.tronque', { n: 2, qui: '', lignes: 0 }))), 'le reçu de Bob révèle les lignes supprimées');

    console.log('Altération du fichier (avec le mot de passe, hors de l’outil)');
    const contenu = await dechiffrerListe(readFileSync(liste3, 'utf8'), MDP_LISTE);
    const c = contenu.journal.find((e) => e.type === 'correction')!;
    (c.contenu as { nouvelle: string }).nouvelle = '9';
    const altere = join(dossier, 'liste_alteree.2x2');
    writeFileSync(altere, await chiffrerListe(contenu, MDP_LISTE));
    await deverrouiller(page, alice.privee);
    await ouvrirListe(page, altere);
    verifier(await visible(page.getByText(T('entete.journal_altere'))), 'altération détectée à l’ouverture');
    verifier(await visible(page.getByText(T('journal.alterations', { n: 1 }).split('(')[0].trim())), 'lecture seule et détail des erreurs affichés');

    verifier(erreursConsole.length === 0, `aucune erreur dans la console${erreursConsole.length ? ' : ' + erreursConsole.join(' | ') : ''}`);
    verifier(requetes.length === 0, `aucune requête réseau${requetes.length ? ' : ' + requetes.join(', ') : ''}`);
  } finally {
    await page.screenshot({ path: join(dossier, 'derniere_page.png'), fullPage: true });
    await contexte.close();
    console.log(`Fichiers du test : ${dossier}`);
  }
}
