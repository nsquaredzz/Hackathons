export type Place = { name: string; lat: number; lon: number }

/** Villages and towns the phone can be set to (Fani's landfall area and nearby coast). */
export const PRESETS: Place[] = [
  { name: 'Puri town', lat: 19.8106, lon: 85.8314 },
  { name: 'Konark', lat: 19.8876, lon: 86.0945 },
  { name: 'Satapada', lat: 19.6700, lon: 85.4400 },
  { name: 'Gopalpur, Ganjam', lat: 19.2586, lon: 84.9056 },
  { name: 'Paradip', lat: 20.3165, lon: 86.6114 },
]
