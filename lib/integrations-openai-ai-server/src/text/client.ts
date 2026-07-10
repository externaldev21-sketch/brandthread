import { openai } from "../client";

/**
 * Sends a chat completion request and returns the raw text content.
 * Use `responseFormatJson: true` to request a JSON object response
 * (the caller is still responsible for parsing/validating the JSON).
 */
export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  options?: { model?: string; responseFormatJson?: boolean }
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: options?.model ?? "gpt-4.1",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(options?.responseFormatJson ? { response_format: { type: "json_object" as const } } : {}),
  });

  return response.choices?.[0]?.message?.content ?? "";
}
