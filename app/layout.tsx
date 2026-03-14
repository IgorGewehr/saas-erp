import type { Metadata } from 'next';
import './globals.css';
import ThemeProvider from './components/providers/ThemeProvider';
import QueryProvider from './components/providers/QueryProvider';
import AuthProvider from './components/providers/AuthProvider';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export const metadata: Metadata = {
  title: 'ServicePro - Gestão para Prestadores de Serviço',
  description: 'Sistema completo de gestão para prestadores de serviço: agenda, clientes, financeiro, estoque e fiscal.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              {children}
              <ToastContainer
                position="top-right"
                autoClose={4000}
                hideProgressBar={false}
                newestOnTop
                closeOnClick
                rtl={false}
                pauseOnFocusLoss
                draggable
                pauseOnHover
                theme="light"
              />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
