// Curated mapping of structured products to their underlying components
// This is version-controlled and carries assumptions explicitly

export interface LookThroughComponent {
  instrument_id: string;
  weight: number;
}

export interface LookThrough {
  structure: string;
  components: LookThroughComponent[];
  assumption: string;
  confidence_ceiling: number;
}

export const UNDERLYING_MAP: Record<string, LookThrough> = {
  "SYN-SP-0501": {
    structure: "worst_of_basket",
    components: [
      { instrument_id: "SYN-EQ-0008", weight: 1 / 3 }, // Global Energy Majors
      { instrument_id: "SYN-ST-0104", weight: 1 / 3 }, // Pacific Orient Shipping  
      { instrument_id: "SYN-ST-0103", weight: 1 / 3 }, // Helios Cloud Systems
    ],
    assumption:
      "Equal-weight attribution for exposure reporting. A worst-of payoff is not " +
      "economically equal-weight: downside tracks the weakest component, so this " +
      "UNDERSTATES tail correlation with the single worst name.",
    confidence_ceiling: 75,
  },
  "SYN-SP-0502": {
    structure: "single_underlying",
    components: [
      { instrument_id: "SYN-ST-0103", weight: 1.0 }, // Helios Cloud Systems
    ],
    assumption: "Direct single-name exposure via equity-linked note.",
    confidence_ceiling: 90,
  },
  "SYN-SP-0503": {
    structure: "accumulator",
    components: [
      { instrument_id: "SYN-ST-0106", weight: 1.0 }, // Golden Harbour Properties
    ],
    assumption:
      "Accumulator with double-up below strike. Economic exposure exceeds notional " +
      "when the underlying falls. Single-name concentration.",
    confidence_ceiling: 80,
  },
  "SYN-SP-0504": {
    structure: "capital_protected",
    components: [
      { instrument_id: "SYN-CM-0401", weight: 0.7 }, // Physical Gold (70% participation)
    ],
    assumption:
      "Capital protected with 70% participation. Downside limited to 0%, upside " +
      "70% of gold spot. Not full gold exposure.",
    confidence_ceiling: 85,
  },
  "SYN-SP-0505": {
    structure: "worst_of_basket",
    components: [
      { instrument_id: "SYN-ST-0104", weight: 1 / 3 }, // Pacific Orient Shipping
      { instrument_id: "SYN-EQ-0008", weight: 1 / 3 }, // Global Energy Majors
      { instrument_id: "SYN-ST-0101", weight: 1 / 3 }, // Bara Nusantara Energy
    ],
    assumption:
      "Equal-weight attribution for exposure reporting. A worst-of payoff is not " +
      "economically equal-weight: downside tracks the weakest component, so this " +
      "UNDERSTATES tail correlation with the single worst name.",
    confidence_ceiling: 75,
  },
  "SYN-SP-0506": {
    structure: "autocallable",
    components: [
      // Three Asian banking majors - not individually specified in dataset
      // Would need bank names to map precisely
    ],
    assumption:
      "Worst-of basket over three Asian banking majors. Individual components not " +
      "specified in dataset; cannot decompose to single-name level.",
    confidence_ceiling: 60,
  },
  "SYN-CM-0401": {
    structure: "physical_allocated",
    components: [
      { instrument_id: "SYN-CM-0401", weight: 1.0 }, // Self-reference for XAU spot
    ],
    assumption: "Physical gold allocated in Singapore vault. Direct spot exposure.",
    confidence_ceiling: 95,
  },
  "SYN-CM-0402": {
    structure: "etf",
    components: [
      { instrument_id: "SYN-CM-0401", weight: 1.0 }, // Maps to physical gold spot
    ],
    assumption: "Gold ETF tracking XAU spot. Small tracking error expected.",
    confidence_ceiling: 95,
  },
  "SYN-AL-0308": {
    structure: "private_equity",
    components: [
      { instrument_id: "SYN-AL-0308", weight: 1.0 }, // Unlisted tech holding
    ],
    assumption:
      "Series D preference shares, last priced Sep-2025. Mark is stale by nearly " +
      "a year. Single-name concentration in an illiquid private position.",
    confidence_ceiling: 50,
  },
};

export function resolveLookThrough(instrumentId: string): LookThrough | null {
  return UNDERLYING_MAP[instrumentId] || null;
}
