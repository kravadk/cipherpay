import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './config/wagmi';
import './index.css';

// Layouts
import { LandingLayout } from './layouts/LandingLayout';
import { AppLayout } from './layouts/AppLayout';

// Pages
import { Home } from './pages/Home';
import { Manifesto } from './pages/Manifesto';
import { HowItWorks } from './pages/HowItWorks';
import { Dashboard } from './pages/app/Dashboard';
import { Explorer } from './pages/app/Explorer';
import { NewCipher } from './pages/app/NewCipher';
import { Identity } from './pages/app/Identity';
import { Build } from './pages/app/Build';
import { Guide } from './pages/app/Guide';
import { Recurring } from './pages/app/Recurring';
import { Batch } from './pages/app/Batch';
import { CipherDrop } from './pages/app/CipherDrop';
import { Settings } from './pages/app/Settings';
import { Notifications } from './pages/app/Notifications';
import { Claim } from './pages/Claim';
import { Pay } from './pages/Pay';
import { Profile } from './pages/Profile';
import { ToastContainer } from './components/ToastContainer';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastContainer />
          <Routes>
            {/* Public Routes */}
            <Route element={<LandingLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/manifesto" element={<Manifesto />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
            </Route>

            {/* Public claim & pay pages (no sidebar) */}
            <Route path="/claim/:hash" element={<Claim />} />
            <Route path="/pay/:hash" element={<Pay />} />
            <Route path="/profile/:address" element={<Profile />} />

            {/* App Routes */}
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate to="/app/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="explorer" element={<Explorer />} />
              <Route path="new-cipher" element={<NewCipher />} />
              <Route path="recurring" element={<Recurring />} />
              <Route path="batch" element={<Batch />} />
              <Route path="cipher-drop" element={<CipherDrop />} />
              <Route path="identity" element={<Identity />} />
              <Route path="build" element={<Build />} />
              <Route path="guide" element={<Guide />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="settings" element={<Settings />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
