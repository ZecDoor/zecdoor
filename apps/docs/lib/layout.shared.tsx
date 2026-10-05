import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, SOURCE_URL } from './shared';

function Logo() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
      <svg width="20" height="20" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M4 12.5 14 4l10 8.5V24H4V12.5Z" stroke="var(--color-fd-primary)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M9 18h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {appName} <span style={{ opacity: 0.6, fontWeight: 500 }}>Docs</span>
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Logo />, url: '/' },
    ...(SOURCE_URL ? { githubUrl: SOURCE_URL } : {}),
    links: [
      // Other parts of the same site, outside this Next app: plain anchors, so basePath
      // (/docs) is not added and no client-side routing is attempted.
      {
        type: 'custom',
        children: (
          <div className="flex items-center gap-3 py-1">
            <a href="/app/" className="text-sm font-medium text-fd-primary-foreground bg-fd-primary rounded-md px-3 py-1.5">
              Open the app
            </a>
            <a href="/" className="text-sm text-fd-muted-foreground hover:text-fd-foreground">
              ZecDoor home
            </a>
          </div>
        ),
      },
    ],
  };
}
