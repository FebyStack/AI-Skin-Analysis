import { HttpLesionProvider, FakeLesionProvider, type LesionProvider } from "./lesion-client";

// LESION_FAKE=1 → run the backend with no Python service (golden fixture).
// Otherwise talk to the FastAPI lesion service at LESION_SERVICE_URL.
export function lesionProviderFromEnv(): LesionProvider {
  if (process.env.LESION_FAKE === "1") return new FakeLesionProvider();
  return new HttpLesionProvider(process.env.LESION_SERVICE_URL ?? "http://localhost:8000");
}
