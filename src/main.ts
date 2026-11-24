import './style.css';
import { demarrer } from './ui/app.ts';
import { t } from './i18n/index.ts';
import { initialiserLangue } from './ui/langue.ts';

initialiserLangue();

if (!globalThis.crypto?.subtle) {
  document.getElementById('app')!.textContent =
    t('app.sans_webcrypto');
} else {
  demarrer(document.getElementById('app')!);
}
