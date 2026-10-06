import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The design system's sheets, tokens first: the app root in index.html carries
// `dv-root dv-ambient` and `data-theme`, which is what they style.
import './styles/divan-tokens.css';
import './styles/divan-components.css';
import { App } from './App';
import { Fallback } from './components/Fallback';

// The panel's own copy is English. i18n is here for one job: the daemon tags
// every error it sends with a code, and this turns those codes into a sentence.
// (The phone is the bilingual client; its table is what src/lib/i18n.ts mirrors.)

// Under a boundary, always: a panel that throws while drawing leaves an empty
// root behind, and an empty root on this page is a black rectangle with the
// reason in a console nobody has open.
createRoot(document.getElementById('root')!).render(
  <StrictMode><Fallback><App /></Fallback></StrictMode>,
);
