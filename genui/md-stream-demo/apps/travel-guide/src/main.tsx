import React from 'react';
import { createRoot } from 'react-dom/client';
import { TravelGuideApp } from './TravelGuideApp';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TravelGuideApp />
  </React.StrictMode>,
);
