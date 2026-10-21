import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createAppRuntime } from './app-runtime.ts';
import './app.css';

const runtime = createAppRuntime();
const root = createRoot(document.getElementById('root')!);
root.render(<App runtime={runtime} />);
void runtime.initialize();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
    void runtime.dispose();
  });
}
