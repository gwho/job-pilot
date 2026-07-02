import { Stagehand } from "@browserbasehq/stagehand";

export async function createStagehand(cdpUrl: string): Promise<Stagehand> {
  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: { cdpUrl },
    model: {
      // "openai/" prefix tells Stagehand to use its OpenAI provider; the rest is the
      // OpenRouter model ID sent as the model param to https://openrouter.ai/api/v1
      modelName: "openai/nvidia/nemotron-3-ultra-550b-a55b:free",
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: "https://openrouter.ai/api/v1",
    },
    disablePino: true,
  });
  await stagehand.init();
  return stagehand;
}
