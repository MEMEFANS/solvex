import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/api';
import { installLegacyDOM, startRuntime } from '@/lib/runtime';
import App from './app';
import './styles.css';
import './brand-theme.css';
import './ui-refinement.css';
import './ui-system.css';
import './mobile-experience.css';
document.body.classList.add('solvex-react');
installLegacyDOM();
// Render wallet compatibility nodes before the classic wallet runtime initializes.
let resolveReady: () => void;
let rejectReady: (reason: unknown) => void;
window.solvexRuntimeReady = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
flushSync(() => createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>));
void startRuntime().then(() => resolveReady()).catch(error => rejectReady(error));
