import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Systems lab',
  description: 'A local eCommerce lab for learning how systems behave.',
};
/** Render the shared document shell around framework-supplied page content.
 * Input: props, from framework route/layout content.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
