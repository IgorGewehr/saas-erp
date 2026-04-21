import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Cardápio',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
