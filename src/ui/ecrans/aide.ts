/** Écran Aide : le mode d'emploi, étape par étape, accessible à tout moment (même sans clé ni liste). */
import { h, type Enfant } from '../dom.ts';

const p = (...t: Enfant[]) => h('p', null, ...t);
const b = (t: string) => h('strong', null, t);
const ol = (...items: Enfant[][]) => h('ol', null, items.map((i) => h('li', null, ...i)));
const ul = (...items: Enfant[][]) => h('ul', null, items.map((i) => h('li', null, ...i)));

interface Section {
  id: string;
  titre: string;
  contenu: Enfant[];
}

const SECTIONS: Section[] = [
  {
    id: 'principe',
    titre: 'Le principe',
    contenu: [
      p(
        '2x2 sert à vérifier et corriger une liste de bénéficiaires avant paiement, sans qu’une seule personne puisse la modifier seule. ',
        'Chaque modification est ',
        b('proposée par une personne et validée par une autre'),
        ' (les « quatre yeux »), signée avec la clé de chacun et inscrite dans un ',
        b('journal'),
        ' que l’on ne peut ni retoucher ni raccourcir sans que cela se voie.',
      ),
      ul(
        ['Tout fonctionne ', b('hors ligne'), ', dans cette page : aucune donnée ne quitte le poste en clair.'],
        ['Le seul fichier qui circule est la ', b('liste chiffrée (.2x2)'), ', protégée par le mot de passe de la liste.'],
        ['L’outil ', b('signale'), ' des anomalies (alertes) ; la ', b('décision'), ' revient toujours à une personne.'],
      ),
    ],
  },
  {
    id: 'roles',
    titre: 'Les rôles',
    contenu: [
      ul(
        [b('Responsable'), ' : crée la liste, déclare les personnes et leurs rôles, fixe les règles de contrôle, décide des alertes et produit les exports.'],
        [b('Correction'), ' : propose des corrections de valeurs et des exclusions de ménages.'],
        [b('Validation'), ' : accepte ou refuse les corrections des autres, décide des alertes, produit des reçus.'],
      ),
      p(
        'Une personne peut cumuler plusieurs rôles, mais ',
        b('personne ne valide jamais sa propre correction'),
        '. Il faut donc au moins deux personnes : une en correction, une autre en validation.',
      ),
    ],
  },
  {
    id: 'cles',
    titre: '1. Chacun crée sa clé (une seule fois)',
    contenu: [
      ol(
        ['Sur l’accueil, ', b('« Créer ma clé »'), ' : votre nom et un mot de passe d’au moins 12 caractères.'],
        [
          'Le navigateur enregistre votre ',
          b('clé privée (.2x2cle)'),
          '. Gardez-la en lieu sûr avec son mot de passe : elle ne se transmet jamais.',
        ],
        [
          'Transmettez votre ',
          b('clé publique'),
          ' au responsable : « Copier ma clé publique (texte) » puis collez-la dans un message, ou envoyez le fichier .json.',
        ],
        ['Vérifiez ensuite de vive voix (téléphone) que l’', b('empreinte'), ' affichée chez le responsable est bien la vôtre.'],
      ),
      p('Aux séances suivantes : « J’ai déjà une clé », choisissez votre fichier .2x2cle et saisissez son mot de passe.'),
    ],
  },
  {
    id: 'creer',
    titre: '2. Le responsable crée la liste',
    contenu: [
      ol(
        ['Accueil → ', b('« Importer un export… »'), ' : un fichier XLSX, ODS ou CSV (par exemple un export KoboToolbox).'],
        ['Vérifiez la ', b('colonne d’identifiant'), ' proposée (une valeur unique par ménage).'],
        [
          'Déclarez les personnes : collez leur clé publique (texte) ou choisissez leur fichier .json, puis cochez leurs ',
          b('rôles'),
          '. Les conditions des quatre yeux s’affichent en direct.',
        ],
        [
          'Choisissez le ',
          b('mot de passe de la liste'),
          ' et créez la liste : le fichier .2x2 est enregistré. L’export d’origine est figé et son empreinte calculée.',
        ],
      ),
      p('Une personne peut être ajoutée plus tard, depuis l’écran Import, la liste étant ouverte.'),
    ],
  },
  {
    id: 'corriger',
    titre: '3. Corriger',
    contenu: [
      ol(
        [
          'Écran ',
          b('Correction'),
          ' : le tableau des ménages montre l’enquêteur, la date de l’entretien (champ « start »), les alertes (avec la décision prise) et l’état de chacun. Filtrez sous chaque titre de colonne (une journée, un enquêteur, un type d’alerte, ou une décision comme « À vérifier sur le terrain »), triez en cliquant sur un titre, ou recherchez dans tous les champs.',
        ],
        ['Cliquez sur une ligne : la fiche du ménage s’ouvre sous le tableau, avec ses alertes. Glissez la barre de séparation pour donner plus de place au tableau ou à la fiche.'],
        [b('« Colonnes… »'), ' (Correction et Validation) : choisissez les colonnes affichées, parmi les repères et toutes les colonnes de l’export. Le choix est gardé dans ce navigateur, pour chaque liste ; « Colonnes par défaut » revient au réglage initial.'],
        [
          'Dans la fiche, la décision sur une alerte propose aussi ',
          b('« … et exclure ce ménage »'),
          ' (avec le motif) et ',
          b('« … et corriger une valeur »'),
          ' : une seule signature enregistre la décision et la proposition, qui attend ensuite la validation d’une autre personne.',
        ],
        [
          b('« Corriger »'),
          ' à côté d’un champ : nouvelle valeur, motif et commentaire, puis signez. La correction reste ',
          b('en attente'),
          ' jusqu’à sa validation par une autre personne.',
        ],
        [b('« Proposer l’exclusion »'), ' (dans la fiche) retire un ménage de la liste finale, avec la même validation. Motifs : doublon, ménage introuvable ou inexistant, fraude avérée, critères d’éligibilité non remplis, ménage parti ou dissous, autre.'],
        [
          'Une ',
          b('simple suspicion'),
          ' (fraude possible, entretien douteux) ne justifie pas une exclusion : décidez plutôt « À vérifier sur le terrain » sur l’alerte (écran Validation), puis corrigez ou excluez après la visite.',
        ],
        [
          b('Exclusion en lot'),
          ' : cochez des ménages (la case de l’en-tête coche tous les ménages filtrés), cliquez « Exclure les N cochés… », choisissez un motif, écrivez un commentaire et confirmez. Chaque proposition est signée séparément et devra être validée.',
        ],
        [
          'Pour un doublon (même téléphone, même pièce d’identité, noms proches) : ',
          b('« Comparer côte à côte »'),
          ' affiche les ménages en colonnes, différences surlignées. On y corrige les valeurs, et l’on choisit pour chaque ménage (ligne « Statut ») : conserver, faire vérifier sur le terrain ou exclure avec son motif. Une seule signature enregistre le tout, avec la décision sur l’alerte proposée d’après ces choix.',
        ],
      ),
    ],
  },
  {
    id: 'regles',
    titre: '4. Règles de contrôle et alertes',
    contenu: [
      p(
        'Les alertes viennent de ',
        b('règles de contrôle'),
        ' : durée d’entretien, ordre des dates, doublons, noms proches, enquêteur atypique, et, si l’export contient des coordonnées GPS, ménages trop proches, entretiens groupés au même endroit et point éloigné de son village. Elles portent sur les valeurs corrigées.',
      ),
      p(
        b('Liens entre ménages'),
        ' (ménage déplacé hébergé ↔ famille d’accueil) : le lien peut être saisi d’un côté ou de l’autre, par le ménage hébergé (code de son hôte, ex. id_menage_hote) ou par la famille d’accueil (codes des ménages qu’elle héberge, séparés par des espaces, ex. ids_menages_heberges). Les codes sont comparés sans tenir compte des majuscules ni des tirets. Les règles vérifient que le code existe, que l’hôte est bien une famille d’accueil, n’est pas exclu et vit à proximité, qu’un ménage n’a qu’un seul hôte, qu’une famille d’accueil héberge au moins un ménage retenu et qu’un ménage déplacé hébergé a un hôte retenu. Un ménage « déplacé sans famille d’accueil » (abri propre, kit prêté…) n’est pas concerné. Sans colonne de lien, ces règles n’existent pas. La fiche montre le lien dans les deux sens, le plan le trace en violet.',
      ),
      ol(
        ['Écran Validation → « Règles de contrôle » : les règles actives et le nombre d’alertes de chacune.'],
        ['Pour les modifier : ', b('exportez'), ' (XLSX, ODS ou CSV), modifiez le fichier dans un tableur (une règle par ligne, voir la feuille « Aide »).'],
        [b('Importez'), ' le fichier (responsable) : il est contrôlé et un aperçu montre l’effet sur les alertes. ', b('« Signer ces règles »'), ' les inscrit au journal.'],
      ),
      p('Gardez le ', b('nom'), ' d’une règle inchangé une fois des décisions prises : les décisions y sont rattachées.'),
    ],
  },
  {
    id: 'valider',
    titre: '5. Valider et décider',
    contenu: [
      p('L’écran ', b('Validation'), ' rassemble dans un tableau les corrections à valider et les alertes à décider.'),
      ol(
        ['Filtrez sous chaque titre de colonne (type, contrôle, enquêteur, journée d’entretien, statut…) et triez en cliquant sur un titre.'],
        ['Cochez les lignes ; la case de l’en-tête coche toutes les lignes affichées ', b('à décider'), '.'],
        [
          'Choisissez la décision dans la barre du haut, ajoutez un commentaire et ',
          b('signez'),
          '. Chaque ligne reçoit sa propre entrée au journal.',
        ],
      ),
      ul(
        [b('Corrections'), ' : « Accepter » ou « Refuser » (un refus doit être motivé).'],
        [
          b('Alertes'),
          ' : « Problème confirmé », « À vérifier sur le terrain » ou « Vérifiée : pas de problème » (commentaire obligatoire pour la première et la dernière).',
        ],
        ['Une décision d’alerte peut être révisée : cochez sa ligne (statut « Tous ») et signez une nouvelle décision ; l’historique reste au journal.'],
        ['Une case grisée ne peut pas être cochée : survolez-la pour savoir pourquoi (votre propre correction, rôle manquant…).'],
      ),
      p(
        'À la fin de la séance, ',
        b('« Produire mon reçu »'),
        ' : gardez ce reçu en dehors du fichier. Il permettra plus tard de prouver qu’aucune ligne du journal n’a été retirée.',
      ),
    ],
  },
  {
    id: 'terrain',
    titre: '6. Visites terrain',
    contenu: [
      p('Pour faire vérifier des ménages sur place ou par téléphone (responsable) :'),
      ol(
        ['Dans ', b('Correction'), ', filtrez (par exemple Alertes = « À vérifier sur le terrain », puis un village ou un enquêteur) et cochez les ménages.'],
        [
          b('« Liste de visite… »'),
          ' : choisissez les colonnes utiles (nom, village, téléphone… le moins possible) et le format. Le fichier contient aussi « À vérifier » (les alertes) et des colonnes à remplir sur place.',
        ],
        ['Chaque liste exportée est inscrite au journal (ménages et colonnes sortis de l’outil). Elle contient des données personnelles en clair : canal sûr, et suppression après la mission.'],
        [
          'La liste de visite ',
          b('ne se réimporte pas'),
          ' : au retour, saisissez les résultats dans 2x2 (décisions d’alerte, corrections, exclusions). Pour un retour automatique, utilisez le formulaire Kobo ci-dessous.',
        ],
      ),
      p(b('Avec un formulaire Kobo de revisite'), ' (preuve de visite par GPS et heure, réponses sans ressaisie) :'),
      ol(
        ['Exportez au format ', b('« Préchargement Kobo »'), ' : un fichier menages_a_revoir.csv avec seulement les ménages et colonnes choisis.'],
        [b('« Formulaire Kobo de revisite (XLSForm) »'), ' : un formulaire prêt à importer dans KoboToolbox. Il ne contient aucune donnée.'],
        ['Dans KoboToolbox : importez le formulaire, ajoutez menages_a_revoir.csv dans ses médias, déployez. Retirez la pièce jointe après la mission.'],
        [
          'Après la mission, exportez les réponses (XLSX ou CSV) et utilisez ',
          b('« Retours du terrain… »'),
          ' dans Correction : l’outil propose les décisions d’alerte, corrections et exclusions correspondantes. Celles dont la visite est loin du ménage (plus de 500 m) ou sans position ne sont pas cochées : vérifiez-les. Rien n’est appliqué sans votre signature, et les corrections passent ensuite par les quatre yeux.',
        ],
      ),
    ],
  },
  {
    id: 'gps',
    titre: 'GPS et plan',
    contenu: [
      ul(
        [b('« Plan GPS »'), ' (Correction) : les ménages filtrés sur un plan, colorés par alerte, enquêteur ou journée. Molette pour zoomer, glisser pour se déplacer, clic sur un point pour ouvrir la fiche.'],
        ['Dans la ', b('comparaison'), ' de ménages, le plan et la distance entre eux, avec la précision du GPS : deux points plus proches que leurs marges d’erreur sont probablement au même endroit.'],
        [
          b('Fond de carte hors ligne'),
          ' : l’outil n’utilise jamais Internet, le fond se prépare en dehors puis se charge depuis le disque. Le plus simple : « Zone pour un fond de carte… » télécharge la zone de vos ménages (élargie et arrondie, elle ne révèle que la région) ; importez-la dans le HOT Export Tool (export.hotosm.org, « Création », puis « Import » sur la carte), cochez routes, cours d’eau et lieux, format GeoJSON ; chargez le ZIP obtenu avec « Charger un fond de carte… ». 2x2 dessine routes, pistes, rivières et noms de villages, avec la mention « © contributeurs OpenStreetMap ».',
        ],
        [
          'Pour de l’',
          b('imagerie satellite'),
          ', un ZIP de tuiles z/x/y.png (par exemple QGIS « Générer des tuiles XYZ (Répertoire) ») se charge de la même façon. Respectez la licence de la source.',
        ],
      ),
    ],
  },
  {
    id: 'circuler',
    titre: '7. Faire circuler la liste',
    contenu: [
      ol(
        [b('« Enregistrer (télécharger) »'), ' : un nouveau fichier .2x2, dont le nom porte la version, par exemple ', h('code', null, 'liste_…_v042-3f9a_2026-11-23.2x2'), '.'],
        ['Envoyez ce fichier par votre canal habituel (e-mail, Teams, Nextcloud…).'],
        [b('Donnez le mot de passe de la liste par un autre canal'), ' (téléphone, Signal…), jamais dans le même message.'],
        ['La personne suivante ouvre le fichier avec ', b('sa propre clé'), ' et le mot de passe de la liste, fait sa part, enregistre et renvoie.'],
      ),
      ul(
        [b('Une seule personne à la fois'), ' : deux copies modifiées en parallèle ne peuvent pas être fusionnées.'],
        ['Travaillez toujours sur la ', b('dernière version'), ' : le numéro affiché à côté du nom de la liste (en haut) fait foi.'],
      ),
    ],
  },
  {
    id: 'exporter',
    titre: '8. Exporter',
    contenu: [
      p(
        'Écran ',
        b('Export'),
        ' (responsable) : la liste finale n’est disponible que lorsque plus aucune correction n’est en attente et que toutes les alertes ont une décision.',
      ),
      ul(
        ['Liste finale (CSV pour la plateforme de paiement, XLSX, ODS) : ménages exclus retirés, corrections appliquées.'],
        ['Rapport des alertes et des corrections, disponible à tout moment.'],
        ['Chaque export est inscrit au journal avec son empreinte : « Vérifier un fichier exporté » détecte un fichier retouché après coup.'],
      ),
    ],
  },
  {
    id: 'journal',
    titre: 'Journal et reçus',
    contenu: [
      ul(
        ['L’écran ', b('Journal'), ' liste toutes les actions signées : qui, quoi, quand.'],
        ['À chaque ouverture, la chaîne du journal et les signatures sont vérifiées. Un fichier altéré s’ouvre en ', b('lecture seule'), ', avec le détail des erreurs.'],
        ['Collez un reçu dans l’écran Journal pour confronter le fichier à ce reçu : un fichier dont on aurait supprimé les dernières lignes est détecté.'],
      ),
    ],
  },
  {
    id: 'problemes',
    titre: 'En cas de problème',
    contenu: [
      ul(
        [
          b('Mot de passe de clé oublié'),
          ' : la clé est inutilisable. Créez une nouvelle clé et envoyez la nouvelle clé publique au responsable, qui vous déclare à nouveau.',
        ],
        [b('Mot de passe de la liste oublié'), ' : le fichier ne peut pas être déchiffré. Reprenez la dernière version auprès d’un collègue qui connaît le mot de passe.'],
        [
          b('Page rafraîchie ou fermée avant d’enregistrer'),
          ' : une copie chiffrée est gardée par le navigateur. Rouvrez la page, déverrouillez votre clé et choisissez « Reprendre ». Enregistrez ensuite.',
        ],
        [b('« Journal altéré »'), ' à l’ouverture : n’utilisez pas ce fichier ; reprenez la version précédente et signalez-le au responsable.'],
        [b('Le nom du fichier ne correspond pas à sa version'), ' : le contenu fait foi ; vérifiez auprès de vos collègues que c’est bien la dernière version.'],
        [b('Rien à cocher dans Validation'), ' : vérifiez le filtre « Statut » et votre rôle ; survolez une case grisée pour en connaître la raison.'],
      ),
    ],
  },
];

export function ecranAide() {
  return [
    h('h1', null, 'Aide : mode d’emploi'),
    h('p', { class: 'intro' }, 'Le parcours complet, de la création des clés à l’export de la liste finale.'),
    h(
      'nav',
      { class: 'sommaire-aide', 'aria-label': 'Sommaire' },
      h(
        'ul',
        null,
        SECTIONS.map((s) =>
          h(
            'li',
            null,
            h('button', { type: 'button', class: 'lien', onclick: () => document.getElementById(`aide-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }) }, s.titre),
          ),
        ),
      ),
    ),
    SECTIONS.map((s) => h('section', { class: 'carte aide-section', id: `aide-${s.id}` }, h('h2', null, s.titre), s.contenu)),
  ];
}
