import type { ReactNode } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <div className="app-layout">
        <Sidebar />
        <main className="app-content" data-testid="app-content">
          {children}
        </main>
      </div>
    </>
  );
}