import { Link } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { ReactNode } from 'react';

const NAV_LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'Pricing', href: '/#pricing' },
];

const FOOTER_LINKS = {
  Product: [
    { label: 'Features', to: '/#features' },
    { label: 'Pricing', to: '/#pricing' },
  ],
  Company: [
    { label: 'Privacy Policy', to: '/privacy' },
    { label: 'Terms of Service', to: '/terms' },
  ],
  Account: [
    { label: 'Sign in', to: '/login' },
    { label: 'Get started', to: '/login?tab=signup' },
    { label: 'Dashboard', to: '/dashboard' },
  ],
};

export function MarketingNav() {
  const { user } = useAuth();

  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.06] bg-[#080810]/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <span className="font-semibold text-[14px] tracking-tight">AYACODA AI Studio</span>
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="h-8 px-3 flex items-center text-[13px] rounded-lg transition-colors text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <Link
              to="/dashboard"
              className="flex items-center gap-1.5 h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-medium rounded-lg transition-colors"
            >
              Dashboard →
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="text-[13px] text-zinc-400 hover:text-zinc-200 transition-colors px-3"
              >
                Sign in
              </Link>
              <Link
                to="/login?tab=signup"
                className="flex items-center gap-1.5 h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-medium rounded-lg transition-colors"
              >
                Get started free
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/[0.04] py-16 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </div>
              <span className="font-semibold text-[14px] text-zinc-300">AYACODA AI Studio</span>
            </Link>
            <p className="text-[12px] text-zinc-600 leading-relaxed max-w-[200px]">
              AI-powered app builder. From prompt to production in seconds.
            </p>
          </div>

          {/* Link groups */}
          {Object.entries(FOOTER_LINKS).map(([group, links]) => (
            <div key={group}>
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.1em] mb-3">{group}</p>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-[13px] text-zinc-600 hover:text-zinc-300 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[12px] text-zinc-700">© {new Date().getFullYear()} AYACODA AI Studio. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="text-[12px] text-zinc-700 hover:text-zinc-500 transition-colors">Privacy</Link>
            <Link to="/terms" className="text-[12px] text-zinc-700 hover:text-zinc-500 transition-colors">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#080810] text-zinc-100 overflow-x-hidden">
      <MarketingNav />
      <div className="pt-14">{children}</div>
      <MarketingFooter />
    </div>
  );
}
