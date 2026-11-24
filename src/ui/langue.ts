/** Choix de la langue de l'interface : mémorisé dans ce navigateur, sinon langue du navigateur. */
import { definirLangue, langueCourante, langueInitiale, t, type Langue } from '../i18n/index.ts';

const CLE = '2x2-langue';

function appliquerAuDocument() {
  document.documentElement.lang = langueCourante();
  document.title = t('app.titre');
}

export function initialiserLangue() {
  let memorisee: string | null = null;
  try {
    memorisee = localStorage.getItem(CLE);
  } catch {
    /* stockage indisponible : langue du navigateur */
  }
  const navigateur = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
  definirLangue(langueInitiale(memorisee, navigateur));
  appliquerAuDocument();
}

export function choisirLangue(l: Langue) {
  definirLangue(l);
  try {
    localStorage.setItem(CLE, l);
  } catch {
    /* stockage indisponible : le choix vaut pour cette séance */
  }
  appliquerAuDocument();
}
