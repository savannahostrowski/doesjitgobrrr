export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-';

  if (seconds < 0.000001) {
    return (seconds * 1000000000).toFixed(0) + ' ns';
  } else if (seconds < 0.001) {
    return (seconds * 1000000).toFixed(0) + ' μs';
  } else if (seconds < 1) {
    const ms = seconds * 1000;
    // Remove unnecessary decimal places
    return (ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2)) + ' ms';
  } else {
    // Remove unnecessary decimal places for seconds
    return (seconds >= 100 ? seconds.toFixed(0) : seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)) + ' s';
  }
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return '-';
  if (num < 0.0001) {
    return num.toExponential(3);
  }
  return num.toFixed(6);
}

export function getArchitecture(machine: string): string {
  // ripley is x86_64, others default to aarch64
  // This can be expanded as more machines are added
  if (machine === 'ripley') {
    return 'x86_64';
  }
  return 'aarch64';
}

export interface SpeedupDisplay {
  text: string;
  className: 'faster' | 'slower' | 'neutral';
}

/**
 * Format a speedup value for display.
 * Speedup > 1 means faster, < 1 means slower.
 */
export function formatSpeedup(speedup: number | null): SpeedupDisplay {
  if (speedup === null) {
    return { text: '-', className: 'neutral' };
  }

  const roundedSpeedup = parseFloat(speedup.toFixed(2));

  if (roundedSpeedup === 1.00) {
    return { text: '1.00x', className: 'neutral' };
  } else if (speedup >= 1.0) {
    return { text: `${speedup.toFixed(2)}x faster`, className: 'faster' };
  } else {
    const slowdown = 1.0 / speedup;
    return { text: `${slowdown.toFixed(2)}x slower`, className: 'slower' };
  }
}

/**
 * Format speedup as a percentage change (e.g., "5.2% faster").
 */
export function formatSpeedupPercent(speedup: number | null): SpeedupDisplay {
  if (speedup === null) {
    return { text: '-', className: 'neutral' };
  }

  const roundedSpeedup = parseFloat(speedup.toFixed(2));

  if (roundedSpeedup === 1.00) {
    return { text: 'same speed', className: 'neutral' };
  } else if (speedup >= 1.0) {
    const percentFaster = ((speedup - 1) * 100).toFixed(1);
    return { text: `${percentFaster}% faster`, className: 'faster' };
  } else {
    const percentSlower = ((1 - speedup) * 100).toFixed(1);
    return { text: `${percentSlower}% slower`, className: 'slower' };
  }
}

/**
 * Generic comparison function for sorting arrays with null-safe handling.
 * Null/undefined values are always sorted to the end.
 */
export function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: 'asc' | 'desc'
): number {
  // Handle null/undefined values - always sort them to the end
  const aIsNull = a === null || a === undefined;
  const bIsNull = b === null || b === undefined;

  if (aIsNull && bIsNull) return 0;
  if (aIsNull) return 1;
  if (bIsNull) return -1;

  // At this point, both values are non-null
  let aComp: string | number = a;
  let bComp: string | number = b;

  // Handle string comparison (case-insensitive)
  if (typeof aComp === 'string' && typeof bComp === 'string') {
    aComp = aComp.toLowerCase();
    bComp = bComp.toLowerCase();
  }

  // Compare values based on direction
  if (direction === 'asc') {
    return aComp > bComp ? 1 : aComp < bComp ? -1 : 0;
  } else {
    return aComp < bComp ? 1 : aComp > bComp ? -1 : 0;
  }
}
