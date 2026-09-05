import type { AssetClass, ScenarioProjection } from "../../contracts/diversification";
import {
  ASSET_CLASSES,
  CAPITAL_MARKET_ASSUMPTIONS,
  CORRELATION_MATRIX,
  assetClassShock,
  type ScenarioDefinition,
} from "./assumptions";
import { cholesky, correlate, mulberry32, normalGenerator } from "./rng";

export type AllocationWeights = Record<AssetClass, number>;

export interface ProjectionInput {
  actionId: string;
  baselineValueUsd: number;
  weights: AllocationWeights;
  scenario: ScenarioDefinition;
  seed: number;
  months?: number;
  paths?: number;
  rebalanceFrequencyMonths?: number;
}

function percentile(values: number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function roundCurrency(value: number): number {
  return Math.round(value);
}

export function normalizeWeights(
  weights: Partial<Record<AssetClass, number>>,
): AllocationWeights {
  const positive = ASSET_CLASSES.map((assetClass) =>
    Math.max(0, weights[assetClass] ?? 0),
  );
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error("Portfolio weights must sum to more than zero");
  return Object.fromEntries(
    ASSET_CLASSES.map((assetClass, index) => [assetClass, positive[index] / total]),
  ) as AllocationWeights;
}

export function runScenarioProjection(input: ProjectionInput): ScenarioProjection {
  const months = input.months ?? 36;
  const pathCount = input.paths ?? 2000;
  const rebalanceFrequency = input.rebalanceFrequencyMonths ?? 3;
  const weights = normalizeWeights(input.weights);
  const lower = cholesky(CORRELATION_MATRIX);
  const normal = normalGenerator(mulberry32(input.seed));
  const monthlyValues = Array.from({ length: months + 1 }, () => [] as number[]);
  const terminalValues: number[] = [];
  const pathDrawdowns: number[] = [];
  const pathVolatilities: number[] = [];

  for (let path = 0; path < pathCount; path += 1) {
    const sleeves = ASSET_CLASSES.map(
      (assetClass) => input.baselineValueUsd * weights[assetClass],
    );
    monthlyValues[0].push(input.baselineValueUsd);
    let priorValue = input.baselineValueUsd;
    let peakValue = input.baselineValueUsd;
    let pathMaxDrawdown = 0;
    const pathReturns: number[] = [];

    for (let month = 1; month <= months; month += 1) {
      const shocks = correlate(
        ASSET_CLASSES.map(() => normal()),
        lower,
      );
      for (let index = 0; index < ASSET_CLASSES.length; index += 1) {
        const assetClass = ASSET_CLASSES[index];
        const assumption = CAPITAL_MARKET_ASSUMPTIONS[assetClass];
        const dt = 1 / 12;
        const stochasticReturn = Math.exp(
          (assumption.expectedReturn - 0.5 * assumption.volatility ** 2) * dt +
            assumption.volatility * Math.sqrt(dt) * shocks[index],
        );
        sleeves[index] *= stochasticReturn;
        if (input.scenario.shockMonth === month) {
          sleeves[index] *= Math.max(0.05, 1 + assetClassShock(assetClass, input.scenario));
        }
      }
      const portfolioValue = sleeves.reduce((sum, value) => sum + value, 0);
      monthlyValues[month].push(portfolioValue);
      pathReturns.push(portfolioValue / priorValue - 1);
      priorValue = portfolioValue;
      peakValue = Math.max(peakValue, portfolioValue);
      pathMaxDrawdown = Math.min(pathMaxDrawdown, portfolioValue / peakValue - 1);
      if (month % rebalanceFrequency === 0 && month < months) {
        ASSET_CLASSES.forEach((assetClass, index) => {
          sleeves[index] = portfolioValue * weights[assetClass];
        });
      }
    }
    terminalValues.push(monthlyValues[months][path]);
    pathDrawdowns.push(Math.abs(pathMaxDrawdown));
    const meanMonthly =
      pathReturns.reduce((sum, value) => sum + value, 0) / pathReturns.length;
    const variance =
      pathReturns.reduce((sum, value) => sum + (value - meanMonthly) ** 2, 0) /
      Math.max(1, pathReturns.length - 1);
    pathVolatilities.push(Math.sqrt(variance * 12));
  }

  const points = monthlyValues.map((values, month) => {
    const p50 = roundCurrency(percentile(values, 0.5));
    return {
      month,
      p10_value: roundCurrency(percentile(values, 0.1)),
      p50_value: p50,
      p90_value: roundCurrency(percentile(values, 0.9)),
      cumulative_return_pct: Number(
        ((p50 / input.baselineValueUsd - 1) * 100).toFixed(3),
      ),
    };
  });
  const meanTerminal =
    terminalValues.reduce((sum, value) => sum + value, 0) / terminalValues.length;
  const annualizedReturn =
    (meanTerminal / input.baselineValueUsd) ** (12 / months) - 1;
  const annualizedVolatility = percentile(pathVolatilities, 0.5);
  const p05Terminal = percentile(terminalValues, 0.05);
  const worstTail = terminalValues.filter((value) => value <= p05Terminal);
  const tailMean =
    worstTail.reduce((sum, value) => sum + value, 0) / Math.max(1, worstTail.length);
  const riskFreeRate = CAPITAL_MARKET_ASSUMPTIONS["Cash and Equivalents"].expectedReturn;

  return {
    scenario_id: input.scenario.id,
    scenario_name: input.scenario.name,
    action_id: input.actionId,
    points,
    terminal_p10: roundCurrency(percentile(terminalValues, 0.1)),
    terminal_p50: roundCurrency(percentile(terminalValues, 0.5)),
    terminal_p90: roundCurrency(percentile(terminalValues, 0.9)),
    expected_return_pct: Number(
      ((meanTerminal / input.baselineValueUsd - 1) * 100).toFixed(2),
    ),
    annualized_return_pct: Number((annualizedReturn * 100).toFixed(2)),
    annualized_volatility_pct: Number((annualizedVolatility * 100).toFixed(2)),
    sharpe_ratio: Number(
      (
        (annualizedReturn - riskFreeRate) /
        Math.max(annualizedVolatility, 0.0001)
      ).toFixed(2),
    ),
    value_at_risk_95_usd: roundCurrency(
      Math.max(0, input.baselineValueUsd - p05Terminal),
    ),
    conditional_var_95_usd: roundCurrency(
      Math.max(0, input.baselineValueUsd - tailMean),
    ),
    max_drawdown_pct: Number((percentile(pathDrawdowns, 0.5) * 100).toFixed(2)),
    probability_of_loss_pct: Number(
      (
        (terminalValues.filter((value) => value < input.baselineValueUsd).length /
          terminalValues.length) *
        100
      ).toFixed(2),
    ),
  };
}

export function stringSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
