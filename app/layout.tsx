'use client';

import './globals.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: '\u{1F4CA}' },
  { href: '/dissolutions', label: 'Dissolutions', icon: '\u{1F3E2}' },
  { href: '/domains', label: 'Domains', icon: '\u{1F310}' },
  { href: '/alerts', label: 'Alerts', icon: '\u{1F514}' },
  { href: '/settings', label: 'Settings', icon: '\u2699\uFE0F' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <html lang="en">
      <head>
        <title>AustrianDomainWatch</title>
        <meta name="description" content="Monitor Austrian company dissolutions and expiring domains" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-dark-bg text-dark-text min-h-screen">
        {/* Mobile header */}
        <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-dark-card border-b border-dark-border px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-dark-text p-1"
            aria-label="Toggle menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {sidebarOpen ? (
                <path d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
          <span className="font-sans font-semibold text-lg text-accent">AustrianDomainWatch</span>
          <div className="w-8" />
        </div>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 z-30 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside
            className={`
              fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-dark-card border-r border-dark-border
              flex flex-col transition-transform duration-200 ease-in-out
              ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
              lg:translate-x-0
            `}
          >
            <div className="p-6 border-b border-dark-border">
              <h1 className="font-sans font-bold text-xl text-accent">AustrianDomainWatch</h1>
              <p className="text-dark-muted text-xs mt-1 font-mono">.at Domain Monitor</p>
            </div>

            <nav className="flex-1 p-4 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors
                      ${isActive
                        ? 'bg-accent/10 text-accent border-l-2 border-accent'
                        : 'text-dark-muted hover:text-dark-text hover:bg-dark-bg'
                      }
                    `}
                  >
                    <span className="text-lg">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="p-4 border-t border-dark-border">
              <div className="text-xs text-dark-muted font-mono">
                <p>v1.0.0</p>
                <p className="mt-1">Austrian Domain Watch</p>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0 pt-14 lg:pt-0">
            <div className="p-6 lg:p-8 max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
