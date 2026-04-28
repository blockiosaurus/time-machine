import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Time Machine — chat with history',
  description:
    'Time Machine is a salon of NFT-backed AI personas of historical figures. Chat is free; owners earn from each character\'s Genesis token.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
