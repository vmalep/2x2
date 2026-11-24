/**
 * Manuel d'utilisation en PDF, à partir des copies d'écran du scénario de démonstration.
 *
 * Usage : npx tsx docs/manuel/scenario.ts [fr|en] && npx tsx docs/manuel/construire.ts [fr|en]
 * Sortie : docs/manuel/sortie/manuel_2x2_v<version>.pdf (français) ou manuel_2x2_v<version>_en.pdf (anglais),
 * et la page HTML intermédiaire. Les textes du manuel sont écrits ici dans les deux langues, côte à côte.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const VERSION: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const SORTIE = resolve('docs/manuel/sortie');
/** Langue du manuel : les copies d'écran viennent du scénario joué dans cette langue. */
const L = process.argv[2] === 'en' ? 'en' : 'fr';
const x = (fr: string, en: string) => (L === 'fr' ? fr : en);
const CAPTURES = join(SORTIE, `captures_${L}`);

const echapper = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Texte simple avec **gras** et `code`. */
const md = (t: string) => echapper(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');

function figure(nom: string, legende: string, classe = '') {
  const chemin = join(CAPTURES, `${nom}.png`);
  if (!existsSync(chemin)) throw new Error(`Capture manquante : ${nom} (lancez d'abord docs/manuel/scenario.ts ${L})`);
  return `<figure class="${classe}"><img src="captures_${L}/${nom}.png" alt=""><figcaption>${md(legende)}</figcaption></figure>`;
}
const p = (t: string) => `<p>${md(t)}</p>`;
const liste = (items: string[]) => `<ul>${items.map((i) => `<li>${md(i)}</li>`).join('')}</ul>`;
const etapes = (items: string[]) => `<ol>${items.map((i) => `<li>${md(i)}</li>`).join('')}</ol>`;
const note = (t: string) => `<div class="note">${md(t)}</div>`;
const section = (titre: string, ...contenu: string[]) => `<section><h2>${md(titre)}</h2>${contenu.join('\n')}</section>`;

const corps = [
  section(
    x('1. À quoi sert 2x2', '1. What 2x2 is for'),
    p(x('**2x2** aide à vérifier et corriger une liste de bénéficiaires (par exemple un export KoboToolbox) avant un paiement, de façon traçable et sans qu’une seule personne puisse la modifier seule.',
      '**2x2** helps check and correct a beneficiary list (for example a KoboToolbox export) before a payment, in a traceable way and without any single person being able to change it alone.')),
    liste([
      x('**Hors ligne** : l’outil est un seul fichier HTML qui s’ouvre dans un navigateur. Aucune donnée ne quitte le poste en clair.',
        '**Offline**: the tool is a single HTML file that opens in a browser. No data leaves the computer unencrypted.'),
      x('**Un seul fichier circule** : la liste chiffrée (`.2x2`), protégée par le mot de passe de la liste.',
        '**A single file circulates**: the encrypted list (`.2x2`), protected by the list password.'),
      x('**Quatre yeux** : toute modification (correction d’une valeur, exclusion d’un ménage) est proposée par une personne et validée par une autre.',
        '**Four eyes**: every change (correction of a value, exclusion of a household) is proposed by one person and validated by another.'),
      x('**Journal signé** : chaque action est signée avec la clé de son auteur et chaînée aux précédentes. Une retouche du fichier se voit à l’ouverture.',
        '**Signed log**: each action is signed with its author’s key and chained to the previous ones. Any alteration of the file shows when it is opened.'),
      x('**L’outil signale, une personne décide** : les règles de contrôle produisent des alertes ; chaque alerte reçoit une décision signée.',
        '**The tool flags, a person decides**: the control rules produce alerts; each alert receives a signed decision.'),
      x('**Français ou anglais** : le sélecteur FR / EN en haut de l’écran change la langue de l’interface ; les données signées (motifs, décisions, commentaires) ne changent pas.',
        '**French or English**: the FR / EN selector at the top of the screen changes the interface language; signed data (reasons, decisions, comments) does not change.'),
    ]),
    note(x('Ce manuel suit un **scénario de démonstration** avec des **données fictives** (300 ménages, noms et lieux inventés). N’utilisez jamais de données réelles avec ce prototype.',
      'This manual follows a **demonstration scenario** with **fictitious data** (300 households, invented names and places). Never use real data with this prototype.')),
  ),
  section(
    x('2. Les rôles et le scénario', '2. Roles and scenario'),
    p(x('Trois personnes interviennent dans le scénario, chacune avec un rôle :', 'Three people take part in the scenario, each with a role:')),
    `<table class="roles"><thead><tr><th>${x('Personne', 'Person')}</th><th>${x('Rôle', 'Role')}</th><th>${x('Ce qu’elle fait', 'What they do')}</th></tr></thead><tbody>
      <tr><td>Rachel</td><td>${x('Responsable', 'Manager')}</td><td>${x('Crée la liste, déclare les personnes, fixe les règles, décide des alertes, prépare les visites, exporte la liste finale.', 'Creates the list, declares the people, sets the rules, decides on alerts, prepares visits, exports the final list.')}</td></tr>
      <tr><td>Paul</td><td>Correction</td><td>${x('Corrige des valeurs et propose des exclusions de ménages.', 'Corrects values and proposes household exclusions.')}</td></tr>
      <tr><td>Victor</td><td>Validation</td><td>${x('Accepte ou refuse les propositions de Paul, produit un reçu.', 'Accepts or rejects Paul’s proposals, produces a receipt.')}</td></tr></tbody></table>`,
    p(x('Une personne peut cumuler plusieurs rôles, mais **personne ne valide sa propre correction**. Il faut donc au moins deux personnes : une en correction, une autre en validation.',
      'One person may hold several roles, but **nobody validates their own correction**. At least two people are therefore needed: one in correction, another in validation.')),
  ),
  section(
    x('3. Chacun crée sa clé', '3. Everyone creates their key'),
    p(x('Chaque personne crée **une fois** sa clé personnelle, sur son propre poste.', 'Each person creates their personal key **once**, on their own computer.')),
    figure('01_accueil', x('Écran d’accueil : ouvrir une clé existante ou en créer une.', 'Home screen: open an existing key or create one.')),
    etapes([
      x('« Créer ma clé » : votre nom et un mot de passe d’au moins 12 caractères.', '“Create my key”: your name and a password of at least 12 characters.'),
      x('Le navigateur enregistre la **clé privée** (`.2x2cle`). Gardez-la en lieu sûr avec son mot de passe : elle ne se transmet jamais.',
        'The browser saves the **private key** (`.2x2cle`). Keep it somewhere safe with its password: it is never shared.'),
      x('Transmettez votre **clé publique** à la responsable : « Copier ma clé publique (texte) » puis collez-la dans un message, ou envoyez le fichier `.json`.',
        'Send your **public key** to the manager: “Copy my public key (text)”, then paste it into a message, or send the `.json` file.'),
    ]),
    figure('02_creer_cle', x('Création de la clé de Rachel.', 'Creating Rachel’s key.')),
    figure('03_cle_creee', x('Clé créée : la clé publique se partage par texte ou par fichier.', 'Key created: the public key is shared as text or as a file.')),
    note(x('**Mot de passe de clé oublié** : la clé est inutilisable. Créez-en une nouvelle et envoyez la nouvelle clé publique à la responsable.',
      '**Forgotten key password**: the key cannot be used. Create a new one and send the new public key to the manager.')),
  ),
  section(
    x('4. La responsable crée la liste', '4. The manager creates the list'),
    p(x('Rachel déverrouille sa clé puis choisit « Importer un export… ».', 'Rachel unlocks her key, then chooses “Import an export…”.')),
    figure('04_bonjour', x('Après déverrouillage : ouvrir une liste, ou en créer une nouvelle à partir d’un export.', 'After unlocking: open a list, or create a new one from an export.')),
    figure('05_import_apercu', x('L’export est lu : nombre de lignes et de colonnes, colonne d’identifiant proposée.', 'The export is read: number of rows and columns, proposed identifier column.')),
    p(x('Elle déclare ensuite les personnes (clé publique collée ou fichier) et leurs **rôles**. Les conditions des quatre yeux s’affichent en direct ; la liste ne peut être créée que lorsqu’elles sont remplies.',
      'She then declares the people (pasted public key or file) and their **roles**. The four-eyes conditions are displayed live; the list can only be created once they are met.')),
    figure('06_import_roles', x('Rôles : Rachel responsable, Paul en correction, Victor en validation. Les trois conditions sont remplies.', 'Roles: Rachel manager, Paul in correction, Victor in validation. The three conditions are met.')),
    figure('07_liste_creee', x('La liste est créée et enregistrée en fichier chiffré. L’export d’origine est figé et son empreinte calculée.', 'The list is created and saved as an encrypted file. The original export is frozen and its fingerprint computed.')),
    note(x('**Le mot de passe de la liste** se transmet par un autre canal que le fichier (téléphone, par exemple), jamais dans le même message.',
      '**The list password** is shared through a different channel than the file (by phone, for example), never in the same message.')),
  ),
  section(
    x('5. Règles de contrôle', '5. Control rules'),
    p(x('Les alertes viennent de **règles de contrôle** proposées d’après les colonnes de l’export : durée d’entretien, ordre des dates, doublons (téléphone, pièce d’identité, noms proches), enquêteur atypique, contrôles GPS, liens entre ménage hôte et ménages hébergés.',
      'Alerts come from **control rules** proposed from the export columns: interview duration, order of dates, duplicates (phone, identity document, similar names), atypical enumerator, GPS checks, links between host household and hosted households.')),
    figure('08_regles', x('Écran Validation, carte « Règles de contrôle » : les règles actives et le nombre d’alertes de chacune.', 'Validation screen, “Control rules” card: the active rules and the number of alerts for each.'), 'large'),
    p(x('Pour les modifier : **exporter** les règles (XLSX, ODS ou CSV), les éditer dans un tableur (une règle par ligne, feuille « Aide »), puis les **importer**. Un aperçu montre l’effet sur les alertes avant de « Signer ces règles ».',
      'To change them: **export** the rules (XLSX, ODS or CSV), edit them in a spreadsheet (one rule per row, “Help” sheet), then **import** them. A preview shows the effect on the alerts before “Sign these rules”.')),
    note(x('Les règles par défaut reçoivent un libellé dans la langue de l’utilisateur ; leur **nom** ne change pas, et les décisions prises y restent rattachées. Un fichier de règles importé garde ses propres libellés.',
      'Default rules get a label in the user’s language; their **name** does not change, and decisions already taken stay attached to them. An imported rules file keeps its own labels.')),
  ),
  section(
    x('6. Décider des alertes, en lot', '6. Deciding on alerts, in bulk'),
    p(x('L’écran **Validation** rassemble dans un tableau les corrections à valider et les alertes à décider. On filtre sous chaque titre de colonne, on coche, on choisit la décision et on signe : chaque ligne reçoit sa propre entrée signée au journal.',
      'The **Validation** screen gathers in one table the corrections to validate and the alerts to decide. Filter under each column title, tick, choose the decision and sign: each row gets its own signed log entry.')),
    figure('09_validation_lot', x('Rachel filtre les entretiens anormalement courts, les coche tous et décide « À vérifier sur le terrain ».', 'Rachel filters the abnormally short interviews, ticks them all and decides “To be checked in the field”.')),
    liste([
      x('**Anomalie confirmée** et **Vérifiée : pas de problème** demandent un commentaire.', '**Anomaly confirmed** and **Checked: no problem** require a comment.'),
      x('**À vérifier sur le terrain** prépare une visite (voir la section 8).', '**To be checked in the field** prepares a visit (see section 8).'),
      x('Une case grisée ne peut pas être cochée : la survoler en donne la raison (votre propre correction, rôle manquant…).', 'A greyed-out box cannot be ticked: hovering over it gives the reason (your own correction, missing role…).'),
    ]),
  ),
  section(
    x('7. Plan GPS', '7. GPS map'),
    p(x('Si l’export contient des coordonnées GPS, l’écran **Correction** propose un **plan** des ménages filtrés, colorés par alerte, enquêteur ou journée. Un fond de carte hors ligne (GeoJSON, par exemple un export du HOT Export Tool) peut être chargé : 2x2 dessine routes, rivières et noms de villages, sans connexion.',
      'If the export contains GPS coordinates, the **Correction** screen offers a **map** of the filtered households, coloured by alert, enumerator or day. An offline base map (GeoJSON, for example an export from the HOT Export Tool) can be loaded: 2x2 draws roads, rivers and village names, without a connection.')),
    figure('10_plan', x('Plan des 300 ménages sur un fond de carte fictif. Les traits violets relient les ménages hébergés à leur famille d’accueil.', 'Map of the 300 households on a fictitious base map. Purple lines connect hosted households to their host family.')),
    figure('11_plan_groupes', x('Filtre « Entretiens groupés au même endroit » : neuf ménages « différents » enregistrés au même point par le même enquêteur.', '“Interviews grouped in the same place” filter: nine “different” households recorded at the same point by the same enumerator.'), 'large'),
  ),
  section(
    x('8. Préparer une visite terrain', '8. Preparing a field visit'),
    p(x('Rachel filtre les ménages dont une alerte est « À vérifier sur le terrain », les coche tous et ouvre « Liste de visite… ».', 'Rachel filters the households with an alert “To be checked in the field”, ticks them all and opens “Visit list…”.')),
    figure('12_liste_visite', x('Liste de visite : colonnes à inclure (le minimum utile), format « Préchargement Kobo » et colonnes affichées dans la liste de choix du formulaire.', 'Visit list: columns to include (the useful minimum), “Kobo preload” format and the columns shown in the form’s choice list.'), 'large'),
    liste([
      x('**Préchargement Kobo** : un fichier `menages_a_revoir.csv` à joindre au formulaire Kobo de revisite (ce formulaire se télécharge depuis le même panneau, en français et en anglais).',
        '**Kobo preload**: a `menages_a_revoir.csv` file to attach to the Kobo revisit form (this form is downloaded from the same panel, in French and English).'),
      x('**Liste à imprimer** (XLSX, ODS) : un document de terrain, qui ne se réimporte pas.', '**Printable list** (XLSX, ODS): a field document, which is not re-imported.'),
      x('Chaque sortie de données est **inscrite au journal** (ménages et colonnes). Le fichier contient des données personnelles en clair : canal sûr, suppression après la mission.',
        'Every data output is **recorded in the log** (households and columns). The file contains personal data in clear text: secure channel, deletion after the mission.'),
    ]),
  ),
  section(
    x('9. Corriger', '9. Correcting'),
    p(x('Paul ouvre la liste avec **sa** clé. L’écran Correction montre les ménages avec leur enquêteur, la date de l’entretien, leurs alertes et leur état ; on filtre et trie sur chaque colonne, et « Colonnes… » permet de choisir et d’ordonner les colonnes.',
      'Paul opens the list with **his** key. The Correction screen shows the households with their enumerator, interview date, alerts and state; you can filter and sort on each column, and “Columns…” lets you choose and order the columns.')),
    figure('13_correction_tableau', x('Écran Correction : tableau des ménages, filtres sous chaque titre, fiche du ménage en dessous.', 'Correction screen: household table, filters under each title, household record below.')),
    figure('14_fiche_menage', x('Fiche d’un ménage hébergé : son ménage hôte, l’alerte de lien (hôte rattaché à trop de ménages) et toutes ses valeurs.', 'Record of a hosted household: its host household, the link alert (host linked to too many households) and all its values.')),
    p(x('« Corriger » à côté d’un champ : nouvelle valeur, motif et commentaire, puis « Signer la correction ». La correction reste **en attente** jusqu’à sa validation par une autre personne.',
      '“Correct” next to a field: new value, reason and comment, then “Sign the correction”. The correction remains **pending** until it is validated by another person.')),
    figure('15_correction_saisie', x('Correction d’un numéro de téléphone, avec son motif et un commentaire.', 'Correction of a phone number, with its reason and a comment.')),
  ),
  section(
    x('10. Comparer des doublons', '10. Comparing duplicates'),
    p(x('Pour un doublon (même pièce d’identité, même téléphone, noms proches), « Comparer côte à côte » affiche les ménages en colonnes, différences surlignées, avec leur position GPS et la distance qui les sépare.',
      'For a duplicate (same identity document, same phone, similar names), “Compare side by side” shows the households in columns, with differences highlighted, along with their GPS position and the distance between them.')),
    p(x('Dans la ligne « Statut », on choisit une décision **pour chaque ménage** (conserver, faire vérifier, exclure avec son motif), puis on signe le tout en une fois.',
      'In the “Status” row, choose a decision **for each household** (keep, have checked, exclude with its reason), then sign everything at once.')),
    figure('16_comparaison', x('Paul conserve un ménage et propose d’exclure l’autre comme doublon. La décision sur l’alerte reviendra à une personne en validation ou responsable.', 'Paul keeps one household and proposes excluding the other as a duplicate. The decision on the alert will belong to a person in validation or a manager.')),
  ),
  section(
    x('11. Valider', '11. Validating'),
    p(x('Victor ouvre la liste avec sa clé. Dans **Validation**, il filtre le type « Correction », coche les propositions de Paul, choisit « Accepter la correction » (ou « Refuser », avec un commentaire) et signe.',
      'Victor opens the list with his key. In **Validation**, he filters the “Correction” type, ticks Paul’s proposals, chooses “Accept the correction” (or “Reject”, with a comment) and signs.')),
    figure('17_validation_corrections', x('Validation en lot des propositions de Paul : la correction du téléphone et l’exclusion du doublon.', 'Bulk validation of Paul’s proposals: the phone correction and the exclusion of the duplicate.')),
    p(x('À la fin de la séance, il produit son **reçu** et le garde en dehors du fichier : il permettra de prouver plus tard qu’aucune ligne du journal n’a été retirée.',
      'At the end of the session, he produces his **receipt** and keeps it outside the file: it will later prove that no log line has been removed.')),
    figure('18_recu', x('Reçu de validation, à copier ou télécharger et à conserver à part.', 'Validation receipt, to copy or download and keep separately.'), 'large'),
  ),
  section(
    x('12. Retours du terrain', '12. Field results'),
    p(x('Après la mission, l’export des réponses du formulaire Kobo de revisite s’importe avec « Retours du terrain… ». L’outil **propose** les décisions d’alerte, corrections et exclusions correspondantes ; rien n’est appliqué sans signature.',
      'After the mission, the export of the Kobo revisit form answers is imported with “Field results…”. The tool **proposes** the corresponding alert decisions, corrections and exclusions; nothing is applied without a signature.')),
    figure('19_retours_terrain', x('Retours de l’équipe terrain : Rachel signe les décisions d’alerte. Les corrections et exclusions, grisées, devront être signées par une personne ayant le rôle Correction.', 'Results from the field team: Rachel signs the alert decisions. The corrections and exclusions, greyed out, will have to be signed by a person with the Correction role.'), 'large'),
    note(x('Une visite enregistrée à plus de 500 m du ménage, ou sans position GPS, est signalée et n’est pas cochée par défaut. L’export des réponses peut être fait avec les valeurs ou les libellés, dans l’une ou l’autre langue du formulaire.',
      'A visit recorded more than 500 m from the household, or without a GPS position, is flagged and not ticked by default. The answers can be exported with values or labels, in either language of the form.')),
  ),
  section(
    x('13. Exporter la liste finale', '13. Exporting the final list'),
    p(x('L’export de la liste finale n’est possible que lorsque **plus aucune correction n’est en attente** et que **toutes les alertes ont une décision**, et seulement pour une personne responsable.',
      'The final list can only be exported once **no correction is pending** and **all alerts have a decision**, and only by a manager.')),
    figure('20_export', x('Écran Export : conditions remplies, liste finale disponible en CSV (paiement), XLSX ou ODS.', 'Export screen: conditions met, final list available as CSV (payment), XLSX or ODS.')),
    p(x('Chaque export est inscrit au journal avec l’empreinte du fichier produit : « Vérifier un fichier exporté » détecte plus tard un fichier retouché. Le rapport des alertes et les listes de visite sont produits dans la langue de l’utilisateur ; la liste finale garde les colonnes de l’export d’origine.',
      'Each export is recorded in the log with the fingerprint of the file produced: “Verify an exported file” later detects an altered file. The alert report and visit lists are produced in the user’s language; the final list keeps the columns of the original export.')),
  ),
  section(
    x('14. Journal et aide', '14. Log and help'),
    figure('21_journal', x('Journal : toutes les actions signées, qui, quoi, quand. Il est vérifié à chaque ouverture du fichier.', 'Log: all signed actions, who, what, when. It is verified each time the file is opened.')),
    figure('22_aide', x('L’écran Aide reprend le mode d’emploi, étape par étape.', 'The Help screen contains the user guide, step by step.')),
  ),
  section(
    x('15. Bonnes pratiques', '15. Good practice'),
    liste([
      x('**Une seule personne travaille sur le fichier à la fois** : deux copies modifiées en parallèle ne peuvent pas être fusionnées.', '**Only one person works on the file at a time**: two copies modified in parallel cannot be merged.'),
      x('**Enregistrez souvent** : chaque enregistrement crée un fichier dont le nom porte la version (par exemple `…_v042-3f9a_2026-11-23.2x2`). Travaillez toujours sur la dernière ; le numéro affiché en haut de l’écran fait foi.',
        '**Save often**: each save creates a file whose name carries the version (for example `…_v042-3f9a_2026-11-23.2x2`). Always work on the latest one; the number shown at the top of the screen prevails.'),
      x('**Mot de passe de la liste** : par un autre canal que le fichier. **Clé privée** : jamais transmise.', '**List password**: through a different channel than the file. **Private key**: never shared.'),
      x('**Copie de secours** : si la page est fermée ou rafraîchie avant d’enregistrer, l’accueil propose de reprendre le travail.', '**Backup copy**: if the page is closed or refreshed before saving, the home screen offers to resume the work.'),
      x('**Fichiers en clair** (listes de visite, exports) : canal sûr, accès limité, suppression après usage.', '**Clear-text files** (visit lists, exports): secure channel, limited access, deletion after use.'),
    ]),
  ),
];

const html = `<!doctype html>
<html lang="${L}"><head><meta charset="utf-8"><title>2x2 — ${x('Manuel d’utilisation', 'User manual')}</title>
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
  <div class="sous-titre">${x('Intégrité des listes de bénéficiaires — manuel d’utilisation', 'Beneficiary list integrity — user manual')}</div>
  <div><span class="bandeau">${x('Prototype · données fictives uniquement', 'Prototype · fictitious data only')}</span></div>
  <div class="meta">Version ${VERSION} · ${x('scénario de démonstration avec trois utilisateurs : responsable, correction, validation.', 'demonstration scenario with three users: manager, correction, validation.')}</div>
</div>
<div class="sommaire"><h2>${x('Sommaire', 'Contents')}</h2><ol>${corps.map((s) => `<li>${s.match(/<h2>(.*?)<\/h2>/)![1].replace(/^\d+\.\s*/, '')}</li>`).join('')}</ol></div>
${corps.join('\n')}
</body></html>`;

const cheminHtml = join(SORTIE, L === 'fr' ? 'manuel.html' : 'manuel_en.html');
writeFileSync(cheminHtml, html);
const navigateur = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await navigateur.newPage();
await page.goto('file://' + cheminHtml, { waitUntil: 'load' });
const pdf = join(SORTIE, `manuel_2x2_v${VERSION}${L === 'fr' ? '' : '_en'}.pdf`);
await page.pdf({
  path: pdf,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="font-size:8px;color:#888;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>2x2 v${VERSION} — ${x('manuel d’utilisation (données fictives)', 'user manual (fictitious data)')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
});
await navigateur.close();
console.log('PDF :', pdf);
