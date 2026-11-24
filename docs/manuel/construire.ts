/**
 * Manuel d'utilisation en PDF, à partir des copies d'écran du scénario de démonstration.
 *
 * Usage : npx tsx docs/manuel/scenario.ts && npx tsx docs/manuel/construire.ts
 * Sortie : docs/manuel/sortie/manuel_2x2_v<version>.pdf (et la page HTML intermédiaire).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const VERSION: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const SORTIE = resolve('docs/manuel/sortie');
const CAPTURES = join(SORTIE, 'captures');

const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Texte simple avec **gras** et `code`. */
const md = (t: string) => echapper(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');

function figure(nom: string, legende: string, classe = '') {
  const chemin = join(CAPTURES, `${nom}.png`);
  if (!existsSync(chemin)) throw new Error(`Capture manquante : ${nom} (lancez d'abord docs/manuel/scenario.ts)`);
  return `<figure class="${classe}"><img src="captures/${nom}.png" alt=""><figcaption>${md(legende)}</figcaption></figure>`;
}
const p = (t: string) => `<p>${md(t)}</p>`;
const liste = (items: string[]) => `<ul>${items.map((i) => `<li>${md(i)}</li>`).join('')}</ul>`;
const etapes = (items: string[]) => `<ol>${items.map((i) => `<li>${md(i)}</li>`).join('')}</ol>`;
const note = (t: string) => `<div class="note">${md(t)}</div>`;
const section = (titre: string, ...contenu: string[]) => `<section><h2>${md(titre)}</h2>${contenu.join('\n')}</section>`;

const corps = [
  section(
    '1. À quoi sert 2x2',
    p('**2x2** aide à vérifier et corriger une liste de bénéficiaires (par exemple un export KoboToolbox) avant un paiement, de façon traçable et sans qu’une seule personne puisse la modifier seule.'),
    liste([
      '**Hors ligne** : l’outil est un seul fichier HTML qui s’ouvre dans un navigateur. Aucune donnée ne quitte le poste en clair.',
      '**Un seul fichier circule** : la liste chiffrée (`.2x2`), protégée par le mot de passe de la liste.',
      '**Quatre yeux** : toute modification (correction d’une valeur, exclusion d’un ménage) est proposée par une personne et validée par une autre.',
      '**Journal signé** : chaque action est signée avec la clé de son auteur et chaînée aux précédentes. Une retouche du fichier se voit à l’ouverture.',
      '**L’outil signale, une personne décide** : les règles de contrôle produisent des alertes ; chaque alerte reçoit une décision signée.',
    ]),
    note('Ce manuel suit un **scénario de démonstration** avec des **données fictives** (300 ménages, noms et lieux inventés). N’utilisez jamais de données réelles avec ce prototype.'),
  ),
  section(
    '2. Les rôles et le scénario',
    p('Trois personnes interviennent dans le scénario, chacune avec un rôle :'),
    `<table class="roles"><thead><tr><th>Personne</th><th>Rôle</th><th>Ce qu’elle fait</th></tr></thead><tbody>
      <tr><td>Rachel</td><td>Responsable</td><td>Crée la liste, déclare les personnes, fixe les règles, décide des alertes, prépare les visites, exporte la liste finale.</td></tr>
      <tr><td>Paul</td><td>Correction</td><td>Corrige des valeurs et propose des exclusions de ménages.</td></tr>
      <tr><td>Victor</td><td>Validation</td><td>Accepte ou refuse les propositions de Paul, produit un reçu.</td></tr></tbody></table>`,
    p('Une personne peut cumuler plusieurs rôles, mais **personne ne valide sa propre correction**. Il faut donc au moins deux personnes : une en correction, une autre en validation.'),
  ),
  section(
    '3. Chacun crée sa clé',
    p('Chaque personne crée **une fois** sa clé personnelle, sur son propre poste.'),
    figure('01_accueil', 'Écran d’accueil : ouvrir une clé existante ou en créer une.'),
    etapes([
      '« Créer ma clé » : votre nom et un mot de passe d’au moins 12 caractères.',
      'Le navigateur enregistre la **clé privée** (`.2x2cle`). Gardez-la en lieu sûr avec son mot de passe : elle ne se transmet jamais.',
      'Transmettez votre **clé publique** à la responsable : « Copier ma clé publique (texte) » puis collez-la dans un message, ou envoyez le fichier `.json`.',
    ]),
    figure('02_creer_cle', 'Création de la clé de Rachel.'),
    figure('03_cle_creee', 'Clé créée : la clé publique se partage par texte ou par fichier.'),
    note('**Mot de passe de clé oublié** : la clé est inutilisable. Créez-en une nouvelle et envoyez la nouvelle clé publique à la responsable.'),
  ),
  section(
    '4. La responsable crée la liste',
    p('Rachel déverrouille sa clé puis choisit « Importer un export… ».'),
    figure('04_bonjour', 'Après déverrouillage : ouvrir une liste, ou en créer une nouvelle à partir d’un export.'),
    figure('05_import_apercu', 'L’export est lu : nombre de lignes et de colonnes, colonne d’identifiant proposée.'),
    p('Elle déclare ensuite les personnes (clé publique collée ou fichier) et leurs **rôles**. Les conditions des quatre yeux s’affichent en direct ; la liste ne peut être créée que lorsqu’elles sont remplies.'),
    figure('06_import_roles', 'Rôles : Rachel responsable, Paul en correction, Victor en validation. Les trois conditions sont remplies.'),
    figure('07_liste_creee', 'La liste est créée et enregistrée en fichier chiffré. L’export d’origine est figé et son empreinte calculée.'),
    note('**Le mot de passe de la liste** se transmet par un autre canal que le fichier (téléphone, par exemple), jamais dans le même message.'),
  ),
  section(
    '5. Règles de contrôle',
    p('Les alertes viennent de **règles de contrôle** proposées d’après les colonnes de l’export : durée d’entretien, ordre des dates, doublons (téléphone, pièce d’identité, noms proches), enquêteur atypique, contrôles GPS, liens entre ménage hôte et ménages hébergés.'),
    figure('08_regles', 'Écran Validation, carte « Règles de contrôle » : les règles actives et le nombre d’alertes de chacune.', 'large'),
    p('Pour les modifier : **exporter** les règles (XLSX, ODS ou CSV), les éditer dans un tableur (une règle par ligne, feuille « Aide »), puis les **importer**. Un aperçu montre l’effet sur les alertes avant de « Signer ces règles ».'),
  ),
  section(
    '6. Décider des alertes, en lot',
    p('L’écran **Validation** rassemble dans un tableau les corrections à valider et les alertes à décider. On filtre sous chaque titre de colonne, on coche, on choisit la décision et on signe : chaque ligne reçoit sa propre entrée signée au journal.'),
    figure('09_validation_lot', 'Rachel filtre les entretiens anormalement courts, les coche tous et décide « À vérifier sur le terrain ».'),
    liste([
      '**Problème confirmé** et **Vérifiée : pas de problème** demandent un commentaire.',
      '**À vérifier sur le terrain** prépare une visite (voir la section 8).',
      'Une case grisée ne peut pas être cochée : la survoler en donne la raison (votre propre correction, rôle manquant…).',
    ]),
  ),
  section(
    '7. Plan GPS',
    p('Si l’export contient des coordonnées GPS, l’écran **Correction** propose un **plan** des ménages filtrés, colorés par alerte, enquêteur ou journée. Un fond de carte hors ligne (GeoJSON, par exemple un export du HOT Export Tool) peut être chargé : 2x2 dessine routes, rivières et noms de villages, sans connexion.'),
    figure('10_plan', 'Plan des 300 ménages sur un fond de carte fictif. Les traits violets relient les ménages hébergés à leur famille d’accueil.'),
    figure('11_plan_groupes', 'Filtre « Entretiens groupés au même endroit » : neuf ménages « différents » enregistrés au même point par le même enquêteur.', 'large'),
  ),
  section(
    '8. Préparer une visite terrain',
    p('Rachel filtre les ménages dont une alerte est « À vérifier sur le terrain », les coche tous et ouvre « Liste de visite… ».'),
    figure('12_liste_visite', 'Liste de visite : colonnes à inclure (le minimum utile), format « Préchargement Kobo » et colonnes affichées dans la liste de choix du formulaire.', 'large'),
    liste([
      '**Préchargement Kobo** : un fichier `menages_a_revoir.csv` à joindre au formulaire Kobo de revisite (ce formulaire se télécharge depuis le même panneau).',
      '**Liste à imprimer** (XLSX, ODS) : un document de terrain, qui ne se réimporte pas.',
      'Chaque sortie de données est **inscrite au journal** (ménages et colonnes). Le fichier contient des données personnelles en clair : canal sûr, suppression après la mission.',
    ]),
  ),
  section(
    '9. Corriger',
    p('Paul ouvre la liste avec **sa** clé. L’écran Correction montre les ménages avec leur enquêteur, la date de l’entretien, leurs alertes et leur état ; on filtre et trie sur chaque colonne, et « Colonnes… » permet de choisir et d’ordonner les colonnes.'),
    figure('13_correction_tableau', 'Écran Correction : tableau des ménages, filtres sous chaque titre, fiche du ménage en dessous.'),
    figure('14_fiche_menage', 'Fiche d’un ménage hébergé : son ménage hôte, l’alerte de lien (hôte rattaché à trop de ménages) et toutes ses valeurs.'),
    p('« Corriger » à côté d’un champ : nouvelle valeur, motif et commentaire, puis « Signer la correction ». La correction reste **en attente** jusqu’à sa validation par une autre personne.'),
    figure('15_correction_saisie', 'Correction d’un numéro de téléphone, avec son motif et un commentaire.'),
  ),
  section(
    '10. Comparer des doublons',
    p('Pour un doublon (même pièce d’identité, même téléphone, noms proches), « Comparer côte à côte » affiche les ménages en colonnes, différences surlignées, avec leur position GPS et la distance qui les sépare.'),
    p('Dans la ligne « Statut », on choisit une décision **pour chaque ménage** (conserver, faire vérifier, exclure avec son motif), puis on signe le tout en une fois.'),
    figure('16_comparaison', 'Paul conserve un ménage et propose d’exclure l’autre comme doublon. La décision sur l’alerte reviendra à une personne en validation ou responsable.'),
  ),
  section(
    '11. Valider',
    p('Victor ouvre la liste avec sa clé. Dans **Validation**, il filtre le type « Correction », coche les propositions de Paul, choisit « Accepter la correction » (ou « Refuser », avec un commentaire) et signe.'),
    figure('17_validation_corrections', 'Validation en lot des propositions de Paul : la correction du téléphone et l’exclusion du doublon.'),
    p('À la fin de la séance, il produit son **reçu** et le garde en dehors du fichier : il permettra de prouver plus tard qu’aucune ligne du journal n’a été retirée.'),
    figure('18_recu', 'Reçu de validation, à copier ou télécharger et à conserver à part.', 'large'),
  ),
  section(
    '12. Retours du terrain',
    p('Après la mission, l’export des réponses du formulaire Kobo de revisite s’importe avec « Retours du terrain… ». L’outil **propose** les décisions d’alerte, corrections et exclusions correspondantes ; rien n’est appliqué sans signature.'),
    figure('19_retours_terrain', 'Retours de l’équipe terrain : Rachel signe les décisions d’alerte. Les corrections et exclusions, grisées, devront être signées par une personne ayant le rôle Correction.', 'large'),
    note('Une visite enregistrée à plus de 500 m du ménage, ou sans position GPS, est signalée et n’est pas cochée par défaut.'),
  ),
  section(
    '13. Exporter la liste finale',
    p('L’export de la liste finale n’est possible que lorsque **plus aucune correction n’est en attente** et que **toutes les alertes ont une décision**, et seulement pour une personne responsable.'),
    figure('20_export', 'Écran Export : conditions remplies, liste finale disponible en CSV (paiement), XLSX ou ODS.'),
    p('Chaque export est inscrit au journal avec l’empreinte du fichier produit : « Vérifier un fichier exporté » détecte plus tard un fichier retouché.'),
  ),
  section(
    '14. Journal et aide',
    figure('21_journal', 'Journal : toutes les actions signées, qui, quoi, quand. Il est vérifié à chaque ouverture du fichier.'),
    figure('22_aide', 'L’écran Aide reprend le mode d’emploi, étape par étape.'),
  ),
  section(
    '15. Bonnes pratiques',
    liste([
      '**Une seule personne travaille sur le fichier à la fois** : deux copies modifiées en parallèle ne peuvent pas être fusionnées.',
      '**Enregistrez souvent** : chaque enregistrement crée un fichier dont le nom porte la version (par exemple `…_v042-3f9a_2026-11-23.2x2`). Travaillez toujours sur la dernière ; le numéro affiché en haut de l’écran fait foi.',
      '**Mot de passe de la liste** : par un autre canal que le fichier. **Clé privée** : jamais transmise.',
      '**Copie de secours** : si la page est fermée ou rafraîchie avant d’enregistrer, l’accueil propose de reprendre le travail.',
      '**Fichiers en clair** (listes de visite, exports) : canal sûr, accès limité, suppression après usage.',
    ]),
  ),
];

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>2x2 — Manuel d’utilisation</title>
<style>
  @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
  body { font-family: 'Noto Sans', 'Segoe UI', Arial, sans-serif; color: #1d1d1b; font-size: 10.5pt; line-height: 1.5; margin: 0; }
  .couverture { height: 245mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .marque { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; width: 54px; height: 54px; margin-bottom: 18px; }
  .marque i { background: #0f5f73; border-radius: 4px; } .marque i:last-child { background: #0a4555; }
  .couverture h1 { font-size: 40pt; margin: 0; color: #0f5f73; }
  .couverture .sous-titre { font-size: 16pt; margin: 6px 0 28px; }
  .couverture .bandeau { display: inline-block; background: #e6f1f4; color: #0a4555; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; font-size: 9pt; padding: 4px 10px; border-radius: 99px; }
  .couverture .meta { margin-top: 40px; color: #6b6b6b; }
  .sommaire { page-break-after: always; }
  .sommaire ol { columns: 2; padding-left: 1.2em; }
  h2 { color: #0f5f73; font-size: 16pt; border-bottom: 2px solid #0f5f73; padding-bottom: 4px; margin: 0 0 10px; break-after: avoid; }
  section { margin-top: 22px; }
  section:first-of-type { margin-top: 0; }
  /* Un titre ne reste jamais seul en bas de page : il part avec le texte qui le suit. */
  h2 + p, h2 + figure { break-before: avoid; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0 6px 1.2em; padding: 0; } li { margin: 3px 0; }
  code { font-family: 'Noto Sans Mono', Consolas, monospace; font-size: 9pt; background: #f2f2f0; padding: 0 3px; border-radius: 3px; }
  figure { margin: 10px 0 12px; page-break-inside: avoid; text-align: center; }
  figure img { max-width: 100%; max-height: 112mm; width: auto; border: 1px solid #d0d0d0; border-radius: 4px; display: block; margin: 0 auto; }
  figure.large img { max-height: 150mm; }
  figcaption { text-align: left; }
  figcaption { font-size: 9pt; color: #555; margin-top: 4px; font-style: italic; }
  .note { border-left: 4px solid #a35a00; background: #fff3e0; padding: 6px 10px; margin: 10px 0; border-radius: 3px; page-break-inside: avoid; }
  table.roles { border-collapse: collapse; width: 100%; margin: 8px 0; }
  table.roles th, table.roles td { border: 1px solid #d0d0d0; padding: 5px 8px; text-align: left; vertical-align: top; }
  table.roles th { background: #e6f1f4; }
</style></head><body>
<div class="couverture">
  <div class="marque"><i></i><i></i><i></i><i></i></div>
  <h1>2x2</h1>
  <div class="sous-titre">Intégrité des listes de bénéficiaires — manuel d’utilisation</div>
  <div><span class="bandeau">Prototype · données fictives uniquement</span></div>
  <div class="meta">Version ${VERSION} · scénario de démonstration avec trois utilisateurs : responsable, correction, validation.</div>
</div>
<div class="sommaire"><h2>Sommaire</h2><ol>${corps.map((s) => `<li>${s.match(/<h2>(.*?)<\/h2>/)![1].replace(/^\d+\.\s*/, '')}</li>`).join('')}</ol></div>
${corps.join('\n')}
</body></html>`;

const cheminHtml = join(SORTIE, 'manuel.html');
writeFileSync(cheminHtml, html);
const navigateur = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await navigateur.newPage();
await page.goto('file://' + cheminHtml, { waitUntil: 'load' });
const pdf = join(SORTIE, `manuel_2x2_v${VERSION}.pdf`);
await page.pdf({
  path: pdf,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="font-size:8px;color:#888;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>2x2 v${VERSION} — manuel d’utilisation (données fictives)</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
});
await navigateur.close();
console.log('PDF :', pdf);
