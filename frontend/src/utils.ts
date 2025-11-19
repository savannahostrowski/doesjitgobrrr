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
