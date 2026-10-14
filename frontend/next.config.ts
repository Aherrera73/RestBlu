import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // RestBlu es una SPA y puede publicarse como archivos estáticos en
  // Firebase Hosting. Las llamadas al gestor local siguen ejecutándose desde
  // el navegador cuando ese programa está abierto en el equipo.
  output: 'export',
};

export default nextConfig;
