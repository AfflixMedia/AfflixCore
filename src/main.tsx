import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles.css';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { NotificationsProvider } from './notifications/NotificationsContext';
import { TaskReminderProvider } from './notifications/TaskReminderContext';
import { registerSW } from './notifications/swSetup';

registerSW();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationsProvider>
          <TaskReminderProvider>
            <App />
          </TaskReminderProvider>
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
