import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { ThemeProvider } from './app/ThemeProvider';
import { UIProvider } from './app/UIProvider';
import { MessageProvider } from './app/MessageProvider';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <MessageProvider>
          <UIProvider>
            <App />
          </UIProvider>
        </MessageProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
