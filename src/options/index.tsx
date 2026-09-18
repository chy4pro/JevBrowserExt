import React from 'react';
import ReactDOM from 'react-dom/client';
import { Options } from './Options';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <Options />
    </React.StrictMode>
  );
}
