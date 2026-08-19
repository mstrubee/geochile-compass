/**
 * Caché con tope de entradas y desalojo del menos usado recientemente.
 *
 * Los cachés de este proyecto se llenan con claves derivadas del VIEWPORT
 * (bbox + zoom), así que cada paneo de más de ~110 m crea una entrada nueva. Sin
 * tope, una sesión de trabajo normal acumula cientos de entradas de miles de
 * polígonos cada una, y la app se va poniendo lenta a medida que la memoria
 * crece — que es exactamente el síntoma reportado.
 *
 * Se apoya en que `Map` de JS conserva el orden de inserción: reinsertar una
 * clave al leerla la manda al final, así que la primera del iterador es siempre
 * la menos usada recientemente.
 */
export class LruCache<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly maxEntries: number) {
    if (maxEntries < 1) throw new Error("LruCache necesita al menos 1 entrada");
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key) as V;
    // Refresca la posición: sin esto el orden sería de inserción, no de uso, y
    // se desalojaría justo la entrada que se está usando todo el tiempo.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  keys(): K[] {
    return [...this.map.keys()];
  }
}
