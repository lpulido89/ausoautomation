import { readCarouselImage } from '../../carousel-image/[id].js';

export function onRequestGet({ params, env }) {
  return readCarouselImage(String(params.id || ''), env, true);
}
