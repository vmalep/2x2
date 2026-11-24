/**
 * État de la séance : identité déverrouillée, liste ouverte, enregistrement.
 * Seule une copie chiffrée de la liste non enregistrée est gardée dans le navigateur (voir secours.ts).
 */
import type { IdentiteDeverrouillee } from '../crypto/cles.ts';
import { calculerAlertes, type Alerte } from '../controles/controles.ts';
import { chiffrerListe, dechiffrerListe } from '../model/fichier-liste.ts';
import { verifierListe, type Etat, type Verification } from '../model/journal.ts';
import type { Liste, Role } from '../model/types.ts';
import { effacerSecours, programmerSecours } from './secours.ts';
import { demanderEmplacement, ecrireDansPoignee, enregistrementDirect, nomDeFichierSur, telecharger } from './fichiers.ts';
import { langueCourante, t } from '../i18n/index.ts';

export type Ecran = 'accueil' | 'import' | 'correction' | 'validation' | 'export' | 'journal' | 'aide';

export interface Session {
  identite?: IdentiteDeverrouillee;
  liste?: Liste;
  etat?: Etat;
  verification?: Verification;
  /** Gardé en mémoire le temps de la séance pour pouvoir réenregistrer le fichier. */
  motDePasseListe?: string;
  poignee?: FileSystemFileHandle;
  nomFichierListe?: string;
  nonEnregistre: boolean;
  ecran: Ecran;
  menageSelectionne?: string;
  /** Décisions signées par moi depuis l'ouverture ou le dernier reçu : rappel de produire un reçu. */
  decisionsDepuisRecu: number;
  /** Clé créée pendant cette séance : on guide la transmission de la clé publique. */
  cleNouvelle?: boolean;
  /** Comparaison côte à côte en cours (doublons) : ménages et alerte d'origine. */
  comparaison?: { menages: string[]; alerte?: string };
}

export const session: Session = { nonEnregistre: false, ecran: 'accueil', decisionsDepuisRecu: 0 };

// ---------- Alertes (recalculées seulement quand le journal change) ----------

let cacheAlertes: { cle: string; alertes: Alerte[] } | undefined;

export function alertesCourantes(): Alerte[] {
  const { liste, etat } = session;
  if (!liste || !etat) return [];
  // Les libellés des règles par défaut et les messages dépendent de la langue.
  const cle = `${liste.journal.at(-1)!.empreinte}|${langueCourante()}`;
  if (cacheAlertes?.cle !== cle) cacheAlertes = { cle, alertes: calculerAlertes(etat, etat.reglesCourantes()) };
  return cacheAlertes.alertes;
}

let rendu: () => void = () => {};
export function surRafraichissement(f: () => void) {
  rendu = f;
}
export function rafraichir() {
  rendu();
}

export function aller(ecran: Ecran) {
  session.ecran = ecran;
  // Les erreurs concernent l'écran quitté : on les retire.
  document.querySelectorAll('#notifications .notification.erreur').forEach((n) => n.remove());
  rafraichir();
}

// ---------- Notifications et opérations longues ----------

export function notifier(message: string, type: 'info' | 'succes' | 'erreur' = 'info') {
  const zone = document.getElementById('notifications');
  if (!zone) return;
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.setAttribute('role', type === 'erreur' ? 'alert' : 'status');
  el.textContent = message;
  const fermer = document.createElement('button');
  fermer.className = 'fermer';
  fermer.setAttribute('aria-label', t('commun.fermer'));
  fermer.textContent = '×';
  fermer.addEventListener('click', () => el.remove());
  el.appendChild(fermer);
  zone.appendChild(el);
  // Trois notifications au plus : les plus anciennes disparaissent.
  while (zone.children.length > 3) zone.firstElementChild!.remove();
  if (type !== 'erreur') setTimeout(() => el.remove(), 6000);
}

export async function occupe<T>(message: string, f: () => Promise<T>): Promise<T | undefined> {
  const voile = document.getElementById('voile')!;
  voile.querySelector('.message')!.textContent = message;
  voile.hidden = false;
  try {
    // Laisse le navigateur afficher le voile avant les calculs.
    await new Promise((r) => setTimeout(r, 30));
    return await f();
  } catch (e) {
    console.error(e);
    notifier((e as Error).message || String(e), 'erreur');
    return undefined;
  } finally {
    voile.hidden = true;
  }
}

// ---------- Droits ----------

export function moi() {
  const empreinte = session.identite?.empreinte;
  return empreinte ? session.etat?.utilisateurs.get(empreinte) : undefined;
}

export function peut(role: Role): boolean {
  return !!session.verification?.valide && (moi()?.roles.includes(role) ?? false);
}

export function nomAuteur(empreinte: string): string {
  return session.etat?.utilisateurs.get(empreinte)?.nom ?? t('session.auteur_inconnu');
}

// ---------- Fichier de liste ----------

export async function ouvrirListe(texte: string, nomFichier: string, motDePasse: string, reprise = false) {
  const liste = await dechiffrerListe(texte, motDePasse);
  const verification = await verifierListe(liste);
  Object.assign(session, {
    liste,
    etat: verification.etat,
    verification,
    motDePasseListe: motDePasse,
    poignee: undefined,
    nomFichierListe: nomFichier,
    nonEnregistre: reprise,
    menageSelectionne: undefined,
    comparaison: undefined,
    decisionsDepuisRecu: 0,
  });
  session.ecran = verification.valide ? 'correction' : 'journal';
  const ecart = reprise ? undefined : ecartDeVersion(nomFichier, liste);
  if (ecart) notifier(ecart, 'erreur');
  if (!verification.valide) notifier(t('session.altere'), 'erreur');
  else if (!moi()) notifier(t('session.cle_non_declaree'), 'erreur');
}

export function fermerListe() {
  if (session.nonEnregistre && !confirm(t('session.fermer_non_enregistre'))) return;
  if (session.decisionsDepuisRecu > 0 && !confirm(t('session.fermer_sans_recu'))) return;
  effacerSecours();
  Object.assign(session, {
    liste: undefined,
    etat: undefined,
    verification: undefined,
    motDePasseListe: undefined,
    poignee: undefined,
    nomFichierListe: undefined,
    nonEnregistre: false,
    menageSelectionne: undefined,
    comparaison: undefined,
    decisionsDepuisRecu: 0,
    ecran: 'accueil',
  });
  rafraichir();
}

function nomDeBase(liste: Liste): string {
  return `liste_${nomDeFichierSur(liste.original.nomFichier.replace(/\.[^.]+$/, ''))}.2x2`;
}

/** Version d'une liste : n° de la dernière entrée du journal et début de son empreinte (distingue deux branches). */
export function versionListe(liste: Liste): { numero: number; texte: string } {
  const derniere = liste.journal.at(-1)!;
  return { numero: derniere.n, texte: `v${String(derniere.n).padStart(3, '0')}-${derniere.empreinte.slice(0, 4)}` };
}

/** Nom de fichier versionné : liste_<export>_v042-3f9a_2026-11-23.2x2 (aucun nom de personne). */
export function nomVersionne(liste: Liste): string {
  const date = liste.journal.at(-1)!.le.slice(0, 10);
  return nomDeBase(liste).replace(/\.2x2$/, `_${versionListe(liste).texte}_${date}.2x2`);
}

/** Compare la version indiquée par le nom du fichier à celle de son contenu : le contenu fait foi. */
export function ecartDeVersion(nomFichier: string, liste: Liste): string | undefined {
  const m = nomFichier.match(/_v(\d{3,})-([0-9a-f]{4})/);
  if (!m) return undefined;
  const reelle = versionListe(liste).texte;
  const annoncee = `v${m[1]}-${m[2]}`;
  return annoncee === reelle ? undefined : t('session.ecart_version', { annoncee, reelle });
}

/** Enregistre le fichier chiffré : directement sur le disque si possible, sinon par téléchargement. */
/**
 * Enregistre le fichier chiffré sous un nom versionné, le même dans tous les navigateurs :
 * Edge et Chrome ouvrent la boîte « Enregistrer sous » (on choisit le dossier), Firefox télécharge.
 * Chaque enregistrement crée une nouvelle version ; rien n'est réécrit automatiquement en arrière-plan
 * (la copie de secours chiffrée du navigateur protège le travail non enregistré).
 */
export async function enregistrer() {
  const { liste, motDePasseListe } = session;
  if (!liste || !motDePasseListe) return;
  const contenu = await chiffrerListe(liste, motDePasseListe);
  const nom = nomVersionne(liste);
  if (enregistrementDirect) {
    const poignee = await demanderEmplacement(nom);
    if (!poignee) return;
    await ecrireDansPoignee(poignee, contenu);
    session.nomFichierListe = poignee.name;
    notifier(t('session.enregistree', { nom: poignee.name }), 'succes');
  } else {
    telecharger(nom, contenu, 'application/json');
    session.nomFichierListe = nom;
    notifier(t('session.telechargee', { nom }), 'succes');
  }
  session.nonEnregistre = false;
  effacerSecours();
  rafraichir();
}

/** Après chaque ligne signée : la liste est à enregistrer, et une copie de secours chiffrée est gardée. */
export async function apresModification() {
  session.nonEnregistre = true;
  sauvegarderEnSecours();
  rafraichir();
}

let echecSecoursSignale = false;
function sauvegarderEnSecours() {
  const { liste, motDePasseListe } = session;
  if (!liste || !motDePasseListe) return;
  programmerSecours(liste, motDePasseListe, session.nomFichierListe ?? nomVersionne(liste), () => versionListe(liste).texte, (raison) => {
    if (echecSecoursSignale) return;
    echecSecoursSignale = true;
    notifier(t('session.secours_impossible', { raison }), 'erreur');
  });
}

window.addEventListener('beforeunload', (e) => {
  if (session.nonEnregistre) e.preventDefault();
});
