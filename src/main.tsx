import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { registerToolboxServiceWorker } from './lib/pwaUpdate';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Register Offline-First Service Worker with non-intrusive user-triggered updates (NEVER silent force-reload)
if (import.meta.env.PROD) {
  registerToolboxServiceWorker(`${import.meta.env.BASE_URL}sw.js`);
}
