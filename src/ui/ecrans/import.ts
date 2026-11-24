import { lireFichierClePublique } from '../../crypto/cles.ts';
import { sha256Hex } from '../../crypto/empreinte.ts';
import { lireExport } from '../../io/import.ts';
import type { Tableau } from '../../io/tableau.ts';
import { creerListe, declarerUtilisateur } from '../../model/journal.ts';
import { LIBELLES_ROLES, type Role, type Utilisateur } from '../../model/types.ts';
import { badge, bouton, carte, champ, empreinte, encadre, motDePasse } from '../composants.ts';
import { h, remplacer, tr } from '../dom.ts';
import { choisirFichier, lireFichier, nomDeFichierSur, type FichierLu } from '../fichiers.ts';
import { apresModification, enregistrer, moi, notifier, occupe, rafraichir, session } from '../session.ts';
import { localeCourante, t } from '../../i18n/index.ts';

const ROLES: Role[] = ['responsable', 'correction', 'validation'];

/** Propose la colonne d'identifiant : un nom évocateur, sinon la première colonne aux valeurs uniques. */
function colonneIdProbable(tab: Tableau): string {
  const uniques = tab.colonnes.filter((_, i) => {
    const v = tab.lignes.map((l) => l[i]);
    return v.every((x) => x.trim()) && new Set(v).size === v.length;
  });
  return (
    uniques.find((c) => /(^|[_/])(id_)?menage(_id)?$|household/i.test(c)) ??
    uniques.find((c) => !c.startsWith('_')) ??
    uniques.find((c) => c === '_uuid') ??
    uniques[0] ??
    tab.colonnes[0]
  );
}

function tableauUtilisateurs(utilisateurs: Utilisateur[], modifiable: boolean, surChangement: () => void) {
  return h(
    'table',
    { class: 'tableau' },
    h('thead', null, h('tr', null, h('th', null, t('import.col_nom')), h('th', null, t('import.col_empreinte')), ...ROLES.map((r) => h('th', null, LIBELLES_ROLES[r])), modifiable && h('th', null, ''))),
    h(
      'tbody',
      null,
      utilisateurs.map((u, i) =>
        h(
          'tr',
          null,
          h('td', null, u.nom, u.empreinte === session.identite?.empreinte && t('import.vous')),
          h('td', null, empreinte(u.empreinte)),
          ...ROLES.map((r) =>
            h(
              'td',
              { class: 'centre' },
              modifiable
                ? h('input', {
                    type: 'checkbox',
                    'aria-label': `${u.nom} : ${LIBELLES_ROLES[r]}`,
                    checked: u.roles.includes(r),
                    disabled: r === 'responsable' && i === 0,
                    onchange: (e: Event) => {
                      const coche = (e.target as HTMLInputElement).checked;
                      u.roles = coche ? [...u.roles, r] : u.roles.filter((x) => x !== r);
                      surChangement();
                    },
                  })
                : u.roles.includes(r)
                  ? '✓'
                  : '',
            ),
          ),
          modifiable &&
            h(
              'td',
              null,
              i > 0 &&
                bouton(t('import.retirer'), () => {
                  utilisateurs.splice(i, 1);
                  surChangement();
                }),
            ),
        ),
      ),
    ),
  );
}

async function utilisateurDepuisTexte(texte: string): Promise<Utilisateur | undefined> {
  try {
    const cle = await lireFichierClePublique(texte);
    return { nom: cle.nom, cle: cle.cle, empreinte: cle.empreinte, roles: [] };
  } catch (e) {
    notifier((e as Error).message, 'erreur');
    return undefined;
  }
}

async function lireClePublique(): Promise<Utilisateur | undefined> {
  const f = await choisirFichier('.json,.txt,application/json,text/plain');
  return f ? utilisateurDepuisTexte(f.texte()) : undefined;
}

/** Zone pour coller une clé publique reçue par message (code « 2X2-CLE-1. »). */
function zoneCollage(surAjout: (u: Utilisateur) => void) {
  const texte = h('textarea', { rows: 3, placeholder: t('import.coller_placeholder'), 'aria-label': t('import.cle_collee') });
  return h(
    'details',
    { class: 'collage' },
    h('summary', null, t('import.coller')),
    texte,
    h(
      'div',
      { class: 'ligne' },
      bouton(t('import.ajouter_cle'), async () => {
        const u = await utilisateurDepuisTexte(texte.value);
        if (u) surAjout(u);
      }),
    ),
  );
}

function nouvelleListe() {
  const id = session.identite!;
  const etat: {
    tableau?: Tableau;
    nomFichier?: string;
    empreinteFichier?: string;
    colonneId?: string;
    utilisateurs: Utilisateur[];
  } = { utilisateurs: [{ nom: id.nom, cle: id.clePublique, empreinte: id.empreinte, roles: ['responsable', 'correction'] }] };
  const zone = h('div');
  const mdp1 = motDePasse('', 'new-password');
  const mdp2 = motDePasse('', 'new-password');

  const charger = (f: FichierLu) =>
    occupe(t('import.lecture'), async () => {
      const tableau = await lireExport(f.octets, f.nom);
      Object.assign(etat, { tableau, nomFichier: f.nom, empreinteFichier: await sha256Hex(f.octets), colonneId: colonneIdProbable(tableau) });
      dessiner();
    });

  const depot = h(
    'div',
    {
      class: 'depot',
      tabindex: 0,
      role: 'button',
      onclick: async () => {
        const f = await choisirFichier('.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (f) charger(f);
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') (e.currentTarget as HTMLElement).click();
      },
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.add('survol');
      },
      ondragleave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('survol'),
      ondrop: async (e: DragEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.remove('survol');
        const f = e.dataTransfer?.files[0];
        if (f) charger(await lireFichier(f));
      },
    },
    h('strong', null, t('import.deposer')),
    h('span', null, t('import.deposer_aide')),
  );

  function dessiner() {
    const tab = etat.tableau;
    remplacer(
      zone,
      carte(
        t('import.etape1'),
        tab
          ? [
              h(
                'dl',
                { class: 'details' },
                h('dt', null, t('import.fichier')),
                h('dd', null, etat.nomFichier!),
                h('dt', null, t('import.contenu')),
                h('dd', null, t('import.dimensions', { lignes: tab.lignes.length, colonnes: tab.colonnes.length })),
                h('dt', null, t('import.empreinte')),
                h('dd', null, empreinte(etat.empreinteFichier!, 16)),
              ),
              encadre(
                'alerte',
                tr('import.envoyer_empreinte'),
              ),
              !tab.colonnes.includes('donnees_fictives') &&
                encadre('erreur', tr('import.non_fictif')),
              champ(
                t('import.colonne_id'),
                h(
                  'select',
                  { onchange: (e: Event) => (etat.colonneId = (e.target as HTMLSelectElement).value) },
                  tab.colonnes.map((c) => h('option', { value: c, selected: c === etat.colonneId }, c)),
                ),
                t('import.colonne_id_aide'),
              ),
              bouton(t('import.autre_export'), () => {
                etat.tableau = undefined;
                dessiner();
              }),
            ]
          : depot,
      ),
      tab &&
        carte(
          t('import.etape2'),
          h(
            'p',
            null,
            tr('import.ajoutez_cles'),
          ),
          tableauUtilisateurs(etat.utilisateurs, true, dessiner),
          h(
            'ul',
            { class: 'conditions' },
            conditionsRoles().map((c) =>
              h('li', { class: c.ok ? 'ok' : 'ko' }, h('span', { class: 'marque', 'aria-hidden': 'true' }, c.ok ? '✓' : '✗'), c.texte),
            ),
          ),
          h(
            'div',
            { class: 'ligne' },
            bouton(t('import.ajouter_fichier'), async () => {
              const u = await lireClePublique();
              if (u) ajouterUtilisateur(u);
            }),
          ),
          zoneCollage(ajouterUtilisateur),
          encadre('info', t('import.verifier_empreintes')),
        ),
      tab &&
        carte(
          t('import.etape3'),
          h('p', null, t('import.mdp_texte')),
          champ(t('import.mdp'), mdp1, t('import.mdp_aide')),
          champ(t('import.confirmer'), mdp2),
          h(
            'div',
            { class: 'ligne' },
            bouton(t('import.creer'), creer, 'principal', !rolesOk()),
            !rolesOk() && h('span', { class: 'discret' }, t('import.completer')),
          ),
        ),
    );
  }

  function ajouterUtilisateur(u: Utilisateur) {
    if (etat.utilisateurs.some((x) => x.empreinte === u.empreinte)) return notifier(t('import.cle_deja'), 'erreur');
    // Rôle proposé : la validation tant que personne d'autre ne l'a, sinon la correction.
    u.roles = etat.utilisateurs.some((x) => x.roles.includes('validation')) ? ['correction'] : ['validation'];
    etat.utilisateurs.push(u);
    notifier(t('import.cle_ajoutee', { nom: u.nom }), 'succes');
    dessiner();
  }

  /** Conditions du principe des quatre yeux, affichées en direct à l'étape 2. */
  function conditionsRoles() {
    const correcteurs = etat.utilisateurs.filter((u) => u.roles.includes('correction'));
    const validateurs = etat.utilisateurs.filter((u) => u.roles.includes('validation'));
    const deuxPersonnes = correcteurs.some((c) => validateurs.some((v) => v !== c));
    return [
      { ok: correcteurs.length > 0, texte: t('import.cond_correction') },
      { ok: validateurs.length > 0, texte: t('import.cond_validation') },
      {
        ok: deuxPersonnes,
        texte:
          etat.utilisateurs.length < 2
            ? t('import.cond_deuxieme')
            : t('import.cond_deux'),
      },
    ];
  }
  const rolesOk = () => conditionsRoles().every((c) => c.ok);

  function creer() {
    const tab = etat.tableau!;
    if (mdp1.value.length < 12) return notifier(t('import.mdp_court'), 'erreur');
    if (mdp1.value !== mdp2.value) return notifier(t('commun.mdp_differents'), 'erreur');
    if (!rolesOk()) return notifier(t('import.quatre_yeux'), 'erreur');
    occupe(t('import.creation'), async () => {
      const { liste, etat: e } = await creerListe(
        { nomFichier: etat.nomFichier!, empreinteFichier: etat.empreinteFichier!, colonnes: tab.colonnes, colonneId: etat.colonneId!, lignes: tab.lignes },
        id,
        etat.utilisateurs,
      );
      const verification = { valide: true, erreurs: [], avertissements: [], etat: e };
      Object.assign(session, {
        liste,
        etat: e,
        verification,
        motDePasseListe: mdp1.value,
        poignee: undefined,
        nomFichierListe: `liste_${nomDeFichierSur(etat.nomFichier!.replace(/\.[^.]+$/, ''))}.2x2`,
        nonEnregistre: true,
        decisionsDepuisRecu: 0,
      });
      await enregistrer();
      session.ecran = 'import';
      rafraichir();
    });
  }

  dessiner();
  return [
    h('h1', null, t('import.titre')),
    h('p', { class: 'intro' }, t('import.intro')),
    zone,
  ];
}

function listeOuverte() {
  const { liste, etat } = session;
  const o = liste!.original;
  const ouverture = liste!.journal[0];
  const utilisateurs = [...etat!.utilisateurs.values()];
  const responsable = moi()?.roles.includes('responsable') && session.verification?.valide;
  return [
    h('h1', null, t('nav.import')),
    carte(
      t('import.origine_fige'),
      h(
        'dl',
        { class: 'details' },
        h('dt', null, t('import.fichier')),
        h('dd', null, o.nomFichier),
        h('dt', null, t('import.contenu')),
        h('dd', null, tr('import.dimensions_liste', { menages: o.lignes.length, colonnes: o.colonnes.length, id: o.colonneId })),
        h('dt', null, t('import.empreinte')),
        h('dd', null, empreinte(o.empreinteFichier, 16)),
        h('dt', null, t('import.ouverte_par')),
        h('dd', null, t('import.ouverte_le', { nom: etat!.utilisateurs.get(ouverture.auteur)?.nom ?? '?', date: new Date(ouverture.le).toLocaleString(localeCourante()) })),
      ),
      h('p', { class: 'aide' }, t('import.comparer_empreinte')),
    ),
    carte(
      t('import.utilisateurs'),
      tableauUtilisateurs(utilisateurs, false, () => {}),
      responsable &&
        h(
          'div',
          { class: 'ligne' },
          bouton(t('import.declarer'), async () => {
            const u = await lireClePublique();
            if (u) declarer(u);
          }),
          badge(t('import.signe_journalise')),
        ),
      responsable && zoneCollage(declarer),
    ),
  ];

  function declarer(u: Utilisateur) {
    if (etat!.utilisateurs.has(u.empreinte)) return notifier(t('import.deja_declaree'), 'erreur');
    const roles = ROLES.filter((r) => r !== 'responsable' && confirm(t('import.donner_role', { role: LIBELLES_ROLES[r], nom: u.nom })));
    if (!roles.length) return notifier(t('import.aucun_role'), 'info');
    u.roles = roles;
    occupe(t('commun.signature'), async () => {
      await declarerUtilisateur(liste!, etat!, session.identite!, u);
      notifier(t('import.declare', { nom: u.nom }), 'succes');
      await apresModification();
    });
  }
}

export function ecranImport() {
  return session.liste ? listeOuverte() : nouvelleListe();
}
