import './sentry';
import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';
import './index.css';

function CrashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-sm p-8 text-center">
        <p className="font-display text-xl font-bold">Something went wrong</p>
        <p className="mt-2 mb-6 text-sm text-muted">The error has been reported. Reload the page to try again.</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashScreen />}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
