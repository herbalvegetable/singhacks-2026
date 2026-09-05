export type RandomSource = () => number;

export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalGenerator(random: RandomSource): RandomSource {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    const u = Math.max(random(), Number.EPSILON);
    const v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}

export function cholesky(matrix: number[][]): number[][] {
  const size = matrix.length;
  if (size === 0 || matrix.some((row) => row.length !== size)) {
    throw new Error("Correlation matrix must be non-empty and square");
  }

  const lower = Array.from({ length: size }, () => Array<number>(size).fill(0));
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = 0;
      for (let k = 0; k < column; k += 1) {
        sum += lower[row][k] * lower[column][k];
      }
      if (row === column) {
        const diagonal = matrix[row][row] - sum;
        if (diagonal <= 0) {
          throw new Error("Correlation matrix must be positive definite");
        }
        lower[row][column] = Math.sqrt(diagonal);
      } else {
        lower[row][column] =
          (matrix[row][column] - sum) / lower[column][column];
      }
    }
  }
  return lower;
}

export function correlate(independent: number[], lower: number[][]): number[] {
  return lower.map((row, rowIndex) =>
    row
      .slice(0, rowIndex + 1)
      .reduce((sum, coefficient, column) => sum + coefficient * independent[column], 0),
  );
}
