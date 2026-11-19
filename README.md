# 2x2 : intégrité des listes de bénéficiaires

Une page web autonome, hors ligne et sans installation, pour corriger une liste de bénéficiaires (par exemple un export KoboToolbox)
en traçant chaque modification, avec une validation obligatoire par une seconde personne (le principe des « quatre yeux »).
Elle signale aussi les erreurs, les fraudes probables et les cas de protection. Aucune donnée ne quitte le poste en clair :
seul circule un fichier chiffré.

Le nom : deux personnes, quatre yeux.

**Prototype sur données fictives uniquement.** Ne l'utilisez pas avec des données réelles.

## Utilisation

```bash
npm install          # une seule fois (outils de développement)
npm run build        # produit dist/index.html : un fichier unique, autonome, hors ligne
npm test             # tests automatisés (crypto, journal, ZIP/XLSX/CSV, générateur)
npm run e2e          # parcours complet à deux personnes dans Chrome (après build)
npm run fictif       # écrit un export Kobo fictif dans fictif/ (CSV, XLSX, vérité des anomalies)
```

`dist/index.html` s'ouvre directement depuis le disque (double-clic), sans serveur ni installation.

## Choix techniques retenus

- **Moteur de données** : modèle en mémoire, sérialisé en JSON puis chiffré (question ouverte n° 11 tranchée).
- **Fichier unique** : TypeScript + Vite + vite-plugin-singlefile. Une Content-Security-Policy stricte est ajoutée à la compilation
  (`default-src 'none'`, `connect-src 'none'`, scripts et styles autorisés par empreinte SHA-256) : la page ne peut faire aucune requête réseau.
- **Cryptographie** : WebCrypto uniquement. AES-GCM 256 + PBKDF2-SHA256 (600 000 itérations), signatures ECDSA P-256.
  L'en-tête du fichier chiffré est authentifié (données associées AES-GCM).
- **XLSX** : lecteur et écrivain maison (ZIP + XML), sans dépendance. Format ouvert (ISO/IEC 29500), lu nativement par LibreOffice Calc.
- **Aucune dépendance à l'exécution** : tout le code de `src/` est le nôtre.

## Structure

| Dossier | Contenu |
|---|---|
| `src/crypto/` | encodage, JSON canonique, SHA-256, chiffrement par mot de passe, clés personnelles et signatures |
| `src/io/` | ZIP, XLSX, CSV, import d'un export Kobo |
| `src/model/` | types, journal signé et chaîné (règles métier communes à l'ajout et à la vérification), fichier de liste chiffré |
| `src/gen/` | générateur de données fictives avec anomalies plantées |
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
- **Contrôles déterministes** (`src/controles/`) : durée d'entretien sous un seuil, horodatages incohérents, enquêteurs atypiques,
  téléphones en double, noms proches dans un même village. Ils portent sur les valeurs corrigées.
- **Repérage protection** : enfants non accompagnés, chefs de ménage mineurs. Règle affichée : orienter, jamais exclure pour ce motif.
- **Décisions humaines signées** sur chaque alerte (révisables, l'historique reste au journal).
- **Paramètres des contrôles** (seuils et colonnes) détectés automatiquement, modifiables par un responsable, signés et journalisés.
- **Exclusion d'un ménage** : proposée puis validée par une autre personne, comme une correction ; avertissement en cas de repérage protection.
- **Reçus de validation** signés, à conserver hors du fichier ; confrontation du fichier à un reçu (détecte la suppression des dernières lignes).
- **Exports** : liste finale (CSV pour la plateforme de paiement, XLSX, ODS), verrouillée tant qu'il reste une correction en attente ou une alerte sans décision ;
  rapport des alertes et des corrections (XLSX, ODS) avec colonnes de décision à remplir, disponible à tout moment.
  Chaque export porte l'empreinte du journal et s'inscrit au journal avec sa propre empreinte : « Vérifier un fichier exporté » reconnaît un fichier authentique et rejette un fichier retouché.

Hors périmètre du prototype : détection d'anomalies par apprentissage, import natif des plateformes de paiement, travail simultané, import ODS.

## Licence

[MIT](LICENSE). Le logiciel est fourni « tel quel », sans garantie. Il n'a pas fait l'objet d'une relecture de sécurité indépendante :
ne l'utilisez pas avec des données réelles sans cette relecture.
