import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootElement = document.getElementById('app');
if (!rootElement) {
  throw new Error('Failed to find root element #app');
}

const root = createRoot(rootElement);
root.render(<App />);
