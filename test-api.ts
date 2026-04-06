import "dotenv/config";
import { readAsuAimlProviderConfig } from "./src/core/api.js";
import { requestAsuAimlChatCompletion } from "./src/core/llm.js";

async function run() {
  console.log("Testing ASU AI Platform API...");
  try {
    const config = readAsuAimlProviderConfig();
    console.log("Using model:", config.model);
    console.log("Using provider:", config.modelProvider);
    
    const prompt = "Explain quantum computing in 1 sentence.";
    const response = await requestAsuAimlChatCompletion(config, prompt);
    
    console.log("\n✅ Response Received:");
    console.log(response);
  } catch (error) {
    console.error("\n❌ API Test Failed:");
    console.error(error);
  }
}

run();
