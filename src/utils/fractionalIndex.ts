/**
 * Índices fraccionales para ordenar nodos del árbol de capas.
 *
 * Cada nodo guarda una `position` de texto; el orden entre hermanos es el orden
 * de bytes de ese texto (`COLLATE "C"` en Postgres, `<` en JS: para ASCII son
 * lo mismo). Mover un nodo entre dos hermanos genera UNA clave nueva entre las
 * de sus vecinos, sin renumerar al resto — por eso `move_node` hace un solo
 * UPDATE en vez de N.
 *
 * Es un port del algoritmo de David Greenspan
 * (https://observablehq.com/@dgreensp/implementing-fractional-indexing,
 * dominio público / CC0) con el alfabeto base 62 por defecto. La versión de
 * SQL (`generate_key_between` en la migración 20261014120000) es otro port del
 * MISMO algoritmo: ambos se validan con los mismos vectores
 * (src/test/fixtures/fractionalIndexVectors.json), que se generaron con la
 * librería de referencia `fractional-indexing`.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SMALLEST_INTEGER = "A" + DIGITS[0].repeat(26);

/** a < b en orden de bytes. */
const lt = (a: string, b: string): boolean => a < b;

// `a` puede ser "", `b` es null o no vacío. a < b si b no es null. Sin ceros finales.
const midpoint = (a: string, b: string | null): string => {
  const zero = DIGITS[0];
  if (b !== null && !lt(a, b)) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === zero || (b && b.slice(-1) === zero)) {
    throw new Error("trailing zero");
  }
  if (b) {
    // Quita el prefijo común, rellenando `a` con ceros a medida que avanza.
    let n = 0;
    while ((a[n] || zero) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))];
  }
  // Primeros dígitos consecutivos.
  if (b && b.length > 1) return b.slice(0, 1);
  // `b` es null o de un solo dígito: el primer dígito de `a` es el anterior a `b`.
  return DIGITS[digitA] + midpoint(a.slice(1), null);
};

const getIntegerLength = (head: string): number => {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
};

const validateInteger = (int: string): void => {
  if (int.length !== getIntegerLength(int[0])) {
    throw new Error(`invalid integer part of order key: ${int}`);
  }
};

const getIntegerPart = (key: string): string => {
  const len = getIntegerLength(key[0]);
  if (len > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, len);
};

const validateOrderKey = (key: string): void => {
  if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
  const i = getIntegerPart(key);
  const f = key.slice(i.length);
  if (f.slice(-1) === DIGITS[0]) throw new Error(`invalid order key: ${key}`);
};

/** Null si ya es el entero más grande. */
const incrementInteger = (x: string): string | null => {
  validateInteger(x);
  const head = x[0];
  let trailing = "";
  for (let i = x.length - 1; i >= 1; i--) {
    const d = DIGITS.indexOf(x[i]) + 1;
    if (d === DIGITS.length) {
      trailing = DIGITS[0] + trailing;
    } else {
      return head + x.slice(1, i) + DIGITS[d] + trailing;
    }
  }
  // Acarreo fuera de todo el tramo de dígitos.
  if (head === "Z") return "a" + DIGITS[0];
  if (head === "z") return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  return h + (h > "a" ? trailing + DIGITS[0] : trailing.slice(1));
};

/** Null si ya es el entero más chico. */
const decrementInteger = (x: string): string | null => {
  validateInteger(x);
  const head = x[0];
  const last = DIGITS[DIGITS.length - 1];
  let trailing = "";
  for (let i = x.length - 1; i >= 1; i--) {
    const d = DIGITS.indexOf(x[i]) - 1;
    if (d === -1) {
      trailing = last + trailing;
    } else {
      return head + x.slice(1, i) + DIGITS[d] + trailing;
    }
  }
  if (head === "a") return "Z" + last;
  if (head === "A") return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  return h + (h < "Z" ? trailing + last : trailing.slice(1));
};

/**
 * Clave estrictamente entre `a` y `b` (null = sin límite en ese lado).
 * Lanza si `a >= b`, o si alguna clave no es válida.
 */
export const generateKeyBetween = (a: string | null, b: string | null): string => {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && !lt(a, b)) throw new Error(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return "a" + DIGITS[0];
    const ib = getIntegerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint("", fb);
    if (lt(ib, b)) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error("cannot decrement any more");
    return res;
  }

  if (b === null) {
    const ia = getIntegerPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }

  const ia = getIntegerPart(a);
  const fa = a.slice(ia.length);
  const ib = getIntegerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInteger(ia);
  if (i === null) throw new Error("cannot increment any more");
  if (lt(i, b)) return i;
  return ia + midpoint(fa, null);
};

// ── Movimientos ───────────────────────────────────────────────────────────────

export interface Sibling {
  id: string;
  position: string;
}

export interface MoveAnchors {
  /** Hermano que quedará inmediatamente DESPUÉS del nodo movido (el nodo va antes de él). */
  beforeId?: string | null;
  /** Hermano que quedará inmediatamente ANTES del nodo movido (el nodo va después de él). */
  afterId?: string | null;
}

/** Orden total y determinista entre hermanos: por position y, si empatan, por id. */
export const compareSiblings = (x: Sibling, y: Sibling): number =>
  x.position < y.position ? -1 : x.position > y.position ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0;

/**
 * Posición que le toca a `movingId` al soltarlo entre `siblings` (los hijos
 * activos del padre destino; puede incluir al propio nodo, se ignora).
 *
 * Misma semántica que el RPC `move_node(node, parent, before_id, after_id)`:
 *  - `afterId` y `beforeId`: entre los dos (deben ser vecinos en ese orden).
 *  - solo `beforeId`: inmediatamente antes de ese hermano.
 *  - solo `afterId`: inmediatamente después de ese hermano.
 *  - ninguno: al final.
 */
export const computeMovePosition = (
  siblings: readonly Sibling[],
  movingId: string,
  { beforeId = null, afterId = null }: MoveAnchors = {},
): string => {
  const list = siblings.filter((s) => s.id !== movingId).sort(compareSiblings);
  const find = (id: string, label: string): number => {
    const i = list.findIndex((s) => s.id === id);
    if (i === -1) throw new Error(`${label} (${id}) no es un hermano activo del destino`);
    return i;
  };

  let prev: string | null;
  let next: string | null;
  if (afterId && beforeId) {
    const ia = find(afterId, "afterId");
    const ib = find(beforeId, "beforeId");
    if (compareSiblings(list[ia], list[ib]) >= 0) throw new Error("las anclas están fuera de orden");
    prev = list[ia].position;
    next = list[ib].position;
  } else if (beforeId) {
    const ib = find(beforeId, "beforeId");
    prev = ib > 0 ? list[ib - 1].position : null;
    next = list[ib].position;
  } else if (afterId) {
    const ia = find(afterId, "afterId");
    prev = list[ia].position;
    next = ia < list.length - 1 ? list[ia + 1].position : null;
  } else {
    prev = list.length ? list[list.length - 1].position : null;
    next = null;
  }
  return generateKeyBetween(prev, next);
};

/** Claves cortas son más baratas de almacenar y comparar; a partir de acá conviene renormalizar. */
export const REBALANCE_KEY_LENGTH = 48;
