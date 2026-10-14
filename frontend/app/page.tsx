import RestBluApp from '@/modules/public-site/RestBluApp';

/**
 * La ruta principal solo conecta Vinext con el módulo de la experiencia pública.
 * Toda la lógica de RestBlu vive fuera de la carpeta de enrutamiento.
 */
export default function HomePage() {
  return <RestBluApp />;
}
