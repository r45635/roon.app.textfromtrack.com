import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/index.js';
import App from './App.jsx';
import LyricsKiosk from './components/LyricsKiosk.jsx';
import './styles/app.css';

const isKioskHash = () => window.location.hash.startsWith('#/lyrics');

// "#/lyrics?zone=…" is the full-screen lyrics display for a tablet or TV.
function Root() {
  const [kiosk, setKiosk] = useState(isKioskHash);
  useEffect(() => {
    const onHash = () => setKiosk(isKioskHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return kiosk ? <LyricsKiosk /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
