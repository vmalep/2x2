# 2x2 : intégrité des listes de bénéficiaires

Une page web autonome, hors ligne et sans installation, pour corriger une liste de bénéficiaires (par exemple un export KoboToolbox)
en traçant chaque modification, avec une validation obligatoire par une seconde personne (le principe des « quatre yeux »).
Elle signale aussi les erreurs et les fraudes probables. Aucune donnée ne quitte le poste en clair :
seul circule un fichier chiffré.

Le nom : deux personnes, quatre yeux.

**Prototype sur données fictives uniquement.** Ne l'utilisez pas avec des données réelles.

## Télécharger · Download

**[Télécharger la dernière version](https://github.com/vmalep/2x2/releases/latest)** : l'outil (`2x2-vX.Y.Z.html`, un seul fichier
à ouvrir dans un navigateur, en français ou en anglais) et le manuel d'utilisation en PDF, en français et en anglais.

*English:* **[download the latest release](https://github.com/vmalep/2x2/releases/latest)**: the tool (`2x2-vX.Y.Z.html`, a single
file to open in a browser, in French or English) and the user manual as PDF, in French and English.
Prototype: use fictitious data only.

## Utilisation

```bash
npm install          # une seule fois (outils de développement)
npm run build        # produit dist/2x2-vX.Y.Z.html : un fichier unique, autonome, hors ligne
npm test             # tests automatisés (crypto, journal, ZIP/XLSX/CSV, générateur)
npm run e2e          # parcours complet à deux personnes dans Chrome (après build), en français puis en anglais
                     # (LANGUES=en npm run e2e pour une seule langue)
npm run fictif       # écrit un export Kobo fictif dans fictif/ (CSV, XLSX, vérité des anomalies)
npm run manuel       # manuel PDF en français et en anglais (après build) : docs/manuel/sortie/manuel_2x2_vX.Y.Z.pdf et …_en.pdf
```

`dist/2x2-vX.Y.Z.html` (version tirée de `package.json`) s'ouvre directement depuis le disque (double-clic), sans serveur ni installation.

## Choix techniques retenus

- **Moteur de données** : modèle en mémoire, sérialisé en JSON puis chiffré (question ouverte n° 11 tranchée).
- **Fichier unique** : TypeScript + Vite + vite-plugin-singlefile. Une Content-Security-Policy stricte est ajoutée à la compilation
  (`default-src 'none'`, `connect-src 'none'`, scripts et styles autorisés par empreinte SHA-256) : la page ne peut faire aucune requête réseau.
- **Cryptographie** : WebCrypto uniquement. AES-GCM 256 + PBKDF2-SHA256 (600 000 itérations), signatures ECDSA P-256.
  L'en-tête du fichier chiffré est authentifié (données associées AES-GCM).
- **XLSX et ODS** : lecteurs et écrivains maison (ZIP + XML), sans dépendance. Formats ouverts (ISO/IEC 29500 et 26300), lus nativement par LibreOffice Calc.
- **Aucune dépendance à l'exécution** : tout le code de `src/` est le nôtre.

## Structure

| Dossier | Contenu |
|---|---|
| `src/crypto/` | encodage, JSON canonique, SHA-256, chiffrement par mot de passe, clés personnelles et signatures |
| `src/io/` | ZIP, XLSX, CSV, import d'un export Kobo |
| `src/model/` | types, journal signé et chaîné (règles métier communes à l'ajout et à la vérification), fichier de liste chiffré |
| `src/gen/` | générateur de données fictives avec anomalies plantées |
| `src/i18n/` | textes de l'interface en français et en anglais (`t('clé', paramètres)`) |
| `src/ui/` | interface (DOM construit sans `innerHTML`) |
| `tests/`, `e2e/` | tests unitaires (Vitest) et parcours de bout en bout |

## Fichiers produits par l'outil

| Fichier | Contenu | Circule ? |
|---|---|---|
| `2x2_cle_privee_NOM.2x2cle` | clé privée chiffrée par le mot de passe personnel | **jamais** |
| `2x2_cle_publique_NOM.json` | clé publique et empreinte | au responsable |
| `liste_….2x2` | original figé, journal signé, clés publiques ; chiffré par le mot de passe de la liste | entre les personnes |

## État d'avancement

**Étape 1 (fait)** : clés personnelles, import XLSX/CSV avec empreinte, déclaration des utilisateurs, correction signée,
validation signée avec refus de l'auto-validation, journal chaîné vérifié à l'ouverture (lecture seule si altéré),
fichier chiffré (enregistrement direct sous Chrome/Edge, téléchargement ailleurs), générateur fictif.

**Étape 2 (fait)** :
- **Règles de contrôle** (`src/controles/`) : ce que l'outil vérifie est décrit par des règles, qui sont des données et jamais du code.
  Types disponibles : durée entre deux dates, ordre de deux dates, date hors période, nombre hors limites, valeur obligatoire,
  valeur hors liste, format (expression régulière), doublon sur une ou deux colonnes, téléphone en double, noms proches dans un groupe,
  enquêteur atypique. Des règles par défaut sont proposées d'après les colonnes de l'export.
  Pour les modifier : exporter le fichier de règles (XLSX, ODS ou CSV, avec une feuille « Aide »), l'éditer dans un tableur, l'importer.
  Le fichier est contrôlé, un aperçu montre l'effet sur les alertes, puis un responsable le signe au journal.
  Les contrôles portent sur les valeurs corrigées. Le repérage des situations de protection se fait en dehors de l'outil.
- **Écran Correction** : tableau des ménages avec enquêteur, date d'entretien (`start`), alertes et état ; filtres et tri sur chaque colonne ; fiche du ménage
  sous le tableau, séparée par une barre que l'on fait glisser ; exclusion en lot des ménages cochés (une proposition signée par ménage).
- **Liens entre ménages** (ex. ménage déplacé ↔ famille d'accueil), saisis d'un côté ou de l'autre (code de l'hôte, ou codes des
  ménages hébergés saisis par l'hôte) : règles « lien vers un autre ménage » (existe, condition, exclu,
  distance, nombre), « ménage sans ménage rattaché » (une famille d'accueil doit héberger au moins un ménage inclus) et « valeur
  obligatoire sous condition ». Proposées seulement si l'export contient une colonne de lien ; lien visible dans la fiche et sur le plan.
- **Colonnes au choix** dans les tableaux Correction et Validation (repères et colonnes de l'export), mémorisées par liste dans le navigateur.
- **Écran Validation unique** : corrections à valider et alertes dans un même tableau, filtrable et triable sur chaque colonne
  (type, contrôle, ménage, enquêteur, date d'entretien, détail, auteur, statut). On coche des lignes, on choisit la décision en en-tête et on signe :
  une ligne de journal par décision. Les lignes non décidables (sa propre correction, rôle manquant) sont grisées avec la raison.
- **Comparaison côte à côte** des ménages concernés par un doublon : différences surlignées, correction des valeurs, et une décision par
  ménage (conserver, faire vérifier, exclure avec son motif) signée en une fois avec la décision sur l'alerte.
- **Décisions humaines signées** sur chaque alerte (révisables, l'historique reste au journal).
- **Exclusion d'un ménage** : proposée puis validée par une autre personne, comme une correction.
- **Motifs distincts** pour corriger une valeur, exclure un ménage ou le réintégrer (une suspicion appelle une vérification, pas une exclusion).
- **Visites terrain** : liste de visite (XLSX, ODS, CSV) des ménages cochés, avec les seules colonnes choisies et des colonnes à remplir ;
  fichier de préchargement et formulaire XLSForm pour une revisite avec KoboToolbox ; import des réponses qui propose les décisions,
  corrections et exclusions à signer (visite loin du ménage signalée). Chaque sortie de données est inscrite au journal.
- **GPS** : plan des ménages (zoom, couleurs par alerte, enquêteur ou journée), distances dans la comparaison, règles « ménages trop
  proches », « entretiens groupés au même endroit », « point éloigné de son village ». Fond de carte hors ligne facultatif, sans aucune
  connexion : GeoJSON (par exemple un export du HOT Export Tool, à partir de la zone téléchargée depuis le plan) dessiné par 2x2,
  ou ZIP de tuiles z/x/y pour l'imagerie.
- **Aide intégrée** : un écran « Aide » (mode d'emploi pas à pas), accessible à tout moment, même avant de créer sa clé.
- **Fichiers de liste versionnés** : `liste_<export>_v042-3f9a_2026-11-23.2x2` (n° de la dernière entrée du journal, début de son
  empreinte, date). La version réelle s'affiche dans l'en-tête ; un écart entre le nom et le contenu est signalé à l'ouverture.
- **Copie de secours** : tant que la liste n'est pas enregistrée, une copie chiffrée (même chiffrement que le fichier) est gardée
  dans le stockage du navigateur. Après un rafraîchissement ou une fermeture accidentelle, l'accueil propose de reprendre le travail
  avec le mot de passe de la liste. La copie est effacée dès l'enregistrement ou l'abandon.
- **Reçus de validation** signés, à conserver hors du fichier ; confrontation du fichier à un reçu (détecte la suppression des dernières lignes).
- **Exports** : liste finale (CSV pour la plateforme de paiement, XLSX, ODS), verrouillée tant qu'il reste une correction en attente ou une alerte sans décision ;
  rapport des alertes et des corrections (XLSX, ODS) avec colonnes de décision à remplir, disponible à tout moment.
  Chaque export porte l'empreinte du journal et s'inscrit au journal avec sa propre empreinte : « Vérifier un fichier exporté » reconnaît un fichier authentique et rejette un fichier retouché.

**Bilingue français / anglais (v0.15)** :
- **Interface et aide intégrée** traduites ; sélecteur FR / EN dans l'en-tête. La langue de départ suit celle du navigateur
  (français, sinon anglais) ; le choix est mémorisé dans ce navigateur.
- **Données signées inchangées** : les motifs (« Erreur de saisie »…) et les codes de décision restent inscrits au journal sous leur
  forme française d'origine, et ne sont traduits qu'à l'affichage ; les listes existantes s'ouvrent et se vérifient comme avant.
  Les règles par défaut reçoivent un libellé dans la langue de l'utilisateur, sans changer leur nom (les identifiants d'alerte
  et les décisions déjà prises restent rattachés) ; un fichier de règles importé garde ses propres libellés. Les commentaires restent tels qu'écrits.
- **Fichiers produits** dans la langue de l'utilisateur : feuille « Aide » du fichier de règles (les en-têtes `actif`, `nom`, `libelle`…
  restent des codes, oui/yes et non/no sont acceptés), rapport des alertes, liste de visite et ses consignes, métadonnées des exports,
  reçus et clés publiques en texte (seule la ligne « Code » est relue). La liste finale (CSV de paiement) garde les colonnes de l'export d'origine.
- **Formulaire Kobo de revisite multilingue** : `label::Français (fr)` / `label::English (en)`, de même pour les aides et les choix ;
  langue par défaut = celle de l'utilisateur. L'import des retours du terrain accepte un export avec libellés dans l'une ou l'autre langue.
- **Manuel d'utilisation en anglais** : `docs/manuel/scenario.ts en` joue le scénario avec l'interface en anglais,
  `docs/manuel/construire.ts en` produit `manuel_2x2_vX.Y.Z_en.pdf` à côté du manuel français.

Hors périmètre du prototype : détection d'anomalies par apprentissage, import natif des plateformes de paiement, travail simultané.

## Licence

[MIT](LICENSE). Le logiciel est fourni « tel quel », sans garantie. Il n'a pas fait l'objet d'une relecture de sécurité indépendante :
ne l'utilisez pas avec des données réelles sans cette relecture.
