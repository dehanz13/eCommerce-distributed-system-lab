import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Systems lab',
  description: 'A local eCommerce lab for learning how systems behave.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
