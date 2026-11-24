import { grouper } from '../crypto/empreinte.ts';
import { h, type Enfant } from './dom.ts';
import { notifier } from './session.ts';

export function carte(titre: string, ...contenu: Enfant[]) {
  return h('section', { class: 'carte' }, h('h2', null, titre), ...contenu);
}

export function champ(libelle: string, controle: HTMLElement, aide?: string) {
  const id = controle.id || `c-${Math.random().toString(36).slice(2, 9)}`;
  controle.id = id;
  return h('div', { class: 'champ' }, h('label', { for: id }, libelle), controle, aide && h('p', { class: 'aide' }, aide));
}

export function motDePasse(placeholder = '', autocomplete = 'current-password') {
  return h('input', { type: 'password', placeholder, autocomplete, required: true });
}

/** Empreinte lisible à voix haute, avec bouton pour la copier entière. */
export function empreinte(hex: string, groupes = 8) {
  return h(
    'span',
    { class: 'empreinte' },
    h('code', { title: hex }, grouper(hex, groupes)),
    h(
      'button',
      {
        class: 'lien',
        type: 'button',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(hex);
            notifier('Empreinte copiée.', 'succes');
          } catch {
            notifier('Copie impossible : sélectionnez le texte manuellement.', 'erreur');
          }
        },
      },
      'Copier',
    ),
  );
}

export function badge(texte: string, type: 'neutre' | 'attente' | 'ok' | 'refus' | 'alerte' = 'neutre') {
  return h('span', { class: `badge ${type}` }, texte);
}

export function bouton(texte: string, onclick: () => void, type: 'principal' | 'secondaire' | 'danger' = 'secondaire', disabled = false) {
  return h('button', { type: 'button', class: `bouton ${type}`, onclick, disabled }, texte);
}

export function encadre(type: 'info' | 'alerte' | 'erreur' | 'ok', ...contenu: Enfant[]) {
  return h('div', { class: `encadre ${type}` }, ...contenu);
}
