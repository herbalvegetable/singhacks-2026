import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { Signal } from "../contracts/signal";
import { z } from "zod";
import { stripInternalReferenceTags } from "./outputSanitizer";
import { assessNarrativeSuitability } from "../compute/suitability";
import {
  OPENAI_REQUEST_OPTIONS,
  requireAgentsEnabled,
} from "./runtime";
import {
  clientPseudonym,
  restoreClientPseudonym,
} from "./privacy";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "agents-disabled",
  ...OPENAI_REQUEST_OPTIONS,
});

export const NARRATIVE_PROMPT_VERSION = "narrative-v2";

const NarrativeSchema = z.object({
  story: z.string().max(5000).describe("Three-paragraph narrative explaining what happened, why it matters, and what to consider"),
  opening_line: z.string().max(500).describe("One-line opening for a client conversation"),
  recommended_action: z.object({
    title: z.string().max(300),
    rationale: z.string().max(1500),
    steps: z.array(z.string().max(500)).max(8),
    confidence: z.number().min(0).max(100),
  }).nullable(),
  caveats: z.array(z.string().max(500)).max(10).describe("Things we cannot determine or are uncertain about"),
  confidence: z.number().min(0).max(100).describe("Overall confidence in this analysis"),
});

type GeneratedNarrative = z.infer<typeof NarrativeSchema>;
type Narrative = GeneratedNarrative & {
  suitability: ReturnType<typeof assessNarrativeSuitability>;
};

export function attachNarrativeSuitability(
  value: unknown,
): Narrative {
  const narrative = NarrativeSchema.parse(value);
  return {
    ...narrative,
    suitability: assessNarrativeSuitability(narrative.recommended_action),
  };
}

interface NarrativeClientContext {
  client_id: string;
  client_name: string;
  age: number | null;
  risk_profile: string;
  objectives: string;
  life_stage: string;
  total_aum_usd: number;
}

export class NarrativeAgent {
  private systemPrompt = `You are a narrative agent for Verity, an AI wealth intelligence system.

Your role: Turn verified, structured facts about a client's portfolio into clear, actionable prose for their Relationship Manager.

RULES:
1. You receive structured signals with evidence. All numbers are already computed and verified.
2. You MUST NOT do arithmetic. Use the numbers provided exactly as given.
3. Every claim must trace to the evidence in the signal.
4. If something is uncertain or missing from the data, SAY SO explicitly in the caveats.
5. Write in a professional but conversational tone - like a senior analyst briefing an RM.
6. Focus on "what happened, why it matters, what to consider doing about it."
7. Never include internal record IDs or reference tags such as [narrative:...], [signal:...], or [diversification:...] in any output text.
8. Keep recommendations conservative and discussion-oriented. Do not claim that a free-form recommendation is mandate-compliant or suitable, and do not invent allocation percentages. Any portfolio change requires quantified diversification analysis.

OUTPUT FORMAT:
Return only valid JSON. Do not wrap it in markdown.
- story: Three paragraphs (what/why/what-to-do)
- opening_line: How the RM should open the conversation with the client
- recommended_action: An object with title, rationale, steps, and confidence; use null if there is no clear action
- caveats: Always an array of strings; use an empty array if there are no caveats
- confidence: 0-100 score for overall confidence`;

  async generateNarrative(
    signal: Signal,
    clientContext: NarrativeClientContext
  ): Promise<Narrative> {
    requireAgentsEnabled();
    const userMessage = `Generate a narrative for this signal:

SIGNAL:
${JSON.stringify(signal, null, 2)}

CLIENT CONTEXT:
- Client reference: ${clientPseudonym(clientContext.client_id)}
- Age: ${clientContext.age}
- Risk Profile: ${clientContext.risk_profile}
- Objectives: ${clientContext.objectives}
- Life Stage: ${clientContext.life_stage}

Focus on making this actionable and specific to this client's situation.`;

    const completion = await openai.chat.completions.parse({
      model: "gpt-4o",
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: zodResponseFormat(NarrativeSchema, "narrative"),
      temperature: 0.3,
      max_completion_tokens: 1000,
    });

    const narrative = completion.choices[0].message.parsed;
    if (!narrative) {
      throw new Error("Failed to parse narrative from OpenAI response");
    }
    const restoreIdentity = (text: string) =>
      restoreClientPseudonym(
        text,
        clientContext.client_id,
        clientContext.client_name,
      );

    return attachNarrativeSuitability({
      ...narrative,
      story: stripInternalReferenceTags(restoreIdentity(narrative.story)),
      opening_line: stripInternalReferenceTags(
        restoreIdentity(narrative.opening_line),
      ),
      recommended_action: narrative.recommended_action
        ? {
            ...narrative.recommended_action,
            title: stripInternalReferenceTags(
              restoreIdentity(narrative.recommended_action.title),
            ),
            rationale: stripInternalReferenceTags(
              restoreIdentity(narrative.recommended_action.rationale),
            ),
            steps: narrative.recommended_action.steps.map((step) =>
              stripInternalReferenceTags(restoreIdentity(step)),
            ),
          }
        : null,
      caveats: narrative.caveats.map((caveat) =>
        stripInternalReferenceTags(restoreIdentity(caveat)),
      ),
    });
  }

  async generateClientBrief(
    signals: Signal[],
    clientContext: NarrativeClientContext
  ): Promise<{
    summary: string;
    priorities: Array<{ signal_id: string; rationale: string }>;
    confidence: number;
  }> {
    requireAgentsEnabled();
    const briefMessage = `Generate a brief summary for this client's morning brief.

CLIENT: ${clientPseudonym(clientContext.client_id)}
AUM: $${(clientContext.total_aum_usd / 1_000_000).toFixed(1)}M
Life Stage: ${clientContext.life_stage}
Objectives: ${clientContext.objectives}

SIGNALS (${signals.length}):
${signals.map((s, i) => `${i + 1}. [${s.type}] ${s.headline} (Urgency: ${s.urgency_score})`).join('\n')}

Write a 2-paragraph executive summary of what the RM needs to know, and prioritize the top 3 signals to address.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: briefMessage },
      ],
      temperature: 0.3,
      max_completion_tokens: 800,
    });

    // For now, return a simplified structure
    // In production, this would use structured output
    const content = stripInternalReferenceTags(
      restoreClientPseudonym(
        completion.choices[0].message.content || "",
        clientContext.client_id,
        clientContext.client_name,
      ),
    );

    return {
      summary: content,
      priorities: signals.slice(0, 3).map((s) => ({
        signal_id: s.signal_id,
        rationale: "High urgency and materiality",
      })),
      confidence: 75,
    };
  }
}
